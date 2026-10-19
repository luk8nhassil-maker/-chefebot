import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { Client } from "@upstash/qstash";
import { redis } from "./redis";
import { configuracaoRolloutInboxWhatsapp } from "./whatsappInboxRollout";
import { webhookEvolutionProtegido } from "./evolutionWebhookAuth";

/**
 * Inbox durável para o evento messages.upsert.
 * O webhook só responde 200 DEPOIS do enfileiramento Redis atômico.
 * Nenhum processamento de pedido, Pix ou resposta deve ocorrer antes disso.
 */
const PREFIX = "whatsapp:inbox:v1:";
const TTL = 7 * 24 * 60 * 60;
const LEASE_MS = 90_000;
const LIMIT = 1_000;
const CONCURRENCY = 4;
const BUDGET_MS = 15_000;
const QSTASH_SCHEDULE_ID = "chefebot-whatsapp-inbox-recovery-v1";
const QSTASH_CRON = "*/5 * * * *";
const K_CONVERSAS = PREFIX + "conversations";
const K_SEQUENCIA = PREFIX + "sequence";
const K_PENDING = PREFIX + "pending-count";
const K_LEASES = PREFIX + "leases";
const K_UNRESOLVED = PREFIX + "unresolved";
const K_METRICAS = PREFIX + "metrics";
const K_WAKE = PREFIX + "wake:reserved";
const WAKE_TTL_SEGUNDOS = 60;
const WAKE_RELEASE_OWNED = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;
const WAKE_RELEASE_AND_PENDING = `
redis.call("DEL", KEYS[1])
return tonumber(redis.call("GET", KEYS[2]) or "0")
`;
const K_LOCK = (c: string) => PREFIX + "lock:" + c;
const K_FILA = (c: string) => PREFIX + "queue:" + c;
const K_JOB = (id: string) => PREFIX + "job:" + id;
const K_DEDUPE = (id: string) => PREFIX + "dedupe:" + id;

// AsyncLocalStorage é um marcador interno ao worker (não um header público).
// Evita que ele volte a enfileirar o mesmo evento ao chamar o webhook existente.
const workerScope = new AsyncLocalStorage<boolean>();
export const executandoWorkerInbox = () => workerScope.getStore() === true;
export const comEscopoWorkerInbox = <T>(fn: () => Promise<T>) => workerScope.run(true, fn);
// Não permitir habilitar inbox sem proteção de origem configurada. Legado permanece intacto.
export const inboxAtivaParaClientes = () => configuracaoRolloutInboxWhatsapp().enabled && webhookEvolutionProtegido();

export type InboxJob = {
  id: string;
  conversationId: string;
  messageId: string;
  payload: unknown;
  state: "pending" | "leased" | "done" | "ambiguous";
  createdAt: number;
  updatedAt: number;
  leaseToken?: string;
  motivo?: string;
};

const ENQUEUE = `
local previous = redis.call("GET", KEYS[1])
if previous then
  return {"duplicate", previous}
end
local pending = tonumber(redis.call("GET", KEYS[6]) or "0")
if pending >= tonumber(ARGV[4]) then
  return {"full", ""}
end
local seq = redis.call("INCR", KEYS[5])
redis.call("SET", KEYS[2], ARGV[2], "EX", tonumber(ARGV[3]))
redis.call("ZADD", KEYS[3], seq, ARGV[1])
redis.call("ZADD", KEYS[4], "NX", seq, ARGV[5])
redis.call("SET", KEYS[1], ARGV[1], "EX", tonumber(ARGV[3]))
redis.call("INCR", KEYS[6])
redis.call("HINCRBY", KEYS[7], "queued", 1)
return {"queued", ARGV[1]}
`;

