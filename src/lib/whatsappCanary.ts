import { redis } from "./redis";
import { enviarTextoWhatsApp } from "./whatsappMensagem";
import { maskMessageId, maskPhone, sanitizeErrorMessage } from "./sanitizeLog";
import { telefonesCorrespondem } from "./telefone";
import { log } from "./logger";
import { marcarOutboundConfirmado } from "./whatsappDiag";

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
  | "acknowledgement_failed"
  | "roundtrip_ok"
  | "expired";

export type CanaryTransition = {
  state: CanaryState;
  at: number;
};

export type CanaryRecord = {
  /** Versão 2 distingue ACK realmente aceito do estado legado de falha. */
  schemaVersion?: number;
  token: string;
  phoneMascarado: string;
  state: CanaryState;
  createdAt: number;
  expiresAt: number;
  outboundAt?: number;
  outboundLatencyMs?: number;
  outboundAttempts?: number;
  outboundHttpStatus?: number;
  outboundMessageIdMasked?: string;
  outboundError?: string;
  inboundAt?: number;
  ackAt?: number;
  ackLatencyMs?: number;
  ackAttempts?: number;
  ackHttpStatus?: number;
  ackMessageIdMasked?: string;
  ackError?: string;
  roundtripAt?: number;
  revision: number;
  transitions: CanaryTransition[];
};

const CHAVE_ATIVO = "whatsapp:canary:active";
const CHAVE_ULTIMO = "whatsapp:canary:last";
const CHAVE_RATE_LIMIT = "whatsapp:canary:ratelimit";
const PREFIXO_LOCK_ACK = "whatsapp:canary:ack-lock:";

const TTL_TESTE_SEGUNDOS = 10 * 60; // 10 minutos
const TTL_ULTIMO_SEGUNDOS = 24 * 60 * 60; // histórico do painel, 24h
const RATE_LIMIT_JANELA_SEGUNDOS = 5 * 60; // 1 início a cada 5 minutos
const ACK_LOCK_TTL_SEGUNDOS = 45;
const INBOUND_LEASE_SEGUNDOS = 2 * 60;
const MAX_TENTATIVAS_CAS = 8;
const CANARY_SCHEMA_VERSION = 2;
const TOKEN_CANARIO_RE = /^CBTEST-[A-Z0-9]{4}$/;
const MENSAGEM_ACK_CANARIO = "Teste concluído ✅ O ChefeBot recebeu sua resposta e respondeu pela produção.";
const MENSAGEM_INICIO_CANARIO_RE = /^Teste técnico do ChefeBot: (CBTEST-[A-Z0-9]{4})\r?\nResponda exatamente: \1$/;

export type CanaryPhoneStatus =
  | { configured: true; phone: string }
  | { configured: false };

/**
 * Faz o webhook responder 503 para que a Evolution reentregue o evento depois
 * da lease corrente. Não inclui token, telefone ou outro dado operacional.
 */
export class CanaryInboundRetryableError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("canary_inbound_busy");
    this.name = "CanaryInboundRetryableError";
  }
}

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

function montarMensagemInicio(token: string): string {
  return `Teste técnico do ChefeBot: ${token}\nResponda exatamente: ${token}`;
}

/**
 * Evita que os ecos fromMe dos dois sendText do canário contaminem o histórico
 * comercial. A classificação só vale para o telefone fixo da env e formatos
 * exatos do canário; mensagens humanas comuns continuam sendo registradas.
 */
export function ehEcoOutboundCanario(remoteJidPhone: string, texto: string): boolean {
  const destino = obterTelefoneCanario();
  if (!destino.configured || !telefonesCorrespondem(remoteJidPhone, destino.phone)) return false;
  const normalizado = (texto || "").trim();
  return (
    TOKEN_CANARIO_RE.test(normalizado.toUpperCase()) ||
    MENSAGEM_INICIO_CANARIO_RE.test(normalizado) ||
    normalizado === MENSAGEM_ACK_CANARIO
  );
}

const ATUALIZAR_REGISTRO_SE_TOKEN_ATUAL_LUA = `
local atual = redis.call("GET", KEYS[1])
if not atual then return 0 end
local ok, registro = pcall(cjson.decode, atual)
if not ok or registro["token"] ~= ARGV[1] then return 0 end
local revisao = tonumber(registro["revision"] or 0)
if revisao ~= tonumber(ARGV[2]) then return 0 end
redis.call("SET", KEYS[1], ARGV[3], "EX", tonumber(ARGV[4]))
redis.call("SET", KEYS[2], ARGV[3], "EX", tonumber(ARGV[5]))
return 1
`;

