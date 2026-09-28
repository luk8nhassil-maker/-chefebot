import type { BehaviorEventType } from "./behaviorEvents";

export type BehaviorInsightEvent = {
  sessionId: string;
  type: BehaviorEventType;
  createdAtMs: number;
  authority: "client_observed" | "server_fact";
  data?: {
    page?: string;
    step?: string;
    orderTotalCents?: number;
  };
};

export type BehaviorJourneyDepth =
  | "exploracao"
  | "consideracao"
  | "carrinho"
  | "checkout"
  | "convertido";

export type BehaviorSessionInsight = {
  sessionId: string;
  startedAtMs: number;
  endedAtMs: number;
  durationSec: number;
  depth: BehaviorJourneyDepth;
  pageViews: number;
  searches: number;
  productOpens: number;
  cartAdds: number;
  cartRemoves: number;
  reachedCheckout: boolean;
  checkoutExitObserved: boolean;
  rankingOpens: number;
  cofreOpens: number;
  converted: boolean;
  orderTotalCents: number | null;
};

export type CustomerBehaviorFeatureVector = {
  schemaVersion: 1;
  sessions: number;
  activeDays: number;
  sessionsWithoutOrder: number;
  sessionsWithCartWithoutOrder: number;
  sessionsWithCheckoutWithoutOrder: number;
  convertedSessions: number;
  conversionRatePct: number;
  avgSessionDurationSec: number;
  searches: number;
  productOpens: number;
  cartAdds: number;
  cartRemoves: number;
  checkoutExitObserved: number;
  rankingOpens: number;
  cofreOpens: number;
  firstSeenAtMs: number | null;
  lastSeenAtMs: number | null;
  lastOrderAtMs: number | null;
  sessionsSinceLastOrder: number;
};

function groupBySession(events: BehaviorInsightEvent[]): Map<string, BehaviorInsightEvent[]> {
  const grouped = new Map<string, BehaviorInsightEvent[]>();
  for (const event of events) {
    if (
      !event ||
      typeof event.sessionId !== "string" ||
      !event.sessionId ||
      !Number.isFinite(event.createdAtMs)
    ) continue;
    const current = grouped.get(event.sessionId) ?? [];
    current.push(event);
    grouped.set(event.sessionId, current);
  }
  return grouped;
}

function deepestStage(events: BehaviorInsightEvent[]): BehaviorJourneyDepth {
  if (events.some((event) => event.type === "order_created" && event.authority === "server_fact")) {
    return "convertido";
  }
  if (
    events.some((event) =>
      event.type === "checkout_exit_observed" ||
      (event.type === "funnel_step" && (
        event.data?.step === "pagamento" ||
        event.data?.step === "entrega"
      )),
    )
  ) {
    return "checkout";
  }
  if (events.some((event) => event.type === "cart_add" || event.type === "cart_remove")) {
    return "carrinho";
  }
  if (events.some((event) => event.type === "product_open" || event.type === "search_used")) {
    return "consideracao";
  }
  return "exploracao";
}

export function buildBehaviorSessionInsights(
  events: BehaviorInsightEvent[],
): BehaviorSessionInsight[] {
  const result: BehaviorSessionInsight[] = [];

  for (const [sessionId, raw] of groupBySession(events).entries()) {
    const sorted = [...raw].sort((a, b) => a.createdAtMs - b.createdAtMs);
    if (sorted.length === 0) continue;

    const orderFacts = sorted.filter(
      (event) => event.type === "order_created" && event.authority === "server_fact",
    );
    const orderTotal = orderFacts.reduce((sum, event) => {
      const value = event.data?.orderTotalCents;
      return sum + (Number.isInteger(value) && (value as number) >= 0 ? (value as number) : 0);
    }, 0);

    const startedAtMs = sorted[0]!.createdAtMs;
    const endedAtMs = sorted[sorted.length - 1]!.createdAtMs;

    result.push({
      sessionId,
      startedAtMs,
      endedAtMs,
      durationSec: Math.max(0, Math.round((endedAtMs - startedAtMs) / 1000)),
      depth: deepestStage(sorted),
      pageViews: sorted.filter((event) => event.type === "page_view").length,
      searches: sorted.filter((event) => event.type === "search_used").length,
      productOpens: sorted.filter((event) => event.type === "product_open").length,
      cartAdds: sorted.filter((event) => event.type === "cart_add").length,
      cartRemoves: sorted.filter((event) => event.type === "cart_remove").length,
      reachedCheckout: sorted.some((event) =>
        event.type === "checkout_exit_observed" ||
        (event.type === "funnel_step" && (
          event.data?.page === "pagamento" ||
          event.data?.page === "entrega"
        )),
      ),
      checkoutExitObserved: sorted.some((event) => event.type === "checkout_exit_observed"),
      rankingOpens: sorted.filter((event) => event.type === "ranking_open").length,
      cofreOpens: sorted.filter((event) => event.type === "cofre_open").length,
      converted: orderFacts.length > 0,
      orderTotalCents: orderFacts.length > 0 ? orderTotal : null,
    });
  }

  return result.sort((a, b) => a.startedAtMs - b.startedAtMs);
}

export function buildCustomerBehaviorFeatureVector(
  events: BehaviorInsightEvent[],
): CustomerBehaviorFeatureVector {
  const sessions = buildBehaviorSessionInsights(events);
  const converted = sessions.filter((session) => session.converted);
  const lastOrderAtMs = converted.length > 0
    ? Math.max(...converted.map((session) => session.endedAtMs))
    : null;

  const sessionsSinceLastOrder = lastOrderAtMs === null
    ? sessions.length
    : sessions.filter((session) => session.startedAtMs > lastOrderAtMs).length;

  const activeDays = new Set(
    events
      .filter((event) => Number.isFinite(event.createdAtMs))
      .map((event) => new Date(event.createdAtMs).toISOString().slice(0, 10)),
  ).size;

  const sum = <K extends keyof BehaviorSessionInsight>(key: K): number =>
    sessions.reduce((total, session) => {
      const value = session[key];
      return total + (typeof value === "number" ? value : 0);
    }, 0);

  return {
    schemaVersion: 1,
    sessions: sessions.length,
    activeDays,
    sessionsWithoutOrder: sessions.filter((session) => !session.converted).length,
    sessionsWithCartWithoutOrder: sessions.filter(
      (session) => !session.converted && session.cartAdds > 0,
    ).length,
    sessionsWithCheckoutWithoutOrder: sessions.filter(
      (session) => !session.converted && session.reachedCheckout,
    ).length,
    convertedSessions: converted.length,
    conversionRatePct:
      sessions.length > 0
        ? Math.round((converted.length / sessions.length) * 10_000) / 100
        : 0,
    avgSessionDurationSec:
      sessions.length > 0
        ? Math.round(sum("durationSec") / sessions.length)
        : 0,
    searches: sum("searches"),
    productOpens: sum("productOpens"),
    cartAdds: sum("cartAdds"),
    cartRemoves: sum("cartRemoves"),
    checkoutExitObserved: sessions.filter((session) => session.checkoutExitObserved).length,
    rankingOpens: sum("rankingOpens"),
    cofreOpens: sum("cofreOpens"),
    firstSeenAtMs: sessions[0]?.startedAtMs ?? null,
    lastSeenAtMs: sessions[sessions.length - 1]?.endedAtMs ?? null,
    lastOrderAtMs,
    sessionsSinceLastOrder,
  };
}
