import { vi, describe, test, expect } from "vitest";
import { NextRequest } from "next/server";

const { salvarConfigFidelidadePontosMock } = vi.hoisted(() => ({
  salvarConfigFidelidadePontosMock: vi.fn(async () => undefined),
}));

vi.mock("@/lib/fidelidade", () => ({
  CONFIG_FIDELIDADE_PONTOS_PADRAO: {
    ativo: false,
    metaPontos: 720,
    valorPizzaFamiliaReferencia: 60,
    metaPizzasFamilia: 12,
    descricaoRecompensa: "1 Pizza Família",
  },
  obterConfigFidelidadePontos: vi.fn(async () => ({
    ativo: true,
    metaPontos: 720,
    descricaoRecompensa: "1 Pizza Família",
    recompensa: { ativa: true, custoPontos: 500, tipo: "desconto_fixo", descricao: "R$20 de desconto", valorDescontoCentavos: 2000 },
  })),
  salvarConfigFidelidadePontos: salvarConfigFidelidadePontosMock,
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    verifyToken: vi.fn(async (token: string) => {
      const role = { "token-admin": "admin", "token-dev": "dev", "token-atendente": "atendente" }[token];
      return role ? { username: `dev-${role}`, name: `Dev QA (${role})`, role } : null;
    }),
  };
});

import { GET, POST } from "./route";

function getRequest(token?: string) {
  const url = "http://localhost/api/fidelidade/config/pontos";
  const init = token ? { headers: { cookie: `auth-token=${token}` } } : undefined;
  return new NextRequest(url, init);
}

function postRequest(token: string | undefined, body: Record<string, unknown>) {
  const url = "http://localhost/api/fidelidade/config/pontos";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.cookie = `auth-token=${token}`;
  return new NextRequest(url, { method: "POST", headers, body: JSON.stringify(body) });
}

const payloadValido = {
  ativo: true,
  metaPontos: 720,
  descricaoRecompensa: "1 Pizza Família",
  recompensa: { ativa: true, custoPontos: 500, tipo: "desconto_fixo", descricao: "R$20 de desconto", valorDescontoCentavos: 2000 },
};

describe("GET /api/fidelidade/config/pontos", () => {
  test("sem cookie retorna 401", async () => {
    const res = await GET(getRequest());
    expect(res.status).toBe(401);
  });

  test("admin/dev/atendente conseguem ler a configuracao", async () => {
    for (const token of ["token-admin", "token-dev", "token-atendente"]) {
      const res = await GET(getRequest(token));
      expect(res.status).toBe(200);
    }
  });

  test("resposta nunca expõe chaves internas do Redis", async () => {
    const res = await GET(getRequest("token-admin"));
    const texto = JSON.stringify(await res.json());
    expect(texto).not.toContain("config:fidelidade:pontos");
  });
});

describe("POST /api/fidelidade/config/pontos — permissão", () => {
  test("sem cookie retorna 401", async () => {
    const res = await POST(postRequest(undefined, payloadValido));
    expect(res.status).toBe(401);
  });

  test("atendente nao pode salvar (403)", async () => {
    const res = await POST(postRequest("token-atendente", payloadValido));
    expect(res.status).toBe(403);
  });

  test("admin consegue salvar a configuracao", async () => {
    const res = await POST(postRequest("token-admin", payloadValido));
    expect(res.status).toBe(200);
  });

  test("dev consegue salvar a configuracao", async () => {
    const res = await POST(postRequest("token-dev", payloadValido));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/fidelidade/config/pontos — validação server-side", () => {
  test("meta em pontos zero ou negativa é recusada", async () => {
    const res = await POST(postRequest("token-admin", { ...payloadValido, metaPontos: 0 }));
    expect(res.status).toBe(400);
  });

  test("recompensa ativa sem custoPontos é recusada", async () => {
    const res = await POST(postRequest("token-admin", {
      ...payloadValido,
      recompensa: { ativa: true, custoPontos: 0, tipo: "desconto_fixo", descricao: "x", valorDescontoCentavos: 2000 },
    }));
    expect(res.status).toBe(400);
  });

  test("desconto_fixo ativo sem valorDescontoCentavos é recusado", async () => {
    const res = await POST(postRequest("token-admin", {
      ...payloadValido,
      recompensa: { ativa: true, custoPontos: 500, tipo: "desconto_fixo", descricao: "x" },
    }));
    expect(res.status).toBe(400);
  });

  test("recompensa ativa sem descrição é recusada", async () => {
    const res = await POST(postRequest("token-admin", {
      ...payloadValido,
      recompensa: { ativa: true, custoPontos: 500, tipo: "desconto_fixo", descricao: "", valorDescontoCentavos: 2000 },
    }));
    expect(res.status).toBe(400);
  });

  test("pizza_gratis ativo sem valorMaximoCentavos ainda é aceito (campo opcional)", async () => {
    const res = await POST(postRequest("token-admin", {
      ...payloadValido,
      recompensa: { ativa: true, custoPontos: 720, tipo: "pizza_gratis", descricao: "Pizza grátis" },
    }));
    expect(res.status).toBe(200);
  });

  test("recompensa desativada é aceita mesmo com campos incompletos (fica apenas indisponível)", async () => {
    const res = await POST(postRequest("token-admin", {
      ...payloadValido,
      recompensa: { ativa: false, custoPontos: 0, tipo: "desconto_fixo", descricao: "" },
    }));
    expect(res.status).toBe(200);
  });

  test("corpo da requisição inválido (não-JSON/objeto) é recusado", async () => {
    const res = await POST(new NextRequest("http://localhost/api/fidelidade/config/pontos", {
      method: "POST",
      headers: { cookie: "auth-token=token-admin", "Content-Type": "application/json" },
      body: "não é json",
    }));
    expect(res.status).toBe(400);
  });

  test("configuração antiga (sem recompensa) continua sendo aceita — compatibilidade", async () => {
    const res = await POST(postRequest("token-admin", { ativo: true, metaPontos: 720, descricaoRecompensa: "1 Pizza Família" }));
    expect(res.status).toBe(200);
  });
});