const LIBERAR_LOCK_SE_OWNER_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

function obterRevisao(record: CanaryRecord): number {
  return Number.isInteger(record.revision) && record.revision >= 0 ? record.revision : 0;
}

function ehAckAceitoPersistido(record: CanaryRecord): boolean {
  return (
    record.state === "acknowledgement_sent" &&
    record.schemaVersion === CANARY_SCHEMA_VERSION &&
    !record.ackError &&
    typeof record.ackHttpStatus === "number" &&
    record.ackHttpStatus >= 200 &&
    record.ackHttpStatus < 300
  );
}

async function salvarRegistro(record: CanaryRecord, revisaoEsperada?: number): Promise<boolean> {
  // O TTL físico acompanha expiresAt; transições tardias não podem criar uma
  // janela morta em que GET mostra expired, mas POST continua bloqueado.
  const ttlAtivo = Math.max(1, Math.ceil((record.expiresAt - Date.now()) / 1000));
  if (revisaoEsperada !== undefined) {
    const atualizado = await redis.eval(
      ATUALIZAR_REGISTRO_SE_TOKEN_ATUAL_LUA,
      [CHAVE_ATIVO, CHAVE_ULTIMO],
      [record.token, String(revisaoEsperada), JSON.stringify(record), String(ttlAtivo), String(TTL_ULTIMO_SEGUNDOS)]
    );
    return Number(atualizado) === 1;
  }
  await redis.set(CHAVE_ATIVO, record, { ex: ttlAtivo });
  await redis.set(CHAVE_ULTIMO, record, { ex: TTL_ULTIMO_SEGUNDOS });
  return true;
}

async function liberarAckLock(key: string, owner: string): Promise<void> {
  await redis.eval(LIBERAR_LOCK_SE_OWNER_LUA, [key], [owner]);
}

function comTransicao(record: CanaryRecord, state: CanaryState, at = Date.now()): CanaryRecord {
  const transitions = Array.isArray(record.transitions)
    ? record.transitions
    : [{ state: record.state, at: record.createdAt }];
  return { ...record, state, revision: obterRevisao(record) + 1, transitions: [...transitions, { state, at }] };
}

/**
 * Reaplica uma mutacao sobre a revisao mais recente enquanto o token continuar
 * sendo o mesmo. Um conflito de revisao dentro da mesma geracao e esperado
 * quando a resposta HTTP do outbound chega em paralelo com o webhook inbound;
 * somente a troca do token deve abortar o fluxo.
 *
 * Retornar undefined no transformador significa que o estado atual ja e
 * suficiente (ou nao admite aquela transicao), sem nova escrita.
 */
async function atualizarRegistroMesmaGeracao(
  token: string,
  transformar: (atual: CanaryRecord) => CanaryRecord | undefined
): Promise<CanaryRecord | null> {
  for (let tentativa = 0; tentativa < MAX_TENTATIVAS_CAS; tentativa++) {
    const atual = await redis.get<CanaryRecord>(CHAVE_ATIVO);
    if (!atual || atual.token !== token) return null;
    const proximo = transformar(atual);
    if (!proximo) return atual;
    if (await salvarRegistro(proximo, obterRevisao(atual))) return proximo;
  }
  return null;
}

type AckEvidence = Pick<
  CanaryRecord,
  "ackAt" | "ackLatencyMs" | "ackAttempts" | "ackHttpStatus" | "ackMessageIdMasked" | "ackError"
>;

async function persistirInboundRecebido(token: string, inboundAt: number): Promise<CanaryRecord | null> {
  return atualizarRegistroMesmaGeracao(token, (atual) => {
    if (
      atual.state === "inbound_received" ||
      atual.state === "roundtrip_ok" ||
      atual.state === "expired" ||
      ehAckAceitoPersistido(atual)
    ) {
      return undefined;
    }

    const expiresAt = Math.max(atual.expiresAt, inboundAt + INBOUND_LEASE_SEGUNDOS * 1000);
    let base = atual;
    if (atual.state === "created") {
      base = { ...comTransicao(atual, "outbound_sent", inboundAt), outboundAt: atual.outboundAt ?? inboundAt };
    } else if (atual.state === "acknowledgement_sent") {
      // Na versão 1, acknowledgement_sent representava justamente uma falha
      // do ACK. Converte explicitamente antes de aceitar uma nova tentativa.
      base = {
        ...comTransicao(atual, "acknowledgement_failed", inboundAt),
        schemaVersion: CANARY_SCHEMA_VERSION,
        ackError: atual.ackError || "legacy_ack_unverified",
      };
    }
    return {
      ...comTransicao(base, "inbound_received", inboundAt),
      schemaVersion: CANARY_SCHEMA_VERSION,
      inboundAt,
      expiresAt,
    };
  });
}

