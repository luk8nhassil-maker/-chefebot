import { vi, describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { cancelarReservaResgate } = vi.hoisted(() => ({
  cancelarReservaResgate: vi.fn(),
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
  cancelarReservaResgate,
}));

import { DELETE } from "./route";

function requestComCookie(token?: string) {
  const url = "http://localhost/api/cliente/fidelidade/resgates/res_1";
  const headers = token ? { cookie: `cliente-token=${token}` } : undefined;
  return new NextRequest(url, { method: "DELETE", headers });
}

function ctx(resgateId = "res_1") {
  return { params: Promise.resolve({ resgateId }) };
}

beforeEach(() => {
  cancelarReservaResgate.mockReset();
});

describe("DELETE /api/cliente/fidelidade/resgates/[resgateId]", () => {
  test("sem cookie retorna 401", async () => {
    const res = await DELETE(requestComCookie(), ctx());
    expect(res.status).toBe(401);
    expect(cancelarReservaResgate).not.toHaveBeenCalled();
  });

  test("cancela reserva do proprio cliente usando o clienteId da sessao", async () => {
    cancelarReservaResgate.mockResolvedValue({ ok: true });
    const res = await DELETE(requestComCookie("token-cliente-a"), ctx("res_1"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(cancelarReservaResgate).toHaveBeenCalledWith("cli_a", "res_1");
  });

  test("resgate de outro cliente nao pode ser cancelado", async () => {
    cancelarReservaResgate.mockResolvedValue({ ok: false, error: "Resgate não encontrado" });
    const res = await DELETE(requestComCookie("token-cliente-b"), ctx("res_1"));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("Resgate não encontrado");
  });

  test("reserva ja aplicada nao pode ser cancelada", async () => {
    cancelarReservaResgate.mockResolvedValue({ ok: false, error: "Este resgate não pode mais ser cancelado" });
    const res = await DELETE(requestComCookie("token-cliente-a"), ctx("res_1"));
    expect(res.status).toBe(400);
  });
});
