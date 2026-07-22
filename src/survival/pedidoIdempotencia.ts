// Namespace isolado de idempotência de criação de pedido no Redis — nunca
// reaproveita nem toca na chave "pedidos" nem em qualquer outra chave já
// auditada em docs/architecture/REDIS_KEY_INVENTORY.md. Mesmo padrão de
// isolamento por prefixo já usado por src/infra/railway (infra:railway:*) e
// pelo MCP Observador (mcp:*).
//
// Desenho: "claim" atômico via SET NX (mesmo padrão já usado em
// src/lib/mercadoPagoReconciliacao.ts para o lock de reconciliação) em vez
// de um simples GET-then-SET. Isso fecha a janela de corrida em que duas
// requisições com o MESMO clientRequestId chegam ao mesmo tempo: só uma
// consegue reivindicar a chave (SET NX bem-sucedido) e prossegue para criar
// o pedido; a outra encontra o marcador "processando" e nunca cria um
// segundo pedido — ou espera o resultado (polling limitado) ou recebe 409
// pedindo para aguardar/verificar, nunca uma resposta de sucesso fabricada.

export const PEDIDO_IDEMPOTENCIA_TTL_SEGUNDOS = 86_400; // 24h — mesma janela do idempotencyKey de webhook (whatsapp/route.ts)

/** Bounded: pior caso ~1.8s de espera, bem dentro do maxDuration=20s da rota. */
export const PEDIDO_IDEMPOTENCIA_POLL_TENTATIVAS = 6;
export const PEDIDO_IDEMPOTENCIA_POLL_INTERVALO_MS = 300;

export function chaveIdempotenciaPedido(clientRequestId: string): string {
  return `survival:idempotencia:pedido:${clientRequestId}`;
}

/** Marcador gravado ao reivindicar a chave, antes de o pedido existir de
 * fato — nunca confundido com uma resposta final (que sempre tem `ok`). */
export const MARCADOR_PEDIDO_PROCESSANDO = { processando: true } as const;

export function ehMarcadorProcessando(valor: unknown): valor is typeof MARCADOR_PEDIDO_PROCESSANDO {
  return !!valor && typeof valor === "object" && (valor as { processando?: unknown }).processando === true;
}