const CLAIM = `
-- O teto vale entre instancias, inclusive callbacks assinados concorrentes.
-- Leases vencidos so liberam capacidade depois da recuperacao explicita.
if redis.call("ZCARD", KEYS[2]) >= tonumber(ARGV[8]) then return nil end
-- A fila e limitada a 1000 jobs no enqueue. Uma janela fixa de 250 conversas
-- deixava uma conversa apta invisivel atras de cabecas em quarentena.
local convs = redis.call("ZRANGE", KEYS[1], 0, -1)
for _, conv in ipairs(convs) do
  local queue = ARGV[1] .. conv
  local first = redis.call("ZRANGE", queue, 0, 0)[1]
  if not first then
    redis.call("ZREM", KEYS[1], conv)
  else
    local lockKey = ARGV[2] .. conv
    if not redis.call("GET", lockKey) then
      local jobKey = ARGV[3] .. first
      local raw = redis.call("GET", jobKey)
      if raw then
        local ok, job = pcall(cjson.decode, raw)
        if ok and type(job) == "table" and job.state == "pending" then
          local token = ARGV[4]
          local untilMs = tonumber(ARGV[5]) + tonumber(ARGV[6])
          redis.call("SET", lockKey, token, "PX", tonumber(ARGV[6]))
          job.state = "leased"
          job.leaseToken = token
          job.updatedAt = tonumber(ARGV[5])
          redis.call("SET", jobKey, cjson.encode(job), "EX", tonumber(ARGV[7]))
          redis.call("ZADD", KEYS[2], untilMs, first)
          redis.call("HINCRBY", KEYS[3], "claimed", 1)
          return cjson.encode(job)
        end
      end
      -- Head ausente/corrompida ou ambígua: nunca pular e inverter a conversa.
    end
  end
end
return nil
`;

const FINISH = `
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local ok, job = pcall(cjson.decode, raw)
if not ok or job.state ~= "leased" or job.leaseToken ~= ARGV[1] then return 0 end
job.leaseToken = nil
job.updatedAt = tonumber(ARGV[2])
job.state = ARGV[3]
job.motivo = ARGV[4]
redis.call("SET", KEYS[1], cjson.encode(job), "EX", tonumber(ARGV[5]))
redis.call("ZREM", KEYS[2], job.id)
if redis.call("GET", KEYS[3]) == ARGV[1] then redis.call("DEL", KEYS[3]) end
if ARGV[3] == "done" then
  redis.call("ZREM", KEYS[4], job.id)
  local head = redis.call("ZRANGE", KEYS[4], 0, 0, "WITHSCORES")
  if #head == 0 then
    redis.call("ZREM", KEYS[5], job.conversationId)
  else
    redis.call("ZADD", KEYS[5], tonumber(head[2]), job.conversationId)
  end
  redis.call("DECR", KEYS[6])
  redis.call("HINCRBY", KEYS[7], "done", 1)
else
  redis.call("HINCRBY", KEYS[7], "ambiguous", 1)
end
return 1
`;

const RECOVER = `
local ids = redis.call("ZRANGEBYSCORE", KEYS[1], "-inf", tonumber(ARGV[1]), "LIMIT", 0, 100)
local recovered = 0
for _, id in ipairs(ids) do
  local key = ARGV[2] .. id
  local raw = redis.call("GET", key)
  local reconciled = false
  if raw then
    local ok, job = pcall(cjson.decode, raw)
    if ok and type(job) == "table" and job.state == "leased" then
      job.state = "ambiguous"
      job.motivo = "inbox_lease_expired_unknown_business_effects"
      job.updatedAt = tonumber(ARGV[1])
      job.leaseToken = nil
      redis.call("SET", key, cjson.encode(job), "EX", tonumber(ARGV[3]))
      redis.call("HINCRBY", KEYS[2], "ambiguous", 1)
      recovered = recovered + 1
      reconciled = true
    elseif ok and type(job) == "table" and (job.state == "done" or job.state == "ambiguous") then
      reconciled = true
    end
  end
  -- Nunca apagar o ultimo indice de um registro ausente/corrompido. Guardar
  -- a referencia antes de liberar capacidade, sem pular a conversa ou reenviar.
  if not reconciled then
    redis.call("ZADD", KEYS[3], tonumber(ARGV[1]), id)
  end
  redis.call("ZREM", KEYS[1], id)
end
return recovered
`;

export function chaveConversaInbound(phone: string): string {
  return createHash("sha256").update(phone).digest("hex").slice(0, 32);
}
function chaveEvento(messageId: string, phone: string): string {
  return createHash("sha256").update(phone + ":" + messageId).digest("hex");
}

/**
 * Retornos: queued / duplicate / full. Em falha Redis, rejeitar a requisição
 * e nunca devolver sucesso falso para o transporte.
 */
