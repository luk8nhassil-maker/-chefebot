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
      if (token === "token-dev") return { username: "ominix", name: "Dev", role: "dev" };
      if (token === "token-atendente") return { username: "kellyne", name: "Atendente", role: "atendente" };
      return null;
    }),
  };
});

vi.mock("@/lib/conexaoWhatsapp", () => ({
  salvarStatusConexao: vi.fn(async () => {}),
}));

vi.stubGlobal("fetch", vi.fn());

import { GET } from "./route";

function requestComCookie(token?: string) {
  const init = token ? { headers: { cookie: `auth-token=${token}` } } : undefined;
  return new NextRequest("http://localhost/api/whatsapp/state", init);
}

beforeEach(() => {
  vi.mocked(fetch).mockReset();
  redisStore.clear();
  process.env.EVOLUTION_API_URL = "https://evolution.teste.com.br";
  process.env.EVOLUTION_API_KEY = "chave-de-teste";
});

describe("GET /api/whatsapp/state — autenticacao", () => {
  test("sem cookie retorna 401 e nunca chama a Evolution API", async () => {
    const res = await GET(requestComCookie(undefined));
    expect(res.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("cookie invalido retorna 401 (nao 403 — nao ha sessao valida)", async () => {
    const res = await GET(requestComCookie("token-invalido"));
    expect(res.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("atendente autenticado retorna 403", async () => {
    const res = await GET(requestComCookie("token-atendente"));
    expect(res.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("admin continua consultando o estado normalmente (tela legitima /admin e /setup preservada)", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ instance: { state: "open" } }),
    } as Response);

    const res = await GET(requestComCookie("token-admin"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.instance.state).toBe("open");
  });

  test("dev continua consultando o estado normalmente", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ instance: { state: "close" } }),
    } as Response);

    const res = await GET(requestComCookie("token-dev"));
    expect(res.status).toBe(200);
  });
});
