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

  test("carryoverTabela válida (posições únicas, bônus decrescente) é aceita e ordenada", async () => {
    const res = await POST(req(adminToken, {
      carryoverAtivo: true,
      carryoverTabela: [
        { posicao: 2, bonus: 60 },
        { posicao: 1, bonus: 100 },
      ],
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.config.carryoverTabela).toEqual([{ posicao: 1, bonus: 100 }, { posicao: 2, bonus: 60 }]);
  });

  test("carryoverTabela com posição fora de 1..10 é REJEITADA por inteiro (400), nada é salvo", async () => {
    const res = await POST(req(adminToken, {
      carryoverAtivo: true,
      carryoverTabela: [{ posicao: 1, bonus: 100 }, { posicao: 11, bonus: 50 }],
    }));
    expect(res.status).toBe(400);
    const getRes = await GET(req(adminToken));
    const getBody = await getRes.json();
    expect(getBody.carryoverAtivo).toBe(false);
    expect(getBody.carryoverTabela).toEqual([]);
  });

  test("carryoverTabela com posição duplicada é rejeitada", async () => {
    const res = await POST(req(adminToken, {
      carryoverTabela: [{ posicao: 1, bonus: 100 }, { posicao: 1, bonus: 50 }],
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.detalhes.join(" ")).toContain("duplicada");
  });

  test("carryoverTabela com bônus negativo é rejeitada", async () => {
    const res = await POST(req(adminToken, {
      carryoverTabela: [{ posicao: 1, bonus: -10 }],
    }));
    expect(res.status).toBe(400);
  });

  test("carryoverTabela com ordem incoerente (posição pior valendo mais) é rejeitada", async () => {
    const res = await POST(req(adminToken, {
      carryoverTabela: [{ posicao: 1, bonus: 50 }, { posicao: 2, bonus: 100 }],
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.detalhes.join(" ")).toContain("decrescente");
  });

  test("nivelChefLimiares válidos (únicos, XP crescente) são aceitos", async () => {
    const res = await POST(req(adminToken, {
      nivelChefAtivo: true,
      nivelChefLimiares: [
        { nivel: 1, nome: "Aprendiz", xpMinimo: 0 },
        { nivel: 2, nome: "Cozinheiro", xpMinimo: 100 },
      ],
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.config.nivelChefLimiares).toEqual([
      { nivel: 1, nome: "Aprendiz", xpMinimo: 0 },
      { nivel: 2, nome: "Cozinheiro", xpMinimo: 100 },
    ]);
  });

  test("nivelChefLimiares sem nome é rejeitado (400), nada é salvo", async () => {
    const res = await POST(req(adminToken, {
      nivelChefLimiares: [{ nivel: 1, nome: "", xpMinimo: 0 }],
    }));
    expect(res.status).toBe(400);
  });

  test("nivelChefLimiares com nível duplicado é rejeitado", async () => {
    const res = await POST(req(adminToken, {
      nivelChefLimiares: [{ nivel: 1, nome: "A", xpMinimo: 0 }, { nivel: 1, nome: "B", xpMinimo: 100 }],
    }));
    expect(res.status).toBe(400);
  });

  test("nivelChefLimiares com XP não-crescente é rejeitado", async () => {
    const res = await POST(req(adminToken, {
      nivelChefLimiares: [{ nivel: 1, nome: "A", xpMinimo: 100 }, { nivel: 2, nome: "B", xpMinimo: 50 }],
    }));
    expect(res.status).toBe(400);
  });

  test("valor numérico inválido é REJEITADO (400) e nunca sobrescreve o anterior", async () => {
    await POST(req(adminToken, { missaoSemanalMultiplicador: 3 }));
    const res = await POST(req(adminToken, { missaoSemanalMultiplicador: "abc" }));
    expect(res.status).toBe(400);
    const getRes = await GET(req(adminToken));
    expect((await getRes.json()).missaoSemanalMultiplicador).toBe(3);
  });

  test("multiplicador fora do limite técnico (ex.: 20x por erro de digitação) é rejeitado", async () => {
    const res = await POST(req(adminToken, { missaoSemanalMultiplicador: 20 }));
    expect(res.status).toBe(400);
  });

  test("cooldown fora do limite técnico é rejeitado", async () => {
    const res = await POST(req(adminToken, { missaoSemanalCooldownDias: 999 }));
    expect(res.status).toBe(400);
  });

  test("booleano estrito: string 'false' NUNCA vira true (proteção contra Boolean(string))", async () => {
    const res = await POST(req(adminToken, { missaoSemanalAtiva: "false" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.detalhes.join(" ")).toContain("missaoSemanalAtiva");
  });

  test("booleano estrito: número não é aceito no lugar de true/false", async () => {
    const res = await POST(req(adminToken, { carryoverAtivo: 1 }));
    expect(res.status).toBe(400);
  });

  test("impulsoPodioBonus maior que o cap da temporada é rejeitado (regra cruzada)", async () => {
    const res = await POST(req(adminToken, { impulsoPodioBonus: 100, impulsoPodioCapTemporada: 50 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.detalhes.join(" ")).toContain("impulsoPodioBonus");
  });

  test("impulsoPodioBonus permitido quando <= cap", async () => {
    const res = await POST(req(adminToken, { impulsoPodioBonus: 30, impulsoPodioCapTemporada: 100 }));
    expect(res.status).toBe(200);
  });

  test("regra cruzada não dispara quando o cap ainda não foi configurado (0 = inativo, não incoerente)", async () => {
    const res = await POST(req(adminToken, { impulsoPodioBonus: 30 }));
    expect(res.status).toBe(200);
  });

  test("requisição com um campo válido e outro inválido rejeita TUDO — nenhum campo é salvo parcialmente", async () => {
    const antes = await (await GET(req(adminToken))).json();
    const res = await POST(req(adminToken, { missaoSemanalAtiva: true, missaoSemanalMultiplicador: "abc" }));
    expect(res.status).toBe(400);
    const depois = await (await GET(req(adminToken))).json();
    expect(depois).toEqual(antes);
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
