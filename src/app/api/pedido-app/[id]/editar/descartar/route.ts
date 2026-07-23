import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import type { PedidoRedis } from "@/types/pedidoRedis";
import {
  adquirirMutexEdicao,
  liberarMutexEdicao,
  tokensIguais,
} from "@/lib/pedidoEdicao";
import { executarComLockPedidos } from "@/lib/pedidosStore";

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

  type ResultadoDescartar = { ok: true; alreadyCleared?: true } | { ok: false; status: number; error: string };

  try {
    const resultadoLock = await executarComLockPedidos<ResultadoDescartar>(async () => {
      const pedidos = (await redis.get<PedidoRedis[]>("pedidos")) || [];
      const index = pedidos.findIndex((p) => p.id === id);
      if (index < 0 || !tokensIguais(pedidos[index].statusToken, statusToken)) {
        return { ok: false, status: 404, error: "Pedido não encontrado" };
      }

      const pedido = pedidos[index];

      // Idempotente: se já não há edição ativa (descarte duplicado, clique
      // duplo, ou o lock já expirou sozinho), responde sucesso sem reescrever
      // nada — o pedido original já está preservado de qualquer forma.
      if (pedido.editStatus !== "editing" || pedido.editSessionId !== editSessionId) {
        return { ok: true, alreadyCleared: true };
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

      return { ok: true };
    });

    if (resultadoLock.tipo !== "sucesso") {
      return NextResponse.json({ ok: false, error: "Não foi possível descartar agora. Tente de novo." }, { status: 409 });
    }
    const resultado = resultadoLock.valor;
    if (!resultado.ok) {
      return NextResponse.json({ ok: false, error: resultado.error }, { status: resultado.status });
    }
    return NextResponse.json(resultado.alreadyCleared ? { ok: true, alreadyCleared: true } : { ok: true });
  } finally {
    await liberarMutexEdicao(id, mutexToken);
  }
}
