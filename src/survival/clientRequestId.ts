// clientRequestId — identificador gerado UMA VEZ por tentativa de checkout,
// no navegador, e reutilizado em qualquer retry da MESMA tentativa (nunca
// regenerado só porque houve timeout). Nunca contém telefone, nome ou
// qualquer PII: é só um identificador aleatório opaco. Quando
// SURVIVAL_MODE_ENABLED=true, o backend usa esse valor (ver
// src/app/api/pedido-app/route.ts) para reconhecer um reenvio do mesmo
// pedido e devolver o resultado já criado, em vez de criar um duplicado.

import { createHash } from "crypto";

// Mínimo de 16 caracteres do alfabeto [a-zA-Z0-9_-] (~95 bits de entropia se
// aleatório) — nunca 8, que permitiria só ~2^47 combinações, pouco o
// bastante para tornar um ataque de força bruta contra o cache de
// idempotência (que devolve o pedido inteiro, incluindo dados de Pix)
// impraticável, mas não trivialmente inviável. UUID v4 (36 ou 32 chars sem
// hífen) folga muito acima deste piso.
const CLIENT_REQUEST_ID_REGEX = /^[a-zA-Z0-9_-]{16,100}$/;

/**
 * Gera um novo identificador de tentativa de checkout. Só deve ser chamado
 * uma vez por tentativa — a garantia de idempotência depende de o mesmo
 * valor ser reaproveitado em qualquer retry dessa tentativa.
 *
 * Nunca usa `Date.now()`/`Math.random()` como fallback: um identificador
 * previsível permitiria a outro cliente adivinhar/colidir com o
 * clientRequestId de alguém e reaproveitar o cache de idempotência (que
 * pode expor dados do pedido — ver revisão de segurança do PR). Na
 * ausência de qualquer fonte de aleatoriedade criptográfica, falha de
 * forma controlada em vez de gerar um valor inseguro.
 */
export function gerarClientRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  throw new Error(
    "Nenhuma fonte de aleatoriedade criptográfica disponível — não é seguro gerar um clientRequestId previsível."
  );
}

/**
 * Valida/normaliza um clientRequestId vindo de fora (body de uma
 * requisição). Retorna null para qualquer valor fora do formato esperado —
 * nunca lança, nunca aceita algo que possa carregar PII.
 */
export function sanitizeClientRequestId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return CLIENT_REQUEST_ID_REGEX.test(trimmed) ? trimmed : null;
}

/**
 * Hash SHA-256 (hex) do clientRequestId — a única forma permitida de deixar
 * um traço da tentativa dentro do próprio pedido persistido em `pedidos`
 * (ver src/app/api/pedido-app/route.ts, campo `survivalClientRequestIdHash`).
 * Nunca o valor bruto: mesmo sendo um identificador opaco (não PII), gravar
 * só o hash evita que o `clientRequestId` original apareça em qualquer
 * dump/leitura direta da chave `pedidos` (painel admin, exportação, etc.).
 */
export function hashClientRequestId(clientRequestId: string): string {
  return createHash("sha256").update(clientRequestId).digest("hex");
}
