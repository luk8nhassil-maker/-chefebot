// Idempotência de criação de pedido — desenho com QUATRO chaves separadas por
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
// 3. "result:token" (…:result:token): chave companheira PLANA do "result",
//    guarda só o `resultToken` atual — existe para permitir invalidar um
//    "result" stale com um compare-and-delete atômico (Lua) sem precisar
//    decodificar JSON dentro do script (ver INVALIDAR_RESULTADO_SE_TOKEN_SCRIPT,
//    revisão de segurança 4ª rodada, ponto 2).
//
// 4. "attempt" (…:attempt): identidade estável da tentativa, criada ANTES de
//    qualquer efeito externo (Jornada do Chef, cobrança Pix) — garante que
//    um retry com o MESMO clientRequestId sempre reutiliza o MESMO pedidoId
//    (e portanto o mesmo txid/X-Idempotency-Key do Mercado Pago), mesmo que
//    a tentativa anterior nunca tenha chegado a persistir o pedido (ver
//    revisão de segurança 4ª rodada, ponto 3).
//
// Nenhuma das quatro chaves toca "pedidos" nem qualquer chave já auditada em
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

/** Registro durável — nunca contém total/pix (ver comentário acima).
 * `resultToken` (4ª revisão de segurança, ponto 2) é um segredo aleatório
 * forte gravado JUNTO do registro, usado exclusivamente para uma
 * invalidação atômica (compare-and-delete via Lua) de um `:result` "stale"
 * — nunca para autenticação nem exposto ao cliente. */
export type ResultadoIdempotenciaPedido = {
  state: "completed";
  requestFingerprint: string;
  pedidoId: string;
  numero: number;
  statusToken: string;
  createdAt: number;
  resultToken: string;
};

const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/;

export function ehResultadoIdempotenciaValido(valor: unknown): valor is ResultadoIdempotenciaPedido {
  if (!valor || typeof valor !== "object") return false;
  const v = valor as Partial<ResultadoIdempotenciaPedido>;
  return (
    v.state === "completed" &&
    typeof v.requestFingerprint === "string" &&
    SHA256_HEX_REGEX.test(v.requestFingerprint) &&
    typeof v.pedidoId === "string" &&
    v.pedidoId.length > 0 &&
    typeof v.numero === "number" &&
    Number.isFinite(v.numero) &&
    typeof v.statusToken === "string" &&
    v.statusToken.length > 0 &&
    typeof v.createdAt === "number" &&
    Number.isFinite(v.createdAt) &&
    typeof v.resultToken === "string" &&
    v.resultToken.length >= 32
  );
}

/** Chave companheira, plana (nunca JSON), que guarda só o `resultToken` do
 * registro atual — existe unicamente para permitir um compare-and-delete
 * atômico (Lua) do PAR (token, registro) sem precisar decodificar JSON
 * dentro do script. Mesmo TTL do registro principal. */
export function chaveResultadoTokenPedido(clientRequestId: string): string {
  return `survival:idempotencia:pedido:${clientRequestId}:result:token`;
}

// Compare-and-delete atômico de um :result "stale" (ver revisão de
// segurança, 4ª rodada, ponto 2): KEYS[1] é a chave-token (plana), KEYS[2] é
// o registro principal (JSON); ARGV[1] é o resultToken que esta execução
// leu e considera stale. Nunca um DEL cego — só apaga os DOIS quando a
// chave-token ainda contém EXATAMENTE o token esperado, o que garante que
// nenhuma execução concorrente já gravou um resultado mais novo (que teria
// sobrescrito a chave-token com outro valor) entre a leitura e esta chamada.
export const INVALIDAR_RESULTADO_SE_TOKEN_SCRIPT = `
local atual = redis.call("get", KEYS[1])
if atual == false then
  return "ja_ausente"
end
if atual == ARGV[1] then
  redis.call("del", KEYS[1])
  redis.call("del", KEYS[2])
  return "removido"
else
  return "substituido_por_outro"
end
`;

/** Registro do "attempt" — identidade estável da tentativa, criada/recuperada
 * ATOMICAMENTE antes de qualquer efeito externo (vínculo da Jornada do Chef,
 * cobrança Pix — ver revisão de segurança, 4ª rodada, ponto 3). Garante que
 * um retry com o MESMO clientRequestId + MESMO fingerprint sempre reutiliza
 * o MESMO pedidoId (e, por consequência, o mesmo txid — derivado
 * deterministicamente de pedidoId em `gerarTxidPixInterno` — e a mesma
 * X-Idempotency-Key do Mercado Pago, derivada do txid), mesmo que a
 * persistência do pedido tenha falhado na tentativa anterior. Nunca contém
 * PII, QR, copia-e-cola ou credencial — só os identificadores necessários
 * para recuperar o fluxo. */
export type RegistroAttemptPedido = {
  state: "in_progress" | "completed";
  requestFingerprint: string;
  pedidoId: string;
  txid: string;
  createdAt: number;
  updatedAt: number;
};

/** Mesmo TTL do :result (24h) — precisa sobreviver ao menos tanto quanto um
 * retry legítimo possa demorar a chegar. */
export const ATTEMPT_TTL_SEGUNDOS = RESULT_TTL_SEGUNDOS;

export function chaveAttemptPedido(clientRequestId: string): string {
  return `survival:idempotencia:pedido:${clientRequestId}:attempt`;
}

export function ehAttemptValido(valor: unknown): valor is RegistroAttemptPedido {
  if (!valor || typeof valor !== "object") return false;
  const v = valor as Partial<RegistroAttemptPedido>;
  return (
    (v.state === "in_progress" || v.state === "completed") &&
    typeof v.requestFingerprint === "string" &&
    v.requestFingerprint.length > 0 &&
    typeof v.pedidoId === "string" &&
    v.pedidoId.length > 0 &&
    typeof v.txid === "string" &&
    v.txid.length > 0 &&
    typeof v.createdAt === "number" &&
    Number.isFinite(v.createdAt)
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
