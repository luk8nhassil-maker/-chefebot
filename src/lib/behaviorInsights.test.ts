import { describe, expect, test } from "vitest";
import {
  buildBehaviorSessionInsights,
  buildCustomerBehaviorFeatureVector,
  type BehaviorInsightEvent,
} from "./behaviorInsights";

const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const S3 = "33333333-3333-4333-8333-333333333333";

function ev(
  sessionId: string,
  type: BehaviorInsightEvent["type"],
  createdAtMs: number,
  data: BehaviorInsightEvent["data"] = {},
  authority: BehaviorInsightEvent["authority"] = "client_observed",
): BehaviorInsightEvent {
  return { sessionId, type, createdAtMs, data, authority };
}

describe("buildBehaviorSessionInsights", () => {
  test("reconstrói profundidade da jornada sem chamar clique de compra", () => {
    const events: BehaviorInsightEvent[] = [
      ev(S1, "app_open", 1000),
      ev(S1, "search_used", 2000),
      ev(S1, "product_open", 3000),
      ev(S1, "cart_add", 4000),
      ev(S1, "funnel_step", 5000, { step: "pagamento" }),
      ev(S1, "checkout_exit_observed", 6000, { step: "pagamento" }),
    ];

    const [session] = buildBehaviorSessionInsights(events);
    expect(session).toMatchObject({
      sessionId: S1,
      depth: "checkout",
      searches: 1,
      productOpens: 1,
      cartAdds: 1,
      reachedCheckout: true,
      checkoutExitObserved: true,
      converted: false,
      orderTotalCents: null,
    });
  });

  test("só server_fact transforma sessão em convertida", () => {
    const fakeClientOrder = ev(S1, "order_created", 2000, { orderTotalCents: 999999 }, "client_observed");
    const realServerOrder = ev(S2, "order_created", 3000, { orderTotalCents: 5500 }, "server_fact");

    const sessions = buildBehaviorSessionInsights([
      ev(S1, "app_open", 1000),
      fakeClientOrder,
      ev(S2, "app_open", 1500),
      realServerOrder,
    ]);

    expect(sessions.find((s) => s.sessionId === S1)?.converted).toBe(false);
    expect(sessions.find((s) => s.sessionId === S1)?.orderTotalCents).toBeNull();
    expect(sessions.find((s) => s.sessionId === S2)?.converted).toBe(true);
    expect(sessions.find((s) => s.sessionId === S2)?.orderTotalCents).toBe(5500);
  });
});

describe("buildCustomerBehaviorFeatureVector", () => {
  test("resume visitas sem pedido, checkout e sessões desde a última compra", () => {
    const day = 24 * 60 * 60 * 1000;
    const base = Date.parse("2026-09-01T12:00:00.000Z");
    const events: BehaviorInsightEvent[] = [
      ev(S1, "app_open", base),
      ev(S1, "product_open", base + 1000),
      ev(S1, "cart_add", base + 2000),
      ev(S1, "order_created", base + 3000, { orderTotalCents: 5000 }, "server_fact"),

      ev(S2, "app_open", base + day),
      ev(S2, "search_used", base + day + 1000),
      ev(S2, "cart_add", base + day + 2000),
      ev(S2, "funnel_step", base + day + 3000, { step: "entrega" }),
      ev(S2, "checkout_exit_observed", base + day + 4000, { step: "entrega" }),

      ev(S3, "app_open", base + 2 * day),
      ev(S3, "ranking_open", base + 2 * day + 1000),
    ];

    expect(buildCustomerBehaviorFeatureVector(events)).toMatchObject({
      sessions: 3,
      activeDays: 3,
      sessionsWithoutOrder: 2,
      sessionsWithCartWithoutOrder: 1,
      sessionsWithCheckoutWithoutOrder: 1,
      convertedSessions: 1,
      conversionRatePct: 33.33,
      searches: 1,
      productOpens: 1,
      cartAdds: 2,
      checkoutExitObserved: 1,
      rankingOpens: 1,
      sessionsSinceLastOrder: 2,
    });
  });

  test("sem eventos retorna vetor neutro, nunca inventa comportamento", () => {
    expect(buildCustomerBehaviorFeatureVector([])).toEqual({
      schemaVersion: 1,
      sessions: 0,
      activeDays: 0,
      sessionsWithoutOrder: 0,
      sessionsWithCartWithoutOrder: 0,
      sessionsWithCheckoutWithoutOrder: 0,
      convertedSessions: 0,
      conversionRatePct: 0,
      avgSessionDurationSec: 0,
      searches: 0,
      productOpens: 0,
      cartAdds: 0,
      cartRemoves: 0,
      checkoutExitObserved: 0,
      rankingOpens: 0,
      cofreOpens: 0,
      firstSeenAtMs: null,
      lastSeenAtMs: null,
      lastOrderAtMs: null,
      sessionsSinceLastOrder: 0,
    });
  });
});
