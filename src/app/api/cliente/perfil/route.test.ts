import { vi, describe, test, expect } from "vitest";
import { NextRequest } from "next/server";

const definirCookieMock = vi.fn();

vi.mock("@/lib/clienteAuth", () => ({
  CLIENTE_COOKIE: "cliente-token",
  resolverSessaoCliente: vi.fn(async (req: NextRequest) => {
    const token = req.cookies.get("cliente-token")?.value;
    if (token === "token-cliente-a") {
      return { cliente: { clienteId: "cli_a", telefone: "11900000001", nome: "Cliente A", createdAt: "", updatedAt: "", lastLoginAt: "" }, deveRenovar: false };
    }
    if (token === "token-cliente-ativo") {
      return { cliente: { clienteId: "cli_ativo", telefone: "11900000003", nome: "Cliente Ativo", createdAt: "", updatedAt: "", lastLoginAt: "", pontosAtivos: true }, deveRenovar: false };
    }
    if (token === "token-renovar") {
      return { cliente: { clienteId: "cli_a", telefone: "11900000001", nome: "Cliente A", createdAt: "", updatedAt: "", lastLoginAt: "" }, deveRenovar: true, novoToken: "token-novo" };
    }
    return null;
  }),
  definirCookieSessaoCliente: (...args: unknown[]) => definirCookieMock(...args),
}));

vi.mock("@/lib/fidelidade", () => ({
  obterProgressoFidelidade: vi.fn(async () => ({
    ativo: true,
    progresso: 3,
    meta: 10,
    faltam: 7,
    tipoRecompensa: "pizza_gratis",
    descricaoRecompensa: "Pizza grátis",
    recompensasDisponiveis: [],
  })),
}));

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async () => [
      { id: "p1", clienteId: "cli_a", numero: 1, data: "01/01", total: 50, status: "entregue" },
      { id: "p2", clienteId: "cli_b", numero: 2, data: "01/01", total: 60, status: "entregue" },
    ]),
  },
}));

import { GET } from "./route";

function requestComCookie(token?: string) {
  const url = "http://localhost/api/cliente/perfil";
  const init = token ? { headers: { cookie: `cliente-token=${token}` } } : undefined;
  return new NextRequest(url, init);
}

describe("GET /api/cliente/perfil", () => {
  test("sem cookie retorna 401", async () => {
    const res = await GET(requestComCookie());
    expect(res.status).toBe(401);
  });

  test("token invalido retorna 401", async () => {
    const res = await GET(requestComCookie("token-adulterado"));
    expect(res.status).toBe(401);
  });

  test("cliente logado recebe apenas seus proprios dados e pedidos (nunca de outro cliente)", async () => {
    const res = await GET(requestComCookie("token-cliente-a"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.cliente.telefone).toBe("11900000001");
    expect(body.fidelidade.progresso).toBe(3);
    expect(body.ultimosPedidos).toHaveLength(1);
    expect(body.ultimosPedidos[0].id).toBe("p1");
  });

  test("cliente sem pontosAtivos no cadastro recebe pontosAtivos:false (nunca undefined)", async () => {
    const res = await GET(requestComCookie("token-cliente-a"));
    const body = await res.json();
    expect(body.cliente.pontosAtivos).toBe(false);
  });

  test("cliente com participacao ativada recebe pontosAtivos:true", async () => {
    const res = await GET(requestComCookie("token-cliente-ativo"));
    const body = await res.json();
    expect(body.cliente.pontosAtivos).toBe(true);
  });

  test("sessao deslizante: quando a sessao precisa renovar, reemite o cookie", async () => {
    definirCookieMock.mockClear();
    const res = await GET(requestComCookie("token-renovar"));
    expect(res.status).toBe(200);
    expect(definirCookieMock).toHaveBeenCalledWith(expect.anything(), "token-novo");
  });

  test("sessao nao renovada (deveRenovar:false) nao reemite o cookie", async () => {
    definirCookieMock.mockClear();
    await GET(requestComCookie("token-cliente-a"));
    expect(definirCookieMock).not.toHaveBeenCalled();
  });
});
