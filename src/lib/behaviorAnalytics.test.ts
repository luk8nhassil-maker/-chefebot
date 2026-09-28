import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { store, zsets, hashes, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const zsets = new Map<string, Map<string, number>>();
  const hashes = new Map<string, Map<string, number>>();

  const redisMock = {
    get: vi.fn(async (key: string) => store.has(key) ? store.get(key) : null),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    zadd: vi.fn(async (key: string, entry: { score: number; member: string } | Array<{ score: number; member: string }>) => {
      const map = zsets.get(key) ?? new Map<string, number>();
      const entries = Array.isArray(entry) ? entry : [entry];
      for (const item of entries) map.set(item.member, item.score);
      zsets.set(key, map);
      return entries.length;
    }),
    zrange: vi.fn(async (key: string, min: number | string, max: number | string) => {
      const lo = min === "-inf" ? Number.NEGATIVE_INFINITY : Number(min);
      const hi = max === "+inf" ? Number.POSITIVE_INFINITY : Number(max);
      return [...(zsets.get(key)?.entries() ?? [])]
        .filter(([, score]) => score >= lo && score <= hi)
        .sort((a, b) => a[1] - b[1])
        .map(([member]) => member);
    }),
    hincrby: vi.fn(async (key: string, field: string, amount: number) => {
      const map = hashes.get(key) ?? new Map<string, number>();
      const next = (map.get(field) ?? 0) + amount;
      map.set(field, next);
      hashes.set(key, map);
      return next;
    }),
    incr: vi.fn(async (key: string) => {
      const current = Number(store.get(key) ?? 0);
      const next = current + 1;
      store.set(key, next);
      return next;
    }),
    expire: vi.fn(async () => 1),
  };

  return { store, zsets, hashes, redisMock };
});

vi.mock("./redis", () => ({ redis: redisMock }));

import {
  behaviorAnalyticsConfig,
  behaviorAnalyticsEnabled,
  deriveBehaviorCustomerRef,
  publicBehaviorEventValid,
  readBehaviorCustomerTimeline,
  readBehaviorFunnelOverview,
  readBehaviorSessionEvents,
  recordOrderCreatedBehaviorFact,
  recordPublicBehaviorEvent,
} from "./behaviorAnalytics";

const SESSION = "11111111-1111-4111-8111-111111111111";
const EVENT = "22222222-2222-4222-8222-222222222222";
const EVENT2 = "33333333-3333-4333-8333-333333333333";
const SECRET = "segredo-comportamental-de-teste-1234567890";

