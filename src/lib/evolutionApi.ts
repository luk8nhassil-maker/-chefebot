// Helpers compartilhados entre as rotas que falam com a Evolution API
// (qrcode, state, verify, connect, rebuild, e os pontos do bot que enviam
// mensagem) — configuração validada centralmente (sem fallback hardcoded
// pra um host de PaaS efêmero), extração do QR e diagnóstico de erro, sem
// duplicar a mesma lógica em cada arquivo.

export type EvolutionConfig = {
  baseUrl: string;
  apiKey: string;
  instanceName: string;
  webhookUrl: string;
};

function ehUrlValida(url: string): boolean {
  try {
    const normalizada = url.startsWith("http://") || url.startsWith("https://") ? url : `https://${url}`;
    const u = new URL(normalizada);
    return u.protocol === "https:" && u.hostname.length > 0;
  } catch {
    return false;
  }
}

/**
 * Fonte única de verdade da configuração da Evolution API. Nunca cai para
 * um host hardcoded (ex.: o antigo `evolution-api-production-8f99.up.railway.app`
 * do Railway) — se a env var não existir ou não for uma URL válida, retorna
 * `null` e quem chamou deve tratar isso como `provider_not_configured`,
 * nunca tentar adivinhar um host.
 */
export function obterConfigEvolution(): EvolutionConfig | null {
  const urlBruta = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;
  const instanceName = process.env.EVOLUTION_INSTANCE_NAME || "chefebot";
  const webhookUrl = process.env.EVOLUTION_WEBHOOK_URL || "";

  if (!urlBruta || !ehUrlValida(urlBruta)) return null;
  if (!apiKey) return null;

  const baseUrl = urlBruta.startsWith("http://") || urlBruta.startsWith("https://") ? urlBruta : `https://${urlBruta}`;
  return { baseUrl, apiKey, instanceName, webhookUrl };
}

/**
 * Estados possíveis do provider de WhatsApp (Evolution API), usados pelo
 * admin para decidir o que mostrar e qual ação recomendar. Nunca inferido só
 * de um código HTTP isolado — sempre combinando configuração + resposta real.
 */
export type EstadoProviderWhatsapp =
  | "provider_not_configured"
  | "provider_down"
  | "provider_unauthorized"
  | "instance_missing"
  | "instance_disconnected"
  | "qr_required"
  | "connecting"
  | "connected"
  | "webhook_error"
  | "unknown";

/**
 * Extrai o QR em base64 de qualquer um dos formatos observados/documentados
 * da Evolution API. Só reconhece caminhos comprovados — nunca inventa um novo.
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

/**
 * A Evolution API (app-level) responde erro de instância com o próprio
 * formato dela. Quando o *host* configurado em EVOLUTION_API_URL não tem
 * nenhum serviço respondendo ali (app deletado/fora do ar no Railway, URL
 * errada etc.), a borda do Railway responde um 404 genérico, sempre no
 * mesmo formato — `{status:"error", code, message:"Application not found",
 * request_id}` — independente do caminho chamado (connect, create, delete
 * ou logout dão exatamente a mesma resposta). Isso é o sinal de que o
 * problema é de infraestrutura/configuração (EVOLUTION_API_URL apontando
 * para um serviço que não existe mais), não de "instância não encontrada"
 * dentro da Evolution API — nenhum retry ou payload novo resolve isso.
 */
export function ehErroPlataformaIndisponivel(status: number, data: unknown): boolean {
  const d = data as Record<string, unknown> | null | undefined;
  if (!d) return false;
  return (
    status === 404 &&
    d.status === "error" &&
    d.message === "Application not found" &&
    typeof d.request_id === "string"
  );
}

/** Mensagem segura para expor ao cliente — nunca o corpo bruto da Evolution API. */
export function mensagemErroEvolution(status: number, data: unknown): string {
  if (ehErroPlataformaIndisponivel(status, data)) {
    return "A Evolution API não está acessível no endereço configurado (EVOLUTION_API_URL). Verifique se o serviço está no ar.";
  }
  const d = data as Record<string, unknown> | null | undefined;
  // Evolution API (NestJS) costuma responder validação como message: string[].
  let mensagem: string | null = null;
  if (typeof d?.message === "string") mensagem = d.message;
  else if (Array.isArray(d?.message) && d.message.every((m) => typeof m === "string")) mensagem = d.message.join("; ");
  return mensagem ? `Evolution API: ${mensagem}` : "Evolution API retornou erro";
}
