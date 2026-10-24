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
      multi: vi.fn(() => {
        const commands: Array<() => void> = [];
        const transaction = {
          set: vi.fn((key: string, value: unknown) => {
            commands.push(() => { store.set(key, value); });
            return transaction;
          }),
          exec: vi.fn(async () => {
            for (const command of commands) command();
            return commands.map(() => "OK");
          }),
        };
        return transaction;
      }),
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

  test("equipe autorizada consulta e altera a pausa global com registro atômico", async () => {
    h.store.set("bot_ativo", true);
    expect((await GET(req("GET", "equipe"))).status).toBe(200);
    const resposta = await POST(req("POST", "equipe", { ativo: false, source: "painel_toggle" }));
    expect(resposta.status).toBe(200);
    expect(h.store.get("bot_ativo")).toBe(false);
    expect(h.store.get("bot_status:last_change")).toMatchObject({
      ativo: false, anteriorObservado: true, role: "atendente", source: "painel_toggle",
    });
    expect(h.redis.multi).toHaveBeenCalledOnce();
    expect(await (await GET(req("GET", "equipe"))).json()).toEqual({ ativo: false });
  });

  test("GET continua protegido; somente painel autorizado pode ler estado", async () => {
    expect((await GET(req("GET"))).status).toBe(401);
    expect((await GET(req("GET", "financeiro"))).status).toBe(401);
  });

  test("origem enviada pelo navegador é limitada ao conjunto permitido", async () => {
    const resposta = await POST(req("POST", "equipe", { ativo: false, source: "valor-malicioso" }));
    expect(resposta.status).toBe(200);
    expect(h.store.get("bot_status:last_change")).toMatchObject({ source: "api" });
  });

  test("sem boolean explícito não altera estado de cliente", async () => {
    const resposta = await POST(req("POST", "equipe", { phone: "5599999999999" }));
    expect(resposta.status).toBe(400);
    expect(h.redis.set).not.toHaveBeenCalled();
    expect(h.redis.del).not.toHaveBeenCalled();
  });

  test("pausa individual mantém a chave e TTL originais", async () => {
    const resposta = await POST(req("POST", "equipe", { phone: "5599999999999", ativo: false }));
    expect(resposta.status).toBe(200);
    expect(h.store.get("manual:5599999999999")).toBe(true);
    expect(h.redis.set).toHaveBeenCalledWith("manual:5599999999999", true, { ex: 3600 });
  });

  test("corpo malformado falha fechado sem escrita", async () => {
    const resposta = await POST(new NextRequest("https://chefedapizza.com.br/api/bot-status", {
      method: "POST",
      headers: { cookie: "auth-token=equipe", "Content-Type": "application/json" },
      body: "{invalido",
    }));
    expect(resposta.status).toBe(400);
    expect(h.redis.set).not.toHaveBeenCalled();
  });
});
