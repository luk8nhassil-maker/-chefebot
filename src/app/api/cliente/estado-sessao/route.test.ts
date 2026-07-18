import { vi, describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const redisStore = new Map<string, unknown>();
const redisFalhaEmClientes = { ativo: false };
vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => {
      if (redisFalhaEmClientes.ativo && key.startsWith("cliente:5")) throw new Error("replica atrasada");
      return redisStore.has(key) ? redisStore.get(key) : null;
    }),
    set: vi.fn(async (key: string, value: unknown) => { redisStore.set(key, value); return "OK"; }),
    del: vi.fn(async (key: string) => { redisStore.delete(key); return 1; }),
  },
}));

import { GET } from "./route";
import { criarSessaoOpaca } from "@/lib/clienteAuth";

const PHONE = "5599974000691";

function reqComBearer(token?: string) {
  return new NextRequest("http://localhost/api/cliente/estado-sessao", token ? { headers: { authorization: `Bearer ${token}` } } : undefined);
}

beforeEach(() => {
  redisStore.clear();
  redisFalhaEmClientes.ativo = false;
});

describe("GET /api/cliente/estado-sessao — unica fonte de 'estou autenticado?'", () => {
  test("sem sessao: 401 (unico gatilho para voltar a confirmacao)", async () => {
    const res = await GET(reqComBearer());
    expect(res.status).toBe(401);
  });

  test("sessao valida + cliente SEM fidelidadeAtivadaEm: next=name", async () => {
    redisStore.set(`perfil-cliente:${PHONE}`, { clienteId: `cli_${PHONE}`, telefone: PHONE, nome: "Nome De Pedido Legado", createdAt: "x", updatedAt: "x", lastLoginAt: "x" });
    const token = await criarSessaoOpaca({ clienteId: `cli_${PHONE}`, telefone: PHONE });
    const res = await GET(reqComBearer(token));
    const body = await res.json();
    expect(res.status).toBe(200);
    // nome legado (vindo de pedido) NUNCA pula a primeira ativacao
    expect(body).toEqual({ authenticated: true, next: "name" });
  });

  test("sessao valida + fidelidadeAtivadaEm presente: next=points", async () => {
    redisStore.set(`perfil-cliente:${PHONE}`, { clienteId: `cli_${PHONE}`, telefone: PHONE, nome: "Maria", fidelidadeAtivadaEm: "2026-01-01T00:00:00.000Z", createdAt: "x", updatedAt: "x", lastLoginAt: "x" });
    const token = await criarSessaoOpaca({ clienteId: `cli_${PHONE}`, telefone: PHONE });
    const res = await GET(reqComBearer(token));
    expect((await res.json())).toEqual({ authenticated: true, next: "points" });
  });

  test("falha ao ler o registro do cliente NUNCA vira 401 — sessao continua valida (next=name)", async () => {
    const token = await criarSessaoOpaca({ clienteId: `cli_${PHONE}`, telefone: PHONE });
    redisFalhaEmClientes.ativo = true;
    const res = await GET(reqComBearer(token));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.authenticated).toBe(true);
    expect(body.next).toBe("name");
  });
});
