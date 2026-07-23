import { createHash } from "crypto";

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

// Grava o registro principal (JSON) + a chave-token (plana) numa ÚNICA
// operação atômica (revisão de segurança, 5ª rodada, ponto 2) — nunca dois
// SETs separados do lado do cliente, que deixariam uma janela em que só uma
// das duas chaves existe (ex.: processo encerrado entre os dois SETs).
// Como um script Lua roda inteiro, sem interleaving com outros comandos, os
// dois SETs abaixo são indivisíveis do ponto de vista de qualquer outra
// execução observando o Redis. KEYS[1] = chave do registro, KEYS[2] = chave
// do token; ARGV[1] = registro serializado (JSON), ARGV[2] = resultToken,
// ARGV[3] = TTL em segundos (igual para as duas chaves).
export const GRAVAR_RESULTADO_E_TOKEN_SCRIPT = `
redis.call("set", KEYS[1], ARGV[1], "EX", ARGV[3])
redis.call("set", KEYS[2], ARGV[2], "EX", ARGV[3])
return 1
`;

// Compare-and-delete atômico de um :result "stale" (ver revisão de
// segurança, 4ª/5ª rodadas, ponto 2): KEYS[1] é a chave-token (plana),
// KEYS[2] é o registro principal (JSON); ARGV[1] é o resultToken que esta
// execução leu e considera stale. Nunca um DEL cego. Distingue
// explicitamente os quatro estados possíveis do PAR de chaves (elas são
// sempre escritas/apagadas juntas por este módulo — ver
// GRAVAR_RESULTADO_E_TOKEN_SCRIPT — então qualquer estado onde só uma delas
// existe é tratado como corrupção/incerteza, nunca uma condição normal):
//
// - as duas ausentes → "ja_ausente" (nada para invalidar, retry pode seguir).
// - só o registro presente, token ausente (nunca deveria acontecer se toda
//   escrita passa pelo script de gravação acima; pode indicar corrupção ou
//   uma versão antiga do dado) → "incerto" — NUNCA decide sozinho, força o
//   chamador a tratar como leitura incerta (503), nunca como ausência.
// - só o token presente, registro ausente (órfão — o registro já foi
//   removido por outra via, mas o token sobrou) → apaga o órfão e trata como
//   "ja_ausente" (o efeito que importa, "não há :result válido", já é real).
// - os dois presentes e o token bate com o esperado → apaga os DOIS,
//   "removido".
// - os dois presentes mas o token NÃO bate → outra execução já gravou um
//   registro mais novo entre a nossa leitura e esta chamada → nunca apaga,
//   "substituido_por_outro" (o chamador reconsulta do zero).
export const INVALIDAR_RESULTADO_SE_TOKEN_SCRIPT = `
local tokenAtual = redis.call("get", KEYS[1])
local resultadoAtual = redis.call("get", KEYS[2])
if tokenAtual == false and resultadoAtual == false then
  return "ja_ausente"
end
if resultadoAtual == false then
  redis.call("del", KEYS[1])
  return "ja_ausente"
end
if tokenAtual == false then
  return "incerto"
end
if tokenAtual == ARGV[1] then
  redis.call("del", KEYS[1])
  redis.call("del", KEYS[2])
  return "removido"
else
  return "substituido_por_outro"
end
`;

/** Snapshot financeiro sanitizado (revisão de segurança, 5ª rodada, ponto 4)
 * — persistido dentro do "attempt" logo após as validações oficiais de
 * preço (cardápio/promoção/taxa/resgate) e ANTES de qualquer chamada ao
 * provider de pagamento. Garante que um retry reutilize EXATAMENTE o mesmo
 * valor cobrado na tentativa original, mesmo que cardápio/promoção/taxa
 * mudem entre tentativas — nunca altera silenciosamente uma cobrança já
 * iniciada. Nunca contém telefone, endereço, nome, itens legíveis, QR,
 * copia-e-cola, token ou credencial — só números e um hash de auditoria. */
export type SnapshotFinanceiroAttempt = {
  total: number;
  subtotal: number;
  taxaEntrega: number;
  descontoFidelidade: number;
  valorPixEsperado?: number;
  /** SHA-256 sobre os campos numéricos acima (serialização canônica) — só
   * para auditoria/detecção de divergência, nunca usado para decidir nada
   * sozinho. */
  pricingFingerprint: string;
};

/** Calcula o `pricingFingerprint` de forma determinística — mesma
 * serialização sempre produz o mesmo hash, para o mesmo conjunto de
 * valores. `valorPixEsperado` ausente é normalizado para `null` (nunca
 * `undefined`, que o JSON.stringify simplesmente omitiria de forma
 * inconsistente dependendo da ordem de construção do objeto). */
export function calcularPricingFingerprint(pricing: Omit<SnapshotFinanceiroAttempt, "pricingFingerprint">): string {
  const canonico = JSON.stringify({
    total: pricing.total,
    subtotal: pricing.subtotal,
    taxaEntrega: pricing.taxaEntrega,
    descontoFidelidade: pricing.descontoFidelidade,
    valorPixEsperado: pricing.valorPixEsperado ?? null,
  });
  return createHash("sha256").update(canonico).digest("hex");
}

// Converte para centavos (arredondando) antes de comparar — evita falsos
// negativos por erro de ponto flutuante em valores decimais em reais, sem
// abrir mão de uma comparação EXATA (nunca uma tolerância "aproximada").
function paraCentavos(valor: number): number {
  return Math.round(valor * 100);
}

