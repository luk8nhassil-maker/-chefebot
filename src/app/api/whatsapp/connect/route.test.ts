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

vi.mock("@/lib/conexaoWhatsapp", () => ({
  salvarStatusConexao: vi.fn(async () => {}),
}));

vi.stubGlobal("fetch", vi.fn());

import { POST } from "./route";

function requestComCookie(token?: string) {
  const init: { method: string; headers: Record<string, string> } = {
    method: "POST",
    headers: token ? { cookie: `auth-token=${token}` } : {},
  };
  return new NextRequest("http://localhost/api/whatsapp/connect", init);
}

beforeEach(() => {
  vi.mocked(fetch).mockReset();
  redisStore.clear();
  process.env.EVOLUTION_API_URL = "https://evolution.teste.com.br";
  process.env.EVOLUTION_API_KEY = "chave-de-teste";
  delete process.env.EVOLUTION_WEBHOOK_URL;
});

describe("POST /api/whatsapp/connect — acao padrao do painel (sem delete)", () => {
  test("sem cookie retorna 401", async () => {
    const res = await POST(requestComCookie(undefined));
    expect(res.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("atendente retorna 403", async () => {
    const res = await POST(requestComCookie("token-atendente"));
    expect(res.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("ja conectado: retorna connected sem nenhuma outra chamada", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ instance: { state: "open" } }) } as Response);
    const res = await POST(requestComCookie("token-admin"));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.estado).toBe("connected");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("instancia ausente: cria, configura webhook (se houver) e conecta — nunca chama delete/logout", async () => {
    process.env.EVOLUTION_WEBHOOK_URL = "https://chefebot-pjif.vercel.app/api/whatsapp";
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ status: 404, message: ["not found"] }) } as Response) // verify
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ instance: {} }) } as Response) // create
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response) // webhook
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ base64: "data:image/png;base64,QR" }) } as Response); // connect

    const res = await POST(requestComCookie("token-admin"));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.qrcode.base64).toContain("QR");
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(vi.mocked(fetch).mock.calls[2][0]).toContain("/webhook/set/");
    expect(vi.mocked(fetch).mock.calls.some(c => String(c[0]).includes("/instance/delete/"))).toBe(false);
    expect(vi.mocked(fetch).mock.calls.some(c => String(c[0]).includes("/instance/logout/"))).toBe(false);
  });

  test("provider_down no verify retorna 502 sem tentar create/connect", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ status: "error", code: 404, message: "Application not found", request_id: "xyz" }),
    } as Response);

    const res = await POST(requestComCookie("token-admin"));
    const data = await res.json();
    expect(res.status).toBe(502);
    expect(data.estado).toBe("provider_down");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("provider nao configurado retorna 503, nunca chama fetch", async () => {
    delete process.env.EVOLUTION_API_URL;
    delete process.env.EVOLUTION_API_KEY;
    const res = await POST(requestComCookie("token-admin"));
    const data = await res.json();
    expect(res.status).toBe(503);
    expect(data.estado).toBe("provider_not_configured");
    expect(fetch).not.toHaveBeenCalled();
  });
});
