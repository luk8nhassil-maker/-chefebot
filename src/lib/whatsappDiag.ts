import { redis } from "./redis";

// Sinais de saúde do WhatsApp, gravados como telemetria passiva — nunca
// usados como gate de nada (Etapa F: separar sinais de saúde ao invés de
// depender só de whatsapp_connection_status). Toda escrita aqui é
// best-effort: falha nunca pode quebrar o webhook ou o envio de mensagem.

const CHAVE_INBOUND = "whatsapp:diag:inboundLastSeenAt";
const CHAVE_OUTBOUND = "whatsapp:diag:outboundLastSuccessAt";
const CHAVE_WEBHOOK = "whatsapp:diag:webhookLastSeenAt";
const CHAVE_WEBHOOK_EVENTO = "whatsapp:diag:webhookLastEvent";
const CHAVE_DESCARTE = "whatsapp:diag:upsertDescartadoLastAt";
const CHAVE_DESCARTE_SUFIXO = "whatsapp:diag:upsertDescartadoSufixo";
const CHAVE_DESCARTE_CAMPOS = "whatsapp:diag:upsertDescartadoCampos";
const CHAVE_ENVIO_AT = "whatsapp:diag:outboundLastAttemptAt";
const CHAVE_ENVIO_OK = "whatsapp:diag:outboundLastAttemptOk";
const CHAVE_ENVIO_MOTIVO = "whatsapp:diag:outboundLastAttemptMotivo";
const CHAVE_ENVIO_STATUS = "whatsapp:diag:outboundLastAttemptStatus";
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

/**
 * Marca que um webhook da Evolution CHEGOU ao servidor, antes de qualquer
 * filtro. É o sinal que separa dois diagnósticos que `inboundLastSeenAt`
 * sozinho não distingue: "a Evolution parou de entregar evento" (este
 * marcador também fica parado) e "o evento chega mas é descartado pelo filtro
 * de JID" (este avança e o inbound não). Só o nome do evento é gravado —
 * nunca telefone, JID ou conteúdo.
 */
export async function marcarWebhookRecebido(evento: unknown): Promise<void> {
  try {
    const nome = typeof evento === "string" && evento.trim() ? evento.trim().slice(0, 60) : "desconhecido";
    await Promise.all([
      redis.set(CHAVE_WEBHOOK, Date.now(), { ex: DIAG_TTL_SEGUNDOS }),
      redis.set(CHAVE_WEBHOOK_EVENTO, nome, { ex: DIAG_TTL_SEGUNDOS }),
    ]);
  } catch {
    // Best-effort — nunca quebra o webhook.
  }
}

/**
 * Marca que um `messages.upsert` foi descartado por não resolver para uma
 * conversa individual (LID sem `remoteJidAlt`, grupo, broadcast).
 *
 * Grava SOMENTE o sufixo do JID ("@lid", "@g.us", ...) e os NOMES dos campos
 * presentes na chave — schema, nunca valor. Nada aqui identifica um cliente,
 * e é justamente isso que permite descobrir em qual campo a versão instalada
 * da Evolution coloca o telefone real, sem inspecionar payload de conversa.
 */
export async function marcarUpsertDescartado(chave: unknown): Promise<void> {
  try {
    const objeto = typeof chave === "object" && chave !== null ? (chave as Record<string, unknown>) : {};
    const remoteJid = objeto.remoteJid;
    const sufixo =
      typeof remoteJid === "string" && remoteJid.includes("@")
        ? `@${remoteJid.split("@").pop()!.slice(0, 30)}`
        : "sem_jid";
    const campos = Object.keys(objeto).sort().join(",").slice(0, 200);
    await Promise.all([
      redis.set(CHAVE_DESCARTE, Date.now(), { ex: DIAG_TTL_SEGUNDOS }),
      redis.set(CHAVE_DESCARTE_SUFIXO, sufixo, { ex: DIAG_TTL_SEGUNDOS }),
      redis.set(CHAVE_DESCARTE_CAMPOS, campos, { ex: DIAG_TTL_SEGUNDOS }),
    ]);
  } catch {
    // Best-effort — nunca quebra o webhook.
  }
}

