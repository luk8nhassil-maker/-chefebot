import { vi, describe, test, expect } from "vitest";
import { NextRequest } from "next/server";

const CLIENTE_A = { clienteId: "cli_86999990000", telefone: "86999990000", nome: "Maria", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", lastLoginAt: "2026-01-01T00:00:00.000Z" };
const CLIENTE_B = { clienteId: "cli_86988887777", telefone: "86988887777", nome: "Joao", createdAt: "2026-02-01T00:00:00.000Z", updatedAt: "2026-02-01T00:00:00.000Z", lastLoginAt: "2026-02-01T00:00:00.000Z" };

vi.mock("@/lib/clientes", async () => {
  const actual = await vi.importActual<typeof import("@/lib/clientes")>("@/lib/clientes");
  return {
    ...actual,
    listarClientesCadastrados: vi.fn(async () => [CLIENTE_A, CLIENTE_B]),
  };
});

vi.mock("@/lib/fidelidade", async () => {
  const actual = await vi.importActual<typeof import("@/lib/fidelidade")>("@/lib/fidelidade");
  return {
    ...actual,
    obterConfigFidelidadePontos: vi.fn(async () => ({ ativo: true, metaPontos: 720, descricaoRecompensa: "1 Pizza Familia" })),
    obterSaldoPontos: vi.fn(async (clienteId: string) => ({ disponivel: clienteId === CLIENTE_A.clienteId ? 150 : 0 })),
  };
});

vi.mock("@/lib/jornadaChef", async () => {
  const actual = await vi.importActual<typeof import("@/lib/jornadaChef")>("@/lib/jornadaChef");
  return {
    ...actual,
    obterConfigJornadaChef: vi.fn(async () => ({ modoRollout: "on", metaPizzas: 12, sequenciaRecompensas: [] })),
    obterEstadoJornada: vi.fn(async (clienteId: string) => ({
      cicloAtual: clienteId === CLIENTE_A.clienteId ? 2 : 1,
      pizzasNoCiclo: clienteId === CLIENTE_A.clienteId ? 3 : 0,
      totalJornadasConcluidas: clienteId === CLIENTE_A.clienteId ? 1 : 0,
    })),
    jornadaAtivaParaCliente: vi.fn(() => true),
  };
});

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

function req(token: string | undefined) {
  const headers: Record<string, string> = {};
  if (token) headers.cookie = `auth-token=${token}`;
  return new NextRequest("http://localhost/api/admin/clientes", { headers });
}

describe("GET /api/admin/clientes", () => {
  test("sem cookie retorna 401", async () => {
    const res = await GET(req(undefined));
    expect(res.status).toBe(401);
  });

  test("lista todos os clientes cadastrados com pontos e jornada", async () => {
    const res = await GET(req("token-admin"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBe(2);
    const maria = data.clientes.find((c: { telefone: string }) => c.telefone === CLIENTE_A.telefone);
    expect(maria.fidelidadePontos).toEqual({ ativo: true, disponivel: 150, meta: 720 });
    expect(maria.jornada).toEqual({ participando: true, cicloAtual: 2, pizzasNoCiclo: 3, faseAtual: expect.any(Number), totalJornadasConcluidas: 1 });
  });

  test("atendente tambem pode consultar", async () => {
    const res = await GET(req("token-atendente"));
    expect(res.status).toBe(200);
  });
});
