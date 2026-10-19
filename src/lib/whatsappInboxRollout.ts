// Política de seleção no servidor. Preparar esta capacidade não ativa nenhum número.
export const INBOX_GRADUAL_SUPPORTED = true;
type Environment = Record<string, string | undefined>;
type Mode = "off" | "allowlist" | "all";
export type InboxRollout = {
  mode: Mode; enabled: boolean; valid: boolean; phones: readonly string[];
};
const PHONE = /^55[1-9]\d{9,10}$/;

export function configuracaoRolloutInboxWhatsapp(env: Environment = process.env): InboxRollout {
  const rawMode = env.WHATSAPP_INBOX_ROLLOUT || "off";
  if (env.VERCEL_ENV === "preview") return { mode: "off", enabled: false, valid: true, phones: [] };
  if (rawMode === "all") return { mode: "all", enabled: true, valid: true, phones: [] };
  if (rawMode === "off") return { mode: "off", enabled: false, valid: true, phones: [] };
  if (rawMode !== "allowlist") return { mode: "off", enabled: false, valid: false, phones: [] };
  const raw = env.WHATSAPP_INBOX_ALLOWED_PHONES || "";
  // Limite de parsing técnico, sem aceitar curingas, DDD parcial ou fallback para all.
  const entries = raw.length <= 8192 ? raw.split(",").map(value => value.trim()) : [];
  if (entries.length === 0 || entries.some(value => !PHONE.test(value))) {
    return { mode: "allowlist", enabled: false, valid: false, phones: [] };
  }
  return { mode: "allowlist", enabled: true, valid: true, phones: [...new Set(entries)] };
}

export function inboxWhatsappHabilitadaPara(phone: string, env: Environment = process.env): boolean {
  const config = configuracaoRolloutInboxWhatsapp(env);
  return config.enabled && (config.mode === "all" || config.phones.includes(phone));
}
