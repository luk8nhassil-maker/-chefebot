import "server-only";

import { createHmac } from "node:crypto";
import { redis } from "./redis";

export const BEHAVIOR_SCHEMA_VERSION = 1 as const;
export const BEHAVIOR_TENANT_DEFAULT = "default";

import {
  BEHAVIOR_FUNNEL_STEPS,
  BEHAVIOR_PAGES,
  PUBLIC_BEHAVIOR_EVENTS,
  type BehaviorEventData,
  type BehaviorEventType,
  type BehaviorPaymentMethod,
  type PublicBehaviorEventType,
} from "./behaviorEvents";

export type BehaviorEventRecord = {
  schemaVersion: typeof BEHAVIOR_SCHEMA_VERSION;
  eventId: string;
  sessionId: string;
  tenantId: string;
  type: BehaviorEventType;
  createdAtMs: number;
  actor: "anonymous" | "authenticated";
  customerRef?: string;
  data: BehaviorEventData;
  authority: "client_observed" | "server_fact";
};

export type BehaviorWriteResult =
  | { recorded: true; duplicate: false; customerLinked: boolean }
  | { recorded: false; duplicate: true; customerLinked: boolean }
  | { recorded: false; duplicate: false; customerLinked: boolean; reason: "disabled" | "invalid" | "session_owner_conflict" | "storage_error" };

type BehaviorConfig = {
  retentionDays: number;
  retentionSeconds: number;
  hmacSecret: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_TOKEN_RE = /^[a-z0-9][a-z0-9:_-]{0,95}$/i;
const MAX_EVENTS_PER_MINUTE_PER_SESSION = 120;

type RedisBehavior = typeof redis & {
  zadd: (
    key: string,
    opts: { score: number; member: string } | Array<{ score: number; member: string }>,
  ) => Promise<number>;
  zrange: (
    key: string,
    min: number | string,
    max: number | string,
    opts?: { byScore?: boolean; limit?: { offset: number; count: number } },
  ) => Promise<string[]>;
  hincrby: (key: string, field: string, amount: number) => Promise<number>;
  incr: (key: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<number>;
};

const aredis = redis as RedisBehavior;

export function behaviorAnalyticsConfig(): BehaviorConfig | null {
  if (process.env.VERCEL_ENV === "preview") return null;
  if (process.env.BEHAVIOR_ANALYTICS_ENABLED !== "true") return null;

  const secret = process.env.BEHAVIOR_ANALYTICS_HMAC_SECRET ?? "";
  const retentionDays = Number(process.env.BEHAVIOR_ANALYTICS_RETENTION_DAYS);

  if (secret.length < 32) return null;
  if (!Number.isInteger(retentionDays) || retentionDays <= 0) return null;

  return {
    retentionDays,
    retentionSeconds: retentionDays * 24 * 60 * 60,
    hmacSecret: secret,
  };
}

export function behaviorAnalyticsEnabled(): boolean {
  return behaviorAnalyticsConfig() !== null;
}

export function behaviorSessionIdValid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function behaviorEventIdValid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function publicBehaviorEventValid(value: unknown): value is PublicBehaviorEventType {
  return typeof value === "string" && (PUBLIC_BEHAVIOR_EVENTS as readonly string[]).includes(value);
}

function asEnum<T extends readonly string[]>(value: unknown, allowed: T): T[number] | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T[number])
    : undefined;
}

function safeToken(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  return SAFE_TOKEN_RE.test(v) ? v : undefined;
}

function boundedInt(value: unknown, min: number, max: number): number | undefined {
  if (!Number.isInteger(value)) return undefined;
  const n = value as number;
  return n >= min && n <= max ? n : undefined;
}

