import { vi, describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/clienteAuth", () => ({
  CLIENTE_COOKIE: "cliente-token",
  cookieOptionsSessaoCliente: () => ({ httpOnly: true, sameSite: "lax", secure: false, path: "/", maxAge: 1296000 }),
  verificarTokenCliente: vi.fn(async (token: string) => {
    if (token === "token-cliente-a") return { clienteId: "cli_a", telefone: "11900000001" };
    if (token === "token-cliente-b") return { clienteId: "cli_b", telefone: "11900000002" };
    return null;
  }),
}));

vi.mock("@/lib/clientes", async () => {
  const actual = await vi.importActual<typeof import("@/lib/clientes")>("@/lib/clientes");
  return {
    ...actual,
    buscarClientePorId: vi.fn(async (clienteId: string) => {
      if (clienteId === "cli_a") return { clienteId: "cli_a", telefone: "cli_a", nome: "Cliente A", createdAt: "", updatedAt: "", lastLoginAt: "" };
      if (clienteId === "cli_b") return { clienteId: "cli_b", telefone: "cli_b", nome: "Cliente B", createdAt: "", updatedAt: "", lastLoginAt: "" };
      return null;
    }),
  };
});

const recompensasPorCliente = new Map<string, Array<{ recompensaId: string; status: string }>>();
const reservarMock = vi.fn();

vi.mock("@/lib/fidelidade", async () => {
  const actual = await vi.importActual<typeof import("@/lib/fidelidade")>("@/lib/fidelidade");
  return {
    ...actual,
    obterRecompensasPontos: vi.fn(async (clienteId: string) => recompensasPorCliente.get(clienteId) ?? []),
    reservarResgatePontos: (...args: unknown[]) => reservarMock(...args),
  };
});

import { POST } from "./route";

function requestComCorpo(token: string | undefined, body: unknown) {
  const init: { method: string; headers: Record<string, string>; body: string } = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
  if (token) init.headers.cookie = `cliente-token=${token}`;
  return new NextRequest("http://localhost/api/cliente/fidelidade/resgate", init);
}

beforeEach(() => {
  recompensasPorCliente.clear();
  reservarMock.mockReset();
});

describe("POST /api/cliente/fidelidade/resgate", () => {
  test("sem cookie retorna 401", async () => {
    const res = await POST(requestComCorpo(undefined, { recompensaId: "rcp_1" }));
    expect(res.status).toBe(401);
  });

  test("cookie invalido retorna 401", async () => {
    const res = await POST(requestComCorpo("token-invalido", { recompensaId: "rcp_1" }));
    expect(res.status).toBe(401);
  });

  test("sem recompensaId no corpo retorna 400", async () => {
    const res = await POST(requestComCorpo("token-cliente-a", {}));
    expect(res.status).toBe(400);
    expect(reservarMock).not.toHaveBeenCalled();
  });

  test("recompensaId que nao pertence ao cliente autenticado retorna 404, nunca chama reservarResgatePontos", async () => {
    recompensasPorCliente.set("cli_a", [{ recompensaId: "rcp_de_outro_cliente", status: "disponivel" }]);
    // essa recompensa pertence a cli_b, nao a cli_a
    const res = await POST(requestComCorpo("token-cliente-a", { recompensaId: "rcp_pertence_a_b" }));
    expect(res.status).toBe(404);
    expect(reservarMock).not.toHaveBeenCalled();
  });

  test("recompensaId valido do proprio cliente reserva com sucesso", async () => {
    recompensasPorCliente.set("cli_a", [{ recompensaId: "rcp_1", status: "disponivel" }]);
    reservarMock.mockResolvedValue({
      resgateId: "rsg_123",
      valorDescontoMaximo: 60,
      pontosReservados: 720,
      expiraEm: "2026-01-01T00:00:00.000Z",
      clienteId: "cli_a",
      recompensaId: "rcp_1",
      status: "reservado",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    const res = await POST(requestComCorpo("token-cliente-a", { recompensaId: "rcp_1" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.resgateId).toBe("rsg_123");
    expect(data.valorDescontoMaximo).toBe(60);
    expect(reservarMock).toHaveBeenCalledWith("cli_a", "rcp_1");
  });

  test("erro ao reservar (ex.: saldo nao atende mais a meta) retorna 409 com a mensagem", async () => {
    recompensasPorCliente.set("cli_a", [{ recompensaId: "rcp_1", status: "disponivel" }]);
    reservarMock.mockRejectedValue(new Error("Saldo atual nao atende mais a meta da recompensa"));

    const res = await POST(requestComCorpo("token-cliente-a", { recompensaId: "rcp_1" }));
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toMatch(/saldo atual nao atende/i);
  });

  test("cliente B nunca consegue reservar recompensa do cliente A", async () => {
    recompensasPorCliente.set("cli_a", [{ recompensaId: "rcp_1", status: "disponivel" }]);
    recompensasPorCliente.set("cli_b", []); // cliente B nao tem essa recompensa

    const res = await POST(requestComCorpo("token-cliente-b", { recompensaId: "rcp_1" }));
    expect(res.status).toBe(404);
    expect(reservarMock).not.toHaveBeenCalled();
  });
});
