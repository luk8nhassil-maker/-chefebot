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

vi.mock("@/lib/conexaoWhatsapp", () => ({
  salvarStatusConexao: vi.fn(async () => {}),
}));

const { qrStore, redisMock } = vi.hoisted(() => {
  const qrStore = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => (qrStore.has(key) ? qrStore.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown) => { qrStore.set(key, value); return "OK"; }),
    del: vi.fn(async (key: string) => (qrStore.delete(key) ? 1 : 0)),
  };
  return { qrStore, redisMock };
});
vi.mock("@/lib/redis", () => ({ redis: redisMock }));

vi.stubGlobal("fetch", vi.fn());

import { GET } from "./route";
import { salvarStatusConexao } from "@/lib/conexaoWhatsapp";
import { persistirQrAtual } from "@/lib/whatsappQrCache";

function requestComCookie(token?: string) {
  const init = token ? { headers: { cookie: `auth-token=${token}` } } : undefined;
  return new NextRequest("http://localhost/api/whatsapp/state", init);
}

beforeEach(() => {
  vi.mocked(fetch).mockReset();
  qrStore.clear();
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

  test("GET nunca altera estado: nao chama salvarStatusConexao, mesmo com a instancia conectada", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ instance: { state: "open" } }),
    } as Response);

    await GET(requestComCookie("token-admin"));
    expect(salvarStatusConexao).not.toHaveBeenCalled();
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

describe("GET /api/whatsapp/state — QR em cache (nunca chama /instance/connect)", () => {
  test("sem QR em cache: qr.disponivel false, uma unica chamada (connectionState)", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ instance: { state: "connecting" } }),
    } as Response);

    const res = await GET(requestComCookie("token-admin"));
    const data = await res.json();
    expect(data.qr).toEqual({ disponivel: false });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain("/instance/connectionState/");
  });

  test("com QR em cache: devolve base64/generatedAt/expiresAt/generationId, sem tocar a Evolution para isso", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ instance: { state: "connecting" } }),
    } as Response);

    const registro = await persistirQrAtual("chefebot", "data:image/png;base64,QRCACHE");

    const res = await GET(requestComCookie("token-admin"));
    const data = await res.json();
    expect(data.qr.disponivel).toBe(true);
    expect(data.qr.base64).toBe("data:image/png;base64,QRCACHE");
    expect(data.qr.generationId).toBe(registro.generationId);
    expect(data.qr.expiresAt).toBe(registro.expiresAt);
    // Continua sendo só leitura: nenhuma chamada extra além de connectionState.
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/whatsapp/state — provider nao configurado", () => {
  test("sem EVOLUTION_API_URL/EVOLUTION_API_KEY retorna estado provider_not_configured, nunca chama fetch", async () => {
    delete process.env.EVOLUTION_API_URL;
    delete process.env.EVOLUTION_API_KEY;
    const res = await GET(requestComCookie("token-admin"));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.estado).toBe("provider_not_configured");
    expect(fetch).not.toHaveBeenCalled();
  });
});
