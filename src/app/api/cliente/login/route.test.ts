import { vi, describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const redisStore = new Map<string, unknown>();
vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => (redisStore.has(key) ? redisStore.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown) => { redisStore.set(key, value); return "OK"; }),
    del: vi.fn(async () => 1),
  },
}));

vi.stubGlobal("fetch", vi.fn());

import { POST } from "./route";

const TELEFONE = "86988887777";

function requestLogin(body: unknown) {
  return new NextRequest("http://localhost/api/cliente/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function textoDosLogs(logSpy: ReturnType<typeof vi.spyOn>, errorSpy: ReturnType<typeof vi.spyOn>): string {
  return [...logSpy.mock.calls, ...errorSpy.mock.calls].map(c => c.join(" ")).join(" | ");
}

beforeEach(() => {
  redisStore.clear();
  vi.mocked(fetch).mockReset();
});

describe("POST /api/cliente/login — nunca vaza telefone ou codigo OTP no log", () => {
  test("provider nao configurado: loga so mensagem generica, sem telefone nem codigo, preserva resposta ok", async () => {
    delete process.env.EVOLUTION_API_URL;
    delete process.env.EVOLUTION_API_KEY;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(requestLogin({ telefone: TELEFONE }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(fetch).not.toHaveBeenCalled();

    const texto = textoDosLogs(logSpy, errorSpy);
    expect(texto).not.toContain(TELEFONE);
    // O codigo OTP tem 6 digitos — garante que nenhuma sequencia de 6 digitos aparece no log.
    expect(texto).not.toMatch(/\d{6}/);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Provider de WhatsApp não configurado"));

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test("provider configurado: envia via fetch, nunca loga telefone, codigo ou corpo da requisicao", async () => {
    process.env.EVOLUTION_API_URL = "https://evolution.teste.com.br";
    process.env.EVOLUTION_API_KEY = "chave-de-teste";
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(requestLogin({ telefone: TELEFONE }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);

    const texto = textoDosLogs(logSpy, errorSpy);
    expect(texto).not.toContain(TELEFONE);
    expect(texto).not.toMatch(/\d{6}/);
    expect(texto).not.toContain("chave-de-teste");

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
