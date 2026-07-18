import { vi, describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const redisStore = new Map<string, unknown>();
vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => (redisStore.has(key) ? redisStore.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown) => { redisStore.set(key, value); return "OK"; }),
    del: vi.fn(async (key: string) => { redisStore.delete(key); return 1; }),
  },
}));

import { POST } from "./route";

const WA_TOKEN = "d".repeat(32);
const PHONE_DO_TOKEN = "5599974000691";
const TELEFONE_MANUAL = "86988887777";

function requestVerificar(body: unknown) {
  return new NextRequest("http://localhost/api/cliente/verificar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function armarOtp(telefone: string, codigo = "123456", tentativas = 0) {
  redisStore.set(`cliente:otp:${telefone}`, { codigo, tentativas });
}

beforeEach(() => {
  redisStore.clear();
});

describe("POST /api/cliente/verificar — fluxo de numero reconhecido (waToken)", () => {
  test("codigo valido autentica o cliente do phone do token, ignorando telefone adulterado do body", async () => {
    redisStore.set(`cardapio:token:${WA_TOKEN}`, { phone: PHONE_DO_TOKEN, createdAt: Date.now() });
    armarOtp(PHONE_DO_TOKEN);

    const res = await POST(requestVerificar({ waToken: WA_TOKEN, telefone: "11999990000", codigo: "123456" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    // sessao criada via cookie HttpOnly
    expect(res.headers.get("set-cookie")).toContain("cliente-token=");
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
    // perfil criado para o phone do token, nunca para o adulterado
    expect(redisStore.has(`cliente:${PHONE_DO_TOKEN}`)).toBe(true);
    expect(redisStore.has("cliente:11999990000")).toBe(false);
    // resposta nunca devolve o numero completo ao navegador
    expect(JSON.stringify(data)).not.toContain(PHONE_DO_TOKEN);
    // ticket de ativacao por navegacao: opaco e apontando para o cliente certo
    expect(data.ticket).toMatch(/^[a-f0-9]{32}$/);
    const payloadTicket = redisStore.get(`cliente:ticket:${data.ticket}`) as { clienteId: string };
    expect(payloadTicket.clienteId).toBe(`cli_${PHONE_DO_TOKEN}`);
  });

  test("waToken invalido/expirado: 401 com vinculoInvalido, nada autenticado", async () => {
    armarOtp(PHONE_DO_TOKEN);
    const res = await POST(requestVerificar({ waToken: "e".repeat(32), codigo: "123456" }));
    const data = await res.json();
    expect(res.status).toBe(401);
    expect(data.vinculoInvalido).toBe(true);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  test("codigo invalido nao autentica", async () => {
    redisStore.set(`cardapio:token:${WA_TOKEN}`, { phone: PHONE_DO_TOKEN, createdAt: Date.now() });
    armarOtp(PHONE_DO_TOKEN, "123456");
    const res = await POST(requestVerificar({ waToken: WA_TOKEN, codigo: "000000" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  test("codigo expirado (sem registro) nao autentica", async () => {
    redisStore.set(`cardapio:token:${WA_TOKEN}`, { phone: PHONE_DO_TOKEN, createdAt: Date.now() });
    const res = await POST(requestVerificar({ waToken: WA_TOKEN, codigo: "123456" }));
    expect(res.status).toBe(401);
  });

  test("codigo usado nao pode ser reutilizado (invalidado apos o uso)", async () => {
    redisStore.set(`cardapio:token:${WA_TOKEN}`, { phone: PHONE_DO_TOKEN, createdAt: Date.now() });
    armarOtp(PHONE_DO_TOKEN);

    const primeira = await POST(requestVerificar({ waToken: WA_TOKEN, codigo: "123456" }));
    expect(primeira.status).toBe(200);

    const segunda = await POST(requestVerificar({ waToken: WA_TOKEN, codigo: "123456" }));
    expect(segunda.status).toBe(401);
  });

  test("limite de tentativas invalida o codigo (protecao contra brute force)", async () => {
    redisStore.set(`cardapio:token:${WA_TOKEN}`, { phone: PHONE_DO_TOKEN, createdAt: Date.now() });
    armarOtp(PHONE_DO_TOKEN, "123456", 5);

    const res = await POST(requestVerificar({ waToken: WA_TOKEN, codigo: "123456" }));
    expect(res.status).toBe(401);
    // registro removido — nem o codigo certo entra depois do limite
    expect(redisStore.has(`cliente:otp:${PHONE_DO_TOKEN}`)).toBe(false);
  });
});

describe("POST /api/cliente/verificar — fluxo manual continua funcionando", () => {
  test("telefone digitado + codigo valido autentica e cria o cliente", async () => {
    armarOtp(TELEFONE_MANUAL);
    const res = await POST(requestVerificar({ telefone: TELEFONE_MANUAL, codigo: "123456", nome: "  Maria   da Silva " }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.cliente.nome).toBe("Maria da Silva");
    expect(redisStore.has(`cliente:${TELEFONE_MANUAL}`)).toBe(true);
  });

  test("dados invalidos retornam 400", async () => {
    const res = await POST(requestVerificar({ telefone: "123", codigo: "123456" }));
    expect(res.status).toBe(400);
  });
});
