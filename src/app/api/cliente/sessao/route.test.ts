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

import { GET } from "./route";
import { criarTicketSessao } from "@/lib/clienteAuth";

const PHONE = "5599974000691";

function requestSessao(tk?: string) {
  const url = tk
    ? `http://localhost/api/cliente/sessao?tk=${tk}`
    : "http://localhost/api/cliente/sessao";
  return new NextRequest(url);
}

function seedCliente(nome?: string) {
  redisStore.set(`cliente:${PHONE}`, {
    clienteId: `cli_${PHONE}`,
    telefone: PHONE,
    ...(nome ? { nome } : {}),
    createdAt: "x",
    updatedAt: "x",
    lastLoginAt: "x",
  });
}

beforeEach(() => {
  redisStore.clear();
});

describe("GET /api/cliente/sessao — ativacao da sessao por navegacao", () => {
  test("ticket valido de cliente com nome: 303 para /cliente com cookie HttpOnly", async () => {
    seedCliente("Maria");
    const ticket = await criarTicketSessao({ clienteId: `cli_${PHONE}`, telefone: PHONE });

    const res = await GET(requestSessao(ticket));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost/cliente");
    const cookie = res.headers.get("set-cookie") || "";
    expect(cookie).toContain("cliente-token=");
    expect(cookie).toContain("HttpOnly");
    // o redirect nunca carrega o ticket nem o telefone
    expect(res.headers.get("location")).not.toContain(ticket);
    expect(cookie).not.toContain(PHONE);
  });

  test("ticket valido de cliente SEM nome: 303 para /cliente?cadastro=nome com cookie", async () => {
    seedCliente();
    const ticket = await criarTicketSessao({ clienteId: `cli_${PHONE}`, telefone: PHONE });

    const res = await GET(requestSessao(ticket));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost/cliente?cadastro=nome");
    expect(res.headers.get("set-cookie")).toContain("cliente-token=");
  });

  test("ticket e de uso unico: a segunda navegacao nao recebe cookie", async () => {
    seedCliente("Maria");
    const ticket = await criarTicketSessao({ clienteId: `cli_${PHONE}`, telefone: PHONE });

    await GET(requestSessao(ticket));
    const segunda = await GET(requestSessao(ticket));
    expect(segunda.status).toBe(303);
    expect(segunda.headers.get("location")).toBe("http://localhost/cliente");
    expect(segunda.headers.get("set-cookie")).toBeNull();
  });

  test("ticket invalido/ausente: 303 neutro sem cookie, sem revelar motivo", async () => {
    for (const req of [requestSessao(), requestSessao("zzz"), requestSessao("a".repeat(32))]) {
      const res = await GET(req);
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe("http://localhost/cliente");
      expect(res.headers.get("set-cookie")).toBeNull();
    }
  });
});
