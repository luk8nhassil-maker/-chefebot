import { vi, describe, test, expect } from "vitest";
import { NextRequest } from "next/server";

const CODIGO_INTEGRAL = "JC-AB12CD34EF56";
const TELEFONE_CLIENTE_A = "86999990000";

vi.mock("@/lib/jornadaChef", async () => {
  const actual = await vi.importActual<typeof import("@/lib/jornadaChef")>("@/lib/jornadaChef");
  return {
    ...actual,
    obterConfigJornadaChef: vi.fn(async () => ({ modoRollout: "canary", metaPizzas: 12, sequenciaRecompensas: [] })),
    obterEstadoJornada: vi.fn(async () => ({ cicloAtual: 2, pizzasNoCiclo: 3, totalJornadasConcluidas: 1 })),
    jornadaAtivaParaCliente: vi.fn(() => true),
    obterRecompensasCliente: vi.fn(async (clienteId: string) => {
      const { derivarClienteIdPorTelefone } = await import("@/lib/fidelidade");
      if (clienteId !== derivarClienteIdPorTelefone(TELEFONE_CLIENTE_A)) return [];
      return [
        {
          recompensaId: "rec_a1",
          ciclo: 1,
          status: "fechada",
          tipo: "pizza",
          produtoNome: "Pizza G Calabresa",
          codigoPublico: CODIGO_INTEGRAL,
          pedidoOrigemId: "ped_1",
          criadaEm: "2026-07-01T00:00:00.000Z",
          atualizadaEm: "2026-07-01T00:00:00.000Z",
        },
      ];
    }),
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

function req(token: string | undefined, telefone: string) {
  const url = `http://localhost/api/admin/jornada-chef?telefone=${encodeURIComponent(telefone)}`;
  const headers: Record<string, string> = {};
  if (token) headers.cookie = `auth-token=${token}`;
  return new NextRequest(url, { headers });
}

describe("GET /api/admin/jornada-chef — consulta administrativa nunca expõe o código integral", () => {
  test("sem cookie retorna 401", async () => {
    const res = await GET(req(undefined, TELEFONE_CLIENTE_A));
    expect(res.status).toBe(401);
  });

  test("retorna somente codigoMascarado, nunca o codigoPublico integral", async () => {
    const res = await GET(req("token-atendente", TELEFONE_CLIENTE_A));
    expect(res.status).toBe(200);
    const data = await res.json();
    const recompensa = data.recompensas[0];
    expect(recompensa.codigoMascarado).toBe("JC-••••••••EF56");
    expect(recompensa).not.toHaveProperty("codigoPublico");
  });

  test("resposta JSON completa nunca contém o código integral", async () => {
    const res = await GET(req("token-atendente", TELEFONE_CLIENTE_A));
    const data = await res.json();
    expect(JSON.stringify(data)).not.toContain(CODIGO_INTEGRAL);
  });

  test("cliente diferente (outro telefone) nao acessa a recompensa do primeiro", async () => {
    const res = await GET(req("token-atendente", "86988887777"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.recompensas).toEqual([]);
  });

  test("telefone invalido retorna 400", async () => {
    const res = await GET(req("token-atendente", "123"));
    expect(res.status).toBe(400);
  });
});