// 7ª revisão de segurança, ponto 4: aceitar `pricingFingerprint` só por
// FORMATO (regex hexadecimal) não comprova integridade nenhuma — qualquer
// string de 64 caracteres hex, mesmo adulterada, passaria. Esta função
// RECALCULA o fingerprint a partir dos próprios campos numéricos e exige
// igualdade EXATA com o valor armazenado, além de validar a coerência
// aritmética do snapshot (desconto <= subtotal; total = subtotal - desconto
// + taxa, em centavos; valorPixEsperado entre 0 e total).
function ehSnapshotFinanceiroValido(valor: unknown): valor is SnapshotFinanceiroAttempt {
  if (!valor || typeof valor !== "object") return false;
  const v = valor as Partial<SnapshotFinanceiroAttempt>;
  const numerosValidos =
    typeof v.total === "number" &&
    Number.isFinite(v.total) &&
    v.total >= 0 &&
    typeof v.subtotal === "number" &&
    Number.isFinite(v.subtotal) &&
    v.subtotal >= 0 &&
    typeof v.taxaEntrega === "number" &&
    Number.isFinite(v.taxaEntrega) &&
    v.taxaEntrega >= 0 &&
    typeof v.descontoFidelidade === "number" &&
    Number.isFinite(v.descontoFidelidade) &&
    v.descontoFidelidade >= 0 &&
    (v.valorPixEsperado === undefined || (typeof v.valorPixEsperado === "number" && Number.isFinite(v.valorPixEsperado))) &&
    typeof v.pricingFingerprint === "string" &&
    SHA256_HEX_REGEX.test(v.pricingFingerprint);
  if (!numerosValidos) return false;

  const total = v.total as number;
  const subtotal = v.subtotal as number;
  const taxaEntrega = v.taxaEntrega as number;
  const descontoFidelidade = v.descontoFidelidade as number;

  if (descontoFidelidade > subtotal) return false;
  if (paraCentavos(total) !== paraCentavos(subtotal) - paraCentavos(descontoFidelidade) + paraCentavos(taxaEntrega)) return false;
  if (v.valorPixEsperado !== undefined && (v.valorPixEsperado < 0 || paraCentavos(v.valorPixEsperado) > paraCentavos(total))) return false;

  const fingerprintRecalculado = calcularPricingFingerprint({
    total,
    subtotal,
    taxaEntrega,
    descontoFidelidade,
    valorPixEsperado: v.valorPixEsperado,
  });
  if (fingerprintRecalculado !== v.pricingFingerprint) return false;

  return true;
}

/** Registro do "attempt" — identidade estável da tentativa, criada/recuperada
 * ATOMICAMENTE antes de qualquer efeito externo (vínculo da Jornada do Chef,
 * cobrança Pix — ver revisão de segurança, 4ª rodada, ponto 3). Garante que
 * um retry com o MESMO clientRequestId + MESMO fingerprint sempre reutiliza
 * o MESMO pedidoId (e, por consequência, o mesmo txid — derivado
 * deterministicamente de pedidoId em `gerarTxidPixInterno` — e a mesma
 * X-Idempotency-Key do Mercado Pago, derivada do txid) E o MESMO valor
 * financeiro (`pricing`, 5ª rodada), mesmo que a persistência do pedido
 * tenha falhado na tentativa anterior. Nunca contém PII, QR, copia-e-cola
 * ou credencial — só os identificadores e números necessários para
 * recuperar o fluxo. */
export type RegistroAttemptPedido = {
  state: "in_progress" | "completed";
  requestFingerprint: string;
  pedidoId: string;
  txid: string;
  pricing: SnapshotFinanceiroAttempt;
  createdAt: number;
  updatedAt: number;
};

/** Mesmo TTL do :result (24h) — precisa sobreviver ao menos tanto quanto um
 * retry legítimo possa demorar a chegar. A garantia de identidade/preço
 * estáveis deste módulo TERMINA quando o attempt expira: um retry que chegue
 * depois de 24h não encontra mais o attempt e gera uma tentativa nova do
 * zero (novo pedidoId/txid, preço recalculado na hora) — ver
 * docs/architecture/MODO_SOBREVIVENCIA_1_0.md, seção 2.5-C, para a análise
 * completa dessa janela e por que 24h foi mantido sem custo adicional
 * (revisão de segurança, 5ª rodada, ponto 6). */
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
    SHA256_HEX_REGEX.test(v.requestFingerprint) &&
    typeof v.pedidoId === "string" &&
    v.pedidoId.length > 0 &&
    typeof v.txid === "string" &&
    v.txid.length > 0 &&
    v.txid === gerarTxidDeterministico(v.pedidoId) &&
    ehSnapshotFinanceiroValido(v.pricing) &&
    typeof v.createdAt === "number" &&
    Number.isFinite(v.createdAt) &&
    v.createdAt > 0 &&
    typeof v.updatedAt === "number" &&
    Number.isFinite(v.updatedAt) &&
    v.updatedAt > 0
  );
}

// Duplicado deliberadamente pequeno de `gerarTxidPixInterno` (src/lib/pix.ts)
// — este módulo (`src/survival/*`) não importa de `src/lib/*` por convenção
// de isolamento (ver auditoria da Etapa 0), e o formato do txid é estável o
// bastante para validar por igualdade de string sem precisar da dependência
// cruzada. Se `gerarTxidPixInterno` mudar de formato, este teste de
// consistência (ehAttemptValido) precisa ser atualizado junto.
function gerarTxidDeterministico(pedidoId: string): string {
  return `chefebot_${pedidoId}`;
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
