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

vi.stubGlobal("fetch", vi.fn());

import { GET } from "./route";

function requestComCookie(token?: string) {
  const init = token ? { headers: { cookie: `auth-token=${token}` } } : undefined;
  return new NextRequest("http://localhost/api/whatsapp/qrcode", init);
}

beforeEach(() => {
  vi.mocked(fetch).mockReset();
  process.env.EVOLUTION_API_URL = "https://evolution.teste.com.br";
  process.env.EVOLUTION_API_KEY = "chave-de-teste";
});

describe("GET /api/whatsapp/qrcode — autenticacao", () => {
  test("sem cookie retorna 401 e nunca chama a Evolution API", async () => {
    const res = await GET(requestComCookie(undefined));
    expect(res.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("cookie invalido/expirado retorna 401", async () => {
    const res = await GET(requestComCookie("token-invalido"));
    expect(res.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("atendente autenticado retorna 403 (nao pode consultar QR)", async () => {
    const res = await GET(requestComCookie("token-atendente"));
    expect(res.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("admin autenticado consegue consultar o QR", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ base64: "data:image/png;base64,AAA" }),
    } as Response);
    const res = await GET(requestComCookie("token-admin"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.base64).toContain("AAA");
  });

  test("dev autenticado consegue consultar o QR", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ base64: "data:image/png;base64,BBB" }),
    } as Response);
    const res = await GET(requestComCookie("token-dev"));
    expect(res.status).toBe(200);
  });
});

describe("GET /api/whatsapp/qrcode — provider nao configurado", () => {
  test("sem EVOLUTION_API_URL/EVOLUTION_API_KEY retorna provider_not_configured, nunca tenta o host antigo do Railway", async () => {
    delete process.env.EVOLUTION_API_URL;
    delete process.env.EVOLUTION_API_KEY;

    const res = await GET(requestComCookie("token-admin"));
    const data = await res.json();

    expect(res.status).toBe(503);
    expect(data.estado).toBe("provider_not_configured");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("GET /api/whatsapp/qrcode — erro da Evolution API sanitizado", () => {
  test("404 no formato de borda do Railway (host fora do ar) vira diagnostico de infraestrutura, nunca expoe o corpo bruto", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ status: "error", code: 404, message: "Application not found", request_id: "abc123" }),
    } as Response);

    const res = await GET(requestComCookie("token-admin"));
    const data = await res.json();
    const texto = JSON.stringify(data);

    expect(res.status).toBe(404);
    expect(data.error).toMatch(/não está acessível/i);
    // nunca expõe o corpo bruto da Evolution API (ex.: request_id) nem chaves internas
    expect(texto).not.toContain("request_id");
    expect(texto).not.toContain("abc123");
  });

  test("404 da propria Evolution API (formato de app, sem request_id) repassa a mensagem normalmente", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ status: 404, error: "Not Found", message: ["The instance chefebot does not exist"] }),
    } as Response);

    const res = await GET(requestComCookie("token-admin"));
    const data = await res.json();
    expect(res.status).toBe(404);
    expect(data.error).toMatch(/does not exist/i);
  });

  test("resposta de erro nunca inclui o campo bruto 'detail' (corpo interno da Evolution API)", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: "Unauthorized", apikey: "chave-interna-nao-deveria-vazar" }),
    } as Response);

    const res = await GET(requestComCookie("token-admin"));
    const data = await res.json();
    expect(data.detail).toBeUndefined();
    expect(JSON.stringify(data)).not.toContain("chave-interna-nao-deveria-vazar");
  });
});
