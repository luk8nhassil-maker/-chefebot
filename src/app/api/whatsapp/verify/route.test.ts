import { vi, describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const redisStore = new Map<string, unknown>();
vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => (redisStore.has(key) ? redisStore.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown) => { redisStore.set(key, value); return "OK"; }),
  },
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    verifyToken: vi.fn(async (token: string) => {
      if (token === "token-admin") return { username: "brito", name: "Admin", role: "admin" };
      if (token === "token-atendente") return { username: "kellyne", name: "Atendente", role: "atendente" };
      return null;
    }),
  };
});

vi.stubGlobal("fetch", vi.fn());

import { GET } from "./route";

function requestComCookie(token?: string) {
  const init = token ? { headers: { cookie: `auth-token=${token}` } } : undefined;
  return new NextRequest("http://localhost/api/whatsapp/verify", init);
}

beforeEach(() => {
  vi.mocked(fetch).mockReset();
  redisStore.clear();
  process.env.EVOLUTION_API_URL = "https://evolution.teste.com.br";
  process.env.EVOLUTION_API_KEY = "chave-de-teste";
});

describe("GET /api/whatsapp/verify — so le, nunca altera nada", () => {
  test("sem cookie retorna 401", async () => {
    const res = await GET(requestComCookie(undefined));
    expect(res.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("atendente retorna 403", async () => {
    const res = await GET(requestComCookie("token-atendente"));
    expect(res.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("conectado retorna estado connected e acao recomendada 'nenhuma acao'", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ instance: { state: "open" } }) } as Response);
    const res = await GET(requestComCookie("token-admin"));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.estado).toBe("connected");
    expect(data.acaoRecomendada).toMatch(/nenhuma ação/i);
    expect(fetch).toHaveBeenCalledTimes(1);
    // so GET connectionState — nunca create/connect/delete
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain("/instance/connectionState/");
  });

  test("host fora do ar nunca recomenda 'Resetar' como primeira acao", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ status: "error", code: 404, message: "Application not found", request_id: "abc" }),
    } as Response);
    const res = await GET(requestComCookie("token-admin"));
    const data = await res.json();
    expect(data.estado).toBe("provider_down");
    expect(data.acaoRecomendada.toLowerCase()).not.toContain("resetar");
    expect(JSON.stringify(data)).not.toContain("abc");
  });

  test("provider nao configurado nunca tenta o host antigo do Railway", async () => {
    delete process.env.EVOLUTION_API_URL;
    delete process.env.EVOLUTION_API_KEY;
    const res = await GET(requestComCookie("token-admin"));
    const data = await res.json();
    expect(data.estado).toBe("provider_not_configured");
    expect(fetch).not.toHaveBeenCalled();
  });

  test("registra ultimaVerificacao e falhasConsecutivas no retorno", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: "Unauthorized" }),
    } as Response);

    await GET(requestComCookie("token-admin"));
    const res2 = await GET(requestComCookie("token-admin"));
    const data2 = await res2.json();
    expect(data2.estado).toBe("provider_unauthorized");
    expect(data2.falhasConsecutivas).toBe(2);
    expect(data2.ultimaVerificacao).toBeTruthy();
  });
});
