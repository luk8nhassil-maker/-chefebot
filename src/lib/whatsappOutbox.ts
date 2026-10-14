import { randomUUID } from "crypto";
import { Client } from "@upstash/qstash";
import { redis } from "./redis";

// Outbox durável de WhatsApp. A Evolution não aceita chave de idempotência no
// sendText; por isso a outbox é "at-least-once até o provider" e nunca repete
// automaticamente um resultado ambíguo (timeout, rede ou 5xx).

export type PrioridadeWhatsapp = "critica" | "normal" | "promocional";
export type EstadoOutboxWhatsapp = "pending" | "leased" | "delivered" | "failed" | "ambiguous";

export type JobOutboxWhatsapp = {
  id: string;
  kind: "text" | "image";
  conversationId: string;
  phone: string;
  text: string;
  mediaUrl?: string;
  mediaCaption?: string;
  priority: PrioridadeWhatsapp;
  state: EstadoOutboxWhatsapp;
  createdAt: number;
  updatedAt: number;
  attempt: number;
  opts?: { delay?: number; presence?: "composing"; timeoutMs?: number; maxAttempts?: 1 | 2 };
  idempotencyKey?: string;
  leaseToken?: string;
};

export type ResultadoTransporteWhatsapp = {
  ok: boolean; motivo?: string; statusHttp?: number; messageIdMascarado?: string; latenciaMs: number; tentativas: number;
};

const PREFIX = "whatsapp:outbox:";
const TTL_SEGUNDOS = 7 * 24 * 60 * 60;
const LEASE_MS = 30_000;
const LIMITE_PADRAO = 4;
const LIMITE_MAXIMO = 16;

const chaveJob = (id: string) => `${PREFIX}job:${id}`;
const chaveFila = (prioridade: PrioridadeWhatsapp) => `${PREFIX}due:${prioridade}`;
const chaveDedupe = (id: string) => `${PREFIX}dedupe:${id}`;
const chaveConversa = (id: string) => `${PREFIX}conversation:${id}`;
const chaveSequenciaConversa = (id: string) => `${PREFIX}conversation-queue:${id}`;
const chaveContadorSequenciaConversa = (id: string) => `${PREFIX}conversation-sequence:${id}`;
const CHAVE_LEASES = `${PREFIX}leases`;

function limiteGlobal(): number {
  const n = Number(process.env.WHATSAPP_OUTBOX_CONCURRENCY ?? LIMITE_PADRAO);
  return Number.isInteger(n) && n > 0 ? Math.min(n, LIMITE_MAXIMO) : LIMITE_PADRAO;
}

function conversaSegura(phone: string): string {
  // O telefone fica apenas no valor do job; a chave não expõe PII.
  let hash = 2166136261;
  for (let i = 0; i < phone.length; i++) hash = Math.imul(hash ^ phone.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36);
}

const ENFILEIRAR_LUA = `
local dedupe = ARGV[1]
if dedupe ~= '' then
  local existing = redis.call('GET', KEYS[1])
  if existing then return existing end
end
redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[4])
redis.call('ZADD', KEYS[3], ARGV[3], ARGV[5])
local sequence = redis.call('INCR', KEYS[5])
redis.call('EXPIRE', KEYS[5], ARGV[4])
redis.call('ZADD', KEYS[4], sequence, ARGV[5])
if dedupe ~= '' then redis.call('SET', KEYS[1], ARGV[5], 'EX', ARGV[4]) end
return ARGV[5]
`;

const CLAIM_LUA = `
local now = tonumber(ARGV[1])
local leaseUntil = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local leaseToken = ARGV[4]
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('ZCARD', KEYS[1]) >= limit then return nil end
for q = 2, 4 do
  local candidates = redis.call('ZRANGEBYSCORE', KEYS[q], '-inf', now, 'LIMIT', 0, 32)
  for _, id in ipairs(candidates) do
    local jobKey = ARGV[5] .. id
    local raw = redis.call('GET', jobKey)
    if not raw then
      redis.call('ZREM', KEYS[q], id)
    else
      local job = cjson.decode(raw)
      if job.state ~= 'pending' then
        redis.call('ZREM', KEYS[q], id)
      else
        local conversationQueueKey = ARGV[7] .. job.conversationId
        local firstInConversation = redis.call('ZRANGE', conversationQueueKey, 0, 0)[1]
        if firstInConversation == id then
          local conversationKey = ARGV[6] .. job.conversationId
          if redis.call('SET', conversationKey, id, 'NX', 'PX', ARGV[8]) then
            job.state = 'leased'
            job.leaseToken = leaseToken
            job.updatedAt = now
            job.attempt = (job.attempt or 0) + 1
            redis.call('SET', jobKey, cjson.encode(job), 'EX', ARGV[9])
            redis.call('ZREM', KEYS[q], id)
            redis.call('ZADD', KEYS[1], leaseUntil, id)
            return cjson.encode(job)
          end
        end
      end
    end
  end
end
return nil
`;

