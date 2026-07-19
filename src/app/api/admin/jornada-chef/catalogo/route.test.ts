import { vi, describe, test, expect } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/jornadaChef", () => ({
  obterCatalogoJornada: vi.fn(async () => ({
    sizes: [{ code: "P", label: "Pequena", price: 35 }],
    saltyFlavors: ["Calabresa"],
    sweetFlavors: ["Chocolate"],
    itensIndividuais: [{ produtoId: "bebida:Guarana 2L", produtoNome: "Guarana 2L", categoria: "bebida", esgotado: false }],
  })),
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    verifyToken: vi.fn(async (token: string) => {
      const role = { "token-admin": "admin", "token-atendente": "atendente" }[token];
      return role ? { username: `dev-${role}`, name: `Dev QA (${role})`, role } : null;
    }),
  };
});

import { GET } from "./route";

function getRequest(token?: string) {
  const url = "http://localhost/api/admin/jornada-chef/catalogo";
  const init = token ? { headers: { cookie: `auth-token=${token}` } } : undefined;
  return new NextRequest(url, init);
}

describe("GET /api/admin/jornada-chef/catalogo", () => {
  test("sem cookie retorna 401", async () => {
    const res = await GET(getRequest());
    expect(res.status).toBe(401);
  });

  test("admin/atendente conseguem ler o catalogo real do cardapio", async () => {
    for (const token of ["token-admin", "token-atendente"]) {
      const res = await GET(getRequest(token));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.itensIndividuais[0].produtoId).toBe("bebida:Guarana 2L");
    }
  });
});