function sanitizePublicData(type: PublicBehaviorEventType, raw: unknown): BehaviorEventData {
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const base: BehaviorEventData = {};

  const page = asEnum(body.page, BEHAVIOR_PAGES);
  const source = asEnum(body.source, ["direct", "internal", "whatsapp", "search", "social", "other"] as const);
  const deviceClass = asEnum(body.deviceClass, ["mobile", "tablet", "desktop"] as const);
  const displayMode = asEnum(body.displayMode, ["browser", "standalone"] as const);

  if (page) base.page = page;
  if (source) base.source = source;
  if (deviceClass) base.deviceClass = deviceClass;
  if (displayMode) base.displayMode = displayMode;

  if (type === "app_resume") {
    const hiddenDurationSec = boundedInt(body.hiddenDurationSec, 0, 7 * 24 * 60 * 60);
    if (hiddenDurationSec !== undefined) base.hiddenDurationSec = hiddenDurationSec;
  }

  if (type === "funnel_step" || type === "checkout_exit_observed") {
    const step = asEnum(body.step, BEHAVIOR_FUNNEL_STEPS);
    if (step) base.step = step;
    const deliveryType = asEnum(body.deliveryType, ["delivery", "retirada", "dine_in"] as const);
    if (deliveryType) base.deliveryType = deliveryType;
    const paymentMethod = asEnum(body.paymentMethod, ["pix", "dinheiro", "cartao", "misto", "outro"] as const);
    if (paymentMethod) base.paymentMethod = paymentMethod;
  }

  if (type === "search_used") {
    const queryLength = boundedInt(body.queryLength, 0, 200);
    const resultCount = boundedInt(body.resultCount, 0, 1000);
    const category = safeToken(body.category);
    if (queryLength !== undefined) base.queryLength = queryLength;
    if (resultCount !== undefined) base.resultCount = resultCount;
    if (category) base.category = category;
  }

  if (type === "product_open" || type === "cart_add" || type === "cart_remove") {
    const itemRef = safeToken(body.itemRef);
    const itemKind = asEnum(body.itemKind, ["pizza", "simple", "promo", "reward", "unknown"] as const);
    const category = safeToken(body.category);
    const cartItems = boundedInt(body.cartItems, 0, 200);
    const cartDistinctItems = boundedInt(body.cartDistinctItems, 0, 100);
    if (itemRef) base.itemRef = itemRef;
    if (itemKind) base.itemKind = itemKind;
    if (category) base.category = category;
    if (cartItems !== undefined) base.cartItems = cartItems;
    if (cartDistinctItems !== undefined) base.cartDistinctItems = cartDistinctItems;
  }

  return base;
}

function dayBucket(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10).replaceAll("-", "");
}

function monthBucket(ms: number): string {
  return new Date(ms).toISOString().slice(0, 7).replace("-", "");
}

function minuteBucket(ms: number): string {
  return String(Math.floor(ms / 60_000));
}

function keyEvent(tenantId: string, eventId: string): string {
  return `behavior:event:${tenantId}:${eventId}`;
}
function keySession(tenantId: string, sessionId: string): string {
  return `behavior:session:${tenantId}:${sessionId}`;
}
function keySessionOwner(tenantId: string, sessionId: string): string {
  return `behavior:session:owner:${tenantId}:${sessionId}`;
}
function keyDay(tenantId: string, day: string): string {
  return `behavior:day:${tenantId}:${day}`;
}
function keyCounterDay(tenantId: string, day: string): string {
  return `behavior:counter:${tenantId}:${day}`;
}
function keyCustomerSessions(tenantId: string, customerRef: string, month: string): string {
  return `behavior:customer:sessions:${tenantId}:${customerRef}:${month}`;
}
function keyRate(tenantId: string, sessionId: string, minute: string): string {
  return `behavior:rate:${tenantId}:${sessionId}:${minute}`;
}

export function deriveBehaviorCustomerRef(clienteId: string, secret?: string): string | null {
  const key = secret ?? behaviorAnalyticsConfig()?.hmacSecret;
  if (!key || !clienteId) return null;
  return "bc_" + createHmac("sha256", key).update(clienteId).digest("hex").slice(0, 32);
}

export function deriveBehaviorOrderRef(pedidoId: string, secret?: string): string | null {
  const key = secret ?? behaviorAnalyticsConfig()?.hmacSecret;
  if (!key || !pedidoId) return null;
  return "bo_" + createHmac("sha256", key).update("order:" + pedidoId).digest("hex").slice(0, 32);
}

async function rateLimitOk(tenantId: string, sessionId: string, nowMs: number): Promise<boolean> {
  const key = keyRate(tenantId, sessionId, minuteBucket(nowMs));
  const count = await aredis.incr(key);
  if (count === 1) await aredis.expire(key, 120);
  return count <= MAX_EVENTS_PER_MINUTE_PER_SESSION;
}