const FINALIZAR_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local job = cjson.decode(raw)
if job.state ~= 'leased' or job.leaseToken ~= ARGV[1] then return 0 end
job.state = ARGV[2]
job.updatedAt = tonumber(ARGV[3])
job.leaseToken = nil
job.result = cjson.decode(ARGV[4])
redis.call('SET', KEYS[1], cjson.encode(job), 'EX', ARGV[5])
redis.call('ZREM', KEYS[2], job.id)
if redis.call('GET', KEYS[3]) == job.id then redis.call('DEL', KEYS[3]) end
redis.call('ZREM', KEYS[4], job.id)
return 1
`;

const RECUPERAR_LEASES_LUA = `
local now = tonumber(ARGV[1])
local ids = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', now, 'LIMIT', 0, tonumber(ARGV[2]))
for _, id in ipairs(ids) do
  local raw = redis.call('GET', ARGV[3] .. id)
  if raw then
    local job = cjson.decode(raw)
    if job.state == 'leased' then
      job.state = 'ambiguous'
      job.updatedAt = now
      job.leaseToken = nil
      job.result = { motivo = 'lease_expired_without_provider_confirmation' }
      redis.call('SET', ARGV[3] .. id, cjson.encode(job), 'EX', ARGV[4])
      local ck = ARGV[5] .. job.conversationId
      if redis.call('GET', ck) == id then redis.call('DEL', ck) end
      redis.call('ZREM', ARGV[6] .. job.conversationId, id)
    end
  end
  redis.call('ZREM', KEYS[1], id)
