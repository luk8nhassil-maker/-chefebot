import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const store = new Map<string, unknown>();

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return "OK";
    }),
  },
}));

const adminToken = "tok-admin";
const devToken = "tok-dev";
const atendenteToken = "tok-atendente";

vi.mock("@/lib/auth", () => ({
  verifyToken: vi.fn(async (token: string) => {
    if (token === adminToken) return { role: "admin" };
    if (token === devToken) return { role: "dev" };
    if (token === atendenteToken) return { role: "atendente" };
    return null;
  }),
}));

import { GET, POST } from "./route";

function req(token: string | null, body?: unknown): NextRequest {
  const r = new NextRequest("http://localhost/api/admin/ranking/gamificacao", {
    method: body !== undefined ? "POST" : "GET",
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}),
  });
  if (token) {
    Object.defineProperty(r, "cookies", {
      value: { get: (name: string) => (name === "auth-token" ? { value: token } : undefined) },
    });
  } else {
    Object.defineProperty(r, "cookies", { value: { get: () => undefined } });
  }
  return r;
}

beforeEach(() => {
  store.clear();
});

describe("GET /api/admin/ranking/gamificacao", () => {
  test("401 sem token", async () => {
    expect((await GET(req(null))).status).toBe(401);
  });

  test("401 para atendente (role sem acesso admin)", async () => {
    expect((await GET(req(atendenteToken))).status).toBe(401);
  });

  test("200 com o padrão fail-closed quando nunca configurado", async () => {
    const res = await GET(req(adminToken));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.missaoSemanalAtiva).toBe(false);
    expect(body.carryoverTabela).toEqual([]);
  });

  test("dev também tem acesso", async () => {
    expect((await GET(req(devToken))).status).toBe(200);
  });
});

describe("POST /api/admin/ranking/gamificacao", () => {
  test("401 sem token", async () => {
    expect((await POST(req(null, {}))).status).toBe(401);
  });

  test("ativa a missão semanal com multiplicador e cooldown customizados", async () => {
    const res = await POST(req(adminToken, {
      missaoSemanalAtiva: true,
      missaoSemanalMultiplicador: 3,
      missaoSemanalCooldownDias: 5,
    }));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.config.missaoSemanalAtiva).toBe(true);
    expect(body.config.missaoSemanalMultiplicador).toBe(3);
    expect(body.config.missaoSemanalCooldownDias).toBe(5);
  });

  test("campos ausentes preservam o valor já salvo", async () => {
    await POST(req(adminToken, { missaoSemanalAtiva: true, missaoSemanalMultiplicador: 4 }));
    const res = await POST(req(adminToken, { impulsoPodioAtivo: true }));
    const body = await res.json();
    expect(body.config.missaoSemanalAtiva).toBe(true);
    expect(body.config.missaoSemanalMultiplicador).toBe(4);
    expect(body.config.impulsoPodioAtivo).toBe(true);
  });

  test("valida e sanitiza a tabela de carryover — descarta posições fora de 1..10 e bônus <= 0", async () => {
    const res = await POST(req(adminToken, {
      carryoverAtivo: true,
      carryoverTabela: [
        { posicao: 1, bonus: 100 },
        { posicao: 11, bonus: 50 },
        { posicao: 2, bonus: -10 },
        { posicao: "invalido", bonus: 20 },
      ],
    }));
    const body = await res.json();
    expect(body.config.carryoverTabela).toEqual([{ posicao: 1, bonus: 100 }]);
  });

  test("valida e sanitiza os limiares de nível de chef — descarta entradas sem nome", async () => {
    const res = await POST(req(adminToken, {
      nivelChefAtivo: true,
      nivelChefLimiares: [
        { nivel: 1, nome: "Aprendiz", xpMinimo: 0 },
        { nivel: 2, nome: "", xpMinimo: 100 },
      ],
    }));
    const body = await res.json();
    expect(body.config.nivelChefLimiares).toEqual([{ nivel: 1, nome: "Aprendiz", xpMinimo: 0 }]);
  });

  test("valor numérico inválido não sobrescreve o anterior", async () => {
    await POST(req(adminToken, { missaoSemanalMultiplicador: 3 }));
    const res = await POST(req(adminToken, { missaoSemanalMultiplicador: "abc" }));
    const body = await res.json();
    expect(body.config.missaoSemanalMultiplicador).toBe(3);
  });

  test("body invalido retorna 400", async () => {
    const r = new NextRequest("http://localhost/api/admin/ranking/gamificacao", {
      method: "POST",
      body: "{ invalido",
      headers: { "content-type": "application/json" },
    });
    Object.defineProperty(r, "cookies", { value: { get: () => ({ value: adminToken }) } });
    expect((await POST(r)).status).toBe(400);
  });
});
