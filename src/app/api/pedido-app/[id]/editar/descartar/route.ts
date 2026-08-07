import { NextRequest, NextResponse } from "next/server";
import { mutarPedidos } from "@/lib/pedidosConcorrencia";
import type { PedidoRedis } from "@/types/pedidoRedis";
import {
  adquirirMutexEdicao,
  liberarMutexEdicao,
  tokensIguais,
} from "@/lib/pedidoEdicao";

type ResultadoDescartarEdicao =
  | { tipo: "nao_encontrado" }
  | { tipo: "already_cleared" }
  | { tipo: "ok" };

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
    // Protegido pelo lock GLOBAL de "pedidos" (ver
    // src/lib/pedidosConcorrencia.ts): leitura, decisão e escrita sobre um
    // snapshot fresco, dentro do lock — nenhuma chamada externa acontece
    // nesta seção crítica. O mutex por pedido (adquirido acima) continua
    // segurado durante toda a rota.
    const resultado = await mutarPedidos<PedidoRedis, ResultadoDescartarEdicao>((pedidosFrescos) => {
      const index = pedidosFrescos.findIndex((p) => p.id === id);
      if (index < 0 || !tokensIguais(pedidosFrescos[index].statusToken, statusToken)) {
        return { persistir: false, resultado: { tipo: "nao_encontrado" } };
      }

      const pedido = pedidosFrescos[index];

      // Idempotente: se já não há edição ativa (descarte duplicado, clique
      // duplo, ou o lock já expirou sozinho), responde sucesso sem reescrever
      // nada — o pedido original já está preservado de qualquer forma.
      if (pedido.editStatus !== "editing" || pedido.editSessionId !== editSessionId) {
        return { persistir: false, resultado: { tipo: "already_cleared" } };
      }

      const agora = new Date().toISOString();
      const atualizados = [...pedidosFrescos];
      atualizados[index] = {
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
      return { persistir: true, pedidos: atualizados, resultado: { tipo: "ok" } };
    });

    if (resultado.tipo === "nao_encontrado") {
      return NextResponse.json({ ok: false, error: "Pedido não encontrado" }, { status: 404 });
    }
    if (resultado.tipo === "already_cleared") {
      return NextResponse.json({ ok: true, alreadyCleared: true });
    }
    return NextResponse.json({ ok: true });
  } finally {
    await liberarMutexEdicao(id, mutexToken);
  }
}
