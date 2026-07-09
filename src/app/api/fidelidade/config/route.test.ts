import { vi, describe, test, expect } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/fidelidade", () => ({
  CONFIG_FIDELIDADE_PADRAO: {
    ativo: false,
    pizzasParaPremio: 10,
    tipoRecompensa: "pizza_gratis",
    descricaoRecompensa: "Pizza grátis",
  },
  obterConfigFidelidade: vi.fn(async () => ({
    ativo: true,
    pizzasParaPremio: 10,
    tipoRecompensa: "pizza_gratis",
    descricaoRecompensa: "Pizza grátis",
  })),
  salvarConfigFidelidade: vi.fn(async () => undefined),
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
  const url = "http://localhost/api/fidelidade/config";
  const init = token ? { headers: { cookie: `auth-token=${token}` } } : undefined;
  return new NextRequest(url, init);
}

function postRequest(token: string | undefined, body: Record<string, unknown>) {
  const url = "http://localhost/api/fidelidade/config";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.cookie = `auth-token=${token}`;
  return new NextRequest(url, { method: "POST", headers, body: JSON.stringify(body) });
}

const payload = {
  ativo: true,
  pizzasParaPremio: 10,
  tipoRecompensa: "pizza_gratis",
  descricaoRecompensa: "Pizza grátis",
};

describe("GET /api/fidelidade/config", () => {
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
});

describe("POST /api/fidelidade/config", () => {
  test("sem cookie retorna 401", async () => {
    const res = await POST(postRequest(undefined, payload));
    expect(res.status).toBe(401);
  });

  test("admin consegue salvar a configuracao", async () => {
    const res = await POST(postRequest("token-admin", payload));
    expect(res.status).toBe(200);
  });

  test("dev consegue salvar a configuracao", async () => {
    const res = await POST(postRequest("token-dev", payload));
    expect(res.status).toBe(200);
  });

  test("atendente NAO consegue alterar a regra de fidelidade (403)", async () => {
    const res = await POST(postRequest("token-atendente", payload));
    expect(res.status).toBe(403);
  });
});