/**
 * Marca o resultado da ÚLTIMA tentativa de envio pela Evolution, com sucesso
 * ou não. Diferente de `outboundLastSuccessAt` (que só cobre o fluxo de
 * conversa do bot), este marcador cobre o choke point real de saída
 * — inclusive a notificação de status de pedido, que chama
 * `enviarTextoWhatsApp` direto. Sem telefone e sem conteúdo: só ok, motivo
 * curto e status HTTP.
 */
export async function marcarTentativaEnvio(resultado: {
  ok: boolean;
  motivo?: string;
  statusHttp?: number;
}): Promise<void> {
  try {
    await Promise.all([
      redis.set(CHAVE_ENVIO_AT, Date.now(), { ex: DIAG_TTL_SEGUNDOS }),
      redis.set(CHAVE_ENVIO_OK, resultado.ok, { ex: DIAG_TTL_SEGUNDOS }),
      redis.set(CHAVE_ENVIO_MOTIVO, (resultado.motivo ?? (resultado.ok ? "ok" : "sem_motivo")).slice(0, 60), {
        ex: DIAG_TTL_SEGUNDOS,
      }),
      redis.set(CHAVE_ENVIO_STATUS, resultado.statusHttp ?? null, { ex: DIAG_TTL_SEGUNDOS }),
    ]);
  } catch {
    // Best-effort — nunca quebra o envio.
  }
}

export type DiagnosticoWhatsapp = {
  inboundLastSeenAt: number | null;
  outboundLastSuccessAt: number | null;
  webhookLastSeenAt: number | null;
  webhookLastEvent: string | null;
  upsertDescartadoLastAt: number | null;
  upsertDescartadoSufixo: string | null;
  upsertDescartadoCampos: string | null;
  outboundLastAttemptAt: number | null;
  outboundLastAttemptOk: boolean | null;
  outboundLastAttemptMotivo: string | null;
  outboundLastAttemptStatus: number | null;
};

export async function lerDiagnosticoWhatsapp(): Promise<DiagnosticoWhatsapp> {
  const ler = <T>(chave: string) => redis.get<T>(chave).catch(() => null);
  const [
    inbound,
    outbound,
    webhookAt,
    webhookEvento,
    descarteAt,
    descarteSufixo,
    descarteCampos,
    envioAt,
    envioOk,
    envioMotivo,
    envioStatus,
  ] = await Promise.all([
    ler<number>(CHAVE_INBOUND),
    ler<number>(CHAVE_OUTBOUND),
    ler<number>(CHAVE_WEBHOOK),
    ler<string>(CHAVE_WEBHOOK_EVENTO),
    ler<number>(CHAVE_DESCARTE),
    ler<string>(CHAVE_DESCARTE_SUFIXO),
    ler<string>(CHAVE_DESCARTE_CAMPOS),
    ler<number>(CHAVE_ENVIO_AT),
    ler<boolean>(CHAVE_ENVIO_OK),
    ler<string>(CHAVE_ENVIO_MOTIVO),
    ler<number>(CHAVE_ENVIO_STATUS),
  ]);
  return {
    inboundLastSeenAt: inbound ?? null,
    outboundLastSuccessAt: outbound ?? null,
    webhookLastSeenAt: webhookAt ?? null,
    webhookLastEvent: webhookEvento ?? null,
    upsertDescartadoLastAt: descarteAt ?? null,
    upsertDescartadoSufixo: descarteSufixo ?? null,
    upsertDescartadoCampos: descarteCampos ?? null,
    outboundLastAttemptAt: envioAt ?? null,
    outboundLastAttemptOk: typeof envioOk === "boolean" ? envioOk : null,
    outboundLastAttemptMotivo: envioMotivo ?? null,
    outboundLastAttemptStatus: typeof envioStatus === "number" ? envioStatus : null,
  };
}
