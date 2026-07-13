import { vi, describe, test, expect } from "vitest";
import { NextRequest } from "next/server";

const salvarMock = vi.fn(async (..._args: unknown[]) => undefined);

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
    metaPontos: 500,
    descricaoRecompensa: "1 Pizza Família",
  })),
  salvarConfigFidelidadePontos: (...args: unknown[]) => salvarMock(...args),
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

const payload = { ativo: true, metaPontos: 300, descricaoRecompensa: "Pizza média grátis" };

describe("GET /api/fidelidade/config/pontos", () => {
  test("sem cookie retorna 401", async () => {
    const res = await GET(getRequest());
    expect(res.status).toBe(401);
  });

  test("admin/dev/atendente conseguem ler a configuracao efetiva de pontos", async () => {
    for (const token of ["token-admin", "token-dev", "token-atendente"]) {
      const res = await GET(getRequest(token));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.metaPontos).toBe(500);
    }
  });
});

describe("POST /api/fidelidade/config/pontos", () => {
  test("sem cookie retorna 401", async () => {
    const res = await POST(postRequest(undefined, payload));
    expect(res.status).toBe(401);
  });

  test("admin consegue salvar", async () => {
    const res = await POST(postRequest("token-admin", payload));
    expect(res.status).toBe(200);
    expect(salvarMock).toHaveBeenCalledWith({ ativo: true, metaPontos: 300, descricaoRecompensa: "Pizza média grátis" });
  });

  test("dev consegue salvar", async () => {
    const res = await POST(postRequest("token-dev", payload));
    expect(res.status).toBe(200);
  });

  test("atendente NAO consegue alterar a configuracao (403)", async () => {
    const res = await POST(postRequest("token-atendente", payload));
    expect(res.status).toBe(403);
  });

  test("metaPontos invalido cai para o padrao (nunca grava 0/negativo/NaN)", async () => {
    salvarMock.mockClear();
    await POST(postRequest("token-admin", { ativo: true, metaPontos: -5, descricaoRecompensa: "x" }));
    expect(salvarMock).toHaveBeenCalledWith(expect.objectContaining({ metaPontos: 720 }));
  });

  test("descricaoRecompensa ausente cai para o padrao", async () => {
    salvarMock.mockClear();
    await POST(postRequest("token-admin", { ativo: true, metaPontos: 100 }));
    expect(salvarMock).toHaveBeenCalledWith(expect.objectContaining({ descricaoRecompensa: "1 Pizza Família" }));
  });
});
