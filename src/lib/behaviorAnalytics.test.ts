import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const store = new Map<string, unknown>();
const zsets = new Map<string, Array<{ score: number; member: string }>>();
const expirations = new Map<string, number>();
let zaddCalls = 0;
let failOnZaddCall = -1;

vi.mock("./redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      if (opts?.ex) expirations.set(key, opts.ex);
      return "OK";
    }),
    zadd: vi.fn(async (key: string, value: { score: number; member: string }) => {
      zaddCalls += 1;
      if (zaddCalls === failOnZaddCall) throw new Error("falha simulada de índice");
      const arr = zsets.get(key) ?? [];
      zsets.set(key, [...arr.filter((x) => x.member !== value.member), value]);
      return 1;
    }),
    expire: vi.fn(async (key: string, seconds: number) => {
      expirations.set(key, seconds);
      return 1;
    }),
    incr: vi.fn(async (key: string) => {
      const atual = Number(store.get(key) ?? 0) + 1;
      store.set(key, atual);
      return atual;
    }),
  },
}));

import {
  behaviorAnalyticsEnabled,
  behaviorGlobalIndexKey,
  behaviorSessionIndexKey,
  pseudonimizarClienteId,
  criarVinculoCookieComportamento,
  validarVinculoCookieComportamento,
  consumirLimiteIngestaoComportamental,
  registrarEventosClienteComportamento,
  registrarEventoServidorComportamento,
  validarEventoClienteComportamento,
} from "./behaviorAnalytics";

const AGORA = Date.parse("2026-09-28T03:30:00.000Z");
const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  store.clear();
  zsets.clear();
  expirations.clear();
  zaddCalls = 0;
  failOnZaddCall = -1;
  vi.stubEnv("BEHAVIOR_ANALYTICS_ENABLED", "true");
  vi.stubEnv("BEHAVIOR_ANALYTICS_RETENTION_DAYS", "180");
  vi.stubEnv("BEHAVIOR_ANALYTICS_HASH_SECRET", "behavior-test-key-material-123456789");
  vi.stubEnv("VERCEL_ENV", "production");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("behaviorAnalyticsEnabled", () => {
  test("fica fechado com configuração incompleta", () => {
    vi.stubEnv("BEHAVIOR_ANALYTICS_ENABLED", "");
    expect(behaviorAnalyticsEnabled()).toBe(false);
  });

  test("Preview nunca escreve mesmo com flag ativa", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(behaviorAnalyticsEnabled()).toBe(false);
  });
});

describe("limite técnico de ingestão", () => {
  test("chave de rate limit também é pseudonimizada e recebe TTL curto", async () => {
    expect(await consumirLimiteIngestaoComportamental("203.0.113.10")).toBe(true);
    const chaves = [...store.keys()].filter((k) => k.startsWith("behavior:v1:rate:"));
    expect(chaves).toHaveLength(1);
    expect(chaves[0]).not.toContain("203.0.113.10");
    expect(expirations.get(chaves[0]!)).toBe(90);
  });
});

describe("resultado de ação", () => {
  test("exige categoria controlada e não persiste mensagem livre", () => {
    const base = { eventId: EVENT_ID, sessionId: SESSION_ID, type: "action_result", occurredAtMs: AGORA };
    expect(validarEventoClienteComportamento(base, AGORA)).toBeNull();
    const evento = validarEventoClienteComportamento({
      ...base,
      context: { action: "checkout_submit", outcome: "failure", failureCode: "network_error", error: "telefone 5544999999999" },
    }, AGORA);
    expect(evento?.context).toEqual({ action: "checkout_submit", outcome: "failure", failureCode: "network_error" });
  });
});
describe("validarEventoClienteComportamento", () => {
  test("aceita evento allowlist e descarta campos livres", () => {
    const evento = validarEventoClienteComportamento({
      eventId: EVENT_ID,
      sessionId: SESSION_ID,
      visitorId: "33333333-3333-4333-8333-333333333333",
      type: "screen_view",
      occurredAtMs: AGORA,
      context: {
        screen: "sc-cart",
        source: "cardapio",
        extraLivre: "nao_deve_persistir",
        productId: "pizza_calabresa",
        cartItems: 2,
        deviceClass: "mobile",
        viewportClass: "compact",
        displayMode: "standalone",
        referrerKind: "whatsapp_link",
        engagementMs: 12345,
      },
    }, AGORA);

    expect(evento).toEqual({
      eventId: EVENT_ID,
      sessionId: SESSION_ID,
      type: "screen_view",
      occurredAtMs: AGORA,
      context: {
        screen: "sc-cart",
        source: "cardapio",
        productId: "pizza_calabresa",
        cartItems: 2,
        deviceClass: "mobile",
        viewportClass: "compact",
        displayMode: "standalone",
        referrerKind: "whatsapp_link",
        engagementMs: 12345,
      },
    });
    expect(JSON.stringify(evento)).not.toContain("nao_deve_persistir");
    expect(JSON.stringify(evento)).not.toContain("visitorId");
  });

  test("descarta contexto técnico fora da allowlist ou duração impossível", () => {
    const evento = validarEventoClienteComportamento({
      eventId: EVENT_ID,
      sessionId: SESSION_ID,
      type: "page_exit",
      occurredAtMs: AGORA,
      context: {
        source: "cardapio",
        deviceClass: "smart_tv",
        viewportClass: "gigante",
        displayMode: "app_secreto",
        referrerKind: "campanha_x",
        engagementMs: 99 * 24 * 60 * 60 * 1000,
      },
    }, AGORA);

    expect(evento?.context).toEqual({ source: "cardapio" });
  });

  test("rejeita tipo e ids fora do contrato", () => {
    expect(validarEventoClienteComportamento({ eventId: "x", sessionId: SESSION_ID, type: "screen_view" }, AGORA)).toBeNull();
    expect(validarEventoClienteComportamento({ eventId: EVENT_ID, sessionId: "x", type: "screen_view" }, AGORA)).toBeNull();
    expect(validarEventoClienteComportamento({ eventId: EVENT_ID, sessionId: SESSION_ID, type: "evento_desconhecido" }, AGORA)).toBeNull();
  });
});

