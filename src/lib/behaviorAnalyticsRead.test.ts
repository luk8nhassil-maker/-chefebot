import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const store = new Map<string, unknown>();
const zsets = new Map<string, string[]>();

vi.mock("./redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    zrange: vi.fn(async (key: string) => zsets.get(key) ?? []),
  },
}));

import {
  behaviorActorIndexKey,
  behaviorDayBucket,
  behaviorEventKey,
  behaviorGlobalIndexKey,
  behaviorSessionIndexKey,
  pseudonimizarClienteId,
  type BehaviorEvent,
} from "./behaviorAnalytics";
import {
  consultarTimelineComportamentalCliente,
  resumirFunilComportamental,
  resumirTimelineComportamentalCliente,
} from "./behaviorAnalyticsRead";

const DAY = Date.parse("2026-09-28T00:00:00.000Z");
const END = DAY + 24 * 60 * 60 * 1000 - 1;
const TENANT = "default";
const CLIENTE = "cli_cliente_exemplo";
const SESSION = "22222222-2222-4222-8222-222222222222";

function put(event: BehaviorEvent) {
  store.set(behaviorEventKey(TENANT, event.eventId), event);
  const day = behaviorDayBucket(event.receivedAtMs);
  const globalKey = behaviorGlobalIndexKey(TENANT, day);
  zsets.set(globalKey, [...(zsets.get(globalKey) ?? []), event.eventId]);
  const sessionKey = behaviorSessionIndexKey(TENANT, event.sessionId, day);
  zsets.set(sessionKey, [...(zsets.get(sessionKey) ?? []), event.eventId]);
  if (event.actorHash) {
    const actorKey = behaviorActorIndexKey(TENANT, event.actorHash, day);
    zsets.set(actorKey, [...(zsets.get(actorKey) ?? []), event.eventId]);
  }
}

function ev(params: {
  id: string;
  type: BehaviorEvent["type"];
  offsetMin: number;
  actorHash?: string | null;
  sessionId?: string;
}): BehaviorEvent {
  return {
    schemaVersion: 1,
    eventId: params.id,
    tenantId: TENANT,
    sessionId: params.sessionId ?? SESSION,
    actorHash: params.actorHash ?? null,
    type: params.type,
    occurredAtMs: DAY + params.offsetMin * 60_000,
    receivedAtMs: DAY + params.offsetMin * 60_000,
    context: { source: params.type === "order_created" ? "checkout" : "cardapio" },
  };
}

beforeEach(() => {
  store.clear();
  zsets.clear();
  vi.stubEnv("BEHAVIOR_ANALYTICS_HASH_SECRET", "behavior-read-test-key-material-123456");
});

afterEach(() => vi.unstubAllEnvs());

describe("consultarTimelineComportamentalCliente", () => {
  test("recupera eventos anônimos anteriores quando a sessão foi ligada ao cliente depois", async () => {
    const actorHash = pseudonimizarClienteId(CLIENTE)!;
    put(ev({ id: "e-open", type: "app_open", offsetMin: 0 }));
    put(ev({ id: "e-cart", type: "cart_state", offsetMin: 5 }));
    put(ev({ id: "e-order", type: "order_created", offsetMin: 10, actorHash }));

    const result = await consultarTimelineComportamentalCliente({
      clienteId: CLIENTE,
      startMs: DAY,
      endMs: END,
    });

    expect(result.truncated).toBe(false);
    expect(result.events.map((event) => event.type)).toEqual([
      "order_created",
      "cart_state",
      "app_open",
    ]);
    expect(result.events.find((event) => event.type === "app_open")?.identificado).toBe(false);
    expect(result.events.find((event) => event.type === "order_created")?.identificado).toBe(true);
    expect(JSON.stringify(result.events)).not.toContain(actorHash);
    expect(JSON.stringify(result.events)).not.toContain(CLIENTE);
  });

  test("não mistura sessão de outro cliente", async () => {
    const actorHash = pseudonimizarClienteId(CLIENTE)!;
    put(ev({ id: "e-order", type: "order_created", offsetMin: 10, actorHash }));
    put(ev({
      id: "e-other",
      type: "app_open",
      offsetMin: 3,
      sessionId: "33333333-3333-4333-8333-333333333333",
    }));

    const result = await consultarTimelineComportamentalCliente({
      clienteId: CLIENTE,
      startMs: DAY,
      endMs: END,
    });

    expect(result.events.map((event) => event.type)).toEqual(["order_created"]);
  });
});