export async function enfileirarInboundWhatsapp(input: {
  phone: string;
  messageId: string;
  payload: unknown;
}): Promise<{ status: "queued" | "duplicate" | "full"; jobId: string }> {
  const conversationId = chaveConversaInbound(input.phone);
  const dedupe = chaveEvento(input.messageId, input.phone);
  const id = randomUUID();
  const now = Date.now();
  const job: InboxJob = {
    id, conversationId, messageId: input.messageId,
    payload: input.payload, state: "pending", createdAt: now, updatedAt: now,
  };
  const result = await redis.eval(ENQUEUE,
    [K_DEDUPE(dedupe), K_JOB(id), K_FILA(conversationId), K_CONVERSAS, K_SEQUENCIA, K_PENDING, K_METRICAS],
    [id, JSON.stringify(job), String(TTL), String(LIMIT), conversationId]);
  const tuple = Array.isArray(result) ? result : [];
  if (!["queued", "duplicate", "full"].includes(String(tuple[0]))) {
    throw new Error("inbox_enqueue_unverified");
  }
  return { status: tuple[0] as "queued" | "duplicate" | "full", jobId: String(tuple[1] ?? "") };
}

export async function claimInboundWhatsapp(): Promise<InboxJob | null> {
  const now = Date.now();
  const raw = await redis.eval(CLAIM,
    [K_CONVERSAS, K_LEASES, K_METRICAS],
    [PREFIX + "queue:", PREFIX + "lock:", PREFIX + "job:", randomUUID(), String(now), String(LEASE_MS), String(TTL), String(CONCURRENCY)]);
  if (!raw) return null;
  const job: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!job || typeof job !== "object" ||
      (job as InboxJob).state !== "leased" ||
      typeof (job as InboxJob).leaseToken !== "string") {
    throw new Error("inbox_invalid_claim");
  }
  return job as InboxJob;
}

export async function finalizarInboundWhatsapp(job: InboxJob, ok: boolean, motivo: string): Promise<boolean> {
  const result = await redis.eval(FINISH,
    [K_JOB(job.id), K_LEASES, K_LOCK(job.conversationId), K_FILA(job.conversationId),
      K_CONVERSAS, K_PENDING, K_METRICAS],
    [job.leaseToken ?? "", String(Date.now()), ok ? "done" : "ambiguous", motivo, String(TTL)]);
  return Number(result) === 1;
}

export async function recuperarInboundWhatsapp(): Promise<number> {
  return Number(await redis.eval(RECOVER, [K_LEASES, K_METRICAS, K_UNRESOLVED],
    [String(Date.now()), PREFIX + "job:", String(TTL)])) || 0;
}

export async function resumoInboxWhatsapp() {
  const [pending, conversationCount, leaseCount, counts, unresolved] = await Promise.all([
    redis.get<number>(K_PENDING), redis.zcard(K_CONVERSAS),
    redis.zcard(K_LEASES), redis.hgetall<Record<string, unknown>>(K_METRICAS),
    redis.zcard(K_UNRESOLVED),
  ]);
  const n = (v: unknown) => Number(v ?? 0) || 0;
  return {
    pending: n(pending), conversations: n(conversationCount),
    inFlight: n(leaseCount), queuedTotal: n(counts?.queued),
    doneTotal: n(counts?.done), ambiguousTotal: n(counts?.ambiguous),
    unresolved: n(unresolved),
    lastWorkerAt: n(counts?.lastWorkerAt),
  };
}

export async function processarLoteInbox(
  executor: (job: InboxJob) => Promise<boolean>,
  limite = 60,
  concorrencia = CONCURRENCY,
) {
  const inicio = Date.now();
  const recovered = await recuperarInboundWhatsapp();
  let remaining = Math.max(0, limite), processed = 0, done = 0, ambiguous = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(8, concorrencia)) }, async () => {
    while (remaining > 0 && Date.now() - inicio < BUDGET_MS) {
      remaining--;
      const job = await claimInboundWhatsapp();
      if (!job) { remaining++; return; }
      processed++;
      let ok = false;
      try { ok = await executor(job); } catch { ok = false; }
      if (await finalizarInboundWhatsapp(job, ok, ok ? "ok" : "processing_unknown")) {
        if (ok) done++; else ambiguous++;
      }
    }
  }));
  await redis.hset(K_METRICAS, { lastWorkerAt: Date.now() });
  return { processed, done, ambiguous, recovered, queue: await resumoInboxWhatsapp() };
}

