import "server-only";

import { createHmac, randomUUID } from "node:crypto";
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

function retentionDays(): number | null {
  const raw = Number(process.env.BEHAVIOR_ANALYTICS_RETENTION_DAYS);
  if (!Number.isInteger(raw) || raw < 7 || raw > 730) return null;
  return raw;
}

function hashSecret(): string | null {
  const secret = process.env.BEHAVIOR_ANALYTICS_HASH_SECRET || process.env.AUTH_SECRET;
  if (!secret || secret.length < 24) return null;
  return secret;
}

export function behaviorAnalyticsEnabled(): boolean {
  if (process.env.BEHAVIOR_ANALYTICS_ENABLED !== "true") return false;
  // Preview nunca escreve telemetria comportamental real, mesmo que uma
  // variável seja herdada por engano do projeto.
  if (process.env.VERCEL_ENV === "preview") return false;
  return retentionDays() !== null && hashSecret() !== null;
}

export function pseudonimizarClienteId(clienteId: string): string | null {
  const secret = hashSecret();
  if (!secret || !clienteId) return null;
  return createHmac("sha256", secret).update(clienteId).digest("hex").slice(0, 32);
}

function bucketDia(ms: number): string {
  const d = new Date(ms);
  return [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, "0"),
    String(d.getUTCDate()).padStart(2, "0"),
  ].join("");
}

function eventKey(tenantId: string, eventId: string): string {
  return `behavior:v1:event:${tenantId}:${eventId}`;
}
function globalIndexKey(tenantId: string, day: string): string {
  return `behavior:v1:idx:${tenantId}:${day}`;
}
function actorIndexKey(tenantId: string, actorHash: string, day: string): string {
  return `behavior:v1:actor:${tenantId}:${actorHash}:${day}`;
}
function sessionIndexKey(tenantId: string, sessionId: string, day: string): string {
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

  return {
    eventId: obj.eventId,
    sessionId: obj.sessionId,
    type: obj.type as ClientBehaviorEventType,
    occurredAtMs,
    context: sanitizeContext(obj.context, false),
  };
}

type RedisBehavior = typeof redis & {
  zadd: (key: string, value: { score: number; member: string }) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<number>;
};
const bredis = redis as RedisBehavior;

async function persistEvent(event: BehaviorEvent): Promise<boolean> {
  if (!behaviorAnalyticsEnabled()) return false;
  const days = retentionDays();
  if (!days) return false;
  const ttl = days * 24 * 60 * 60;
  const day = bucketDia(event.receivedAtMs);

  const created = await redis.set(eventKey(event.tenantId, event.eventId), event, { nx: true, ex: ttl });
  if (!created) return false;

  const keys: string[] = [
    globalIndexKey(event.tenantId, day),
    sessionIndexKey(event.tenantId, event.sessionId, day),
  ];
  if (event.actorHash) keys.push(actorIndexKey(event.tenantId, event.actorHash, day));

  for (const key of keys) {
    await bredis.zadd(key, { score: event.receivedAtMs, member: event.eventId });
    await bredis.expire(key, ttl);
  }
  return true;
}

export async function registrarEventosClienteComportamento(params: {
  tenantId?: string;
  clienteId?: string | null;
  events: BehaviorClientInput[];
  agoraMs?: number;
}): Promise<{ accepted: number; duplicated: number }> {
  if (!behaviorAnalyticsEnabled()) return { accepted: 0, duplicated: 0 };
  const tenantId = params.tenantId ?? BEHAVIOR_TENANT_DEFAULT;
  const agoraMs = params.agoraMs ?? Date.now();
  const actorHash = params.clienteId ? pseudonimizarClienteId(params.clienteId) : null;
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
    actorHash: params.clienteId ? pseudonimizarClienteId(params.clienteId) : null,
    type: params.type,
    occurredAtMs: agoraMs,
    receivedAtMs: agoraMs,
    context: sanitizeContext(params.context, true),
  };
  return persistEvent(event);
}