async function linkSessionToCustomer(params: {
  config: BehaviorConfig;
  tenantId: string;
  sessionId: string;
  customerRef: string;
  nowMs: number;
}): Promise<"linked" | "conflict"> {
  const { config, tenantId, sessionId, customerRef, nowMs } = params;
  const ownerKey = keySessionOwner(tenantId, sessionId);
  const existing = await redis.get<string>(ownerKey);
  if (existing && existing !== customerRef) return "conflict";

  if (!existing) {
    const created = await redis.set(ownerKey, customerRef, {
      nx: true,
      ex: config.retentionSeconds,
    });
    if (!created) {
      const raced = await redis.get<string>(ownerKey);
      if (raced && raced !== customerRef) return "conflict";
    }
  } else {
    await aredis.expire(ownerKey, config.retentionSeconds);
  }

  const customerKey = keyCustomerSessions(
    tenantId,
    customerRef,
    monthBucket(nowMs),
  );
  await aredis.zadd(customerKey, { score: nowMs, member: sessionId });
  await aredis.expire(customerKey, config.retentionSeconds);
  return "linked";
}

async function persistEvent(
  config: BehaviorConfig,
  record: BehaviorEventRecord,
): Promise<BehaviorWriteResult> {
  const created = await redis.set(keyEvent(record.tenantId, record.eventId), record, {
    nx: true,
    ex: config.retentionSeconds,
  });
  if (!created) {
    return {
      recorded: false,
      duplicate: true,
      customerLinked: record.actor === "authenticated",
    };
  }

  const day = dayBucket(record.createdAtMs);
  const sessionKey = keySession(record.tenantId, record.sessionId);
  const dayKey = keyDay(record.tenantId, day);
  const counterKey = keyCounterDay(record.tenantId, day);

  await Promise.all([
    aredis.zadd(sessionKey, { score: record.createdAtMs, member: record.eventId }),
    aredis.expire(sessionKey, config.retentionSeconds),
    aredis.zadd(dayKey, { score: record.createdAtMs, member: record.eventId }),
    aredis.expire(dayKey, config.retentionSeconds),
    aredis.hincrby(counterKey, record.type, 1),
    aredis.expire(counterKey, config.retentionSeconds),
  ]);

  return {
    recorded: true,
    duplicate: false,
    customerLinked: record.actor === "authenticated",
  };
}

export async function recordPublicBehaviorEvent(params: {
  tenantId?: string;
  eventId: unknown;
  sessionId: unknown;
  type: unknown;
  data?: unknown;
  clienteId?: string | null;
  nowMs?: number;
}): Promise<BehaviorWriteResult> {
  const config = behaviorAnalyticsConfig();
  if (!config) {
    return { recorded: false, duplicate: false, customerLinked: false, reason: "disabled" };
  }

  const tenantId = params.tenantId ?? BEHAVIOR_TENANT_DEFAULT;
  const nowMs = Number.isFinite(params.nowMs) ? Math.trunc(params.nowMs as number) : Date.now();

  if (
    !behaviorEventIdValid(params.eventId) ||
    !behaviorSessionIdValid(params.sessionId) ||
    !publicBehaviorEventValid(params.type)
  ) {
    return { recorded: false, duplicate: false, customerLinked: false, reason: "invalid" };
  }

  try {
    if (!(await rateLimitOk(tenantId, params.sessionId, nowMs))) {
      return { recorded: false, duplicate: false, customerLinked: false, reason: "invalid" };
    }

    let customerRef: string | undefined;
    if (params.clienteId) {
      const derived = deriveBehaviorCustomerRef(params.clienteId, config.hmacSecret);
      if (derived) {
        const link = await linkSessionToCustomer({
          config,
          tenantId,
          sessionId: params.sessionId,
          customerRef: derived,
          nowMs,
        });
        if (link === "conflict") {
          return {
            recorded: false,
            duplicate: false,
            customerLinked: false,
            reason: "session_owner_conflict",
          };
        }
        customerRef = derived;
      }
    }

    const record: BehaviorEventRecord = {
      schemaVersion: BEHAVIOR_SCHEMA_VERSION,
      eventId: params.eventId,
      sessionId: params.sessionId,
      tenantId,
      type: params.type,
      createdAtMs: nowMs,
      actor: customerRef ? "authenticated" : "anonymous",
      ...(customerRef ? { customerRef } : {}),
      data: sanitizePublicData(params.type, params.data),
      authority: "client_observed",
    };

    return await persistEvent(config, record);
  } catch {
    return {
      recorded: false,
      duplicate: false,
      customerLinked: false,
      reason: "storage_error",
    };
  }
}