describe("persistência pseudonimizada", () => {
  test("não persiste clienteId cru e cria índices com TTL", async () => {
    const clienteIdCru = "cli_exemplo_12345";
    const hash = pseudonimizarClienteId(clienteIdCru);
    expect(hash).toMatch(/^[a-f0-9]{32}$/);
    expect(hash).not.toContain(clienteIdCru);

    const resultado = await registrarEventosClienteComportamento({
      clienteId: clienteIdCru,
      events: [{
        eventId: EVENT_ID,
        sessionId: SESSION_ID,
        type: "cart_state",
        occurredAtMs: AGORA,
        context: { source: "cardapio", cartItems: 3, cartDistinctItems: 2 },
      }],
      agoraMs: AGORA,
    });

    expect(resultado).toEqual({ accepted: 1, duplicated: 0 });
    const serializado = JSON.stringify([...store.entries()]);
    expect(serializado).not.toContain(clienteIdCru);
    expect(serializado).not.toContain("visitorHash");
    expect([...zsets.keys()].some((k) => k.startsWith("behavior:v1:visitor:"))).toBe(false);
    expect(serializado).toContain(hash!);
    expect([...zsets.keys()].some((k) => k.includes("behavior:v1:actor:default:" + hash))).toBe(true);
    expect([...expirations.values()].every((ttl) => ttl === 180 * 24 * 60 * 60)).toBe(true);
  });

  test("retry repara índice parcial sem sobrescrever o evento canônico", async () => {
    const params = {
      events: [{
        eventId: EVENT_ID,
        sessionId: SESSION_ID,
        type: "app_open" as const,
        occurredAtMs: AGORA,
        context: { source: "cardapio" as const },
      }],
      agoraMs: AGORA,
    };
    failOnZaddCall = 2;
    await expect(registrarEventosClienteComportamento(params)).rejects.toThrow("falha simulada de índice");
    expect(zsets.size).toBe(1);

    failOnZaddCall = -1;
    zaddCalls = 0;
    expect(await registrarEventosClienteComportamento(params)).toEqual({ accepted: 0, duplicated: 1 });
    expect(zsets.get(behaviorGlobalIndexKey("default", "20260928"))).toEqual([
      { score: AGORA, member: EVENT_ID },
    ]);
    expect(zsets.get(behaviorSessionIndexKey("default", SESSION_ID, "20260928"))).toEqual([
      { score: AGORA, member: EVENT_ID },
    ]);
    expect([...expirations.values()].every((ttl) => ttl === 180 * 24 * 60 * 60)).toBe(true);
  });

  test("eventId repetido é idempotente", async () => {
    const params = {
      events: [{
        eventId: EVENT_ID,
        sessionId: SESSION_ID,
        type: "app_open" as const,
        occurredAtMs: AGORA,
        context: { source: "cardapio" as const },
      }],
      agoraMs: AGORA,
    };
    expect(await registrarEventosClienteComportamento(params)).toEqual({ accepted: 1, duplicated: 0 });
    expect(await registrarEventosClienteComportamento(params)).toEqual({ accepted: 0, duplicated: 1 });
  });

  test("Preview retorna sem escrita", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const resultado = await registrarEventosClienteComportamento({
      events: [{ eventId: EVENT_ID, sessionId: SESSION_ID, type: "app_open" }],
      agoraMs: AGORA,
    });
    expect(resultado).toEqual({ accepted: 0, duplicated: 0 });
    expect(store.size).toBe(0);
  });
});

describe("vínculo pseudonimizado do WhatsApp", () => {
  test("cookie não contém clienteId e valida somente assinatura vigente", () => {
    const token = criarVinculoCookieComportamento("cli_5544999999999", AGORA)!;
    expect(token).not.toContain("5544999999999");
    expect(validarVinculoCookieComportamento(token, AGORA)).toBe(pseudonimizarClienteId("cli_5544999999999"));
    expect(validarVinculoCookieComportamento(token + "x", AGORA)).toBeNull();
    expect(validarVinculoCookieComportamento(token, AGORA + 31 * 24 * 60 * 60 * 1000)).toBeNull();
  });
});

describe("registrarEventoServidorComportamento", () => {
  test("associa conversão apenas ao pseudônimo validado fornecido pelo servidor", async () => {
    const actorHash = "a".repeat(32);
    expect(await registrarEventoServidorComportamento({
      actorHash,
      sessionId: SESSION_ID,
      type: "order_created",
      context: { source: "checkout", pedidoId: "pedido_123" },
      agoraMs: AGORA,
    })).toBe(true);
    const evento = [...store.entries()].find(([key]) => key.startsWith("behavior:v1:event:"))?.[1] as { actorHash?: string } | undefined;
    expect(evento?.actorHash).toBe(actorHash);
  });

  test("descarta pseudônimo malformado e não vincula telefone digitado", async () => {
    await registrarEventoServidorComportamento({
      actorHash: "5544999999999",
      sessionId: SESSION_ID,
      type: "order_created",
      agoraMs: AGORA,
    });
    const evento = [...store.entries()].find(([key]) => key.startsWith("behavior:v1:event:"))?.[1] as { actorHash?: string | null } | undefined;
    expect(evento?.actorHash).toBeNull();
  });
});
