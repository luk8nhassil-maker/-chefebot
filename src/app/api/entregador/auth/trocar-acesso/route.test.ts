import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => { store.set(key, value); return "OK"; }),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    eval: vi.fn(async (_script: string, keys: string[]) => {
      const value = store.get(keys[0]);
      if (value === undefined) return null;
      store.delete(keys[0]);
      return value;
    }),
  };
  return { store, redisMock };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));

import { POST } from "./route";
import { criarTicketAcessoEntregador } from "@/lib/entregadorAuth";

function request(acesso: unknown) {
  return new NextRequest("https://x.test/api/entregador/auth/trocar-acesso", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ acesso }),
  });
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  vi.stubEnv("AUTH_SECRET", "segredo-de-teste-com-entropia-suficiente");
  vi.stubEnv("NODE_ENV", "production");
});

describe("POST /api/entregador/auth/trocar-acesso", () => {
  it("ticket válido cria cookie seguro sem retornar o JWT", async () => {
    const entregador = { id: "ent-1", nome: "Rafael", telefone: "86999990000", ativo: true };
    store.set("entregadores", [entregador]);
    const { ticket } = await criarTicketAcessoEntregador(entregador.id);

    const res = await POST(request(ticket));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data).toEqual({ ok: true, entregador: { id: "ent-1", nome: "Rafael" } });
    expect(JSON.stringify(data)).not.toContain("token");
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain("entregador-token=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=lax");

    expect((await POST(request(ticket))).status).toBe(401);
  });

  it("ticket inválido retorna 401 e formato inválido retorna 400", async () => {
    expect((await POST(request("b".repeat(43)))).status).toBe(401);
    expect((await POST(request("curto"))).status).toBe(400);
  });

  it("ticket de entregador inativo retorna 403", async () => {
    const inativo = { id: "ent-2", nome: "Inativo", telefone: "86999990001", ativo: false };
    store.set("entregadores", [inativo]);
    const { ticket } = await criarTicketAcessoEntregador(inativo.id);
    expect((await POST(request(ticket))).status).toBe(403);
  });
});
