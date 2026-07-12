import { vi, describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const redisStore = new Map<string, unknown>();
vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => (redisStore.has(key) ? redisStore.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown, opts?: { ex?: number }) => { redisStore.set(key, value); void opts; return "OK"; }),
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

import { POST } from "./route";
import { obterAuditoriaReconstrucoes } from "@/lib/whatsappAudit";

function requestComCookie(token: string | undefined, body: unknown) {
  const init: { method: string; headers: Record<string, string>; body: string } = {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { cookie: `auth-token=${token}` } : {}) },
    body: JSON.stringify(body),
  };
  return new NextRequest("http://localhost/api/whatsapp/rebuild", init);
}

const CORPO_VALIDO = { mode: "rebuild", confirmacao: "RECRIAR CHEFEBOT" };

function mockCicloCompleto() {
  vi.mocked(fetch)
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response) // logout
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response) // delete
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ instance: {} }) } as Response) // create
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response) // webhook
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ base64: "data:image/png;base64,REBUILD" }) } as Response); // connect
}

beforeEach(() => {
  vi.mocked(fetch).mockReset();
  redisStore.clear();
  process.env.EVOLUTION_API_URL = "https://evolution.teste.com.br";
  process.env.EVOLUTION_API_KEY = "chave-de-teste";
  process.env.EVOLUTION_WEBHOOK_URL = "https://chefebot-pjif.vercel.app/api/whatsapp";
});

describe("POST /api/whatsapp/rebuild — acao de emergencia, protegida", () => {
  test("sem cookie retorna 401", async () => {
    const res = await POST(requestComCookie(undefined, CORPO_VALIDO));
    expect(res.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("atendente NUNCA pode reconstruir (403), mesmo com confirmacao correta", async () => {
    const res = await POST(requestComCookie("token-atendente", CORPO_VALIDO));
    expect(res.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("admin sem mode=rebuild e rejeitado (400)", async () => {
    const res = await POST(requestComCookie("token-admin", { confirmacao: "RECRIAR CHEFEBOT" }));
    expect(res.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("admin com confirmacao errada e rejeitado (400), nunca chama a Evolution API", async () => {
    const res = await POST(requestComCookie("token-admin", { mode: "rebuild", confirmacao: "recriar chefebot" }));
    expect(res.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("admin com corpo valido e confirmacao exata reconstrói com sucesso", async () => {
    mockCicloCompleto();
    const res = await POST(requestComCookie("token-admin", CORPO_VALIDO));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.qrcode.base64).toContain("REBUILD");
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain("/instance/logout/");
    expect(vi.mocked(fetch).mock.calls[1][0]).toContain("/instance/delete/");
  });

  test("dev tambem pode reconstruir", async () => {
    mockCicloCompleto();
    const res = await POST(requestComCookie("token-dev", CORPO_VALIDO));
    expect(res.status).toBe(200);
  });

  test("rate limit: bloqueia na 3a tentativa dentro da janela", async () => {
    mockCicloCompleto();
    await POST(requestComCookie("token-admin", CORPO_VALIDO));
    mockCicloCompleto();
    await POST(requestComCookie("token-admin", CORPO_VALIDO));

    const antesDaTerceira = vi.mocked(fetch).mock.calls.length;
    const res3 = await POST(requestComCookie("token-admin", CORPO_VALIDO));
    expect(res3.status).toBe(429);
    // a 3a tentativa nao chama a Evolution API — nenhuma chamada nova
    expect(vi.mocked(fetch).mock.calls.length).toBe(antesDaTerceira);
  });

  test("host fora do ar (borda do Railway) detectado no delete NUNCA deixa passar pro create", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response) // logout
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ status: "error", code: 404, message: "Application not found", request_id: "abc" }),
      } as Response); // delete: host morto

    const res = await POST(requestComCookie("token-admin", CORPO_VALIDO));
    const data = await res.json();
    expect(res.status).toBe(502);
    expect(data.estado).toBe("provider_down");
    expect(data.step).toBe("delete");
    expect(fetch).toHaveBeenCalledTimes(2); // nunca chega no create
  });

  test("credencial invalida (401) no delete NUNCA deixa passar pro create", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response) // logout
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ message: "Unauthorized" }) } as Response); // delete: credencial invalida

    const res = await POST(requestComCookie("token-admin", CORPO_VALIDO));
    const data = await res.json();
    expect(res.status).toBe(502);
    expect(data.estado).toBe("provider_unauthorized");
    expect(data.step).toBe("delete");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("toda tentativa grava auditoria (sucesso e falha), nunca com segredo", async () => {
    mockCicloCompleto();
    await POST(requestComCookie("token-admin", CORPO_VALIDO));

    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response) // logout
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ message: "Unauthorized" }) } as Response); // delete falha
    await POST(requestComCookie("token-admin", CORPO_VALIDO));

    const auditoria = await obterAuditoriaReconstrucoes();
    expect(auditoria.length).toBe(2);
    expect(auditoria[0].resultado).toBe("falha");
    expect(auditoria[1].resultado).toBe("sucesso");
    expect(auditoria.every(a => a.usuario === "brito")).toBe(true);
    const texto = JSON.stringify(auditoria);
    expect(texto).not.toContain("chave-de-teste");
    expect(texto).not.toContain("REBUILD");
  });

  test("provider nao configurado retorna 503 e grava auditoria de falha, nunca chama fetch", async () => {
    delete process.env.EVOLUTION_API_URL;
    delete process.env.EVOLUTION_API_KEY;
    const res = await POST(requestComCookie("token-admin", CORPO_VALIDO));
    expect(res.status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
    const auditoria = await obterAuditoriaReconstrucoes();
    expect(auditoria[0].etapaFalha).toBe("config");
  });
});
