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

vi.stubGlobal("fetch", vi.fn());

import { POST } from "./route";

function requestComCookie(token?: string) {
  const init: { method: string; headers: Record<string, string> } = {
    method: "POST",
    headers: token ? { cookie: `auth-token=${token}` } : {},
  };
  return new NextRequest("http://localhost/api/whatsapp/reset", init);
}

beforeEach(() => {
  vi.mocked(fetch).mockReset();
  process.env.EVOLUTION_API_URL = "https://evolution.teste.com.br";
  process.env.EVOLUTION_API_KEY = "chave-de-teste";
});

describe("POST /api/whatsapp/reset — autenticacao e papeis", () => {
  test("sem cookie retorna 401 e nunca chama a Evolution API", async () => {
    const res = await POST(requestComCookie(undefined));
    expect(res.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("cookie invalido retorna 401", async () => {
    const res = await POST(requestComCookie("token-invalido"));
    expect(res.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("atendente autenticado NAO pode resetar a instancia (403), nunca chama a Evolution API", async () => {
    const res = await POST(requestComCookie("token-atendente"));
    expect(res.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("POST /api/whatsapp/reset — provider nao configurado", () => {
  test("sem EVOLUTION_API_URL/EVOLUTION_API_KEY retorna 503, nunca chama fetch", async () => {
    delete process.env.EVOLUTION_API_URL;
    delete process.env.EVOLUTION_API_KEY;
    const res = await POST(requestComCookie("token-admin"));
    const data = await res.json();
    expect(res.status).toBe(503);
    expect(data.ok).toBe(false);
    expect(data.estado).toBe("provider_not_configured");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("POST /api/whatsapp/reset — fluxo seguro, nunca apaga instancia conectada", () => {
  test("instancia ja conectada: retorna sucesso sem QR, uma unica chamada, nunca logout/delete", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ instance: { state: "open" } }),
    } as Response);

    const res = await POST(requestComCookie("token-admin"));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.estado).toBe("connected");
    expect(data.qrcode).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain("/instance/connectionState/");
    expect(vi.mocked(fetch).mock.calls.some(c => String(c[0]).includes("/instance/delete/"))).toBe(false);
    expect(vi.mocked(fetch).mock.calls.some(c => String(c[0]).includes("/instance/logout/"))).toBe(false);
  });

  test("instancia existe mas desconectada: reconecta direto, sem create, sem logout/delete", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ instance: { state: "close" } }) } as Response) // connectionState
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ base64: "data:image/png;base64,QR" }) } as Response); // connect

    const res = await POST(requestComCookie("token-admin"));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.estado).toBe("qr_required");
    expect(data.qrcode.base64).toContain("QR");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls.some(c => String(c[0]).includes("/instance/create"))).toBe(false);
    expect(vi.mocked(fetch).mock.calls.some(c => String(c[0]).includes("/instance/delete/"))).toBe(false);
    expect(vi.mocked(fetch).mock.calls.some(c => String(c[0]).includes("/instance/logout/"))).toBe(false);
  });

  test("instancia ausente: cria, configura webhook e conecta — nunca chama delete/logout", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ message: "not found" }) } as Response) // connectionState
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ instance: {} }) } as Response) // create
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response) // webhook
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ base64: "data:image/png;base64,NOVOQR" }) } as Response); // connect

    const res = await POST(requestComCookie("token-admin"));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.qrcode.base64).toContain("NOVOQR");
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(vi.mocked(fetch).mock.calls[1][0]).toContain("/instance/create");
    expect(vi.mocked(fetch).mock.calls[2][0]).toContain("/webhook/set/");
    expect(vi.mocked(fetch).mock.calls[3][0]).toContain("/instance/connect/");
    expect(vi.mocked(fetch).mock.calls.some(c => String(c[0]).includes("/instance/delete/"))).toBe(false);
    expect(vi.mocked(fetch).mock.calls.some(c => String(c[0]).includes("/instance/logout/"))).toBe(false);
  });

  test("dev autenticado tambem pode reconectar", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ instance: { state: "open" } }),
    } as Response);

    const res = await POST(requestComCookie("token-dev"));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
  });
});

describe("POST /api/whatsapp/reset — erro sanitizado, sem segredos", () => {
  test("falha ao criar instancia nunca expoe o corpo bruto da Evolution API", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ message: "not found" }) } as Response) // connectionState
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ message: "Internal error", stack: "linha-sensivel-do-servidor-interno" }),
      } as Response); // create falha

    const res = await POST(requestComCookie("token-admin"));
    const data = await res.json();
    const texto = JSON.stringify(data);

    expect(res.status).toBe(502);
    expect(data.ok).toBe(false);
    expect(texto).not.toContain("linha-sensivel-do-servidor-interno");
  });

  test("credencial invalida na verificacao retorna 502 sanitizado, nunca tenta criar/apagar", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ message: "Unauthorized" }) } as Response);

    const res = await POST(requestComCookie("token-admin"));
    const data = await res.json();

    expect(res.status).toBe(502);
    expect(data.ok).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("QR nao gerado apos connect retorna 502", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ instance: { state: "close" } }) } as Response) // connectionState
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response); // connect sem QR

    const res = await POST(requestComCookie("token-admin"));
    const data = await res.json();

    expect(res.status).toBe(502);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("QR code não gerado");
  });
});
