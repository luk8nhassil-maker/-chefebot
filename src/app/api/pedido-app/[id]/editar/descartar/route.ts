import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import type { PedidoRedis } from "@/types/pedidoRedis";
import {
  adquirirMutexEdicao,
  liberarMutexEdicao,
  tokensIguais,
} from "@/lib/pedidoEdicao";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { statusToken?: string; editSessionId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Payload inválido" }, { status: 400 });
  }
  const statusToken = (body.statusToken || "").trim();
  const editSessionId = (body.editSessionId || "").trim();
  if (!id || !statusToken || !editSessionId) {
    return NextResponse.json({ ok: false, error: "id, statusToken e editSessionId obrigatórios" }, { status: 400 });
  }

  const mutexToken = await adquirirMutexEdicao(id);
  if (!mutexToken) {
    return NextResponse.json({ ok: false, error: "Não foi possível descartar agora. Tente de novo." }, { status: 409 });
  }

  try {
    const pedidos = (await redis.get<PedidoRedis[]>("pedidos")) || [];
    const index = pedidos.findIndex((p) => p.id === id);
    if (index < 0 || !tokensIguais(pedidos[index].statusToken, statusToken)) {
      return NextResponse.json({ ok: false, error: "Pedido não encontrado" }, { status: 404 });
    }

    const pedido = pedidos[index];

    // Idempotente: se já não há edição ativa (descarte duplicado, clique
    // duplo, ou o lock já expirou sozinho), responde sucesso sem reescrever
    // nada — o pedido original já está preservado de qualquer forma.
    if (pedido.editStatus !== "editing" || pedido.editSessionId !== editSessionId) {
      return NextResponse.json({ ok: true, alreadyCleared: true });
    }

    const agora = new Date().toISOString();
    pedidos[index] = {
      ...pedido,
      editStatus: "none",
      editSessionId: undefined,
      editStartedAt: undefined,
      editExpiresAt: undefined,
      editHistory: [
        ...(pedido.editHistory || []),
        { tipo: "descartado", horario: agora, revisaoAnterior: pedido.revision ?? 1 },
      ],
    };
    await redis.set("pedidos", pedidos);

    return NextResponse.json({ ok: true });
  } finally {
    await liberarMutexEdicao(id, mutexToken);
  }
}
