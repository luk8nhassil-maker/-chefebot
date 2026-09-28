import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { redis } from "./redis";

export const BEHAVIOR_SCHEMA_VERSION = 1 as const;
export const BEHAVIOR_TENANT_DEFAULT = "default";

import {
  CLIENT_BEHAVIOR_EVENTS,
  type BehaviorContext,
  type BehaviorEventType,
  type ClientBehaviorEventType,
  type ServerBehaviorEventType,
} from "./behaviorAnalyticsTypes";

export type {
  BehaviorContext,
  BehaviorEventType,
  ClientBehaviorEventType,
  ServerBehaviorEventType,
} from "./behaviorAnalyticsTypes";

export type BehaviorClientInput = {
  eventId: string;
  sessionId: string;
  type: ClientBehaviorEventType;
  occurredAtMs?: number;
  context?: BehaviorContext;
};

export type BehaviorEvent = {
  schemaVersion: typeof BEHAVIOR_SCHEMA_VERSION;
  eventId: string;
  tenantId: string;
  sessionId: string;
  actorHash: string | null;
  type: BehaviorEventType;
  occurredAtMs: number;
  receivedAtMs: number;
  context: BehaviorContext;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ID_RE = /^[a-zA-Z0-9:_-]{1,80}$/;
const SAFE_SCREEN_RE = /^[a-z0-9_-]{1,40}$/;
const SAFE_ACTOR_HASH_RE = /^[a-f0-9]{32}$/;
const BEHAVIOR_LINK_TTL_SECONDS = 2592000;

function retentionDays(): number | null {
  const configured = process.env.BEHAVIOR_ANALYTICS_RETENTION_DAYS;
  if (configured === undefined || configured.trim() === "") return 30;
  const raw = Number(configured);
  if (!Number.isInteger(raw) || raw < 7 || raw > 730) return null;
  return raw;
}

function hashSecret(): string | null {
  const secret = process.env.BEHAVIOR_ANALYTICS_HASH_SECRET || process.env.AUTH_SECRET;
  if (!secret || secret.length < 24) return null;
  return secret;
}

export function behaviorAnalyticsEnabled(): boolean {
  // Preview nunca escreve telemetria comportamental real, mesmo que uma
  // variável seja herdada por engano do projeto.
  if (process.env.VERCEL_ENV === "preview") return false;
  if (process.env.BEHAVIOR_ANALYTICS_ENABLED === "false") return false;
  // A coleta liga por padrão somente em produção; em desenvolvimento, continua
  // exigindo ativação explícita para não gerar dados acidentais.
  if (process.env.BEHAVIOR_ANALYTICS_ENABLED !== "true" && process.env.VERCEL_ENV !== "production") return false;
  return retentionDays() !== null && hashSecret() !== null;
}

function pseudonimizarValor(valor: string): string | null {
  const secret = hashSecret();
  if (!secret || !valor) return null;
  return createHmac("sha256", secret).update(valor).digest("hex").slice(0, 32);
}

export function pseudonimizarClienteId(clienteId: string): string | null {
  return pseudonimizarValor(clienteId);
}

function assinarVinculoAtor(actorHash: string, expiresAt: number): string | null {
  const secret = hashSecret();
  if (!secret) return null;
  return createHmac("sha256", secret).update("behavior-link:v1:" + actorHash + ":" + expiresAt).digest("hex");
}

export function criarVinculoCookieComportamento(clienteId: string, agoraMs = Date.now()): string | null {
  const actorHash = pseudonimizarClienteId(clienteId);
  if (!actorHash) return null;
  const expiresAt = Math.floor(agoraMs / 1000) + BEHAVIOR_LINK_TTL_SECONDS;
  const signature = assinarVinculoAtor(actorHash, expiresAt);
  return signature ? actorHash + "." + expiresAt + "." + signature : null;
}

export function validarVinculoCookieComportamento(token: string | undefined, agoraMs = Date.now()): string | null {
  if (!token) return null;
  const [actorHash, expiresRaw, signature, ...extra] = token.split(".");
  if (extra.length || !actorHash || !SAFE_ACTOR_HASH_RE.test(actorHash) || !expiresRaw || !signature || !/^[a-f0-9]{64}$/.test(signature)) return null;
  const expiresAt = Number(expiresRaw);
  const nowSeconds = Math.floor(agoraMs / 1000);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= nowSeconds || expiresAt > nowSeconds + BEHAVIOR_LINK_TTL_SECONDS) return null;
  const expected = assinarVinculoAtor(actorHash, expiresAt);
  if (!expected) return null;
  const receivedBytes = Buffer.from(signature, "hex");
  const expectedBytes = Buffer.from(expected, "hex");
  return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes) ? actorHash : null;
}

