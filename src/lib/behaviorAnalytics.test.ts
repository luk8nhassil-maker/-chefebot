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
      const lo = Number(min);
      const hi = Number(max);
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
