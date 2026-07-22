// Namespace isolado de idempotência de criação de pedido no Redis — nunca
// reaproveita nem toca na chave "pedidos" nem em qualquer outra chave já
// auditada em docs/architecture/REDIS_KEY_INVENTORY.md. Mesmo padrão de
// isolamento por prefixo já usado por src/infra/railway (infra:railway:*) e
// pelo MCP Observador (mcp:*).

export const PEDIDO_IDEMPOTENCIA_TTL_SEGUNDOS = 86_400; // 24h — mesma janela do idempotencyKey de webhook (whatsapp/route.ts)

export function chaveIdempotenciaPedido(clientRequestId: string): string {
  return `survival:idempotencia:pedido:${clientRequestId}`;
}