beforeEach(() => {
  store.clear();
  zsets.clear();
  hashes.clear();
  vi.clearAllMocks();
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("BEHAVIOR_ANALYTICS_ENABLED", "true");
  vi.stubEnv("BEHAVIOR_ANALYTICS_HMAC_SECRET", SECRET);
  vi.stubEnv("BEHAVIOR_ANALYTICS_RETENTION_DAYS", "123");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("configuração do Customer 360 comportamental", () => {
  test("fica desligado sem flag, segredo ou retenção explícita", () => {
    vi.stubEnv("BEHAVIOR_ANALYTICS_ENABLED", "");
    expect(behaviorAnalyticsEnabled()).toBe(false);

    vi.stubEnv("BEHAVIOR_ANALYTICS_ENABLED", "true");
    vi.stubEnv("BEHAVIOR_ANALYTICS_HMAC_SECRET", "curto");
    expect(behaviorAnalyticsEnabled()).toBe(false);

    vi.stubEnv("BEHAVIOR_ANALYTICS_HMAC_SECRET", SECRET);
    vi.stubEnv("BEHAVIOR_ANALYTICS_RETENTION_DAYS", "");
    expect(behaviorAnalyticsEnabled()).toBe(false);
  });

  test("Preview Vercel nunca grava mesmo com flags presentes", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(behaviorAnalyticsConfig()).toBeNull();
  });

  test("config válida exige retenção explícita e não inventa prazo", () => {
    expect(behaviorAnalyticsConfig()).toMatchObject({
      retentionDays: 123,
      retentionSeconds: 123 * 24 * 60 * 60,
    });
  });
});

describe("evento público comportamental", () => {
  test("allowlist nunca aceita fato financeiro do navegador", () => {
    expect(publicBehaviorEventValid("app_open")).toBe(true);
    expect(publicBehaviorEventValid("cart_add")).toBe(true);
    expect(publicBehaviorEventValid("order_created")).toBe(false);
    expect(publicBehaviorEventValid("pix_paid")).toBe(false);
  });

  test("registra sessão anônima sem PII extra e com campos permitidos", async () => {
    const result = await recordPublicBehaviorEvent({
      eventId: EVENT,
      sessionId: SESSION,
      type: "search_used",
      data: {
        page: "cardapio",
        queryLength: 8,
        resultCount: 3,
        category: "pizza",
        telefone: "5599974000691",
        nome: "Maria",
        query: "meu telefone 5599974000691",
      },
      nowMs: 1_780_000_000_000,
    });

    expect(result).toEqual({
      recorded: true,
      duplicate: false,
      customerLinked: false,
    });

    const saved = [...store.entries()].find(([key]) => key.includes("behavior:event:"))?.[1] as {
      actor: string;
      data: Record<string, unknown>;
    };
    expect(saved.actor).toBe("anonymous");
    expect(saved.data).toEqual({
      page: "cardapio",
      queryLength: 8,
      resultCount: 3,
      category: "pizza",
    });
    expect(JSON.stringify(saved)).not.toContain("5599974000691");
    expect(JSON.stringify(saved)).not.toContain("Maria");
    expect(JSON.stringify(saved)).not.toContain("meu telefone");
  });

  test("cliente autenticado recebe customerRef HMAC, nunca clienteId bruto", async () => {
    const result = await recordPublicBehaviorEvent({
      eventId: EVENT,
      sessionId: SESSION,
      type: "page_view",
      data: { page: "cliente" },
      clienteId: "cli_5599974000691",
      nowMs: 1_780_000_000_000,
    });

    expect(result.recorded).toBe(true);
    expect(result.customerLinked).toBe(true);
    const ref = deriveBehaviorCustomerRef("cli_5599974000691", SECRET);
    expect(ref).toMatch(/^bc_[a-f0-9]{32}$/);

    const serialized = JSON.stringify([...store.values()]);
    expect(serialized).toContain(ref!);
    expect(serialized).not.toContain("cli_5599974000691");
    expect(serialized).not.toContain("5599974000691");
  });

  test("sessão já vinculada a outro cliente falha fechada sem misturar históricos", async () => {
    await recordPublicBehaviorEvent({
      eventId: EVENT,
      sessionId: SESSION,
      type: "page_view",
      data: { page: "cliente" },
      clienteId: "cli_a",
      nowMs: 1_780_000_000_000,
    });

    const result = await recordPublicBehaviorEvent({
      eventId: EVENT2,
      sessionId: SESSION,
      type: "page_view",
      data: { page: "cliente" },
      clienteId: "cli_b",
      nowMs: 1_780_000_000_100,
    });

    expect(result).toEqual({
      recorded: false,
      duplicate: false,
      customerLinked: false,
      reason: "session_owner_conflict",
    });
  });

  test("eventId repetido é idempotente", async () => {
    const input = {
      eventId: EVENT,
      sessionId: SESSION,
      type: "app_open" as const,
      data: { page: "cardapio" },
      nowMs: 1_780_000_000_000,
    };
    expect((await recordPublicBehaviorEvent(input)).recorded).toBe(true);
    expect(await recordPublicBehaviorEvent(input)).toEqual({
      recorded: false,
      duplicate: true,
      customerLinked: false,
    });
    expect(hashes.get("behavior:counter:default:20260528")?.get("app_open")).toBe(1);
  });

  test("histórico da sessão devolve inclusive eventos anônimos anteriores ao login", async () => {
    await recordPublicBehaviorEvent({
      eventId: EVENT,
      sessionId: SESSION,
      type: "app_open",
      data: { page: "cardapio" },
      nowMs: 1_780_000_000_000,
    });
    await recordPublicBehaviorEvent({
      eventId: EVENT2,
      sessionId: SESSION,
      type: "page_view",
      data: { page: "cliente" },
      clienteId: "cli_a",
      nowMs: 1_780_000_000_100,
    });

    const events = await readBehaviorSessionEvents({
      sessionId: SESSION,
      startMs: 1_779_999_999_000,
      endMs: 1_780_000_001_000,
    });

    expect(events).toHaveLength(2);
    expect(events[0].actor).toBe("anonymous");
    expect(events[1].actor).toBe("authenticated");
  });
});

describe("linha do tempo individual", () => {
  test("vincula ao cliente a sessão inteira, inclusive eventos anteriores à identificação", async () => {
    await recordPublicBehaviorEvent({
      eventId: EVENT,
      sessionId: SESSION,
      type: "app_open",
      data: { page: "cardapio" },
      nowMs: 1_780_000_000_000,
    });
    await recordPublicBehaviorEvent({
      eventId: EVENT2,
      sessionId: SESSION,
      type: "product_open",
      data: { page: "cardapio", itemKind: "simple", itemRef: "bebida_2l" },
      nowMs: 1_780_000_001_000,
    });
    await recordOrderCreatedBehaviorFact({
      pedidoId: "pedido-vinculo",
      sessionId: SESSION,
      clienteId: "cli_a",
      totalCents: 6000,
      itemCount: 2,
      deliveryType: "delivery",
      payment: "Pix",
      nowMs: 1_780_000_002_000,
    });

    const timeline = await readBehaviorCustomerTimeline({
      clienteId: "cli_a",
      startMs: 1_779_999_999_000,
      endMs: 1_780_000_003_000,
    });

    expect(timeline?.totalSessions).toBe(1);
    expect(timeline?.convertedSessions).toBe(1);
    expect(timeline?.sessions[0]?.events.map((event) => event.type)).toEqual([
      "app_open",
      "product_open",
      "order_created",
    ]);
    expect(timeline?.sessions[0]?.events[0]?.actor).toBe("anonymous");
    expect(timeline?.sessions[0]?.events[2]?.actor).toBe("authenticated");

    const serialized = JSON.stringify(timeline);
    expect(serialized).not.toContain("cli_a");
    expect(serialized).not.toContain("pedido-vinculo");
  });
});

describe("overview do funil por sessão", () => {
  test("separa visitas, carrinho, checkout e conversão sem contar eventos duplicados", async () => {
    const sessionA = SESSION;
    const sessionB = "44444444-4444-4444-8444-444444444444";
    const sessionC = "55555555-5555-4555-8555-555555555555";

    await recordPublicBehaviorEvent({
      eventId: EVENT,
      sessionId: sessionA,
      type: "app_open",
      data: { page: "cardapio" },
      nowMs: 1_780_000_000_000,
    });
    await recordPublicBehaviorEvent({
      eventId: EVENT2,
      sessionId: sessionA,
      type: "cart_add",
      data: { page: "cardapio", cartItems: 1, cartDistinctItems: 1 },
      nowMs: 1_780_000_000_100,
    });
    await recordPublicBehaviorEvent({
      eventId: "66666666-6666-4666-8666-666666666666",
      sessionId: sessionA,
      type: "funnel_step",
      data: { page: "cardapio", step: "pagamento" },
      nowMs: 1_780_000_000_200,
    });
    await recordOrderCreatedBehaviorFact({
      pedidoId: "pedido-a",
      sessionId: sessionA,
      clienteId: "cli_a",
      totalCents: 5000,
      itemCount: 1,
      deliveryType: "retirada",
      payment: "Pix",
      nowMs: 1_780_000_000_300,
    });

    await recordPublicBehaviorEvent({
      eventId: "77777777-7777-4777-8777-777777777777",
      sessionId: sessionB,
      type: "app_open",
      data: { page: "cardapio" },
      nowMs: 1_780_000_001_000,
    });
    await recordPublicBehaviorEvent({
      eventId: "88888888-8888-4888-8888-888888888888",
      sessionId: sessionB,
      type: "cart_add",
      data: { page: "cardapio", cartItems: 2, cartDistinctItems: 1 },
      nowMs: 1_780_000_001_100,
    });

    await recordPublicBehaviorEvent({
      eventId: "99999999-9999-4999-8999-999999999999",
      sessionId: sessionC,
      type: "app_open",
      data: { page: "cardapio" },
      nowMs: 1_780_000_002_000,
    });
    await recordPublicBehaviorEvent({
      eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      sessionId: sessionC,
      type: "funnel_step",
      data: { page: "cardapio", step: "entrega" },
      nowMs: 1_780_000_002_100,
    });
    await recordPublicBehaviorEvent({
      eventId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      sessionId: sessionC,
      type: "checkout_exit_observed",
      data: { page: "cardapio", step: "entrega" },
      nowMs: 1_780_000_002_200,
    });

    const overview = await readBehaviorFunnelOverview({
      startMs: 1_779_999_999_000,
      endMs: 1_780_000_003_000,
    });

    expect(overview).toMatchObject({
      sessions: 3,
      sessionsWithCart: 2,
      sessionsReachedCheckout: 2,
      sessionsWithCheckoutExitObserved: 1,
      convertedSessions: 1,
      sessionsWithoutOrder: 2,
      cartSessionsWithoutOrder: 1,
      checkoutSessionsWithoutOrder: 1,
      conversionRatePct: 33.33,
    });
    expect(overview?.identifiedCustomers).toBe(1);
    expect(overview?.identifiedCustomerSessions).toBe(1);
  });
});

describe("fato server-side de pedido", () => {
  test("pedido criado é idempotente, pseudonimizado e financeiro vem do servidor", async () => {
    const first = await recordOrderCreatedBehaviorFact({
      pedidoId: "pedido-real-123",
      sessionId: SESSION,
      clienteId: "cli_a",
      totalCents: 8750,
      itemCount: 3,
      deliveryType: "delivery",
      payment: "Pix + Dinheiro",
      nowMs: 1_780_000_000_000,
    });
    const second = await recordOrderCreatedBehaviorFact({
      pedidoId: "pedido-real-123",
      sessionId: SESSION,
      clienteId: "cli_a",
      totalCents: 8750,
      itemCount: 3,
      deliveryType: "delivery",
      payment: "Pix + Dinheiro",
      nowMs: 1_780_000_000_100,
    });

    expect(first.recorded).toBe(true);
    expect(second.duplicate).toBe(true);

    const event = [...store.values()].find((value) =>
      typeof value === "object" && value !== null && (value as { type?: string }).type === "order_created"
    ) as { authority: string; data: Record<string, unknown> };

    expect(event.authority).toBe("server_fact");
    expect(event.data.orderTotalCents).toBe(8750);
    expect(event.data.orderItemCount).toBe(3);
    expect(event.data.paymentMethod).toBe("misto");

    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("pedido-real-123");
    expect(serialized).not.toContain("cli_a");
  });
});