async function persistirAckAceito(token: string, evidencia: AckEvidence): Promise<CanaryRecord | null> {
  return atualizarRegistroMesmaGeracao(token, (atual) => {
    if (atual.state === "roundtrip_ok" || atual.state === "expired" || ehAckAceitoPersistido(atual)) {
      return undefined;
    }
    if (
      atual.state !== "inbound_received" &&
      atual.state !== "acknowledgement_failed" &&
      atual.state !== "acknowledgement_sent"
    ) return undefined;
    return {
      ...comTransicao(atual, "acknowledgement_sent", evidencia.ackAt),
      schemaVersion: CANARY_SCHEMA_VERSION,
      ...evidencia,
    };
  });
}

async function persistirFalhaAck(token: string, evidencia: AckEvidence): Promise<CanaryRecord | null> {
  return atualizarRegistroMesmaGeracao(token, (atual) => {
    // Uma confirmacao aceita por outro fluxo nunca pode ser regredida por uma
    // resposta de falha tardia do provedor.
    if (
      atual.state === "roundtrip_ok" ||
      atual.state === "expired" ||
      ehAckAceitoPersistido(atual)
    ) {
      return undefined;
    }
    if (atual.state !== "inbound_received" && atual.state !== "acknowledgement_sent") return undefined;
    return {
      ...comTransicao(atual, "acknowledgement_failed", evidencia.ackAt),
      schemaVersion: CANARY_SCHEMA_VERSION,
      ...evidencia,
    };
  });
}

async function persistirRoundtrip(token: string, roundtripAt: number): Promise<CanaryRecord | null> {
  return atualizarRegistroMesmaGeracao(token, (atual) => {
    if (atual.state === "roundtrip_ok" || atual.state === "expired") return undefined;
    if (!ehAckAceitoPersistido(atual)) return undefined;
    return {
      ...comTransicao(atual, "roundtrip_ok", roundtripAt),
      schemaVersion: CANARY_SCHEMA_VERSION,
      roundtripAt,
    };
  });
}

async function finalizarAckAceito(token: string, roundtripAt: number): Promise<CanaryRecord | null> {
  const concluido = await persistirRoundtrip(token, roundtripAt);
  if (concluido?.state === "roundtrip_ok") return concluido;

  // Se a geração ainda contém um ACK comprovadamente aceito, não devolve 200
  // antes de concluir: pede reentrega para recuperar uma contenção transitória.
  const atual = await redis.get<CanaryRecord>(CHAVE_ATIVO);
  if (atual?.token === token && ehAckAceitoPersistido(atual)) {
    throw new CanaryInboundRetryableError(1);
  }
  return concluido;
}

async function retryDepoisDoLock(key: string): Promise<CanaryInboundRetryableError> {
  const ttl = await redis.ttl(key).catch(() => 1);
  return new CanaryInboundRetryableError(ttl > 0 ? Math.min(ttl, ACK_LOCK_TTL_SEGUNDOS) : 1);
}

async function consolidarEvidenciaOutbound(
  recordEnvio: CanaryRecord,
  revisaoEsperada: number
): Promise<CanaryRecord | null> {
  if (await salvarRegistro(recordEnvio, revisaoEsperada)) return recordEnvio;

  // Um inbound pode chegar antes de a resposta HTTP do sendText voltar. Nesse
  // caso preserva o estado mais avançado e anexa apenas a evidência outbound,
  // sempre sob CAS de revisão para não regredir a mesma geração.
  return atualizarRegistroMesmaGeracao(recordEnvio.token, (atual) => {
    const revisaoAtual = obterRevisao(atual);
    const base = atual.state === "created"
      ? comTransicao(atual, recordEnvio.state, recordEnvio.outboundAt)
      : { ...atual, revision: revisaoAtual + 1 };
    const consolidado: CanaryRecord = {
      ...base,
      schemaVersion: CANARY_SCHEMA_VERSION,
      outboundAt: base.outboundAt ?? recordEnvio.outboundAt,
      outboundLatencyMs: recordEnvio.outboundLatencyMs,
      outboundAttempts: recordEnvio.outboundAttempts,
      outboundHttpStatus: recordEnvio.outboundHttpStatus,
      outboundMessageIdMasked: recordEnvio.outboundMessageIdMasked,
      outboundError: recordEnvio.outboundError,
    };
    return consolidado;
  });
}