export async function consumirLimiteIngestaoComportamental(chaveBruta: string): Promise<boolean> {
  if (!behaviorAnalyticsEnabled()) return false;
  const hash = pseudonimizarValor(chaveBruta);
  if (!hash) return false;
  const janela = Math.floor(Date.now() / 60_000);
  const chave = `behavior:v1:rate:${hash}:${janela}`;
  const contador = await redis.incr(chave);
  if (contador === 1) await redis.expire(chave, 90);
  // O cliente oficial envia lotes, portanto 120 requisições/minuto oferece
  // ampla folga operacional e bloqueia loops/abuso acidental antes de gerar
  // volume desnecessário no Redis. O limite é técnico, não regra comercial.
  return contador <= 120;
}

export function behaviorDayBucket(ms: number): string {
  const d = new Date(ms);
  return [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, "0"),
    String(d.getUTCDate()).padStart(2, "0"),
  ].join("");
}

export function behaviorEventKey(tenantId: string, eventId: string): string {
  return `behavior:v1:event:${tenantId}:${eventId}`;
}
export function behaviorGlobalIndexKey(tenantId: string, day: string): string {
  return `behavior:v1:idx:${tenantId}:${day}`;
}
export function behaviorActorIndexKey(tenantId: string, actorHash: string, day: string): string {
  return `behavior:v1:actor:${tenantId}:${actorHash}:${day}`;
}
export function behaviorSessionIndexKey(tenantId: string, sessionId: string, day: string): string {
  return `behavior:v1:session:${tenantId}:${sessionId}:${day}`;
}

function sanitizeSafeId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  return SAFE_ID_RE.test(v) ? v : undefined;
}

function sanitizeContext(input: unknown, allowPedidoId = false): BehaviorContext {
  if (!input || typeof input !== "object") return {};
  const raw = input as Record<string, unknown>;
  const out: BehaviorContext = {};

  if (typeof raw.screen === "string" && SAFE_SCREEN_RE.test(raw.screen)) out.screen = raw.screen;
  if (["cardapio","cliente","ranking","cofre","checkout","tracking","orders","other"].includes(String(raw.source))) {
    out.source = raw.source as BehaviorContext["source"];
  }
  const categoryId = sanitizeSafeId(raw.categoryId);
  if (categoryId) out.categoryId = categoryId;
  const productId = sanitizeSafeId(raw.productId);
  if (productId) out.productId = productId;

  for (const k of ["cartItems","cartDistinctItems","queryLength","resultCount"] as const) {
    const n = Number(raw[k]);
    if (Number.isInteger(n) && n >= 0 && n <= 10000) out[k] = n;
  }

  if (["delivery","retirada","dine_in","unknown"].includes(String(raw.deliveryType))) {
    out.deliveryType = raw.deliveryType as BehaviorContext["deliveryType"];
  }
  if (["pix","dinheiro","cartao","misto","unknown"].includes(String(raw.paymentFamily))) {
    out.paymentFamily = raw.paymentFamily as BehaviorContext["paymentFamily"];
  }
  if (["ranking","cofre","fidelity","cart","checkout","orders","tracking"].includes(String(raw.target))) {
    out.target = raw.target as BehaviorContext["target"];
  }
  if (["mobile","tablet","desktop","unknown"].includes(String(raw.deviceClass))) {
    out.deviceClass = raw.deviceClass as BehaviorContext["deviceClass"];
  }
  if (["compact","medium","wide","unknown"].includes(String(raw.viewportClass))) {
    out.viewportClass = raw.viewportClass as BehaviorContext["viewportClass"];
  }
  if (["standalone","browser","unknown"].includes(String(raw.displayMode))) {
    out.displayMode = raw.displayMode as BehaviorContext["displayMode"];
  }
  if (["direct","internal","external","whatsapp_link","unknown"].includes(String(raw.referrerKind))) {
    out.referrerKind = raw.referrerKind as BehaviorContext["referrerKind"];
  }
  const engagementMs = Number(raw.engagementMs);
  if (Number.isInteger(engagementMs) && engagementMs >= 0 && engagementMs <= 24 * 60 * 60 * 1000) {
    out.engagementMs = engagementMs;
  }
  if (raw.action === "checkout_submit") out.action = "checkout_submit";
  if (["success", "failure"].includes(String(raw.outcome))) out.outcome = raw.outcome as BehaviorContext["outcome"];
  if (["request_rejected", "service_unavailable", "network_error", "unknown"].includes(String(raw.failureCode))) {
    out.failureCode = raw.failureCode as BehaviorContext["failureCode"];
  }
  if (allowPedidoId) {
    const pedidoId = sanitizeSafeId(raw.pedidoId);
    if (pedidoId) out.pedidoId = pedidoId;
  }
  return out;
}

export function validarEventoClienteComportamento(raw: unknown, agoraMs = Date.now()): BehaviorClientInput | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.eventId !== "string" || !UUID_RE.test(obj.eventId)) return null;
  if (typeof obj.sessionId !== "string" || !UUID_RE.test(obj.sessionId)) return null;
  if (!CLIENT_BEHAVIOR_EVENTS.includes(obj.type as ClientBehaviorEventType)) return null;

  const occurred = Number(obj.occurredAtMs);
  const occurredAtMs = Number.isFinite(occurred) && Math.abs(agoraMs - occurred) <= 24 * 60 * 60 * 1000
    ? Math.trunc(occurred)
    : agoraMs;

  const context = sanitizeContext(obj.context, false);
  if (obj.type === "action_result" && (!context.action || !context.outcome || (context.outcome === "failure" && !context.failureCode))) return null;
  return {
    eventId: obj.eventId,
    sessionId: obj.sessionId,
    type: obj.type as ClientBehaviorEventType,
    occurredAtMs,
    context,
  };
}

