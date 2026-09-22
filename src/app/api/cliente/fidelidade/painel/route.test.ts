import { vi, describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

let temporadaAtiva: Record<string, unknown> | null = null;
let posicaoPorCliente = new Map<string, { posicao: number; score: number } | null>();
let topRanking: Array<{ clienteId: string; score: number; posicao: number }> = [];

vi.mock("@/lib/clienteAuth", () => ({
  CLIENTE_COOKIE: "cliente-token",
  lerSessaoCliente: vi.fn(async (req: { cookies: { get(n: string): { value: string } | undefined } }) => {
    const token = req.cookies.get("cliente-token")?.value ?? "";
    if (token === "token-cli-a") return { clienteId: "cli_a", telefone: "11900000001" };
    return null;
  }),
}));

vi.mock("@/lib/clientes", async () => {
  const actual = await vi.importActual<typeof import("@/lib/clientes")>("@/lib/clientes");
  return {
    ...actual,
    buscarClientePorId: vi.fn(async (clienteId: string) => {
      if (clienteId === "cli_a")
        return { clienteId: "cli_a", telefone: "11900000001", nome: "A", createdAt: "", updatedAt: "", lastLoginAt: "" };
      return null;
    }),
  };
});

vi.mock("@/lib/fidelidade", async () => {
  const actual = await vi.importActual<typeof import("@/lib/fidelidade")>("@/lib/fidelidade");
  return {
    ...actual,
    derivarClienteIdPorTelefone: vi.fn((telefone: string) => `hashed_${telefone}`),
  };
});

vi.mock("@/lib/temporadas", () => ({
  obterTemporadaAtiva: vi.fn(async () => temporadaAtiva),
}));

vi.mock("@/lib/rankingClientes", () => ({
  posicaoClienteRanking: vi.fn(async (_tenantId: string, _tempId: string, clienteId: string) =>
    posicaoPorCliente.get(clienteId) ?? null,
  ),
  obterTopRanking: vi.fn(async () => topRanking),
}));

import { GET } from "./route";

function req(token?: string) {
  const url = "http://localhost/api/cliente/fidelidade/painel";
  const init = token ? { headers: { cookie: `cliente-token=${token}` } } : undefined;
  return new NextRequest(url, init);
}

beforeEach(() => {
  temporadaAtiva = null;
  posicaoPorCliente = new Map();
  topRanking = [];
});

describe("GET /api/cliente/fidelidade/painel", () => {
  test("401 sem autenticação", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  test("retorna temporada null quando não há temporada ativa", async () => {
    const res = await GET(req("token-cli-a"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.temporada).toBeNull();
    expect(body.ranking).toBeNull();
  });

  test("retorna dados de temporada quando há temporada ativa", async () => {
    const fimEm = new Date(Date.now() + 5 * 86400000).toISOString();
    temporadaAtiva = { temporadaId: "temp_1", nome: "Temporada Outono", fimEm, estado: "ativa" };
    const res = await GET(req("token-cli-a"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.temporada?.nome).toBe("Temporada Outono");
    expect(body.temporada?.diasRestantes).toBeGreaterThanOrEqual(4);
    expect(body.temporada?.diasRestantes).toBeLessThanOrEqual(5);
    expect(body.temporada?.estado).toBe("ativa");
  });

  test("diasRestantes = 0 quando fimEm já passou", async () => {
    const fimEm = new Date(Date.now() - 1000).toISOString();
    temporadaAtiva = { temporadaId: "temp_1", nome: null, fimEm, estado: "encerrada" };
    const res = await GET(req("token-cli-a"));
    const body = await res.json();
    expect(body.temporada?.diasRestantes).toBe(0);
  });

  test("ranking retorna posicao do cliente quando ranqueado", async () => {
    temporadaAtiva = { temporadaId: "temp_1", nome: null, fimEm: null, estado: "ativa" };
    const clienteId = "hashed_11900000001";
    posicaoPorCliente.set(clienteId, { posicao: 3, score: 150 });
    topRanking = [
      { clienteId: "outro_1", score: 200, posicao: 2 },
      { clienteId, score: 150, posicao: 3 },
      { clienteId: "outro_2", score: 100, posicao: 4 },
    ];
    const res = await GET(req("token-cli-a"));
    const body = await res.json();
    expect(body.ranking?.posicao).toBe(3);
    expect(body.ranking?.score).toBe(150);
  });

  test("entorno nunca expõe clienteId — só posicao e eVoce", async () => {
    temporadaAtiva = { temporadaId: "temp_1", nome: null, fimEm: null, estado: "ativa" };
    const clienteId = "hashed_11900000001";
    posicaoPorCliente.set(clienteId, { posicao: 3, score: 150 });
    topRanking = [
      { clienteId: "outro_1", score: 200, posicao: 2 },
      { clienteId, score: 150, posicao: 3 },
      { clienteId: "outro_2", score: 100, posicao: 4 },
    ];
    const res = await GET(req("token-cli-a"));
    const body = await res.json();
    const entorno: unknown[] = body.ranking?.entorno ?? [];
    expect(entorno.length).toBeGreaterThan(0);
    for (const entrada of entorno) {
      expect(entrada).not.toHaveProperty("clienteId");
      expect(entrada).toHaveProperty("posicao");
      expect(entrada).toHaveProperty("eVoce");
    }
    const lista = body.ranking?.lista ?? [];
    expect(lista.length).toBeGreaterThan(0);
    for (const entrada of lista) {
      expect(entrada).not.toHaveProperty("clienteId");
      expect(entrada).toHaveProperty("posicao");
      expect(entrada).toHaveProperty("score");
      expect(entrada).toHaveProperty("eVoce");
    }
    const voce = entorno.find((e) => (e as { eVoce: boolean }).eVoce === true);
    expect(voce).toBeDefined();
    expect((voce as { posicao: number }).posicao).toBe(3);
  });

  test("ranking null quando cliente não está no ranking", async () => {
    temporadaAtiva = { temporadaId: "temp_1", nome: null, fimEm: null, estado: "ativa" };
    // posicaoPorCliente vazio → posicaoClienteRanking retorna null
    const res = await GET(req("token-cli-a"));
    const body = await res.json();
    expect(body.ranking).toBeNull();
  });
});