function normalizarRegistroLegadoParaLeitura(record: CanaryRecord): CanaryRecord {
  if (record.state !== "acknowledgement_sent" || ehAckAceitoPersistido(record)) return record;
  return comTransicao(record, "acknowledgement_failed", record.ackAt ?? record.createdAt);
}

export async function lerCanarioAtual(): Promise<CanaryRecord | null> {
  const ativo = await redis.get<CanaryRecord>(CHAVE_ATIVO);
  const bruto = ativo ?? (await redis.get<CanaryRecord>(CHAVE_ULTIMO));
  if (!bruto) return null;
  const record = normalizarRegistroLegadoParaLeitura(bruto);
  if (Date.now() > record.expiresAt && record.state !== "roundtrip_ok" && record.state !== "expired") {
    // GET é deliberadamente read-only: persistir/deletar aqui criaria uma
    // corrida com um POST novo exatamente na fronteira do TTL.
    return comTransicao(record, "expired");
  }
  return record;
}

export type IniciarCanarioResultado =
  | { ok: true; record: CanaryRecord }
  | { ok: false; motivo: "provider_not_configured" }
  | { ok: false; motivo: "rate_limited"; retryAfterSeconds: number };

/** Inicia um novo teste: gera token, envia via Evolution, salva estado efêmero. */
export async function iniciarCanario(): Promise<IniciarCanarioResultado> {
  const destino = obterTelefoneCanario();
  if (!destino.configured) return { ok: false, motivo: "provider_not_configured" };

  // O rate limit curto não pode permitir que um segundo POST sobrescreva um
  // teste ainda válido. Enquanto qualquer execução não terminal estiver ativa,
  // devolve o tempo lógico restante do próprio canário.
  const ativo = await redis.get<CanaryRecord>(CHAVE_ATIVO);
  if (
    ativo &&
    ativo.state !== "roundtrip_ok" &&
    ativo.state !== "expired" &&
    Date.now() <= ativo.expiresAt
  ) {
    const ttlAtivo = await redis.ttl(CHAVE_ATIVO).catch(() => -1);
    const restanteLogico = Math.ceil((ativo.expiresAt - Date.now()) / 1000);
    return {
      ok: false,
      motivo: "rate_limited",
      retryAfterSeconds: ttlAtivo > 0 ? ttlAtivo : Math.max(1, restanteLogico),
    };
  }

  const bloqueado = !(await redis.set(CHAVE_RATE_LIMIT, "1", { nx: true, ex: RATE_LIMIT_JANELA_SEGUNDOS }));
  if (bloqueado) {
    const ttl = await redis.ttl(CHAVE_RATE_LIMIT).catch(() => RATE_LIMIT_JANELA_SEGUNDOS);
    return { ok: false, motivo: "rate_limited", retryAfterSeconds: ttl > 0 ? ttl : RATE_LIMIT_JANELA_SEGUNDOS };
  }

  const token = gerarToken();
  const agora = Date.now();
  const phoneMascarado = maskPhone(destino.phone);

  let record: CanaryRecord = {
    schemaVersion: CANARY_SCHEMA_VERSION,
    token,
    phoneMascarado,
    state: "created",
    createdAt: agora,
    expiresAt: agora + TTL_TESTE_SEGUNDOS * 1000,
    revision: 0,
    transitions: [{ state: "created", at: agora }],
  };
  await salvarRegistro(record);

  const texto = montarMensagemInicio(token);
  const envio = await enviarTextoWhatsApp(destino.phone, texto);

  const outboundAt = Date.now();
  const revisaoAntesEnvio = obterRevisao(record);
  const recordEnvio: CanaryRecord = {
    ...comTransicao(record, envio.ok ? "outbound_sent" : "outbound_failed", outboundAt),
    outboundAt,
    outboundLatencyMs: envio.latenciaMs,
    outboundAttempts: envio.tentativas,
    outboundHttpStatus: envio.statusHttp,
    outboundMessageIdMasked: envio.messageIdMascarado || undefined,
    outboundError: envio.motivo,
  };
  const consolidado = await consolidarEvidenciaOutbound(recordEnvio, revisaoAntesEnvio);
  if (!consolidado) throw new Error("canary_generation_changed_during_outbound");
  record = consolidado;
  if (envio.ok) await marcarOutboundConfirmado();

  await log(
    envio.ok ? "info" : "erro",
    `Canário WhatsApp: ${recordEnvio.state}`,
    `sendText=true statusHttp=${envio.statusHttp ?? "n/a"} latenciaMs=${envio.latenciaMs} tentativas=${envio.tentativas} messageId=${envio.messageIdMascarado || "n/a"}${envio.motivo ? ` motivo=${sanitizeErrorMessage(envio.motivo)}` : ""}`
  );

  return { ok: true, record };
}

