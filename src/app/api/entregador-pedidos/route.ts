import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { adquirirMutexPedidos, liberarMutexPedidos } from "@/lib/pedidosConcorrencia";
import { autenticarEntregador, pedidoIdValido } from "@/lib/entregadorAuth";
import type { PedidoEntregador } from "@/types/entregador";
import { creditarPontosPedidoEntregue } from "@/lib/fidelidade";
import { processarConclusaoPedidoJornada } from "@/lib/jornadaChef";
import type { ItemApp } from "@/lib/pedidoAppItens";
import type { ItemElegibilidadeJornada } from "@/lib/jornadaChef";
import type { PedidoSnapshotOficial } from "@/lib/pedidoSnapshot";

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
  snapshotOficial?: PedidoSnapshotOficial;
  itensJornada?: ItemElegibilidadeJornada[];
  recompensaJornadaId?: string;
};

const ACAO_PATTERN = /^(iniciar|entregar)$/;

const CONCLUIR_ENTREGA_LUA = `redis.call("SET", KEYS[1], ARGV[1]); redis.call("SET", KEYS[2], ARGV[2], "EX", 86400); return 1`;

type ResultadoConcluirEntrega =
  | { tipo: "nao_encontrado" }
  | { tipo: "nao_autorizado" }
  | { tipo: "ja_entregue"; pedidoFila: PedidoEntregador }
  | { tipo: "transicao_invalida" }
  | { tipo: "ok"; pedidoMain: PedidoMain; pedidoFila: PedidoEntregador };

