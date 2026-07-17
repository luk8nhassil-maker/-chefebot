import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { autenticarEntregador, pedidoIdValido } from "@/lib/entregadorAuth";
import type { PedidoEntregador } from "@/types/entregador";
import { creditarPontosPedidoEntregue } from "@/lib/fidelidade";

type PedidoMain = {
  id: string;
  status: string;
  telefone?: string;
  total?: number;
  taxaEntrega?: number;
  clienteId?: string;
  entregador?: { id: string; nome: string; telefone: string };
};

const ACAO_PATTERN = /^(iniciar|entregar)$/;

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

    if (pedidoFila.status === "entregue" && pedidoMain.status === "entregue") {
      return NextResponse.json({ ok: true, pedido: pedidoFila });
    }
    if (pedidoFila.status !== "em_rota" || pedidoMain.status !== "saiu_entrega") {
      return NextResponse.json({ ok: false, error: "Transição inválida" }, { status: 409 });
    }

    const filaAtualizada = [...fila];
    filaAtualizada[indexFila] = { ...pedidoFila, status: "entregue" };
    const principaisAtualizados = [...principais];
    principaisAtualizados[indexMain] = { ...pedidoMain, status: "entregue" };

    // As duas representações do pedido mudam no mesmo comando Redis: nunca
    // fica fila entregue com pedido principal ainda em rota (ou vice-versa).
    await redis.eval(
      `redis.call("SET", KEYS[1], ARGV[1]); redis.call("SET", KEYS[2], ARGV[2], "EX", 86400); return 1`,
      ["pedidos", filaKey],
      [JSON.stringify(principaisAtualizados), JSON.stringify(filaAtualizada)]
    );

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

    return NextResponse.json({ ok: true, pedido: filaAtualizada[indexFila] });
  } catch {
    return NextResponse.json({ ok: false, error: "Não foi possível atualizar o pedido" }, { status: 503 });
  }
}