/**
 * Chamado pelo webhook em toda messages.upsert individual, ANTES de qualquer
 * gate normal (bot_ativo, manual, spam) e antes de qualquer sessão/pedido.
 * Só age se o telefone remetente for exatamente o autorizado E o texto for
 * exatamente um token de canário. Tokens reconhecíveis desse telefone são
 * sempre consumidos, inclusive se expirados, repetidos ou superseded, para
 * nunca vazarem ao fluxo comercial normal. Texto comum continua retornando
 * false e segue o bot normalmente.
 */
export async function processarPossivelInboundCanario(
  remoteJidPhone: string,
  texto: string,
  msgId: string | undefined
): Promise<boolean> {
  const destino = obterTelefoneCanario();
  if (!destino.configured) return false;
  if (!telefonesCorrespondem(remoteJidPhone, destino.phone)) return false;
  const textoNormalizado = (texto || "").trim().toUpperCase();
  if (!TOKEN_CANARIO_RE.test(textoNormalizado)) return false;
  const inboundAt = Date.now();

  let ackLockKey: string | null = null;
  let ackLockOwner: string | null = null;
  let ackLockAdquirido = false;
  let ackFoiAceito = false;
  const liberarLockAtual = async () => {
    if (ackLockKey && ackLockOwner) await liberarAckLock(ackLockKey, ackLockOwner);
  };
  try {
    const atual = await redis.get<CanaryRecord>(CHAVE_ATIVO);

    // Token reconhecível, mas sem execução correspondente (expirou fisicamente
    // ou foi superseded): consome silenciosamente e nunca cria sessão/pedido.
    if (!atual || textoNormalizado !== atual.token) return true;
    if (atual.state === "roundtrip_ok" || atual.state === "expired") return true;

    // Recuperação CAS-only antes do lock: não há envio físico aqui, portanto
    // um lock órfão não pode impedir o fechamento de um ACK já aceito.
    if (ehAckAceitoPersistido(atual)) {
      const concluido = await finalizarAckAceito(atual.token, Date.now());
      if (concluido?.state === "roundtrip_ok") {
        await log("info", "Canário WhatsApp: roundtrip_ok", "recovered_from=acknowledgement_sent");
      }
      return true;
    }
    if (inboundAt > atual.expiresAt) return true;

    // Idempotência também por token: cobre webhooks concorrentes com IDs
    // diferentes e eventos sem messageId. Em falha do ACK o lock é liberado
    // para permitir uma nova resposta do proprietário dentro do TTL ativo.
    ackLockKey = `${PREFIXO_LOCK_ACK}${atual.token}`;
    ackLockOwner = globalThis.crypto.randomUUID();
    ackLockAdquirido = !!(await redis.set(ackLockKey, ackLockOwner, { nx: true, ex: ACK_LOCK_TTL_SEGUNDOS }));
    if (!ackLockAdquirido) {
      const maisRecente = await redis.get<CanaryRecord>(CHAVE_ATIVO);
      if (!maisRecente || maisRecente.token !== atual.token) return true;
      if (maisRecente.state === "roundtrip_ok" || maisRecente.state === "expired") return true;
      if (ehAckAceitoPersistido(maisRecente)) {
        const concluido = await finalizarAckAceito(atual.token, Date.now());
        if (concluido?.state === "roundtrip_ok") {
          await log("info", "Canário WhatsApp: roundtrip_ok", "recovered_from=acknowledgement_sent");
        }
        return true;
      }
      throw await retryDepoisDoLock(ackLockKey);
    }

    let registro = await persistirInboundRecebido(atual.token, inboundAt);
    if (!registro) {
      await liberarLockAtual();
      ackLockAdquirido = false;
      await log("aviso", "Canário WhatsApp: inbound superseded", "motivo=geracao_alterada_ou_conflito_cas");
      return true;
    }

    // Se houve queda exatamente entre persistir o ACK aceito e fechar o estado
    // final, completa sob o mesmo lock sem reenviar a mensagem. A releitura
    // acima também cobre uma mudança concorrente para acknowledgement_sent.
    if (registro.state === "acknowledgement_sent") {
      const concluido = await finalizarAckAceito(atual.token, Date.now());
      if (concluido?.state !== "roundtrip_ok") {
        await liberarLockAtual();
        ackLockAdquirido = false;
        await log("aviso", "Canário WhatsApp: recovery ignorado", "motivo=geracao_alterada_ou_conflito_cas");
        return true;
      }
      await log("info", "Canário WhatsApp: roundtrip_ok", "recovered_from=acknowledgement_sent");
      return true;
    }
    if (registro.state === "roundtrip_ok" || registro.state === "expired") return true;
    if (registro.state !== "inbound_received") {
      await liberarLockAtual();
      ackLockAdquirido = false;
      await log("aviso", "Canário WhatsApp: inbound ignorado", `state=${registro.state}`);
      return true;
    }
    await log(
      "info",
      "Canário WhatsApp: inbound_received",
      `fromMe=false phone=${maskPhone(destino.phone)} token=${atual.token} messageId=${maskMessageId(msgId) || "n/a"} intercepted_before_normal_gates=true`
    );

    const ack = await enviarTextoWhatsApp(destino.phone, MENSAGEM_ACK_CANARIO);
    const ackAt = Date.now();
    const ackEvidence = {
      ackAt,
      ackLatencyMs: ack.latenciaMs,
      ackAttempts: ack.tentativas,
      ackHttpStatus: ack.statusHttp,
      ackMessageIdMasked: ack.messageIdMascarado || undefined,
      ackError: ack.motivo,
    };

    if (ack.ok) {
      // Depois que o provedor aceitou o ACK, o lock não deve ser liberado por
      // uma falha de persistência: isso poderia causar uma segunda mensagem.
      ackFoiAceito = true;
      registro = await persistirAckAceito(atual.token, ackEvidence);
      if (
        !registro ||
        (registro.state !== "acknowledgement_sent" && registro.state !== "roundtrip_ok")
      ) {
        await log("aviso", "Canário WhatsApp: ACK aceito sem persistir", "motivo=geracao_alterada_ou_conflito_cas");
        return true;
      }
      await marcarOutboundConfirmado();
      await log(
        "info",
        "Canário WhatsApp: acknowledgement_sent",
        `sendText=true statusHttp=${ack.statusHttp ?? "n/a"} latenciaMs=${ack.latenciaMs} tentativas=${ack.tentativas} messageId=${ack.messageIdMascarado || "n/a"}`
      );

      const roundtripAt = Date.now();
      registro = await finalizarAckAceito(atual.token, roundtripAt);
      if (registro?.state !== "roundtrip_ok") {
        await log("aviso", "Canário WhatsApp: roundtrip não persistido", "motivo=geracao_alterada_ou_conflito_cas");
        return true;
      }
      await log("info", "Canário WhatsApp: roundtrip_ok", `ackAt=${ackAt}`);
    } else {
      registro = await persistirFalhaAck(atual.token, ackEvidence);
      if (!registro) {
        await liberarLockAtual();
        ackLockAdquirido = false;
        await log("aviso", "Canário WhatsApp: falha de ACK não persistida", "motivo=geracao_alterada_ou_conflito_cas");
        return true;
      }
      await liberarLockAtual();
      ackLockAdquirido = false;
      if (registro.state !== "acknowledgement_failed") {
        await log("aviso", "Canário WhatsApp: falha de ACK ignorada", `state=${registro.state}`);
        return true;
      }
      await log(
        "erro",
        "Canário WhatsApp: acknowledgement_failed",
        `statusHttp=${ack.statusHttp ?? "n/a"} latenciaMs=${ack.latenciaMs} tentativas=${ack.tentativas} motivo=${sanitizeErrorMessage(ack.motivo)}`
      );
    }

    return true;
  } catch (err) {
    if (err instanceof CanaryInboundRetryableError) {
      if (!ackFoiAceito && ackLockAdquirido) await liberarLockAtual().catch(() => undefined);
      throw err;
    }
    if (!ackFoiAceito && ackLockAdquirido) await liberarLockAtual().catch(() => undefined);
    // Falha fechada para token de canário: Redis/log nunca pode fazê-lo cair no
    // bot normal. O detalhe é sanitizado e não contém telefone/texto bruto.
    await log("erro", "Canário WhatsApp: falha ao processar inbound", sanitizeErrorMessage(err));
    throw new CanaryInboundRetryableError(1);
  }
}
