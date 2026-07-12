import { vi, describe, it, expect, beforeEach } from "vitest";

// Garante que POST /api/conversas/enviar-mensagem-humana renova manual:{phone}
// e session:{phone} com TTL 7200 após envio bem-sucedido pela Evolution API.

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async () => 1),
  };
  return { store, redisMock };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));

import { POST } from "./route";
import { createToken } from "@/lib/auth";

const PHONE = "5586988887777";

function postReq(body: unknown, token?: string) {
  return {
    cookies: {
      get: (name: string) =>
        name === "auth-token" && token ? { value: token } : undefined,
    },
    json: async () => body,
  } as never;
}

function mockFetchOk() {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
}

function mockFetchFail() {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  process.env.EVOLUTION_API_URL = "https://evolution.teste.com.br";
  process.env.EVOLUTION_API_KEY = "chave-de-teste";
  // Conversa em atendimento humano por padrão
  store.set(`manual:${PHONE}`, true);
  mockFetchOk();
});

describe("POST /api/conversas/enviar-mensagem-humana — TTL 7200", () => {
  it("sem token retorna 401 e não grava no Redis", async () => {
    const res = await POST(postReq({ phone: PHONE, text: "Olá!" }));
    expect(res.status).toBe(401);
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it("409 quando conversa não está em atendimento humano", async () => {
    store.delete(`manual:${PHONE}`);
    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "atendente" });
    const res = await POST(postReq({ phone: PHONE, text: "Olá!" }, token));
    expect(res.status).toBe(409);
  });

  it("renova manual:{phone} com TTL 7200 após envio bem-sucedido", async () => {
    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "atendente" });
    const res = await POST(postReq({ phone: PHONE, text: "Pedido confirmado!" }, token));
    expect(res.status).toBe(200);

    const manualCall = redisMock.set.mock.calls.find(([k]: [string]) =>
      k === `manual:${PHONE}`
    );
    expect(manualCall).toBeDefined();
    expect(manualCall[1]).toBe(true);
    expect(manualCall[2]).toEqual({ ex: 7200 });
  });

  it("renova session:{phone} com TTL 7200 quando sessão existe", async () => {
    const sessao = { step: "manual", cart: [] };
    store.set(`session:${PHONE}`, sessao);

    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "atendente" });
    await POST(postReq({ phone: PHONE, text: "Seu pedido está a caminho!" }, token));

    const sessionCall = redisMock.set.mock.calls.find(([k]: [string]) =>
      k === `session:${PHONE}`
    );
    expect(sessionCall).toBeDefined();
    expect(sessionCall[1]).toEqual(sessao);
    expect(sessionCall[2]).toEqual({ ex: 7200 });
  });

  it("não renova TTL quando Evolution API retorna erro HTTP", async () => {
    mockFetchFail();
    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "atendente" });
    const res = await POST(postReq({ phone: PHONE, text: "Olá!" }, token));
    expect(res.status).toBe(502);

    const manualRenewal = redisMock.set.mock.calls.find(([k]: [string]) =>
      k === `manual:${PHONE}`
    );
    expect(manualRenewal).toBeUndefined();
  });

  it("não renova TTL quando Evolution API lança exceção de rede", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "atendente" });
    const res = await POST(postReq({ phone: PHONE, text: "Olá!" }, token));
    expect(res.status).toBe(502);

    const manualRenewal = redisMock.set.mock.calls.find(([k]: [string]) =>
      k === `manual:${PHONE}`
    );
    expect(manualRenewal).toBeUndefined();
  });
});
