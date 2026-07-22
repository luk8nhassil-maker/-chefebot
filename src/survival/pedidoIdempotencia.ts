// Idempotência de criação de pedido — desenho com DUAS chaves separadas por
// clientRequestId, cada uma com seu próprio TTL e propósito:
//
// 1. "claim" (survival:idempotencia:pedido:{id}:claim): reivindicação
//    efêmera, só existe enquanto uma requisição está de fato processando a
//    criação. TTL curto (CLAIM_TTL_SEGUNDOS), estritamente maior que
//    maxDuration=20s da rota — a margem garante que, se o TTL expirar, a
//    execução original JÁ FOI encerrada à força pela plataforma (Vercel mata
//    a função em 20s), então ela nunca pode "voltar" e duplicar o pedido
//    depois que outra execução reivindicou a chave de novo. Valor gravado:
//    `${ownerToken}::${requestFingerprint}` (string simples, nunca JSON) —
//    permite tanto comparar o dono via compare-and-delete atômico (Lua,
//    mesmo padrão já usado em src/lib/mercadoPagoReconciliacao.ts) quanto
//    inspecionar o fingerprint de quem já possui a chave, sem precisar
//    decodificar JSON dentro do script Lua.
//
// 2. "result" (survival:idempotencia:pedido:{id}:result): registro DURÁVEL
//    (TTL de 24h) escrito uma única vez, logo após a persistência real do
//    pedido — nunca antes. Guarda só o necessário para localizar o pedido de
//    novo (pedidoId/numero/statusToken) e o fingerprint da tentativa
//    original — NUNCA o total nem o Pix, que são sempre reconstruídos a
//    partir do pedido real no momento do retry (nunca uma cobrança Pix
//    antiga/expirada é devolvida às cegas).
//
// Nenhuma das duas chaves toca "pedidos" nem qualquer chave já auditada em
// docs/architecture/REDIS_KEY_INVENTORY.md — mesmo padrão de isolamento por
// prefixo já usado por infra:railway:* e mcp:*.

/** Maior que maxDuration=20s da rota, com margem de segurança — ver
 * explicação acima sobre por que isso torna seguro o compare-and-delete. */
export const CLAIM_TTL_SEGUNDOS = 30;

/** Janela em que um retry legítimo ainda encontra o resultado (mesma janela
 * do idempotencyKey de webhook do WhatsApp já existente). */
export const RESULT_TTL_SEGUNDOS = 86_400;

/** Bounded: pior caso ~1.8s de espera, bem dentro do maxDuration=20s da rota. */
export const POLL_TENTATIVAS = 6;
export const POLL_INTERVALO_MS = 300;

export function chaveClaimPedido(clientRequestId: string): string {
  return `survival:idempotencia:pedido:${clientRequestId}:claim`;
}

export function chaveResultadoPedido(clientRequestId: string): string {
  return `survival:idempotencia:pedido:${clientRequestId}:result`;
}

/** Registro durável — nunca contém total/pix (ver comentário acima). */
export type ResultadoIdempotenciaPedido = {
  state: "completed";
  requestFingerprint: string;
  pedidoId: string;
  numero: number;
  statusToken: string;
  createdAt: number;
};

export function ehResultadoIdempotenciaValido(valor: unknown): valor is ResultadoIdempotenciaPedido {
  if (!valor || typeof valor !== "object") return false;
  const v = valor as Partial<ResultadoIdempotenciaPedido>;
  return (
    v.state === "completed" &&
    typeof v.requestFingerprint === "string" &&
    typeof v.pedidoId === "string" &&
    typeof v.numero === "number" &&
    typeof v.statusToken === "string"
  );
}

export function montarValorClaim(ownerToken: string, requestFingerprint: string): string {
  return `${ownerToken}::${requestFingerprint}`;
}

/** Extrai o fingerprint de um valor de claim já lido (`GET`). Retorna null
 * se o formato não bater com o esperado (nunca lança) — tratado pelo
 * chamador como resultado incerto, nunca como "sem proteção". */
export function extrairFingerprintDoClaim(valorClaim: unknown): string | null {
  if (typeof valorClaim !== "string") return null;
  const separadorIdx = valorClaim.indexOf("::");
  if (separadorIdx < 0) return null;
  const fingerprint = valorClaim.slice(separadorIdx + 2);
  return fingerprint.length > 0 ? fingerprint : null;
}

// Compare-and-delete atômico (Lua via EVAL) — só apaga o claim se o valor
// gravado ainda for exatamente o que esta execução gravou (ownerToken +
// fingerprint). Mesmo script/padrão de
// src/lib/mercadoPagoReconciliacao.ts:LIBERAR_LOCK_SE_DONO_SCRIPT. Evita que
// uma execução antiga (já expirada e cuja chave foi reivindicada de novo por
// outra execução) apague ou sobrescreva a reivindicação da execução nova.
export const LIBERAR_CLAIM_SE_DONO_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;
