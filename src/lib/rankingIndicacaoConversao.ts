// Migalha da conversão de indicação (primeira compra válida) por pedido —
// permite que o cancelamento tardio (correção do pedido do indicado para
// "cancelado" depois de já ter creditado a indicação) encontre indicador e
// indicado sem precisar reconsultar `indicacaoToken.ts` (a relação
// permanente já foi confirmada nesse momento e não muda depois).
import "server-only";
import { redis } from "./redis";

function chaveBreadcrumb(pedidoId: string): string {
  return `estrelasIndicacao:conversao:pedido:${pedidoId}`;
}

export type BreadcrumbConversaoIndicacao = {
  indicadorId: string;
  indicadoId: string;
  pedidoId: string;
};

export async function registrarConversaoIndicacao(params: BreadcrumbConversaoIndicacao): Promise<void> {
  await redis.set(chaveBreadcrumb(params.pedidoId), params);
}

export async function obterConversaoIndicacaoDoPedido(pedidoId: string): Promise<BreadcrumbConversaoIndicacao | null> {
  if (!pedidoId) return null;
  return redis.get<BreadcrumbConversaoIndicacao>(chaveBreadcrumb(pedidoId));
}
