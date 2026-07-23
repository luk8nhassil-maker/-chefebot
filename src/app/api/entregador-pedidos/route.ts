import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { autenticarEntregador, pedidoIdValido } from "@/lib/entregadorAuth";
import type { PedidoEntregador } from "@/types/entregador";
import { creditarPontosPedidoEntregue } from "@/lib/fidelidade";
import { processarConclusaoPedidoJornada } from "@/lib/jornadaChef";
import type { ItemApp } from "@/lib/pedidoAppItens";
import type { ItemElegibilidadeJornada } from "@/lib/jornadaChef";
import { executarComLockPedidos, LOCK_KEY as PEDIDOS_LOCK_KEY } from "@/lib/pedidosStore";

type PedidoMain = {
  id: string;
  status: string;
  telefone?: string;
  total?: number;
  taxaEntrega?: number;
  clienteId?: string;
  entregador?: { id: string; nome: string; telefone: string };
  origem?: string;
  tipoEntrega?: string;
  itensDetalhados?: ItemApp[];
  itensJornada?: ItemElegibilidadeJornada[];
  recompensaJornadaId?: string;
  revision?: number;
};

const ACAO_PATTERN = /^(iniciar|entregar)$/;

// FENCING: mesmo padrão de src/lib/pedidosStore.ts/src/app/api/orders/route.ts
// — a transição para "entregue" grava "pedidos" e a fila do entregador no
// MESMO EVAL Lua, cercado (fenced) pelo token do lock global de "pedidos".
// Antes desta correção, esta rota gravava "pedidos" diretamente (sem
// nenhum lock) — uma corrida real com QUALQUER outro writer (painel,
// WhatsApp, cron) podia perder a mudança de status de um pedido diferente.
const ENTREGAR_LUA = `
if redis.call("get", KEYS[1]) ~= ARGV[1] then
  return "lock_perdido"
end
redis.call("SET", KEYS[2], ARGV[2])
redis.call("SET", KEYS[3], ARGV[3], "EX", 86400)
return 1
`;

// FENCING (achado MÉDIO da revisão externa do PR #252): a ação "iniciar"
// grava só a fila do entregador (nunca "pedidos"), mas antes desta correção
// usava um `redis.set` direto — mesmo dentro de `executarComLockPedidos`,
// nada validava que o token ainda era dono do lock NO INSTANTE da escrita.
// Uma execução cujo lock já tivesse expirado (GC pause, rede lenta) podia
// sobrescrever, com uma fila obtida antes de perder o lock, uma atribuição
// mais nova gravada nesse meio-tempo por `salvarAtribuicaoComFilas`
// (orders/route.ts) na MESMA `filaKey`. Mesmo padrão de fencing do restante
// do módulo: GET do dono do lock + SET na MESMA operação Lua.
const INICIAR_LUA = `
if redis.call("get", KEYS[1]) ~= ARGV[1] then
  return "lock_perdido"
end
redis.call("SET", KEYS[2], ARGV[2], "EX", 86400)
return 1
`;

