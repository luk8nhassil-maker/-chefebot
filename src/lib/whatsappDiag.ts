import { redis } from "./redis";

// Sinais de saúde do WhatsApp, gravados como telemetria passiva — nunca
// usados como gate de nada (Etapa F: separar sinais de saúde ao invés de
// depender só de whatsapp_connection_status). Toda escrita aqui é
// best-effort: falha nunca pode quebrar o webhook ou o envio de mensagem.

const CHAVE_INBOUND = "whatsapp:diag:inboundLastSeenAt";
const CHAVE_OUTBOUND = "whatsapp:diag:outboundLastSuccessAt";
const DIAG_TTL_SEGUNDOS = 30 * 24 * 60 * 60; // 30 dias — só telemetria, não é estado operacional

export async function marcarInboundRecebido(): Promise<void> {
  try {
    await redis.set(CHAVE_INBOUND, Date.now(), { ex: DIAG_TTL_SEGUNDOS });
  } catch {
    // Best-effort — nunca quebra o webhook.
  }
}

export async function marcarOutboundConfirmado(): Promise<void> {
  try {
    await redis.set(CHAVE_OUTBOUND, Date.now(), { ex: DIAG_TTL_SEGUNDOS });
  } catch {
    // Best-effort — nunca quebra o envio.
  }
}

export async function lerDiagnosticoWhatsapp(): Promise<{
  inboundLastSeenAt: number | null;
  outboundLastSuccessAt: number | null;
}> {
  const [inbound, outbound] = await Promise.all([
    redis.get<number>(CHAVE_INBOUND).catch(() => null),
    redis.get<number>(CHAVE_OUTBOUND).catch(() => null),
  ]);
  return { inboundLastSeenAt: inbound ?? null, outboundLastSuccessAt: outbound ?? null };
}
