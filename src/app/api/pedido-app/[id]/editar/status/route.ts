import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { mutarPedidos } from "@/lib/pedidosConcorrencia";
import type { PedidoRedis } from "@/types/pedidoRedis";
import { montarStatusPublicoPedido } from "@/lib/pedidoStatusPublico";
import {
  tokensIguais,
  lockEdicaoAtivo,
  limparEdicaoExpiradaSeNecessario,
  adquirirMutexEdicao,
  liberarMutexEdicao,
} from "@/lib/pedidoEdicao";

type ConfigPizzariaPix = { whatsappPizzaria?: string };

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const statusToken = req.nextUrl.searchParams.get("token")?.trim();
  const editSessionId = req.nextUrl.searchParams.get("editSessionId")?.trim();
  if (!id || !statusToken) {
    return NextResponse.json({ error: "id e token obrigatórios" }, { status: 400 });
  }

  const pedidos = (await redis.get<PedidoRedis[]>("pedidos")) || [];
  const index = pedidos.findIndex((p) => p.id === id);
  if (index < 0 || !tokensIguais(pedidos[index].statusToken, statusToken)) {
    return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
  }

  let pedido = pedidos[index];
  const limpeza = limparEdicaoExpiradaSeNecessario(pedido);
  if (limpeza.mudou) {
    // Limpeza preguiçosa: só grava se conseguir o mutex rapidamente — não
    // vale a pena bloquear uma consulta de status por causa disso.
    const mutexToken = await adquirirMutexEdicao(id);
    if (mutexToken) {
      try {
        // Protegido pelo lock GLOBAL de "pedidos" (ver
        // src/lib/pedidosConcorrencia.ts): releitura fresca dentro do lock,
        // nunca sobre o snapshot lido antes do mutex por pedido.
        await mutarPedidos<PedidoRedis, void>((pedidosFrescos) => {
          const idx2 = pedidosFrescos.findIndex((p) => p.id === id);
          if (idx2 < 0 || pedidosFrescos[idx2].editStatus !== "editing") {
            return { persistir: false, resultado: undefined };
          }
          const limpeza2 = limparEdicaoExpiradaSeNecessario(pedidosFrescos[idx2]);
          if (!limpeza2.mudou) return { persistir: false, resultado: undefined };
          const atuais = [...pedidosFrescos];
          atuais[idx2] = limpeza2.pedido;
          return { persistir: true, pedidos: atuais, resultado: undefined };
        });
      } finally {
        await liberarMutexEdicao(id, mutexToken);
      }
    }
    pedido = limpeza.pedido;
  }

  const configPix = (await redis.get<ConfigPizzariaPix>("config:pizzaria")) || {};

  return NextResponse.json({
    ...montarStatusPublicoPedido(pedido),
    revision: pedido.revision ?? 1,
    editStatus: pedido.editStatus ?? "none",
    editExpiresAt: pedido.editExpiresAt ?? null,
    editedByMe: !!(editSessionId && pedido.editSessionId && editSessionId === pedido.editSessionId),
    lockAtivo: lockEdicaoAtivo(pedido),
    changesSummary: pedido.changesSummary ?? [],
    whatsappPizzaria: configPix.whatsappPizzaria || undefined,
  });
}