function sanitizePaymentMethod(value: string | undefined): BehaviorPaymentMethod {
  const lower = (value ?? "").toLowerCase();
  const pix = lower.includes("pix");
  const dinheiro = lower.includes("dinheiro");
  const cartao = lower.includes("cart");
  const total = Number(pix) + Number(dinheiro) + Number(cartao);
  if (total > 1) return "misto";
  if (pix) return "pix";
  if (dinheiro) return "dinheiro";
  if (cartao) return "cartao";
  return "outro";
}

export async function recordOrderCreatedBehaviorFact(params: {
  tenantId?: string;
  pedidoId: string;
  sessionId?: string | null;
  clienteId?: string | null;
  totalCents: number;
  itemCount: number;
  deliveryType?: string;
  payment?: string;
  nowMs?: number;
}): Promise<BehaviorWriteResult> {
  const config = behaviorAnalyticsConfig();
  if (!config) {
    return { recorded: false, duplicate: false, customerLinked: false, reason: "disabled" };
  }

  const tenantId = params.tenantId ?? BEHAVIOR_TENANT_DEFAULT;
  const nowMs = Number.isFinite(params.nowMs) ? Math.trunc(params.nowMs as number) : Date.now();
  if (!params.pedidoId) {
    return { recorded: false, duplicate: false, customerLinked: false, reason: "invalid" };
  }

  const syntheticSessionId = behaviorSessionIdValid(params.sessionId)
    ? params.sessionId
    : "00000000-0000-4000-8000-000000000000";

  try {
    let customerRef: string | undefined;
    if (params.clienteId) {
      customerRef = deriveBehaviorCustomerRef(params.clienteId, config.hmacSecret) ?? undefined;
      if (customerRef && behaviorSessionIdValid(params.sessionId)) {
        const link = await linkSessionToCustomer({
          config,
          tenantId,
          sessionId: params.sessionId,
          customerRef,
          nowMs,
        });
        if (link === "conflict") {
          return {
            recorded: false,
            duplicate: false,
            customerLinked: false,
            reason: "session_owner_conflict",
          };
        }
      }
    }

    const orderRef = deriveBehaviorOrderRef(params.pedidoId, config.hmacSecret);
    if (!orderRef) {
      return { recorded: false, duplicate: false, customerLinked: false, reason: "invalid" };
    }

    const eventId = "srv_" + createHmac("sha256", config.hmacSecret)
      .update("order-created:" + params.pedidoId)
      .digest("hex")
      .slice(0, 32);

    const deliveryType = asEnum(params.deliveryType, ["delivery", "retirada", "dine_in"] as const);
    const record: BehaviorEventRecord = {
      schemaVersion: BEHAVIOR_SCHEMA_VERSION,
      eventId,
      sessionId: syntheticSessionId,
      tenantId,
      type: "order_created",
      createdAtMs: nowMs,
      actor: customerRef ? "authenticated" : "anonymous",
      ...(customerRef ? { customerRef } : {}),
      data: {
        orderRef,
        orderTotalCents: Math.max(0, Math.trunc(params.totalCents)),
        orderItemCount: Math.max(0, Math.trunc(params.itemCount)),
        ...(deliveryType ? { deliveryType } : {}),
        paymentMethod: sanitizePaymentMethod(params.payment),
      },
      authority: "server_fact",
    };

    return await persistEvent(config, record);
  } catch {
    return {
      recorded: false,
      duplicate: false,
      customerLinked: false,
      reason: "storage_error",
    };
  }
}

export async function readBehaviorSessionEvents(params: {
  sessionId: string;
  tenantId?: string;
  startMs?: number;
  endMs?: number;
}): Promise<BehaviorEventRecord[]> {
  const config = behaviorAnalyticsConfig();
  if (!config || !behaviorSessionIdValid(params.sessionId)) return [];
  const tenantId = params.tenantId ?? BEHAVIOR_TENANT_DEFAULT;
  const startMs = Number.isFinite(params.startMs) ? Math.trunc(params.startMs as number) : 0;
  const endMs = Number.isFinite(params.endMs) ? Math.trunc(params.endMs as number) : Date.now();
  if (startMs > endMs) return [];

  const ids = await aredis.zrange(keySession(tenantId, params.sessionId), startMs, endMs, { byScore: true });
  const records = await Promise.all(ids.map((id) => redis.get<BehaviorEventRecord>(keyEvent(tenantId, id))));
  return records.filter((event): event is BehaviorEventRecord => event !== null);
}