// Protegido pelo lock GLOBAL de "pedidos" (ver src/lib/pedidosConcorrencia.ts):
// releitura fresca de "pedidos" (e da fila do entregador) DENTRO do lock,
// nunca sobre o snapshot lido no início do POST (que só serve para o
// gate de autorização/404 anterior a esta seção crítica — tolerável ficar
// levemente desatualizado, já que esta função revalida tudo do zero). A
// escrita de "pedidos" + fila do entregador continua atômica na MESMA
// operação Lua já existente — nunca passa para ela um array obtido antes
// de adquirir o lock.
async function concluirEntregaAtomico(
  pedidoId: string,
  entregadorId: string,
  filaKey: string
): Promise<ResultadoConcluirEntrega> {
  const globalToken = await adquirirMutexPedidos();
  try {
    const [filaFresca, principaisFrescos] = await Promise.all([
      redis.get<PedidoEntregador[]>(filaKey),
      redis.get<PedidoMain[]>("pedidos"),
    ]);
    const fila = filaFresca ?? [];
    const principais = principaisFrescos ?? [];
    const indexFila = fila.findIndex((pedido) => pedido.pedidoId === pedidoId);
    const indexMain = principais.findIndex((pedido) => pedido.id === pedidoId);
    const pedidoMain = indexMain >= 0 ? principais[indexMain] : null;

    if (pedidoMain?.entregador?.id && pedidoMain.entregador.id !== entregadorId) {
      return { tipo: "nao_autorizado" };
    }
    if (indexMain === -1 || indexFila === -1) {
      return { tipo: "nao_encontrado" };
    }
    if (pedidoMain?.entregador?.id !== entregadorId) {
      return { tipo: "nao_autorizado" };
    }

    const pedidoFila = fila[indexFila];
    if (pedidoFila.status === "entregue" && pedidoMain.status === "entregue") {
      return { tipo: "ja_entregue", pedidoFila };
    }
    if (pedidoFila.status !== "em_rota" || pedidoMain.status !== "saiu_entrega") {
      return { tipo: "transicao_invalida" };
    }

    const filaAtualizada = [...fila];
    filaAtualizada[indexFila] = { ...pedidoFila, status: "entregue" };
    const principaisAtualizados = [...principais];
    principaisAtualizados[indexMain] = { ...pedidoMain, status: "entregue" };

    // As duas representações do pedido mudam no mesmo comando Redis: nunca
    // fica fila entregue com pedido principal ainda em rota (ou vice-versa).
    await redis.eval(
      CONCLUIR_ENTREGA_LUA,
      ["pedidos", filaKey],
      [JSON.stringify(principaisAtualizados), JSON.stringify(filaAtualizada)]
    );

    return { tipo: "ok", pedidoMain: principaisAtualizados[indexMain], pedidoFila: filaAtualizada[indexFila] };
  } finally {
    await liberarMutexPedidos(globalToken);
  }
}

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
      return NextResponse.json({ ok: false, error: "Pedido não autorizado" }, { status: 403 });
    }
    if (indexMain === -1 || indexFila === -1) {
      return NextResponse.json({ ok: false, error: "Pedido não encontrado" }, { status: 404 });
    }
    if (pedidoMain?.entregador?.id !== auth.entregador.id) {
      return NextResponse.json({ ok: false, error: "Pedido não autorizado" }, { status: 403 });
    }

    const pedidoFila = fila[indexFila];
    if (acao === "iniciar") {
      if (pedidoFila.status === "em_rota" && pedidoMain.status === "saiu_entrega") {
        return NextResponse.json({ ok: true, pedido: pedidoFila });
      }
      if (pedidoFila.status !== "pendente" || pedidoMain.status !== "saiu_entrega") {
        return NextResponse.json({ ok: false, error: "Transição inválida" }, { status: 409 });
      }
      const atualizados = [...fila];
      atualizados[indexFila] = { ...pedidoFila, status: "em_rota" };
      await redis.set(filaKey, atualizados, { ex: 86400 });
      return NextResponse.json({ ok: true, pedido: atualizados[indexFila] });
    }

    // acao === "entregar": toda a validação de estado e a escrita
    // pedidos+fila acontecem DENTRO do lock global, sobre dados frescos —
    // as variáveis `pedidoFila`/`pedidoMain` lidas acima só serviram para o
    // gate de autorização/404 anterior, nunca para decidir esta transição.
    const resultado = await concluirEntregaAtomico(pedidoId, auth.entregador.id, filaKey);
    if (resultado.tipo === "nao_encontrado") {
      return NextResponse.json({ ok: false, error: "Pedido não encontrado" }, { status: 404 });
    }
    if (resultado.tipo === "nao_autorizado") {
      return NextResponse.json({ ok: false, error: "Pedido não autorizado" }, { status: 403 });
    }
    if (resultado.tipo === "transicao_invalida") {
      return NextResponse.json({ ok: false, error: "Transição inválida" }, { status: 409 });
    }
    if (resultado.tipo === "ja_entregue") {
      return NextResponse.json({ ok: true, pedido: resultado.pedidoFila });
    }

    const pedidoMainAtualizado = resultado.pedidoMain;
    try {
      await creditarPontosPedidoEntregue({
        id: pedidoMainAtualizado.id,
        status: "entregue",
        telefone: pedidoMainAtualizado.telefone,
        clienteId: pedidoMainAtualizado.clienteId,
        total: pedidoMainAtualizado.total ?? 0,
        taxaEntrega: pedidoMainAtualizado.taxaEntrega,
        snapshotOficial: pedidoMainAtualizado.snapshotOficial,
      });
    } catch (error) {
      console.error("[ChefeBot] Erro ao creditar pontos de fidelidade do pedido entregue (ignorado):", error);
    }

    // Jornada do Chef: hook centralizado, mesma função chamada em toda
    // transição oficial para "entregue" — nunca duplica a regra por rota.
    await processarConclusaoPedidoJornada({ ...pedidoMainAtualizado, status: "entregue" }).catch((error) =>
      console.error("[ChefeBot] Erro ao processar Jornada do Chef (ignorado):", error)
    );

    return NextResponse.json({ ok: true, pedido: resultado.pedidoFila });
  } catch {
    return NextResponse.json({ ok: false, error: "Não foi possível atualizar o pedido" }, { status: 503 });
  }
}
