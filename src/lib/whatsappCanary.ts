import { redis } from "./redis";
import { enviarTextoWhatsApp } from "./whatsappMensagem";
import { maskPhone, sanitizeErrorMessage } from "./sanitizeLog";
import { telefonesCorrespondem } from "./telefone";
import { log } from "./logger";

// Canário permanente de baixo custo do WhatsApp (Etapa G) — teste real sob
// demanda, sem polling nem cron obrigatório. Só é acionado por um clique
// explícito de admin/dev em /dev/whatsapp. Nunca cria pedido, sessão ou
// carrinho, nunca interfere em Pix/fidelidade, e nunca aceita telefone
// arbitrário: o único destino possível é WHATSAPP_CANARY_PHONE.

export type CanaryState =
  | "created"
  | "outbound_sent"
  | "outbound_failed"
  | "inbound_received"
  | "acknowledgement_sent"
  | "roundtrip_ok"
  | "expired";

export type CanaryRecord = {
  token: string;
  phoneMascarado: string;
  state: CanaryState;
  createdAt: number;
  expiresAt: number;
  outboundAt?: number;
  outboundLatencyMs?: number;
  outboundError?: string;
  inboundAt?: number;
  ackAt?: number;
  ackError?: string;
};

const CHAVE_ATIVO = "whatsapp:canary:active";
const CHAVE_ULTIMO = "whatsapp:canary:last";
const CHAVE_RATE_LIMIT = "whatsapp:canary:ratelimit";
const PREFIXO_DEDUP_INBOUND = "whatsapp:canary:inbound:";

const TTL_TESTE_SEGUNDOS = 10 * 60; // 10 minutos
const TTL_ULTIMO_SEGUNDOS = 24 * 60 * 60; // histórico do painel, 24h
const RATE_LIMIT_JANELA_SEGUNDOS = 5 * 60; // 1 início a cada 5 minutos
const DEDUP_INBOUND_TTL_SEGUNDOS = 60 * 60;

export type CanaryPhoneStatus =
  | { configured: true; phone: string }
  | { configured: false };

/** Único destino permitido — nunca aceita telefone vindo do corpo da requisição. */
export function obterTelefoneCanario(): CanaryPhoneStatus {
  const phone = process.env.WHATSAPP_CANARY_PHONE;
  if (!phone) return { configured: false };
  return { configured: true, phone };
}

function gerarToken(): string {
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem caracteres ambíguos
  let sufixo = "";
  for (let i = 0; i < 4; i++) {
    sufixo += alfabeto[Math.floor(Math.random() * alfabeto.length)];
  }
  return `CBTEST-${sufixo}`;
}

async function salvarRegistro(record: CanaryRecord): Promise<void> {
  await redis.set(CHAVE_ATIVO, record, { ex: TTL_TESTE_SEGUNDOS });
  await redis.set(CHAVE_ULTIMO, record, { ex: TTL_ULTIMO_SEGUNDOS });
}

export async function lerCanarioAtual(): Promise<CanaryRecord | null> {
  const ativo = await redis.get<CanaryRecord>(CHAVE_ATIVO);
  if (ativo) {
    if (Date.now() > ativo.expiresAt && ativo.state !== "roundtrip_ok" && ativo.state !== "expired") {
      const expirado: CanaryRecord = { ...ativo, state: "expired" };
      await redis.set(CHAVE_ULTIMO, expirado, { ex: TTL_ULTIMO_SEGUNDOS });
      return expirado;
    }
    return ativo;
  }
  return redis.get<CanaryRecord>(CHAVE_ULTIMO);
}

export type IniciarCanarioResultado =
  | { ok: true; record: CanaryRecord }
  | { ok: false; motivo: "provider_not_configured" }
  | { ok: false; motivo: "rate_limited"; retryAfterSeconds: number };

