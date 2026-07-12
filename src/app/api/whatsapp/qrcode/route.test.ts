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

import { POST } from "./route";

function requestComCookie(token?: string) {
  const init: { method: string; headers: Record<string, string> } = {
    method: "POST",
    headers: token ? { cookie: `auth-token=${token}` } : {},
  };
  return new NextRequest("http://localhost/api/whatsapp/qrcode", init);
}

beforeEach(() => {
  vi.mocked(fetch).mockReset();
  process.env.EVOLUTION_API_URL = "https://evolution.teste.com.br";
  process.env.EVOLUTION_API_KEY = "chave-de-teste";
});

describe("POST /api/whatsapp/qrcode — autenticacao", () => {
  test("sem cookie retorna 401 e nunca chama a Evolution API", async () => {
    const res = await POST(requestComCookie(undefined));
    expect(res.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("cookie invalido/expirado retorna 401", async () => {
    const res = await POST(requestComCookie("token-invalido"));
    expect(res.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("atendente autenticado retorna 403 (nao pode consultar QR)", async () => {
    const res = await POST(requestComCookie("token-atendente"));
    expect(res.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("admin autenticado consegue consultar o QR", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ base64: "data:image/png;base64,AAA" }),
    } as Response);
    const res = await POST(requestComCookie("token-admin"));
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
    const res = await POST(requestComCookie("token-dev"));
    expect(res.status).toBe(200);
  });
});

describe("GET /api/whatsapp/qrcode — nao existe mais (rota so aceita POST)", () => {
  test("modulo da rota nao exporta GET", async () => {
    const mod = await import("./route");
    expect((mod as Record<string, unknown>).GET).toBeUndefined();
  });
});

describe("POST /api/whatsapp/qrcode — erro da Evolution API sanitizado", () => {
  test("404 'Application not found' repassa so a mensagem, nunca o corpo bruto nem a apikey", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ status: "error", code: 404, message: "Application not found", request_id: "abc123" }),
    } as Response);

    const res = await POST(requestComCookie("token-admin"));
    const data = await res.json();
    const texto = JSON.stringify(data);

    expect(res.status).toBe(404);
    expect(data.error).toMatch(/Application not found/i);
    // nunca expõe o corpo bruto da Evolution API (ex.: request_id) nem chaves internas
    expect(texto).not.toContain("request_id");
    expect(texto).not.toContain("abc123");
  });

  test("resposta de erro nunca inclui o campo bruto 'detail' (corpo interno da Evolution API)", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: "Unauthorized", apikey: "chave-interna-nao-deveria-vazar" }),
    } as Response);

    const res = await POST(requestComCookie("token-admin"));
    const data = await res.json();
    expect(data.detail).toBeUndefined();
    expect(JSON.stringify(data)).not.toContain("chave-interna-nao-deveria-vazar");
  });
});

describe("POST /api/whatsapp/qrcode — provider nao configurado", () => {
  test("sem EVOLUTION_API_URL/EVOLUTION_API_KEY retorna 503, nunca chama fetch, nunca tenta o host antigo", async () => {
    delete process.env.EVOLUTION_API_URL;
    delete process.env.EVOLUTION_API_KEY;
    const res = await POST(requestComCookie("token-admin"));
    const data = await res.json();
    expect(res.status).toBe(503);
    expect(data.estado).toBe("provider_not_configured");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("POST /api/whatsapp/qrcode — nenhum marcador sensivel aparece nos logs", () => {
  const QR_MARCADOR = "QRSECRETO-NUNCA-DEVERIA-APARECER-NO-LOG";
  const APIKEY_MARCADOR = "chave-de-teste";
  const CORPO_BRUTO_MARCADOR = "CAMPO-INTERNO-SENSIVEL-NUNCA-LOGAR";

  function textoDosLogs(logSpy: ReturnType<typeof vi.spyOn>, errorSpy: ReturnType<typeof vi.spyOn>): string {
    return [...logSpy.mock.calls, ...errorSpy.mock.calls].map(c => c.map((a: unknown) => JSON.stringify(a)).join(" ")).join(" | ");
  }

  test("sucesso com QR: nenhum marcador de QR/apikey/corpo bruto aparece no log", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ base64: QR_MARCADOR, detalheInterno: CORPO_BRUTO_MARCADOR }),
    } as Response);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(requestComCookie("token-admin"));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.base64).toBe(QR_MARCADOR); // a resposta HTTP pode conter o QR — só o log não pode

    const texto = textoDosLogs(logSpy, errorSpy);
    expect(texto).not.toContain(QR_MARCADOR);
    expect(texto).not.toContain(APIKEY_MARCADOR);
    expect(texto).not.toContain(CORPO_BRUTO_MARCADOR);

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test("erro da Evolution API: corpo bruto nunca aparece no log", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ message: "Internal error", stack: CORPO_BRUTO_MARCADOR }),
    } as Response);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(requestComCookie("token-admin"));
    expect(res.status).toBe(500);

    const texto = textoDosLogs(logSpy, errorSpy);
    expect(texto).not.toContain(CORPO_BRUTO_MARCADOR);

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test("erro inesperado (excecao de rede): mensagem do erro nunca aparece no log", async () => {
    const MENSAGEM_SENSIVEL_DO_ERRO = "erro-com-detalhe-interno-sensivel-nunca-logar";
    vi.mocked(fetch).mockRejectedValueOnce(new Error(MENSAGEM_SENSIVEL_DO_ERRO));

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(requestComCookie("token-admin"));
    expect(res.status).toBe(502);

    const texto = textoDosLogs(logSpy, errorSpy);
    expect(texto).not.toContain(MENSAGEM_SENSIVEL_DO_ERRO);

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