end
return #ids
`;

export async function enfileirarMensagemWhatsapp(input: {
  phone: string; text: string; priority?: PrioridadeWhatsapp;
  opts?: JobOutboxWhatsapp["opts"]; idempotencyKey?: string;
}): Promise<{ jobId: string; deduplicated: boolean }> {
  const id = randomUUID();
  const now = Date.now();
  const priority = input.priority ?? "critica";
  const job: JobOutboxWhatsapp = {
    id, kind: "text", phone: input.phone, text: input.text, priority, state: "pending", createdAt: now, updatedAt: now,
    attempt: 0, conversationId: conversaSegura(input.phone), opts: input.opts, idempotencyKey: input.idempotencyKey,
  };
  const dedupe = input.idempotencyKey ? chaveDedupe(input.idempotencyKey) : "";
  const resultado = await redis.eval(ENFILEIRAR_LUA,
    [dedupe || `${PREFIX}no-dedupe:${id}`, chaveJob(id), chaveFila(priority), chaveSequenciaConversa(job.conversationId), chaveContadorSequenciaConversa(job.conversationId)],
    [dedupe, JSON.stringify(job), String(now), String(TTL_SEGUNDOS), id]);
  return { jobId: String(resultado), deduplicated: String(resultado) !== id };
}

export async function enfileirarImagemWhatsapp(input: {
  phone: string; mediaUrl: string; caption?: string; priority?: PrioridadeWhatsapp; idempotencyKey?: string;
}): Promise<{ jobId: string; deduplicated: boolean }> {
  const id = randomUUID();
  const now = Date.now();
  const priority = input.priority ?? "critica";
  const job: JobOutboxWhatsapp = {
    id, kind: "image", phone: input.phone, text: "", mediaUrl: input.mediaUrl, mediaCaption: input.caption ?? "",
    priority, state: "pending", createdAt: now, updatedAt: now, attempt: 0,
    conversationId: conversaSegura(input.phone), idempotencyKey: input.idempotencyKey,
  };
  const dedupe = input.idempotencyKey ? chaveDedupe(input.idempotencyKey) : "";
  const resultado = await redis.eval(ENFILEIRAR_LUA,
    [dedupe || `${PREFIX}no-dedupe:${id}`, chaveJob(id), chaveFila(priority), chaveSequenciaConversa(job.conversationId), chaveContadorSequenciaConversa(job.conversationId)],
    [dedupe, JSON.stringify(job), String(now), String(TTL_SEGUNDOS), id]);
  return { jobId: String(resultado), deduplicated: String(resultado) !== id };
}

async function claimProximo(): Promise<JobOutboxWhatsapp | null> {
  const now = Date.now();
  const raw = await redis.eval(CLAIM_LUA,
    [CHAVE_LEASES, chaveFila("critica"), chaveFila("normal"), chaveFila("promocional")],
    [String(now), String(now + LEASE_MS), String(limiteGlobal()), randomUUID(), `${PREFIX}job:`, `${PREFIX}conversation:`, `${PREFIX}conversation-queue:`, String(LEASE_MS), String(TTL_SEGUNDOS)]);
  return raw ? JSON.parse(String(raw)) as JobOutboxWhatsapp : null;
}

async function finalizar(job: JobOutboxWhatsapp, estado: "delivered" | "failed" | "ambiguous", result: ResultadoTransporteWhatsapp | { motivo: string }) {
  await redis.eval(FINALIZAR_LUA, [chaveJob(job.id), CHAVE_LEASES, chaveConversa(job.conversationId), chaveSequenciaConversa(job.conversationId)],
    [job.leaseToken ?? "", estado, String(Date.now()), JSON.stringify(result), String(TTL_SEGUNDOS)]);
}

export async function recuperarLeasesWhatsapp(limite = 100): Promise<number> {
  return Number(await redis.eval(RECUPERAR_LEASES_LUA, [CHAVE_LEASES],
    [String(Date.now()), String(Math.max(1, Math.min(limite, 500))), `${PREFIX}job:`, String(TTL_SEGUNDOS), `${PREFIX}conversation:`, `${PREFIX}conversation-queue:`])) || 0;
}

function resultadoAmbiguo(resultado: ResultadoTransporteWhatsapp): boolean {
  return resultado.motivo === "timeout" || resultado.motivo === "network_error" ||
    (typeof resultado.statusHttp === "number" && resultado.statusHttp >= 500);
}

export async function processarFilaWhatsapp(
  executar: (job: JobOutboxWhatsapp) => Promise<ResultadoTransporteWhatsapp>,
  limite = limiteGlobal(),
): Promise<{ processed: number; delivered: number; failed: number; ambiguous: number }> {
  await recuperarLeasesWhatsapp();
  let processed = 0, delivered = 0, failed = 0, ambiguous = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limite, LIMITE_MAXIMO)) }, async () => {
    const job = await claimProximo();
    if (!job) return;
    processed++;
    try {
      const resultado = await executar(job);
      if (resultado.ok) { await finalizar(job, "delivered", resultado); delivered++; }
      else if (resultadoAmbiguo(resultado)) { await finalizar(job, "ambiguous", resultado); ambiguous++; }
      else { await finalizar(job, "failed", resultado); failed++; }
    } catch {
      await finalizar(job, "ambiguous", { motivo: "executor_threw_before_provider_confirmation" });
      ambiguous++;
    }
  }));
  return { processed, delivered, failed, ambiguous };
}

export async function obterJobWhatsapp(id: string): Promise<JobOutboxWhatsapp | null> {
  return await redis.get<JobOutboxWhatsapp>(chaveJob(id));
}

export async function resumoFilaWhatsapp(): Promise<{ pending: number; inFlight: number }> {
  const [critica, normal, promocional, inFlight] = await Promise.all([
    redis.zcard(chaveFila("critica")), redis.zcard(chaveFila("normal")), redis.zcard(chaveFila("promocional")), redis.zcard(CHAVE_LEASES),
  ]);
  return { pending: Number(critica) + Number(normal) + Number(promocional), inFlight: Number(inFlight) };
}

let qstash: Client | null | undefined;
function clienteQstash(): Client | null {
  if (qstash !== undefined) return qstash;
  qstash = process.env.QSTASH_TOKEN ? new Client({ token: process.env.QSTASH_TOKEN }) : null;
  return qstash;
}

// Melhor esforço: a durabilidade está no Redis; QStash só desperta o worker.
// Não publica sem token/URL e nunca impede que um pedido já aceito prossiga.
export async function agendarDrenoWhatsapp(): Promise<boolean> {
  const client = clienteQstash();
  const base = process.env.WHATSAPP_OUTBOX_CALLBACK_URL?.trim() || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}/api/interno/whatsapp-outbox/processar` : "");
  if (!client || !base) return false;
  try {
    await client.publishJSON({ url: base, body: {}, retries: 1, flowControl: { key: "chefebot-whatsapp-outbox", parallelism: 1 } });
    return true;
  } catch { return false; }
}
