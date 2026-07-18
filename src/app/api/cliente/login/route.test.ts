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

const WA_TOKEN = "b".repeat(32);
const PHONE_DO_TOKEN = "5599974000691";

describe("POST /api/cliente/login — fluxo de numero reconhecido (waToken)", () => {
  test("waToken valido: OTP vai para o phone resolvido no servidor, ignorando telefone adulterado do body", async () => {
    process.env.EVOLUTION_API_URL = "https://evolution.teste.com.br";
    process.env.EVOLUTION_API_KEY = "chave-de-teste";
    redisStore.set(`cardapio:token:${WA_TOKEN}`, { phone: PHONE_DO_TOKEN, createdAt: Date.now() });
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({}) } as Response);

    const res = await POST(requestLogin({ waToken: WA_TOKEN, telefone: "11999990000" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    const corpoEnvio = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    // destino = phone do token (ja com DDI), nunca o telefone do body
    expect(corpoEnvio.number).toBe(PHONE_DO_TOKEN);
    expect(corpoEnvio.number).not.toContain("11999990000");
    // o OTP foi gravado para o phone do token, nao para o adulterado
    expect(redisStore.has(`cliente:otp:${PHONE_DO_TOKEN}`)).toBe(true);
    expect(redisStore.has("cliente:otp:11999990000")).toBe(false);
  });

  test("waToken invalido/expirado: 401 generico com vinculoInvalido, nenhum OTP enviado", async () => {
    process.env.EVOLUTION_API_URL = "https://evolution.teste.com.br";
    process.env.EVOLUTION_API_KEY = "chave-de-teste";

    const res = await POST(requestLogin({ waToken: "c".repeat(32), telefone: "11999990000" }));
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.ok).toBe(false);
    expect(data.vinculoInvalido).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    // resposta nunca revela se o telefone possui ou nao cadastro
    expect(JSON.stringify(data)).not.toContain("11999990000");
  });

  test("cooldown de reenvio vale tambem para o fluxo reconhecido", async () => {
    process.env.EVOLUTION_API_URL = "https://evolution.teste.com.br";
    process.env.EVOLUTION_API_KEY = "chave-de-teste";
    redisStore.set(`cardapio:token:${WA_TOKEN}`, { phone: PHONE_DO_TOKEN, createdAt: Date.now() });
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({}) } as Response);

    const primeira = await POST(requestLogin({ waToken: WA_TOKEN }));
    expect((await primeira.json()).ok).toBe(true);

    const segunda = await POST(requestLogin({ waToken: WA_TOKEN }));
    expect(segunda.status).toBe(429);
  });
});
