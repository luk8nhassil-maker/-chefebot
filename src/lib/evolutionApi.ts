// Configuração central da Evolution API — usada por todas as rotas e
// funções que enviam, consultam ou reconectam o WhatsApp. Sem fallback
// hardcoded para nenhum host de PaaS efêmero: sem env var válida, quem
// chamar recebe `null` e deve tratar como `provider_not_configured`.

export type EvolutionConfig = {
  baseUrl: string;
  apiKey: string;
  instanceName: string;
  webhookUrl: string;
};

const WEBHOOK_URL_PADRAO = "https://chefebot-pjif.vercel.app/api/whatsapp";

/**
 * Valida e normaliza a URL configurada, sem alterar o host/caminho
 * informado — só adiciona o protocolo quando ausente e remove barra(s)
 * final(is) duplicada(s). Só aceita HTTPS.
 */
function normalizarBaseUrl(url: string): string | null {
  const comProtocolo = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  let parsed: URL;
  try {
    parsed = new URL(comProtocolo);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || !parsed.hostname) return null;
  return comProtocolo.replace(/\/+$/, "");
}

/**
 * Fonte única de verdade da configuração da Evolution API. Nunca cai para
 * um host hardcoded (ex.: o antigo `evolution-api-production-8f99.up.railway.app`
 * do Railway) — se `EVOLUTION_API_URL` estiver ausente/inválida ou
 * `EVOLUTION_API_KEY` estiver ausente, retorna `null`. Nunca envia
 * `apikey: undefined` para a Evolution API.
 */
export function obterConfigEvolution(): EvolutionConfig | null {
  const urlBruta = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;
  if (!urlBruta || !apiKey) return null;

  const baseUrl = normalizarBaseUrl(urlBruta);
  if (!baseUrl) return null;

  return {
    baseUrl,
    apiKey,
    instanceName: process.env.EVOLUTION_INSTANCE_NAME || "chefebot",
    webhookUrl: process.env.EVOLUTION_WEBHOOK_URL || WEBHOOK_URL_PADRAO,
  };
}

/**
 * Extrai o QR em base64 de qualquer um dos formatos observados/documentados
 * da Evolution API. Só reconhece caminhos já comprovados — nunca inventa um novo.
 */
export function extrairQrBase64(data: unknown): string | null {
  const d = data as Record<string, unknown> | null | undefined;
  if (!d) return null;
  if (typeof d.base64 === "string") return d.base64;
  const qrcode = d.qrcode as Record<string, unknown> | undefined;
  if (qrcode && typeof qrcode.base64 === "string") return qrcode.base64;
  const qr = d.qr as Record<string, unknown> | undefined;
  if (qr && typeof qr.base64 === "string") return qr.base64;
  return null;
}
