import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  return {
    store,
    redis: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: unknown) => { store.set(key, value); return "OK"; }),
      del: vi.fn(async (key: string) => store.delete(key) ? 1 : 0),
    },
  };
});

vi.mock("@/lib/redis", () => ({ redis: h.redis }));
vi.mock("@/lib/auth", () => ({
  verifyToken: vi.fn(async (token: string) => {
    if (token === "equipe") return { role: "atendente" };
    if (token === "financeiro") return { role: "financeiro" };
    return null;
  }),
}));

import { GET, POST } from "./route";

function req(method: "GET" | "POST", token?: string, body?: unknown): NextRequest {
  return new NextRequest("https://chefedapizza.com.br/api/bot-status", {
    method,
    headers: {
      ...(token ? { cookie: `auth-token=${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  h.store.clear();
  vi.clearAllMocks();
});

describe("/api/bot-status", () => {
  test("sem sessão ou com papel alheio não lê nem altera a pausa", async () => {
    expect((await GET(req("GET"))).status).toBe(401);
    expect((await POST(req("POST", undefined, { ativo: false }))).status).toBe(401);
    expect((await POST(req("POST", "financeiro", { ativo: false }))).status).toBe(401);
    expect(h.redis.set).not.toHaveBeenCalled();
  });

  test("equipe autorizada consulta e altera a pausa global", async () => {
    expect((await GET(req("GET", "equipe"))).status).toBe(200);
    const resposta = await POST(req("POST", "equipe", { ativo: false }));
    expect(resposta.status).toBe(200);
    expect(h.store.get("bot_ativo")).toBe(false);
    expect(await (await GET(req("GET", "equipe"))).json()).toEqual({ ativo: false });
  });
});
