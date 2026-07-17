import { vi, describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    verifyToken: vi.fn(async (token: string) => {
      if (token === "token-admin") return { username: "brito", name: "Admin", role: "admin" };
      if (token === "token-dev") return { username: "ominix", name: "Dev", role: "dev" };
      if (token === "token-atendente") return { username: "kellyne", name: "Atendente", role: "atendente" };
      return null;
    }),
  };
});

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const ttls = new Map<string, number>();
  const redisMock = {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      if (opts?.ex) ttls.set(key, opts.ex);
      return "OK";
    }),
    eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
      if (keys.length === 1) {
        if (store.get(keys[0]) !== args[0]) return 0;
        store.delete(keys[0]);
        return 1;
      }
      const [activeKey, lastKey] = keys;
      const [expectedToken, expectedRevision, serialized, activeTtl, lastTtl] = args;
      const current = store.get(activeKey) as { token?: string; revision?: number } | undefined;
      if (!current || current.token !== expectedToken || (current.revision ?? 0) !== Number(expectedRevision)) return 0;
      const record = JSON.parse(serialized);
      store.set(activeKey, record);
      store.set(lastKey, record);
      ttls.set(activeKey, Number(activeTtl));
      ttls.set(lastKey, Number(lastTtl));
      return 1;
    }),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    ttl: vi.fn(async (key: string) => ttls.get(key) ?? -1),
  };
  return { store, redisMock };
});
vi.mock("@/lib/redis", () => ({ redis: redisMock }));
vi.mock("@/lib/logger", () => ({ log: vi.fn(async () => {}) }));

vi.stubGlobal("fetch", vi.fn());

import { GET, POST } from "./route";

const PHONE_AUTORIZADO = "5511900000000";

function req(token?: string, method: "GET" | "POST" = "GET") {
  const init: { headers?: Record<string, string>; method: string } = { method };
  if (token) init.headers = { cookie: `auth-token=${token}` };
  return new NextRequest("http://localhost/api/dev/whatsapp/canary", init);
}

beforeEach(() => {
  store.clear();
  vi.mocked(fetch).mockReset();
  vi.unstubAllEnvs();
  vi.stubEnv("EVOLUTION_API_URL", "https://evolution.exemplo.com");
  vi.stubEnv("EVOLUTION_API_KEY", "chave-teste");
  vi.stubEnv("WHATSAPP_CANARY_PHONE", PHONE_AUTORIZADO);
  vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);
});

describe("1. canário só aceita admin/dev", () => {
  test("POST sem cookie retorna 401", async () => {
    const res = await POST(req(undefined, "POST"));
    expect(res.status).toBe(401);
  });

  test("POST com role atendente retorna 403", async () => {
    const res = await POST(req("token-atendente", "POST"));
    expect(res.status).toBe(403);
  });

  test("GET sem cookie retorna 401", async () => {
    const res = await GET(req(undefined));
    expect(res.status).toBe(401);
  });

  test("POST admin autenticado é aceito", async () => {
    const res = await POST(req("token-admin", "POST"));
    expect(res.status).toBe(200);
  });

  test("POST dev autenticado é aceito", async () => {
    const res = await POST(req("token-dev", "POST"));
    expect(res.status).toBe(200);
  });
});

describe("3. sem env retorna erro seguro", () => {
  test("sem WHATSAPP_CANARY_PHONE, POST retorna 503 e nunca chama a Evolution", async () => {
    vi.stubEnv("WHATSAPP_CANARY_PHONE", "");
    const res = await POST(req("token-admin", "POST"));
    expect(res.status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("4. rate limit via API", () => {
  test("segunda chamada dentro de 5 minutos retorna 429", async () => {
    const primeiro = await POST(req("token-admin", "POST"));
    expect(primeiro.status).toBe(200);
    const segundo = await POST(req("token-admin", "POST"));
    expect(segundo.status).toBe(429);
  });

  test("mantém 429 enquanto o teste original está ativo mesmo sem a chave curta de rate limit", async () => {
    const primeiro = await POST(req("token-admin", "POST"));
    const primeiroBody = await primeiro.json();
    store.delete("whatsapp:canary:ratelimit");

    const segundo = await POST(req("token-admin", "POST"));
    const segundoBody = await segundo.json();

    expect(segundo.status).toBe(429);
    expect(segundoBody.retryAfterSeconds).toBeGreaterThan(0);
    expect((store.get("whatsapp:canary:active") as { token: string }).token).toBe(primeiroBody.canary.token);
    const sendTextCalls = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/message/sendText/"));
    expect(sendTextCalls).toHaveLength(1);
  });
});

describe("2. telefone vem apenas da env (nunca do body)", () => {
  test("POST ignora qualquer telefone no corpo da requisição", async () => {
    const request = new NextRequest("http://localhost/api/dev/whatsapp/canary", {
      method: "POST",
      headers: { cookie: "auth-token=token-admin", "content-type": "application/json" },
      body: JSON.stringify({ phone: "5511900000000" }),
    });
    await POST(request);
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(body.number).toBe(PHONE_AUTORIZADO);
  });
});

describe("GET — diagnóstico agregado", () => {
  test("admin autenticado recebe o diagnóstico completo", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ instance: { state: "open" } }),
    } as Response);
    const res = await GET(req("token-admin"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.providerConfigured).toBe(true);
    expect(data.canaryPhoneConfigured).toBe(true);
    expect(typeof data.botGlobalEnabled).toBe("boolean");
  });
});

describe("POST — evidências sanitizadas do provider", () => {
  test("devolve HTTP, tentativas e messageId mascarado sem corpo bruto", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ key: { id: "provider-message-123456" }, segredo: "nao-expor" }),
    } as Response);

    const res = await POST(req("token-admin", "POST"));
    const data = await res.json();

    expect(data.canary.outboundHttpStatus).toBe(201);
    expect(data.canary.outboundAttempts).toBe(1);
    expect(data.canary.outboundMessageIdMasked).toBe("...123456");
    expect(JSON.stringify(data)).not.toContain("nao-expor");
  });
});
