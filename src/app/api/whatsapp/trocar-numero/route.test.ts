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

const { salvarStatusConexao } = vi.hoisted(() => ({
  salvarStatusConexao: vi.fn(async () => {}),
}));
vi.mock("@/lib/conexaoWhatsapp", () => ({ salvarStatusConexao }));

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

import { POST } from "./route";

function req(token?: string) {
  return new NextRequest("http://localhost/api/whatsapp/trocar-numero", {
    method: "POST",
    headers: token ? { cookie: `auth-token=${token}` } : {},
  });
}

beforeEach(() => {
  vi.mocked(fetch).mockReset();
  salvarStatusConexao.mockClear();
  qrStore.clear();
  process.env.EVOLUTION_API_URL = "https://evolution.teste.com.br";
  process.env.EVOLUTION_API_KEY = "chave-de-teste";
  process.env.EVOLUTION_INSTANCE_NAME = "chefebot";
  delete process.env.EVOLUTION_WEBHOOK_URL;
});

describe("POST /api/whatsapp/trocar-numero — seguranca", () => {
  test("sem autenticação retorna 401 e não toca Evolution", async () => {
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("atendente não pode derrubar a conexão", async () => {
    const res = await POST(req("token-atendente"));
    expect(res.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("sem provider configurado falha explicitamente", async () => {
    delete process.env.EVOLUTION_API_URL;
    delete process.env.EVOLUTION_API_KEY;
    const res = await POST(req("token-admin"));
    expect(res.status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("POST /api/whatsapp/trocar-numero — troca controlada", () => {
  test("faz logout da sessão, preserva instância e devolve novo QR", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: "SUCCESS" }) } as Response) // logout
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ instance: { state: "close" } }) } as Response) // state
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response) // webhook
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ base64: "data:image/png;base64,NOVOQR" }) } as Response); // connect

    const res = await POST(req("token-admin"));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toMatchObject({ ok: true, estado: "qr_required" });
    expect(data.qrcode.base64).toContain("NOVOQR");

    const calls = vi.mocked(fetch).mock.calls;
    expect(String(calls[0][0])).toContain("/instance/logout/chefebot");
    expect((calls[0][1] as RequestInit).method).toBe("DELETE");
    expect(calls.some(c => String(c[0]).includes("/instance/delete/"))).toBe(false);
    expect(calls.some(c => String(c[0]).includes("/instance/create"))).toBe(false);
    expect(calls.some(c => String(c[0]).includes("/instance/connect/chefebot"))).toBe(true);
    expect(salvarStatusConexao).toHaveBeenNthCalledWith(1, "disconnected");
    expect(salvarStatusConexao).toHaveBeenNthCalledWith(2, "connecting");
  });

  test("erro 500 no logout não bloqueia se o estado real já fechou", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ message: "erro interno" }) } as Response) // logout
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ instance: { state: "close" } }) } as Response) // state confirma logout real
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response) // webhook
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ qrcode: { base64: "data:image/png;base64,QR2" } }) } as Response); // connect

    const res = await POST(req("token-dev"));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.qrcode.base64).toContain("QR2");
  });

  test("não tenta gerar QR se a instância continuar aberta depois do logout", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) } as Response) // logout
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ instance: { state: "open" } }) } as Response); // 4 checks

    const res = await POST(req("token-admin"));
    const data = await res.json();

    expect(res.status).toBe(502);
    expect(data.estado).toBe("still_connected");
    expect(vi.mocked(fetch).mock.calls.some(c => String(c[0]).includes("/instance/connect/"))).toBe(false);
    expect(vi.mocked(fetch).mock.calls.some(c => String(c[0]).includes("/instance/delete/"))).toBe(false);
    expect(salvarStatusConexao).not.toHaveBeenCalled();
  });

  test("credencial inválida no logout falha sem tentar delete/create/connect", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) } as Response);
    const res = await POST(req("token-admin"));
    expect(res.status).toBe(502);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls.some(c => /\/instance\/(delete|create|connect)\//.test(String(c[0])))).toBe(false);
  });
});
