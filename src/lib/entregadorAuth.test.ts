import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return "OK";
    }),
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

vi.mock("./redis", () => ({ redis: redisMock }));

import {
  ENTREGADOR_COOKIE,
  autenticarEntregador,
  consumirTicketAcesso,
  cookieEntregadorOptions,
  criarTicketAcessoEntregador,
  criarTokenEntregador,
  hashTicketAcesso,
  verificarTokenEntregador,
} from "./entregadorAuth";
import { createToken } from "./auth";
import { autenticarRequisicao } from "./apiAuth";

const entregador = { id: "ent-1", nome: "Rafael", telefone: "86999990000", ativo: true };

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  vi.stubEnv("AUTH_SECRET", "segredo-de-teste-com-entropia-suficiente");
  vi.stubEnv("NODE_ENV", "test");
  store.set("entregadores", [entregador]);
});

describe("ticket opaco do entregador", () => {
  it("usa 256 bits, armazena somente o hash e falha no replay", async () => {
    const { ticket } = await criarTicketAcessoEntregador(entregador.id);
    expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect([...store.keys()]).toContain(`entregador:acesso:${hashTicketAcesso(ticket)}`);
    expect(JSON.stringify([...store.entries()])).not.toContain(ticket);

    expect((await consumirTicketAcesso(ticket))?.entregadorId).toBe(entregador.id);
    expect(await consumirTicketAcesso(ticket)).toBeNull();
  });

  it("rejeita ticket expirado", async () => {
    const ticket = "a".repeat(43);
    store.set(`entregador:acesso:${hashTicketAcesso(ticket)}`, JSON.stringify({
      entregadorId: entregador.id,
      criadoEm: new Date(Date.now() - 10_000).toISOString(),
      expiraEm: new Date(Date.now() - 1_000).toISOString(),
    }));
    expect(await consumirTicketAcesso(ticket)).toBeNull();
  });
});

describe("sessão separada do entregador", () => {
  it("valida issuer, audience, tipo, iat, exp e entregador ativo", async () => {
    const token = await criarTokenEntregador(entregador);
    const payload = await verificarTokenEntregador(token);
    expect(payload).toMatchObject({
      entregadorId: entregador.id,
      nome: entregador.nome,
      tipo: "entregador",
    });
    expect(payload!.expiresAt).toBeGreaterThan(payload!.issuedAt);

    const req = new NextRequest("https://x.test/api/entregador/auth/me", {
      headers: { cookie: `${ENTREGADOR_COOKIE}=${token}` },
    });
    expect((await autenticarEntregador(req))?.entregador.id).toBe(entregador.id);
  });

  it("JWT da equipe não é aceito como sessão do entregador", async () => {
    const tokenEquipe = await createToken({ username: "admin", name: "Admin", role: "admin" });
    expect(await verificarTokenEntregador(tokenEquipe)).toBeNull();
  });

  it("entregador-token não é aceito como auth-token da equipe", async () => {
    const tokenEntregador = await criarTokenEntregador(entregador);
    const req = new NextRequest("https://x.test/api/financeiro", {
      headers: { cookie: `auth-token=${tokenEntregador}` },
    });
    expect(await autenticarRequisicao(req)).toBeNull();
  });

  it("cookie é HttpOnly, SameSite=Lax e Secure em produção", () => {
    vi.stubEnv("NODE_ENV", "production");
    const options = cookieEntregadorOptions();
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.secure).toBe(true);
    expect(options.path).toBe("/");
    expect(options.maxAge).toBeGreaterThan(0);
    expect(options.expires).toBeInstanceOf(Date);
  });
});
