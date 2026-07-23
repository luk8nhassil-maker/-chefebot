import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import type { PedidoRedis } from "@/types/pedidoRedis";
import { montarStatusPublicoPedido } from "@/lib/pedidoStatusPublico";
import {
  tokensIguais,
  lockEdicaoAtivo,
  limparEdicaoExpiradaSeNecessario,
  adquirirMutexEdicao,
  liberarMutexEdicao,
} from "@/lib/pedidoEdicao";
import { executarComLockPedidos } from "@/lib/pedidosStore";

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
        // Além do mutex por pedido, a releitura+escrita roda sob o lock
        // global do módulo central — protege contra corrida com qualquer
        // outro writer de "pedidos".
        await executarComLockPedidos(async () => {
          const atuais = (await redis.get<PedidoRedis[]>("pedidos")) || [];
          const idx2 = atuais.findIndex((p) => p.id === id);
          if (idx2 >= 0 && atuais[idx2].editStatus === "editing") {
            const limpeza2 = limparEdicaoExpiradaSeNecessario(atuais[idx2]);
            if (limpeza2.mudou) {
              atuais[idx2] = limpeza2.pedido;
              await redis.set("pedidos", atuais);
            }
          }
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