/** Inicia um novo teste: gera token, envia via Evolution, salva estado efêmero. */
export async function iniciarCanario(): Promise<IniciarCanarioResultado> {
  const destino = obterTelefoneCanario();
  if (!destino.configured) return { ok: false, motivo: "provider_not_configured" };

  const bloqueado = !(await redis.set(CHAVE_RATE_LIMIT, "1", { nx: true, ex: RATE_LIMIT_JANELA_SEGUNDOS }));
  if (bloqueado) {
    const ttl = await redis.ttl(CHAVE_RATE_LIMIT).catch(() => RATE_LIMIT_JANELA_SEGUNDOS);
    return { ok: false, motivo: "rate_limited", retryAfterSeconds: ttl > 0 ? ttl : RATE_LIMIT_JANELA_SEGUNDOS };
  }

  const token = gerarToken();
  const agora = Date.now();
  const phoneMascarado = maskPhone(destino.phone);

  let record: CanaryRecord = {
    token,
    phoneMascarado,
    state: "created",
    createdAt: agora,
    expiresAt: agora + TTL_TESTE_SEGUNDOS * 1000,
  };
  await salvarRegistro(record);

  const texto = `Teste técnico do ChefeBot: ${token}\nResponda exatamente: ${token}`;
  const envio = await enviarTextoWhatsApp(destino.phone, texto);

  record = envio.ok
    ? { ...record, state: "outbound_sent", outboundAt: Date.now(), outboundLatencyMs: envio.latenciaMs }
    : { ...record, state: "outbound_failed", outboundAt: Date.now(), outboundLatencyMs: envio.latenciaMs, outboundError: envio.motivo };
  await salvarRegistro(record);

  await log(
    envio.ok ? "info" : "erro",
    `Canário WhatsApp: ${record.state}`,
    `latenciaMs=${envio.latenciaMs} tentativas=${envio.tentativas}${envio.motivo ? ` motivo=${envio.motivo}` : ""}`
  );

  return { ok: true, record };
}

/**
 * Chamado pelo webhook em toda messages.upsert individual, ANTES de qualquer
 * gate normal (bot_ativo, manual, spam) e antes de qualquer sessão/pedido.
 * Só age se o telefone remetente for exatamente o autorizado E o texto for
 * exatamente o token do canário ativo. Qualquer outra combinação retorna
 * false sem efeito colateral, deixando o fluxo normal do cliente seguir.
 */
export async function processarPossivelInboundCanario(
  remoteJidPhone: string,
  texto: string,
  msgId: string | undefined
): Promise<boolean> {
  const destino = obterTelefoneCanario();
  if (!destino.configured) return false;
  if (!telefonesCorrespondem(remoteJidPhone, destino.phone)) return false;

  const atual = await redis.get<CanaryRecord>(CHAVE_ATIVO);
  if (!atual) return false;
  if ((texto || "").trim().toUpperCase() !== atual.token) return false;

  // Dedup por messageId ANTES do gate de estado terminal: uma reentrega do
  // mesmo evento (Evolution pode reenviar webhooks) para uma mensagem já
  // processada ainda é reconhecida como "do canário" (não cai no fluxo
  // normal do cliente), só não dispara um segundo ack.
  if (msgId) {
    const novo = await redis.set(`${PREFIXO_DEDUP_INBOUND}${msgId}`, "1", { nx: true, ex: DEDUP_INBOUND_TTL_SEGUNDOS });
    if (!novo) return true;
  }

  if (Date.now() > atual.expiresAt) return false;
  if (atual.state === "roundtrip_ok" || atual.state === "expired") return false;

  let registro: CanaryRecord = { ...atual, state: "inbound_received", inboundAt: Date.now() };
  await salvarRegistro(registro);
  await log("info", "Canário WhatsApp: inbound_received", "");

  const ack = await enviarTextoWhatsApp(destino.phone, "Teste concluído ✅ O ChefeBot recebeu sua resposta e respondeu pela produção.");
  if (ack.ok) {
    registro = { ...registro, state: "roundtrip_ok", ackAt: Date.now() };
    await log("info", "Canário WhatsApp: roundtrip_ok", `latenciaMs=${ack.latenciaMs}`);
  } else {
    registro = { ...registro, state: "acknowledgement_sent", ackAt: Date.now(), ackError: ack.motivo };
    await log("erro", "Canário WhatsApp: falha ao enviar confirmação", sanitizeErrorMessage(ack.motivo));
  }
  await salvarRegistro(registro);

  return true;
}
