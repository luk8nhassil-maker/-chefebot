import "server-only";

import { redis } from "./redis";
import {
  BEHAVIOR_TENANT_DEFAULT,
  behaviorActorIndexKey,
  behaviorDayBucket,
  behaviorEventKey,
  behaviorGlobalIndexKey,
  behaviorSessionIndexKey,
  pseudonimizarClienteId,
  type BehaviorEvent,
} from "./behaviorAnalytics";
import type { BehaviorEventType } from "./behaviorAnalyticsTypes";

const MAX_EVENTOS_LEITURA = 20_000;
const MAX_EVENTOS_CLIENTE = 1_000;
const BATCH_GET = 100;

type RedisBehaviorRead = typeof redis & {
  zrange: (key: string, start: number, stop: number) => Promise<string[]>;
};
const rredis = redis as RedisBehaviorRead;

export type BehaviorTimelineEvent = {
  eventId: string;
  sessionId: string;
  type: BehaviorEventType;
  occurredAtMs: number;
  receivedAtMs: number;
  context: BehaviorEvent["context"];
  identificado: boolean;
};

export type BehaviorCustomerSummary = {
  schemaVersion: 1;
  mode: "behavior_customer_summary_read_only";
  sessions: number;
  sessionsWithOrder: number;
  sessionsWithoutOrder: number;
  appOpens: number;
  searches: number;
  productViews: number;
  cartInteractions: number;
  checkoutStarts: number;
  rankingOpens: number;
  fidelityOpens: number;
  totalEngagementSeconds: number;
  medianEngagementSeconds: number | null;
  medianDaysBetweenSessions: number | null;
  firstSeenAtMs: number | null;
  lastSeenAtMs: number | null;
};

export type BehaviorFunnelSummary = {
  schemaVersion: 1;
  mode: "behavior_summary_read_only";
  period: { startMs: number; endMs: number };
  truncated: boolean;
  events: number;
  sessions: number;
  sessionsWithCheckout: number;
  sessionsWithOrder: number;
  sessionsWithoutOrder: number;
  sessionsWithSearch: number;
  sessionsWithProductView: number;
  sessionsWithCart: number;
  abandonedCheckoutSessions: number;
  checkoutToOrderRate: number | null;
  sessionToOrderRate: number | null;
  medianMinutesFirstOpenToOrder: number | null;
  medianEngagementSeconds: number | null;
  byType: Record<string, number>;
};

function dayStartsBetween(startMs: number, endMs: number): number[] {
  const start = new Date(startMs);
  const end = new Date(endMs);
  const cursor = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const last = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  const out: number[] = [];
  for (let ms = cursor; ms <= last; ms += 24 * 60 * 60 * 1000) out.push(ms);
  return out;
}

async function loadEventsByIds(
  tenantId: string,
  ids: string[],
  cap: number,
): Promise<BehaviorEvent[]> {
  const unique = [...new Set(ids)].slice(0, cap);
  const out: BehaviorEvent[] = [];
  for (let i = 0; i < unique.length; i += BATCH_GET) {
    const batch = unique.slice(i, i + BATCH_GET);
    const items = await Promise.all(
      batch.map((id) => redis.get<BehaviorEvent>(behaviorEventKey(tenantId, id)).catch(() => null)),
    );
    for (const item of items) {
      if (item && item.schemaVersion === 1) out.push(item);
    }
  }
  return out;
}

async function idsFromDailyIndexes(
  buildKey: (day: string) => string,
  startMs: number,
  endMs: number,
  cap: number,
): Promise<{ ids: string[]; truncated: boolean }> {
  const ids: string[] = [];
  let truncated = false;
  for (const dayMs of dayStartsBetween(startMs, endMs)) {
    const day = behaviorDayBucket(dayMs);
    const current = await rredis.zrange(buildKey(day), 0, -1).catch(() => []);
    for (const id of current) {
      if (ids.length >= cap) {
        truncated = true;
        break;
      }
      ids.push(id);
    }
    if (truncated) break;
  }
  return { ids, truncated };
}

