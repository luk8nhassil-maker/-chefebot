import { vi, describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const redisStore = new Map<string, unknown>();
vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => (redisStore.has(key) ? redisStore.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown) => { redisStore.set(key, value); return "OK"; }),
    del: vi.fn(async (key: string) => { redisStore.delete(key); return 1; }),
    // GET+DEL atomico generico — usado por consumirTicketAtivacaoPerfil.
    eval: vi.fn(async (_script: string, keys: string[]) => {
      if (!redisStore.has(keys[0])) return null;
      const valor = redisStore.get(keys[0]);
      redisStore.delete(keys[0]);
      return typeof valor === "string" ? valor : JSON.stringify(valor);
    }),
  },
}));

import { POST } from "./route";
import { resolverSessaoPortatil, consumirTicketAtivacaoPerfil } from "@/lib/clienteAuth";

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
    expect(redisStore.has(`perfil-cliente:${PHONE_DO_TOKEN}`)).toBe(true);
    expect(redisStore.has("cliente:11999990000")).toBe(false);
    // resposta nunca devolve o numero completo ao navegador
    expect(JSON.stringify(data)).not.toContain(PHONE_DO_TOKEN);
    // ticket de ativacao por navegacao: opaco e apontando para o cliente certo
    expect(data.ticket).toMatch(/^[a-f0-9]{32}$/);
    const payloadTicket = redisStore.get(`cliente:ticket:${data.ticket}`) as { clienteId: string };
    expect(payloadTicket.clienteId).toBe(`cli_${PHONE_DO_TOKEN}`);
    // sessao portatil (fallback Bearer): JWE cifrado, sem dado do cliente em
    // claro e sem nenhum registro no redis (validada só por decriptação).
    expect(data.sessao.split(".")).toHaveLength(5);
    expect(data.sessao).not.toContain(PHONE_DO_TOKEN);
    expect(data.sessao).not.toContain(PHONE_DO_TOKEN.slice(-8));
    expect(redisStore.has(`cliente:sessao:${data.sessao}`)).toBe(false);
    const payloadSessao = await resolverSessaoPortatil(data.sessao);
    expect(payloadSessao?.clienteId).toBe(`cli_${PHONE_DO_TOKEN}`);
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

describe("POST /api/cliente/verificar — resposta atomica decide a proxima tela", () => {
  test("cliente novo (sem fidelidadeAtivadaEm): next=name, mesmo que ja exista nome legado", async () => {
    redisStore.set(`cardapio:token:${WA_TOKEN}`, { phone: PHONE_DO_TOKEN, createdAt: Date.now() });
    redisStore.set(`perfil-cliente:${PHONE_DO_TOKEN}`, { clienteId: `cli_${PHONE_DO_TOKEN}`, telefone: PHONE_DO_TOKEN, nome: "Nome De Pedido", createdAt: "x", updatedAt: "x", lastLoginAt: "x" });
    armarOtp(PHONE_DO_TOKEN);
    const res = await POST(requestVerificar({ waToken: WA_TOKEN, codigo: "123456" }));
    const data = await res.json();
    expect(data.next).toBe("name");
  });

  test("cliente com fidelidade ativada: next=points", async () => {
    redisStore.set(`cardapio:token:${WA_TOKEN}`, { phone: PHONE_DO_TOKEN, createdAt: Date.now() });
    redisStore.set(`perfil-cliente:${PHONE_DO_TOKEN}`, { clienteId: `cli_${PHONE_DO_TOKEN}`, telefone: PHONE_DO_TOKEN, nome: "Maria", fidelidadeAtivadaEm: "2026-01-01T00:00:00.000Z", createdAt: "x", updatedAt: "x", lastLoginAt: "x" });
    armarOtp(PHONE_DO_TOKEN);
    const res = await POST(requestVerificar({ waToken: WA_TOKEN, codigo: "123456" }));
    const data = await res.json();
    expect(data.next).toBe("points");
  });

  test("cliente novo (next=name) recebe tambem o ticket de ativacao do perfil (P3-ABB28C) — opaco, uso unico, vinculado ao cliente certo", async () => {
    redisStore.set(`cardapio:token:${WA_TOKEN}`, { phone: PHONE_DO_TOKEN, createdAt: Date.now() });
    armarOtp(PHONE_DO_TOKEN);
    const res = await POST(requestVerificar({ waToken: WA_TOKEN, codigo: "123456" }));
    const data = await res.json();
    expect(data.next).toBe("name");
    expect(data.ativacaoToken).toMatch(/^[a-f0-9]{32}$/);
    expect(JSON.stringify(data)).not.toContain(PHONE_DO_TOKEN);

    // round-trip real: o ticket emitido autentica e resolve para o cliente certo
    const payload = await consumirTicketAtivacaoPerfil(data.ativacaoToken);
    expect(payload).toEqual({ clienteId: `cli_${PHONE_DO_TOKEN}`, telefone: PHONE_DO_TOKEN });
    // uso unico: uma segunda tentativa com o mesmo ticket ja falha
    expect(await consumirTicketAtivacaoPerfil(data.ativacaoToken)).toBeNull();
  });

  test("cliente com fidelidade ja ativada (next=points) NUNCA recebe ticket de ativacao — nao ha PATCH de nome a proteger", async () => {
    redisStore.set(`cardapio:token:${WA_TOKEN}`, { phone: PHONE_DO_TOKEN, createdAt: Date.now() });
    redisStore.set(`perfil-cliente:${PHONE_DO_TOKEN}`, { clienteId: `cli_${PHONE_DO_TOKEN}`, telefone: PHONE_DO_TOKEN, nome: "Maria", fidelidadeAtivadaEm: "2026-01-01T00:00:00.000Z", createdAt: "x", updatedAt: "x", lastLoginAt: "x" });
    armarOtp(PHONE_DO_TOKEN);
    const res = await POST(requestVerificar({ waToken: WA_TOKEN, codigo: "123456" }));
    const data = await res.json();
    expect(data.next).toBe("points");
    expect(data.ativacaoToken).toBeNull();
  });

  test("traceId valido e ecoado; invalido vira null; nunca ha PII na resposta", async () => {
    redisStore.set(`cardapio:token:${WA_TOKEN}`, { phone: PHONE_DO_TOKEN, createdAt: Date.now() });
    armarOtp(PHONE_DO_TOKEN);
    const res = await POST(requestVerificar({ waToken: WA_TOKEN, codigo: "123456", traceId: "P3-ABC123" }));
    const data = await res.json();
    expect(data.traceId).toBe("P3-ABC123");
    expect(JSON.stringify(data)).not.toContain(PHONE_DO_TOKEN);

    armarOtp(PHONE_DO_TOKEN);
    const res2 = await POST(requestVerificar({ waToken: WA_TOKEN, codigo: "123456", traceId: PHONE_DO_TOKEN }));
    expect((await res2.json()).traceId).toBeNull();
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
    expect(redisStore.has(`perfil-cliente:${TELEFONE_MANUAL}`)).toBe(true);
  });

  test("dados invalidos retornam 400", async () => {
    const res = await POST(requestVerificar({ telefone: "123", codigo: "123456" }));
    expect(res.status).toBe(400);
  });
});