type RedisBehavior = typeof redis & {
  zadd: (key: string, value: { score: number; member: string }) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<number>;
};
const bredis = redis as RedisBehavior;

async function indexEvent(event: BehaviorEvent, ttl: number): Promise<void> {
  const day = behaviorDayBucket(event.receivedAtMs);
  const keys: string[] = [
    behaviorGlobalIndexKey(event.tenantId, day),
    behaviorSessionIndexKey(event.tenantId, event.sessionId, day),
  ];
  if (event.actorHash) keys.push(behaviorActorIndexKey(event.tenantId, event.actorHash, day));

  for (const key of keys) {
    // ZADD é idempotente para o mesmo eventId; repetir também corrige TTL
    // ausente se uma tentativa anterior parou no meio dos índices.
    await bredis.zadd(key, { score: event.receivedAtMs, member: event.eventId });
    await bredis.expire(key, ttl);
  }
}

async function persistEvent(event: BehaviorEvent): Promise<boolean> {
  if (!behaviorAnalyticsEnabled()) return false;
  const days = retentionDays();
  if (!days) return false;
  const ttl = days * 24 * 60 * 60;
  const eventKey = behaviorEventKey(event.tenantId, event.eventId);
  const created = await redis.set(eventKey, event, { nx: true, ex: ttl });

  // Se uma tentativa anterior gravou o evento e falhou ao criar um índice,
  // o retry relê a versão canônica e repara os índices sem sobrescrever dados.
  // Em colisão de eventId, indexamos o evento já persistido, nunca o payload novo.
  const canonicalEvent = created
    ? event
    : await redis.get<BehaviorEvent>(eventKey).catch(() => null);
  if (
    !canonicalEvent
    || canonicalEvent.schemaVersion !== BEHAVIOR_SCHEMA_VERSION
    || canonicalEvent.eventId !== event.eventId
    || canonicalEvent.tenantId !== event.tenantId
  ) {
    return false;
  }

  await indexEvent(canonicalEvent, ttl);
  return Boolean(created);
}

export async function registrarEventosClienteComportamento(params: {
  tenantId?: string;
  clienteId?: string | null;
  actorHashVerificado?: string | null;
  events: BehaviorClientInput[];
  agoraMs?: number;
}): Promise<{ accepted: number; duplicated: number }> {
  if (!behaviorAnalyticsEnabled()) return { accepted: 0, duplicated: 0 };
  const tenantId = params.tenantId ?? BEHAVIOR_TENANT_DEFAULT;
  const agoraMs = params.agoraMs ?? Date.now();
  const actorHash = params.clienteId
    ? pseudonimizarClienteId(params.clienteId)
    : (params.actorHashVerificado && SAFE_ACTOR_HASH_RE.test(params.actorHashVerificado) ? params.actorHashVerificado : null);
  let accepted = 0;
  let duplicated = 0;

  for (const input of params.events.slice(0, 20)) {
    const event: BehaviorEvent = {
      schemaVersion: BEHAVIOR_SCHEMA_VERSION,
      eventId: input.eventId,
      tenantId,
      sessionId: input.sessionId,
      actorHash,
      type: input.type,
      occurredAtMs: input.occurredAtMs ?? agoraMs,
      receivedAtMs: agoraMs,
      context: sanitizeContext(input.context, false),
    };
    if (await persistEvent(event)) accepted += 1;
    else duplicated += 1;
  }
  return { accepted, duplicated };
}

export async function registrarEventoServidorComportamento(params: {
  tenantId?: string;
  clienteId?: string | null;
  /** Pseudônimo já verificado a partir do cookie assinado de vínculo. */
  actorHash?: string | null;
  sessionId: string;
  type: ServerBehaviorEventType;
  context?: BehaviorContext;
  agoraMs?: number;
}): Promise<boolean> {
  if (!behaviorAnalyticsEnabled()) return false;
  if (!UUID_RE.test(params.sessionId)) return false;
  const agoraMs = params.agoraMs ?? Date.now();
  const event: BehaviorEvent = {
    schemaVersion: BEHAVIOR_SCHEMA_VERSION,
    eventId: randomUUID(),
    tenantId: params.tenantId ?? BEHAVIOR_TENANT_DEFAULT,
    sessionId: params.sessionId,
    actorHash: params.clienteId
      ? pseudonimizarClienteId(params.clienteId)
      : params.actorHash && SAFE_ACTOR_HASH_RE.test(params.actorHash)
        ? params.actorHash
        : null,
    type: params.type,
    occurredAtMs: agoraMs,
    receivedAtMs: agoraMs,
    context: sanitizeContext(params.context, true),
  };
  return persistEvent(event);
}