function inPeriod(event: BehaviorEvent, startMs: number, endMs: number): boolean {
  return event.receivedAtMs >= startMs && event.receivedAtMs <= endMs;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function ratio(part: number, whole: number): number | null {
  if (!whole) return null;
  return Math.round((part / whole) * 10_000) / 100;
}

export async function consultarTimelineComportamentalCliente(params: {
  clienteId: string;
  startMs: number;
  endMs: number;
  tenantId?: string;
}): Promise<{ events: BehaviorTimelineEvent[]; truncated: boolean }> {
  const tenantId = params.tenantId ?? BEHAVIOR_TENANT_DEFAULT;
  const actorHash = pseudonimizarClienteId(params.clienteId);
  if (!actorHash) return { events: [], truncated: false };

  const actorIds = await idsFromDailyIndexes(
    (day) => behaviorActorIndexKey(tenantId, actorHash, day),
    params.startMs,
    params.endMs,
    MAX_EVENTOS_CLIENTE,
  );
  const actorEvents = (await loadEventsByIds(tenantId, actorIds.ids, MAX_EVENTOS_CLIENTE))
    .filter((event) => inPeriod(event, params.startMs, params.endMs));

  // Eventos anônimos da mesma sessão são recuperados somente quando uma
  // sessão já foi ligada ao ator por algum fato autenticado/oficial.
  const sessionIds = [...new Set(actorEvents.map((event) => event.sessionId))];
  const allIds = new Set(actorIds.ids);
  let truncated = actorIds.truncated;

  for (const sessionId of sessionIds) {
    if (allIds.size >= MAX_EVENTOS_CLIENTE) {
      truncated = true;
      break;
    }
    const remaining = MAX_EVENTOS_CLIENTE - allIds.size;
    const sessionResult = await idsFromDailyIndexes(
      (day) => behaviorSessionIndexKey(tenantId, sessionId, day),
      params.startMs,
      params.endMs,
      remaining,
    );
    for (const id of sessionResult.ids) allIds.add(id);
    truncated ||= sessionResult.truncated;
  }

  const events = (await loadEventsByIds(tenantId, [...allIds], MAX_EVENTOS_CLIENTE))
    .filter((event) => inPeriod(event, params.startMs, params.endMs))
    .sort((a, b) => b.occurredAtMs - a.occurredAtMs)
    .map((event): BehaviorTimelineEvent => ({
      eventId: event.eventId,
      sessionId: event.sessionId,
      type: event.type,
      occurredAtMs: event.occurredAtMs,
      receivedAtMs: event.receivedAtMs,
      context: event.context,
      identificado: event.actorHash === actorHash,
    }));

  return { events, truncated };
}

export function resumirTimelineComportamentalCliente(
  events: BehaviorTimelineEvent[],
): BehaviorCustomerSummary {
  const ordered = [...events].sort((a, b) => a.occurredAtMs - b.occurredAtMs);
  const bySession = new Map<string, BehaviorTimelineEvent[]>();
  for (const event of ordered) {
    const list = bySession.get(event.sessionId) ?? [];
    list.push(event);
    bySession.set(event.sessionId, list);
  }

  let sessionsWithOrder = 0;
  let appOpens = 0;
  let searches = 0;
  let productViews = 0;
  let cartInteractions = 0;
  let checkoutStarts = 0;
  let rankingOpens = 0;
  let fidelityOpens = 0;
  let totalEngagementMs = 0;
  const engagementBySessionSeconds: number[] = [];
  const sessionStarts: number[] = [];

  for (const list of bySession.values()) {
    const sorted = [...list].sort((a, b) => a.occurredAtMs - b.occurredAtMs);
    if (sorted[0]) sessionStarts.push(sorted[0].occurredAtMs);
    if (sorted.some((event) => event.type === "order_created")) sessionsWithOrder += 1;

    let sessionEngagementMs = 0;
    for (const event of sorted) {
      if (event.type === "app_open") appOpens += 1;
      if (event.type === "search_used") searches += 1;
      if (event.type === "product_view") productViews += 1;
      if (
        event.type === "cart_state" ||
        event.type === "cart_add" ||
        event.type === "cart_remove" ||
        event.type === "cart_quantity_change"
      ) cartInteractions += 1;
      if (
        event.type === "checkout_start" ||
        event.type === "delivery_step_view" ||
        event.type === "payment_step_view" ||
        event.type === "order_submit_attempt"
      ) checkoutStarts += 1;
      if (event.type === "ranking_open") rankingOpens += 1;
      if (event.type === "fidelity_open") fidelityOpens += 1;
      if (event.type === "page_exit") sessionEngagementMs += event.context.engagementMs ?? 0;
    }
    if (sessionEngagementMs > 0) engagementBySessionSeconds.push(sessionEngagementMs / 1000);
    totalEngagementMs += sessionEngagementMs;
  }

  const gapsDays: number[] = [];
  const starts = [...new Set(sessionStarts)].sort((a, b) => a - b);
  for (let i = 1; i < starts.length; i++) {
    const gap = (starts[i]! - starts[i - 1]!) / (24 * 60 * 60 * 1000);
    if (gap >= 0) gapsDays.push(gap);
  }

  const medianEngagement = median(engagementBySessionSeconds);
  const medianGap = median(gapsDays);
  const sessions = bySession.size;

  return {
    schemaVersion: 1,
    mode: "behavior_customer_summary_read_only",
    sessions,
    sessionsWithOrder,
    sessionsWithoutOrder: Math.max(sessions - sessionsWithOrder, 0),
    appOpens,
    searches,
    productViews,
    cartInteractions,
    checkoutStarts,
    rankingOpens,
    fidelityOpens,
    totalEngagementSeconds: Math.round(totalEngagementMs / 100) / 10,
    medianEngagementSeconds: medianEngagement === null ? null : Math.round(medianEngagement * 10) / 10,
    medianDaysBetweenSessions: medianGap === null ? null : Math.round(medianGap * 10) / 10,
    firstSeenAtMs: ordered[0]?.occurredAtMs ?? null,
    lastSeenAtMs: ordered[ordered.length - 1]?.occurredAtMs ?? null,
  };
}

export async function resumirFunilComportamental(params: {
  startMs: number;
  endMs: number;
  tenantId?: string;
}): Promise<BehaviorFunnelSummary> {
  const tenantId = params.tenantId ?? BEHAVIOR_TENANT_DEFAULT;
  const index = await idsFromDailyIndexes(
    (day) => behaviorGlobalIndexKey(tenantId, day),
    params.startMs,
    params.endMs,
    MAX_EVENTOS_LEITURA,
  );
  const events = (await loadEventsByIds(tenantId, index.ids, MAX_EVENTOS_LEITURA))
    .filter((event) => inPeriod(event, params.startMs, params.endMs));

  const byType: Record<string, number> = {};
  const bySession = new Map<string, BehaviorEvent[]>();
  for (const event of events) {
    byType[event.type] = (byType[event.type] ?? 0) + 1;
    const list = bySession.get(event.sessionId) ?? [];
    list.push(event);
    bySession.set(event.sessionId, list);
  }

  let sessionsWithCheckout = 0;
  let sessionsWithOrder = 0;
  let sessionsWithSearch = 0;
  let sessionsWithProductView = 0;
  let sessionsWithCart = 0;
  let abandonedCheckoutSessions = 0;
  const openToOrderMinutes: number[] = [];
  const engagementSeconds: number[] = [];

  for (const list of bySession.values()) {
    const sorted = [...list].sort((a, b) => a.occurredAtMs - b.occurredAtMs);
    const checkout = sorted.some((event) =>
      event.type === "checkout_start" ||
      event.type === "delivery_step_view" ||
      event.type === "payment_step_view" ||
      event.type === "order_submit_attempt",
    );
    const order = sorted.find((event) => event.type === "order_created");
    const searched = sorted.some((event) => event.type === "search_used");
    const productViewed = sorted.some((event) => event.type === "product_view");
    const cartTouched = sorted.some((event) =>
      event.type === "cart_state" ||
      event.type === "cart_add" ||
      event.type === "cart_remove" ||
      event.type === "cart_quantity_change",
    );
    if (checkout) sessionsWithCheckout += 1;
    if (order) sessionsWithOrder += 1;
    if (searched) sessionsWithSearch += 1;
    if (productViewed) sessionsWithProductView += 1;
    if (cartTouched) sessionsWithCart += 1;
    if (checkout && !order) abandonedCheckoutSessions += 1;

    const engagement = sorted
      .filter((event) => event.type === "page_exit")
      .reduce((sum, event) => sum + (event.context.engagementMs ?? 0), 0);
    if (engagement > 0) engagementSeconds.push(engagement / 1000);

    if (order) {
      const firstOpen = sorted.find((event) => event.type === "app_open");
      if (firstOpen && order.occurredAtMs >= firstOpen.occurredAtMs) {
        openToOrderMinutes.push((order.occurredAtMs - firstOpen.occurredAtMs) / 60_000);
      }
    }
  }

  const sessions = bySession.size;
  const medianMinutes = median(openToOrderMinutes);
  const medianEngagement = median(engagementSeconds);

  return {
    schemaVersion: 1,
    mode: "behavior_summary_read_only",
    period: { startMs: params.startMs, endMs: params.endMs },
    truncated: index.truncated,
    events: events.length,
    sessions,
    sessionsWithCheckout,
    sessionsWithOrder,
    sessionsWithoutOrder: Math.max(sessions - sessionsWithOrder, 0),
    sessionsWithSearch,
    sessionsWithProductView,
    sessionsWithCart,
    abandonedCheckoutSessions,
    checkoutToOrderRate: ratio(sessionsWithOrder, sessionsWithCheckout),
    sessionToOrderRate: ratio(sessionsWithOrder, sessions),
    medianMinutesFirstOpenToOrder: medianMinutes === null ? null : Math.round(medianMinutes * 10) / 10,
    medianEngagementSeconds: medianEngagement === null ? null : Math.round(medianEngagement * 10) / 10,
    byType,
  };
}
