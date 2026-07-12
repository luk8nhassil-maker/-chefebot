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
    .mockResolvedValueOnce({ ok: true, status: 200, text: async () => "{}" } as unknown as Response) // delete
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
});

describe("POST /api/whatsapp/reset — erro sanitizado, sem segredos", () => {
  test("falha ao criar instancia nunca expoe o corpo bruto da Evolution API", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response) // logout
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => "{}" } as unknown as Response) // delete
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
});
