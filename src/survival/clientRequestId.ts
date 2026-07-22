// clientRequestId — identificador gerado UMA VEZ por tentativa de checkout,
// no navegador, e reutilizado em qualquer retry da MESMA tentativa (nunca
// regenerado só porque houve timeout). Nunca contém telefone, nome ou
// qualquer PII: é só um identificador aleatório opaco. Quando
// SURVIVAL_MODE_ENABLED=true, o backend usa esse valor (ver
// src/app/api/pedido-app/route.ts) para reconhecer um reenvio do mesmo
// pedido e devolver o resultado já criado, em vez de criar um duplicado.

const CLIENT_REQUEST_ID_REGEX = /^[a-zA-Z0-9_-]{8,100}$/;

/**
 * Gera um novo identificador de tentativa de checkout. Só deve ser chamado
 * uma vez por tentativa — a garantia de idempotência depende de o mesmo
 * valor ser reaproveitado em qualquer retry dessa tentativa.
 */
export function gerarClientRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback só para ambientes sem crypto.randomUUID (não deveria ocorrer
  // em navegadores modernos) — ainda assim nunca usa só Math.random.
  return `crid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
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
