import { vi, describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { criarReservaResgate, obterResgatesCliente } = vi.hoisted(() => ({
  criarReservaResgate: vi.fn(),
  obterResgatesCliente: vi.fn(),
}));

vi.mock("@/lib/clienteAuth", () => ({
  CLIENTE_COOKIE: "cliente-token",
  verificarTokenCliente: vi.fn(async (token: string) => {
    if (token === "token-cliente-a") return { clienteId: "cli_a", telefone: "11900000001" };
    if (token === "token-cliente-b") return { clienteId: "cli_b", telefone: "11900000002" };
    return null;
  }),
}));

vi.mock("@/lib/clientes", () => ({
  buscarClientePorId: vi.fn(async (clienteId: string) => {
    if (clienteId === "cli_a") return { clienteId: "cli_a", telefone: "11900000001", nome: "Cliente A", createdAt: "", updatedAt: "", lastLoginAt: "" };
    if (clienteId === "cli_b") return { clienteId: "cli_b", telefone: "11900000002", nome: "Cliente B", createdAt: "", updatedAt: "", lastLoginAt: "" };
    return null;
  }),
}));

vi.mock("@/lib/fidelidade", () => ({
  criarReservaResgate,
  obterResgatesCliente,
}));

import { POST, GET } from "./route";

function requestComCookie(method: string, token?: string) {
  const url = "http://localhost/api/cliente/fidelidade/resgates";
  const headers = token ? { cookie: `cliente-token=${token}` } : undefined;
  return new NextRequest(url, { method, headers });
}

beforeEach(() => {
  criarReservaResgate.mockReset();
  obterResgatesCliente.mockReset();
});

describe("POST /api/cliente/fidelidade/resgates", () => {
  test("sem cookie retorna 401", async () => {
    const res = await POST(requestComCookie("POST"));
    expect(res.status).toBe(401);
    expect(criarReservaResgate).not.toHaveBeenCalled();
  });

  test("token invalido retorna 401", async () => {
    const res = await POST(requestComCookie("POST", "token-adulterado"));
    expect(res.status).toBe(401);
  });

  test("cria reserva usando somente o clienteId da sessao", async () => {
    criarReservaResgate.mockResolvedValue({
      ok: true,
      resgate: { resgateId: "res_1", clienteId: "cli_a", status: "reservado", tipoRecompensa: "desconto_fixo", pontosUtilizados: 500, valorAplicadoCentavos: 0, criadoEm: "x", expiraEm: "y" },
    });
    const res = await POST(requestComCookie("POST", "token-cliente-a"));
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.resgate.resgateId).toBe("res_1");
    expect(criarReservaResgate).toHaveBeenCalledWith("cli_a");
  });

  test("saldo insuficiente retorna 400 com mensagem sem detalhes internos", async () => {
    criarReservaResgate.mockResolvedValue({ ok: false, error: "Saldo de pontos insuficiente" });
    const res = await POST(requestComCookie("POST", "token-cliente-a"));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("Saldo de pontos insuficiente");
    expect(JSON.stringify(body)).not.toContain("fidelidade:pontos:");
  });

  test("recompensa desativada retorna 400", async () => {
    criarReservaResgate.mockResolvedValue({ ok: false, error: "Recompensa indisponível" });
    const res = await POST(requestComCookie("POST", "token-cliente-a"));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/cliente/fidelidade/resgates", () => {
  test("sem cookie retorna 401", async () => {
    const res = await GET(requestComCookie("GET"));
    expect(res.status).toBe(401);
  });

  test("lista somente os resgates do proprio cliente", async () => {
    obterResgatesCliente.mockResolvedValue([
      { resgateId: "res_1", clienteId: "cli_a", status: "reservado", tipoRecompensa: "desconto_fixo", pontosUtilizados: 500, valorAplicadoCentavos: 0, criadoEm: "x", expiraEm: "y" },
    ]);
    const res = await GET(requestComCookie("GET", "token-cliente-a"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.resgates).toHaveLength(1);
    expect(obterResgatesCliente).toHaveBeenCalledWith("cli_a");
  });
});
