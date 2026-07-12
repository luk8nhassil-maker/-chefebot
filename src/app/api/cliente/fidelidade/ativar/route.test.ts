import { vi, describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/clienteAuth", () => ({
  CLIENTE_COOKIE: "cliente-token",
  cookieOptionsSessaoCliente: () => ({ httpOnly: true, sameSite: "lax", secure: false, path: "/", maxAge: 1296000 }),
  verificarTokenCliente: vi.fn(async (token: string) => {
    if (token === "token-cliente-a") return { clienteId: "cli_a", telefone: "11900000001" };
    return null;
  }),
}));

vi.mock("@/lib/clientes", async () => {
  const actual = await vi.importActual<typeof import("@/lib/clientes")>("@/lib/clientes");
  return {
    ...actual,
    buscarClientePorId: vi.fn(async (clienteId: string) => {
      if (clienteId === "cli_a") return { clienteId: "cli_a", telefone: "11900000001", nome: "Cliente A", createdAt: "", updatedAt: "", lastLoginAt: "" };
      return null;
    }),
  };
});

const ativarMock = vi.fn();

vi.mock("@/lib/fidelidade", async () => {
  const actual = await vi.importActual<typeof import("@/lib/fidelidade")>("@/lib/fidelidade");
  return {
    ...actual,
    ativarPontosCliente: (...args: unknown[]) => ativarMock(...args),
  };
});

import { POST } from "./route";

function requestComCookie(token?: string) {
  const url = "http://localhost/api/cliente/fidelidade/ativar";
  const init = token ? { method: "POST", headers: { cookie: `cliente-token=${token}` } } : { method: "POST" };
  return new NextRequest(url, init);
}

beforeEach(() => {
  ativarMock.mockReset();
});

describe("POST /api/cliente/fidelidade/ativar", () => {
  test("sem cookie retorna 401 e nunca ativa", async () => {
    const res = await POST(requestComCookie());
    expect(res.status).toBe(401);
    expect(ativarMock).not.toHaveBeenCalled();
  });

  test("cookie invalido retorna 401", async () => {
    const res = await POST(requestComCookie("token-invalido"));
    expect(res.status).toBe(401);
    expect(ativarMock).not.toHaveBeenCalled();
  });

  test("cliente autenticado ativa o programa para o proprio clienteId (derivado do telefone)", async () => {
    const res = await POST(requestComCookie("token-cliente-a"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(ativarMock).toHaveBeenCalledWith("cli_11900000001");
  });
});