describe("resumirTimelineComportamentalCliente", () => {
  test("resume frequência, intenção e sessões sem expor identidade", () => {
    const events = [
      {
        eventId: "a1",
        sessionId: SESSION,
        type: "app_open" as const,
        occurredAtMs: DAY,
        receivedAtMs: DAY,
        context: { source: "cardapio" as const },
        identificado: false,
      },
      {
        eventId: "a2",
        sessionId: SESSION,
        type: "search_used" as const,
        occurredAtMs: DAY + 60_000,
        receivedAtMs: DAY + 60_000,
        context: { source: "cardapio" as const, queryLength: 5 },
        identificado: false,
      },
      {
        eventId: "a3",
        sessionId: SESSION,
        type: "checkout_start" as const,
        occurredAtMs: DAY + 2 * 60_000,
        receivedAtMs: DAY + 2 * 60_000,
        context: { source: "checkout" as const },
        identificado: false,
      },
      {
        eventId: "a4",
        sessionId: SESSION,
        type: "page_exit" as const,
        occurredAtMs: DAY + 3 * 60_000,
        receivedAtMs: DAY + 3 * 60_000,
        context: { source: "cardapio" as const, engagementMs: 90_000 },
        identificado: false,
      },
      {
        eventId: "b1",
        sessionId: "66666666-6666-4666-8666-666666666666",
        type: "app_open" as const,
        occurredAtMs: DAY + 2 * 24 * 60 * 60 * 1000,
        receivedAtMs: DAY + 2 * 24 * 60 * 60 * 1000,
        context: { source: "cardapio" as const },
        identificado: true,
      },
      {
        eventId: "b2",
        sessionId: "66666666-6666-4666-8666-666666666666",
        type: "order_created" as const,
        occurredAtMs: DAY + 2 * 24 * 60 * 60 * 1000 + 5 * 60_000,
        receivedAtMs: DAY + 2 * 24 * 60 * 60 * 1000 + 5 * 60_000,
        context: { source: "checkout" as const },
        identificado: true,
      },
      {
        eventId: "b3",
        sessionId: "66666666-6666-4666-8666-666666666666",
        type: "page_exit" as const,
        occurredAtMs: DAY + 2 * 24 * 60 * 60 * 1000 + 6 * 60_000,
        receivedAtMs: DAY + 2 * 24 * 60 * 60 * 1000 + 6 * 60_000,
        context: { source: "cardapio" as const, engagementMs: 150_000 },
        identificado: true,
      },
    ];

    const summary = resumirTimelineComportamentalCliente(events);

    expect(summary).toEqual(expect.objectContaining({
      sessions: 2,
      sessionsWithOrder: 1,
      sessionsWithoutOrder: 1,
      appOpens: 2,
      searches: 1,
      checkoutStarts: 1,
      totalEngagementSeconds: 240,
      medianEngagementSeconds: 120,
      medianDaysBetweenSessions: 2,
      firstSeenAtMs: DAY,
    }));
    expect(summary.lastSeenAtMs).toBeGreaterThan(DAY);
    expect(JSON.stringify(summary)).not.toContain("actor");
    expect(JSON.stringify(summary)).not.toContain("cliente");
  });
});

describe("resumirFunilComportamental", () => {
  test("mede busca, interesse, carrinho, abandono e tempo ativo por sessão", async () => {
    const sessionA = SESSION;
    put(ev({ id: "m1", type: "app_open", offsetMin: 0, sessionId: sessionA }));
    put(ev({ id: "m2", type: "search_used", offsetMin: 1, sessionId: sessionA }));
    put(ev({ id: "m3", type: "product_view", offsetMin: 2, sessionId: sessionA }));
    put(ev({ id: "m4", type: "cart_add", offsetMin: 3, sessionId: sessionA }));
    put(ev({ id: "m5", type: "checkout_start", offsetMin: 4, sessionId: sessionA }));
    const exitA = ev({ id: "m6", type: "page_exit", offsetMin: 10, sessionId: sessionA });
    exitA.context = { source: "cardapio", engagementMs: 120_000 };
    put(exitA);

    const sessionB = "55555555-5555-4555-8555-555555555555";
    put(ev({ id: "n1", type: "app_open", offsetMin: 0, sessionId: sessionB }));
    const exitB = ev({ id: "n2", type: "page_exit", offsetMin: 2, sessionId: sessionB });
    exitB.context = { source: "cardapio", engagementMs: 60_000 };
    put(exitB);

    const summary = await resumirFunilComportamental({
      startMs: DAY,
      endMs: END,
    });

    expect(summary.sessions).toBe(2);
    expect(summary.sessionsWithSearch).toBe(1);
    expect(summary.sessionsWithProductView).toBe(1);
    expect(summary.sessionsWithCart).toBe(1);
    expect(summary.sessionsWithCheckout).toBe(1);
    expect(summary.abandonedCheckoutSessions).toBe(1);
    expect(summary.sessionsWithOrder).toBe(0);
    expect(summary.medianEngagementSeconds).toBe(90);
  });

  test("mede sessões, checkout, compra e abandono sem identificar pessoas", async () => {
    const actorHash = pseudonimizarClienteId(CLIENTE)!;
    put(ev({ id: "a1", type: "app_open", offsetMin: 0 }));
    put(ev({ id: "a2", type: "checkout_start", offsetMin: 5 }));
    put(ev({ id: "a3", type: "order_created", offsetMin: 20, actorHash }));

    const sessionB = "44444444-4444-4444-8444-444444444444";
    put(ev({ id: "b1", type: "app_open", offsetMin: 1, sessionId: sessionB }));
    put(ev({ id: "b2", type: "checkout_start", offsetMin: 8, sessionId: sessionB }));

    const summary = await resumirFunilComportamental({
      startMs: DAY,
      endMs: END,
    });

    expect(summary.sessions).toBe(2);
    expect(summary.sessionsWithCheckout).toBe(2);
    expect(summary.sessionsWithOrder).toBe(1);
    expect(summary.sessionsWithoutOrder).toBe(1);
    expect(summary.checkoutToOrderRate).toBe(50);
    expect(summary.sessionToOrderRate).toBe(50);
    expect(summary.medianMinutesFirstOpenToOrder).toBe(20);
    expect(summary.byType).toEqual({
      app_open: 2,
      checkout_start: 2,
      order_created: 1,
    });
    expect(JSON.stringify(summary)).not.toContain(actorHash);
    expect(JSON.stringify(summary)).not.toContain(CLIENTE);
  });
});