export async function GET(req: NextRequest) {
  try {
    const auth = await autenticarEntregador(req);
    if (!auth) {
      return NextResponse.json({ ok: false, error: "Não autenticado" }, { status: 401 });
    }

    // A query string é deliberadamente ignorada. A única identidade aceita
    // vem do entregador-token validado acima.
    const [pedidos, principais] = await Promise.all([
      redis.get<PedidoEntregador[]>(`entregador:pedidos:${auth.entregador.id}`),
      redis.get<PedidoMain[]>("pedidos"),
    ]);
    const atribuidosAtualmente = new Set(
      (principais ?? [])
        .filter((pedido) => pedido.entregador?.id === auth.entregador.id)
        .map((pedido) => pedido.id)
    );
    const autorizados = (pedidos ?? []).filter((pedido) =>
      atribuidosAtualmente.has(pedido.pedidoId)
    );
    return NextResponse.json(autorizados);
  } catch {
    return NextResponse.json({ ok: false, error: "Não foi possível carregar os pedidos" }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await autenticarEntregador(req);
    if (!auth) {
      return NextResponse.json({ ok: false, error: "Não autenticado" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const pedidoId = body?.pedidoId;
    const acao = body?.acao;
    if (!pedidoIdValido(pedidoId) || typeof acao !== "string" || !ACAO_PATTERN.test(acao)) {
      return NextResponse.json({ ok: false, error: "Ação inválida" }, { status: 400 });
    }

    const filaKey = `entregador:pedidos:${auth.entregador.id}`;

    type ResultadoInterno =
      | { ok: true; pedido: PedidoEntregador; pedidoMain?: PedidoMain }
      | { ok: false; status: number; error: string };

    // Toda a leitura+validação+mutação+escrita de "pedidos" roda sob o MESMO
    // lock global do módulo central (pedidosStore) — antes desta correção,
    // esta rota lia e gravava "pedidos" SEM nenhum lock, podendo perder
    // silenciosamente uma mudança concorrente feita pelo painel, WhatsApp ou
    // outro webhook entre a leitura e a escrita.
    const resultadoLock = await executarComLockPedidos<ResultadoInterno>(async (token) => {
      const [pedidos, todosPedidos] = await Promise.all([
        redis.get<PedidoEntregador[]>(filaKey),
        redis.get<PedidoMain[]>("pedidos"),
      ]);
      const fila = pedidos ?? [];
      const principais = todosPedidos ?? [];
      const indexFila = fila.findIndex((pedido) => pedido.pedidoId === pedidoId);
      const indexMain = principais.findIndex((pedido) => pedido.id === pedidoId);
      const pedidoMain = indexMain >= 0 ? principais[indexMain] : null;

      if (pedidoMain?.entregador?.id && pedidoMain.entregador.id !== auth.entregador.id) {
        return { ok: false, status: 403, error: "Pedido não autorizado" };
      }
      if (indexMain === -1 || indexFila === -1) {
        return { ok: false, status: 404, error: "Pedido não encontrado" };
      }
      if (pedidoMain?.entregador?.id !== auth.entregador.id) {
        return { ok: false, status: 403, error: "Pedido não autorizado" };
      }

      const pedidoFila = fila[indexFila];
      if (acao === "iniciar") {
        if (pedidoFila.status === "em_rota" && pedidoMain.status === "saiu_entrega") {
          return { ok: true, pedido: pedidoFila };
        }
        if (pedidoFila.status !== "pendente" || pedidoMain.status !== "saiu_entrega") {
          return { ok: false, status: 409, error: "Transição inválida" };
        }
        const atualizados = [...fila];
        atualizados[indexFila] = { ...pedidoFila, status: "em_rota" };
        // Cercado (fenced) pelo token do lock — se o lock já expirou nesse
        // meio-tempo, a escrita é recusada em vez de sobrescrever uma
        // atribuição mais nova gravada na mesma fila por outra execução.
        const resultadoIniciar = await redis.eval(
          INICIAR_LUA,
          [PEDIDOS_LOCK_KEY, filaKey],
          [token, JSON.stringify(atualizados)]
        );
        if (resultadoIniciar === "lock_perdido") {
          return { ok: false, status: 409, error: "Não foi possível atualizar agora. Tente de novo." };
        }
        return { ok: true, pedido: atualizados[indexFila] };
      }

      if (pedidoFila.status === "entregue" && pedidoMain.status === "entregue") {
        return { ok: true, pedido: pedidoFila };
      }
      if (pedidoFila.status !== "em_rota" || pedidoMain.status !== "saiu_entrega") {
        return { ok: false, status: 409, error: "Transição inválida" };
      }

      const filaAtualizada = [...fila];
      filaAtualizada[indexFila] = { ...pedidoFila, status: "entregue" };
      const principaisAtualizados = [...principais];
      const revisionAtual = typeof pedidoMain.revision === "number" && Number.isFinite(pedidoMain.revision) ? pedidoMain.revision : 1;
      const pedidoMainAtualizado: PedidoMain = { ...pedidoMain, status: "entregue", revision: revisionAtual + 1 };
      principaisAtualizados[indexMain] = pedidoMainAtualizado;

      // As duas representações do pedido mudam no mesmo comando Redis: nunca
      // fica fila entregue com pedido principal ainda em rota (ou vice-versa).
      // Cercado (fenced) pelo token do lock — se o lock já expirou nesse
      // meio-tempo, a escrita é recusada em vez de sobrescrever o que uma
      // execução mais nova já gravou.
      const resultadoEval = await redis.eval(
        ENTREGAR_LUA,
        [PEDIDOS_LOCK_KEY, "pedidos", filaKey],
        [token, JSON.stringify(principaisAtualizados), JSON.stringify(filaAtualizada)]
      );
      if (resultadoEval === "lock_perdido") {
        return { ok: false, status: 409, error: "Não foi possível atualizar agora. Tente de novo." };
      }

      return { ok: true, pedido: filaAtualizada[indexFila], pedidoMain: pedidoMainAtualizado };
    });

    if (resultadoLock.tipo !== "sucesso") {
      return NextResponse.json({ ok: false, error: "Não foi possível atualizar agora. Tente de novo." }, { status: 409 });
    }
    const resultado = resultadoLock.valor;
    if (!resultado.ok) {
      return NextResponse.json({ ok: false, error: resultado.error }, { status: resultado.status });
    }
    if (acao === "iniciar" || !resultado.pedidoMain) {
      return NextResponse.json({ ok: true, pedido: resultado.pedido });
    }
    const pedidoMain = resultado.pedidoMain;

    try {
      await creditarPontosPedidoEntregue({
        id: pedidoMain.id,
        status: "entregue",
        telefone: pedidoMain.telefone,
        clienteId: pedidoMain.clienteId,
        total: pedidoMain.total ?? 0,
        taxaEntrega: pedidoMain.taxaEntrega,
      });
    } catch (error) {
      console.error("[ChefeBot] Erro ao creditar pontos de fidelidade do pedido entregue (ignorado):", error);
    }

    // Jornada do Chef: hook centralizado, mesma função chamada em toda
    // transição oficial para "entregue" — nunca duplica a regra por rota.
    await processarConclusaoPedidoJornada({ ...pedidoMain, status: "entregue" }).catch((error) =>
      console.error("[ChefeBot] Erro ao processar Jornada do Chef (ignorado):", error)
    );

    return NextResponse.json({ ok: true, pedido: resultado.pedido });
  } catch {
    return NextResponse.json({ ok: false, error: "Não foi possível atualizar o pedido" }, { status: 503 });
  }
}
