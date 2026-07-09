import { vi, describe, test, expect } from "vitest";
import { NextRequest } from "next/server";

const CONFIG_MOCK = vi.hoisted(() => ({
  nomePizzaria: "Chefe da Pizza",
  horaAbertura: 18,
  horaFechamento: 23,
  chavePix: "chave-pix-secreta",
  nomeTitularPix: "Fulano de Tal",
  limitePico: 0,
  whatsappPizzaria: "5511999999999",
  tempoEntregaDelivery: "40-60 minutos",
  tempoEntregaRetirada: "20-30 minutos",
}));

vi.mock("@/lib/redis", () => ({
  redis: { get: vi.fn().mockResolvedValue(CONFIG_MOCK) },
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

import { GET } from "./route";

function requestComCookie(token?: string) {
  const url = "http://localhost/api/configuracoes";
  const init = token ? { headers: { cookie: `auth-token=${token}` } } : undefined;
  return new NextRequest(url, init);
}

describe("GET /api/configuracoes — autorizacao e sanitizacao por role", () => {
  test("sem cookie retorna 401", async () => {
    const res = await GET(requestComCookie());
    expect(res.status).toBe(401);
  });

  test("role admin retorna 200 com chavePix e nomeTitularPix", async () => {
    const res = await GET(requestComCookie("token-admin"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.chavePix).toBe("chave-pix-secreta");
    expect(body.nomeTitularPix).toBe("Fulano de Tal");
  });

  test("role dev retorna 200 com chavePix e nomeTitularPix", async () => {
    const res = await GET(requestComCookie("token-dev"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.chavePix).toBe("chave-pix-secreta");
    expect(body.nomeTitularPix).toBe("Fulano de Tal");
  });

  test("role atendente retorna 200 sem chavePix e sem nomeTitularPix", async () => {
    const res = await GET(requestComCookie("token-atendente"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.chavePix).toBeUndefined();
    expect(body.nomeTitularPix).toBeUndefined();
    expect(body.nomePizzaria).toBe("Chefe da Pizza");
  });
});
