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

// Simula o ciclo completo logout -> delete -> create -> webhook -> connect,
// na mesma ordem chamada pela rota, todos com sucesso e devolvendo um QR novo.
function mockCicloResetCompleto() {
  vi.mocked(fetch)
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response) // logout
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response) // delete
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ instance: { instanceName: "chefebot" } }) } as Response) // create
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response) // webhook
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ base64: "data:image/png;base64,NOVOQR" }) } as Response); // connect
}

beforeEach(() => {
  vi.mocked(fetch).mockReset();
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

  test("admin autenticado pode resetar: recria a instancia e recebe o QR novo", async () => {
    mockCicloResetCompleto();
    const res = await POST(requestComCookie("token-admin"));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.qrcode.base64).toContain("NOVOQR");
    // logout, delete, create, webhook, connect — nessa ordem
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain("/instance/logout/");
    expect(vi.mocked(fetch).mock.calls[1][0]).toContain("/instance/delete/");
    expect(vi.mocked(fetch).mock.calls[2][0]).toContain("/instance/create");
    expect(vi.mocked(fetch).mock.calls[4][0]).toContain("/instance/connect/");
  });

  test("dev autenticado tambem pode resetar", async () => {
    mockCicloResetCompleto();
    const res = await POST(requestComCookie("token-dev"));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
  });

  test("404 normal no delete (instancia realmente nao existe ainda) e esperado, segue para create normalmente", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response) // logout
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ status: 404, error: "Not Found", message: ["Instance not found"] }) } as Response) // delete: instancia nao existe (formato normal da Evolution, nao o da borda do Railway)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ instance: { instanceName: "chefebot" } }) } as Response) // create
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response) // webhook
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ base64: "data:image/png;base64,OK" }) } as Response); // connect

    const res = await POST(requestComCookie("token-admin"));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.qrcode.base64).toContain("OK");
  });
});

describe("POST /api/whatsapp/reset — erro sanitizado, sem segredos", () => {
  test("falha ao criar instancia nunca expoe o corpo bruto da Evolution API", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response) // logout
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response) // delete
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
    expect(data.detail).toBeUndefined();
    expect(texto).not.toContain("linha-sensivel-do-servidor-interno");
  });

  test("delete com 401 (credencial invalida) para o fluxo imediatamente, nunca tenta create/connect", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response) // logout
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ message: "Unauthorized" }) } as Response); // delete falha por credencial

    const res = await POST(requestComCookie("token-admin"));
    const data = await res.json();

    expect(res.status).toBe(502);
    expect(data.step).toBe("delete");
    expect(fetch).toHaveBeenCalledTimes(2); // nunca chega em create
  });

  test("host da Evolution API fora do ar (borda do Railway) detectado ja no delete, nunca chega a chamar create", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response) // logout
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ status: "error", code: 404, message: "Application not found", request_id: "abc" }),
      } as Response); // delete atinge o host errado

    const res = await POST(requestComCookie("token-admin"));
    const data = await res.json();

    expect(res.status).toBe(502);
    expect(data.step).toBe("delete");
    expect(data.error).toMatch(/não está acessível/i);
    expect(fetch).toHaveBeenCalledTimes(2); // logout + delete, nunca create
  });

  test("host da Evolution API fora do ar (borda do Railway) no create retorna diagnostico claro, nao generico", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response) // logout
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response) // delete
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ status: "error", code: 404, message: "Application not found", request_id: "xyz" }),
      } as Response); // create atinge o host errado

    const res = await POST(requestComCookie("token-admin"));
    const data = await res.json();

    expect(res.status).toBe(502);
    expect(data.step).toBe("create");
    expect(data.error).toMatch(/não está acessível/i);
    expect(JSON.stringify(data)).not.toContain("xyz");
  });

  test("create respondendo 'ja existe' (409) nao falha — segue para conectar na instancia existente", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response) // logout
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response) // delete
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ message: "Instance already exists" }) } as Response) // create: ja existe
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response) // webhook
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ base64: "data:image/png;base64,EXISTENTE" }) } as Response); // connect

    const res = await POST(requestComCookie("token-admin"));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.qrcode.base64).toContain("EXISTENTE");
  });

  test("QR ja vem na propria resposta do create — nao chama connect de novo", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response) // logout
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response) // delete
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ qrcode: { base64: "data:image/png;base64,DOCREATE" } }) } as Response) // create ja com QR
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response); // webhook

    const res = await POST(requestComCookie("token-admin"));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.qrcode.base64).toContain("DOCREATE");
    expect(fetch).toHaveBeenCalledTimes(4); // logout, delete, create, webhook — sem connect
  });
});

describe("POST /api/whatsapp/reset — retry limitado do connect", () => {
  test("QR nao vem no create: tenta connect, e se as primeiras tentativas nao trazem QR, insiste ate achar", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetch)
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response) // logout
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response) // delete
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ instance: {} }) } as Response) // create sem QR
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response) // webhook
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response) // connect tentativa 1: sem QR ainda
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response) // connect tentativa 2: sem QR ainda
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ base64: "data:image/png;base64,TENTATIVA3" }) } as Response); // tentativa 3: QR!

      const promise = POST(requestComCookie("token-admin"));
      await vi.runAllTimersAsync();
      const res = await promise;
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.qrcode.base64).toContain("TENTATIVA3");
      // logout, delete, create, webhook, + 3 tentativas de connect
      expect(fetch).toHaveBeenCalledTimes(7);
    } finally {
      vi.useRealTimers();
    }
  });

  test("connect nunca traz QR: para exatamente em 10 tentativas e retorna erro na etapa connect", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetch)
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response) // logout
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response) // delete
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ instance: {} }) } as Response) // create sem QR
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response); // webhook
      // 10 tentativas de connect, nenhuma com QR
      for (let i = 0; i < 10; i++) {
        vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response);
      }

      const promise = POST(requestComCookie("token-admin"));
      await vi.runAllTimersAsync();
      const res = await promise;
      const data = await res.json();

      expect(res.status).toBe(502);
      expect(data.step).toBe("connect");
      // logout, delete, create, webhook + exatamente 10 tentativas de connect, nunca mais
      expect(fetch).toHaveBeenCalledTimes(14);
    } finally {
      vi.useRealTimers();
    }
  });

  test("connect com 401/403 nunca tenta de novo (credencial invalida nao se resolve com retry)", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response) // logout
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response) // delete
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ instance: {} }) } as Response) // create sem QR
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response) // webhook
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ message: "Unauthorized" }) } as Response); // connect: credencial invalida

    const res = await POST(requestComCookie("token-admin"));
    const data = await res.json();

    expect(res.status).toBe(502);
    expect(data.step).toBe("connect");
    // logout, delete, create, webhook + 1 unica tentativa de connect (sem retry em 401)
    expect(fetch).toHaveBeenCalledTimes(5);
  });
});
