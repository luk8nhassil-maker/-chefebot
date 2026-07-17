// Helpers de sanitização para logs/diagnósticos do WhatsApp — nunca expor
// telefone completo, texto de mensagem ou credenciais, mesmo em erro.
// Reaproveita o mesmo padrão já usado em healthChecks.ts/redisTelemetry.ts
// (mascarar sequências longas de dígitos e tokens Bearer), centralizado aqui
// para o novo código de diagnóstico/canário do WhatsApp.

/** Mascara um erro para exibição segura: nunca telefone, token ou corpo bruto. */
export function sanitizeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  return raw
    .replace(/\d{8,}/g, "[numero]")
    .replace(/bearer\s+\S+/gi, "bearer [token]")
    .slice(0, 200);
}

/** Mostra só os últimos 4 dígitos de um telefone — nunca o número completo. */
export function maskPhone(phone: string | null | undefined): string {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `***${digits.slice(-4)}`;
}

/** Mostra só os últimos 6 caracteres de um messageId da Evolution. */
export function maskMessageId(id: string | null | undefined): string {
  if (!id) return "";
  return id.length <= 6 ? id : `...${id.slice(-6)}`;
}