let qstash: Client | null | undefined;
let scheduleUrl: string | null = null;

function workerUrl(): string {
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") return "";
  const outbox = process.env.WHATSAPP_OUTBOX_CALLBACK_URL?.trim();
  if (!outbox) return "";
  try {
    const url = new URL(outbox);
    if (url.protocol !== "https:" ||
        url.pathname !== "/api/interno/whatsapp-outbox/processar" ||
        url.search || url.hash) return "";
    url.pathname = "/api/interno/whatsapp-inbox/processar";
    return url.toString();
  } catch { return ""; }
}

function obterQStash(): Client | null {
  if (qstash !== undefined) return qstash;
  const token = process.env.QSTASH_TOKEN?.trim();
  const baseUrl = process.env.QSTASH_URL?.trim();
  if (!token || !baseUrl) return qstash = null;
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" || url.pathname !== "/" ||
        !["qstash.upstash.io", "qstash-us-east-1.upstash.io", "qstash-eu-central-1.upstash.io"].includes(url.hostname)) {
      return qstash = null;
    }
    return qstash = new Client({ token, baseUrl: url.origin });
  } catch { return qstash = null; }
}
export const urlWorkerInboxAssinada = () => workerUrl();

export function configuracaoInboxWhatsapp() {
  const missing: string[] = [];
  for (const k of ["QSTASH_TOKEN", "QSTASH_URL", "QSTASH_CURRENT_SIGNING_KEY",
                   "QSTASH_NEXT_SIGNING_KEY", "WHATSAPP_OUTBOX_CALLBACK_URL"]) {
    if (!process.env[k]) missing.push(k);
  }
  if (!workerUrl()) missing.push("inbox_callback_url_invalida");
  return { ready: missing.length === 0, missing };
}

/**
 * Acordador por rajada, reservado em Redis: 50 entradas concorrentes pedem
 * um único callback QStash. O worker assinado libera o despertador e lê o
 * saldo pendente na mesma operação Lua, eliminando a janela de perda entre
 * "terminou lote" e "chegou mensagem nova".
 */
export async function liberarDespertadorEContarPendentes(): Promise<number> {
  return Number(await redis.eval(WAKE_RELEASE_AND_PENDING, [K_WAKE, K_PENDING], [])) || 0;
}

/** Publicação não é uma confirmação de processamento. Redis é a fonte durável. */
export async function agendarInboxWhatsapp(continuacao = false): Promise<boolean> {
  const url = workerUrl();
  const client = obterQStash();
  if (!client || !url || !configuracaoInboxWhatsapp().ready) return false;
  let donoDespertador: string | null = null;
  if (!continuacao) {
    try {
      const token = randomUUID();
      const reservado = await redis.set(K_WAKE, token, { nx: true, ex: WAKE_TTL_SEGUNDOS });
      if (!reservado) return true; // já existe um callback responsável pela rajada
      donoDespertador = token;
    } catch { return false; }
  }
  try {
    if (scheduleUrl !== url) {
      await client.schedules.create({
        destination: url, cron: QSTASH_CRON, scheduleId: QSTASH_SCHEDULE_ID,
        body: "{}", headers: { "Content-Type": "application/json" }, retries: 1,
        flowControl: { key: "chefebot-whatsapp-inbox", parallelism: 1 },
        redact: { body: true },
      });
      scheduleUrl = url;
    }
    await client.publishJSON({
      url, body: {}, retries: 1,
      deduplicationId: continuacao
        ? "chefebot-inbox-cont-" + randomUUID()
        : "chefebot-inbox-" + Math.floor(Date.now() / 3000),
      flowControl: { key: "chefebot-whatsapp-inbox", parallelism: 1 },
      redact: { body: true },
    });
    return true;
  } catch {
    if (donoDespertador) {
      // Não apagar a reserva de um callback mais novo se o primeiro falhou.
      await redis.eval(WAKE_RELEASE_OWNED, [K_WAKE], [donoDespertador]).catch(() => {});
    }
    return false;
  }
}
