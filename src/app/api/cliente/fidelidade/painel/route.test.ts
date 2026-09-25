import { vi, describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

let temporadaAtiva: Record<string, unknown> | null = null;
let posicaoPorCliente = new Map<string, { posicao: number; score: number } | null>();
let topRanking: Array<{ clienteId: string; score: number; posicao: number }> = [];
let rankingCompleto: Array<{ clienteId: string; score: number; posicao: number }> = [];
let identidadesPublicas = new Map<string, { participaCampanha: boolean; nomePublico: string | null; telefoneMascarado: string | null; fotoPerfilUrl: null }>();

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

vi.mock("@/lib/rankingClientes", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rankingClientes")>("@/lib/rankingClientes");
  return {
    ...actual,
    posicaoClienteRanking: vi.fn(async (_tenantId: string, _tempId: string, clienteId: string) =>
      posicaoPorCliente.get(clienteId) ?? null,
    ),
    obterTopRanking: vi.fn(async () => topRanking),
    obterRankingCompleto: vi.fn(async () => rankingCompleto),
  };
});

vi.mock("@/lib/rankingPrivacidade", () => ({
  projetarIdentidadesPublicasRanking: vi.fn(async () => identidadesPublicas),
}));

let posicaoAnteriorMock: { geral: number; participantes: number | null } | null = null;

vi.mock("@/lib/rankingHistorico", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rankingHistorico")>("@/lib/rankingHistorico");
  return {
    ...actual,
    garantirSnapshotDiario: vi.fn(async () => {}),
    obterPosicaoAnterior: vi.fn(async () => posicaoAnteriorMock),
  };
});

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
  rankingCompleto = [];
  identidadesPublicas = new Map();
  posicaoAnteriorMock = null;
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

  test("identidade opcional vem somente da projecao server-side e nunca inclui clienteId", async () => {
    temporadaAtiva = { temporadaId: "temp_1", nome: null, fimEm: null, estado: "ativa" };
    const clienteId = "hashed_11900000001";
    posicaoPorCliente.set(clienteId, { posicao: 2, score: 150 });
    topRanking = [
      { clienteId: "outro_1", score: 200, posicao: 1 },
      { clienteId, score: 150, posicao: 2 },
    ];
    identidadesPublicas.set("outro_1", {
      participaCampanha: true,
      nomePublico: "Ana",
      telefoneMascarado: "(11) 9••••-1234",
      fotoPerfilUrl: null,
    });

    const body = await (await GET(req("token-cli-a"))).json();
    expect(body.ranking.lista[0]).toEqual({
      posicao: 1,
      score: 200,
      eVoce: false,
      participaCampanha: true,
      nomePublico: "Ana",
      telefoneMascarado: "(11) 9••••-1234",
    });
    expect(JSON.stringify(body)).not.toContain("outro_1");
  });

  test("posição entre participantes é recalculada, nunca herda a posição geral", async () => {
    temporadaAtiva = { temporadaId: "temp_1", nome: null, fimEm: null, estado: "ativa" };
    const clienteId = "hashed_11900000001";
    // Geral: 1º e 2º não participam; o cliente autenticado é o 3º geral mas
    // o 1º colocado ENTRE PARTICIPANTES (únicos dois que autorizaram).
    posicaoPorCliente.set(clienteId, { posicao: 3, score: 100 });
    topRanking = [
      { clienteId: "nao_participa_1", score: 300, posicao: 1 },
      { clienteId: "nao_participa_2", score: 200, posicao: 2 },
      { clienteId, score: 100, posicao: 3 },
      { clienteId: "participa_2", score: 50, posicao: 4 },
    ];
    rankingCompleto = topRanking;
    identidadesPublicas = new Map([
      ["nao_participa_1", { participaCampanha: false, nomePublico: null, telefoneMascarado: null, fotoPerfilUrl: null }],
      ["nao_participa_2", { participaCampanha: false, nomePublico: null, telefoneMascarado: null, fotoPerfilUrl: null }],
      [clienteId, { participaCampanha: true, nomePublico: "Você", telefoneMascarado: "(11) 9••••-0001", fotoPerfilUrl: null }],
      ["participa_2", { participaCampanha: true, nomePublico: "Bia", telefoneMascarado: "(21) 9••••-0002", fotoPerfilUrl: null }],
    ]);

    const body = await (await GET(req("token-cli-a"))).json();
    // Posição geral continua 3 (não é sobrescrita).
    expect(body.ranking.posicao).toBe(3);
    // Entre participantes, o cliente é o 1º colocado — pódio real, não geral.
    expect(body.ranking.participantes.posicao).toBe(1);
    expect(body.ranking.participantes.total).toBe(2);
    expect(body.ranking.participantes.lista).toEqual([
      { posicao: 1, score: 100, eVoce: true, participaCampanha: true, nomePublico: "Você", telefoneMascarado: "(11) 9••••-0001" },
      { posicao: 2, score: 50, eVoce: false, participaCampanha: true, nomePublico: "Bia", telefoneMascarado: "(21) 9••••-0002" },
    ]);
    // Ninguém que não autorizou aparece na lista de participantes.
    expect(JSON.stringify(body.ranking.participantes)).not.toContain("nao_participa");
  });

  test("participante fora do Top 50 geral ainda aparece com a própria posição entre participantes", async () => {
    temporadaAtiva = { temporadaId: "temp_1", nome: null, fimEm: null, estado: "ativa" };
    const clienteId = "hashed_11900000001";
    posicaoPorCliente.set(clienteId, { posicao: 60, score: 5 });
    topRanking = []; // fora do Top 50 geral
    // Ranking completo: 59 não-participantes à frente, depois o cliente.
    rankingCompleto = [
      ...Array.from({ length: 59 }, (_, i) => ({ clienteId: `outro_${i}`, score: 100 - i, posicao: i + 1 })),
      { clienteId, score: 5, posicao: 60 },
    ];
    identidadesPublicas = new Map([
      [clienteId, { participaCampanha: true, nomePublico: "Você", telefoneMascarado: "(11) 9••••-0001", fotoPerfilUrl: null }],
    ]);

    const body = await (await GET(req("token-cli-a"))).json();
    expect(body.ranking.participantes.posicao).toBe(1);
    expect(body.ranking.participantes.total).toBe(1);
    const proprio = body.ranking.participantes.lista.find((e: { eVoce: boolean }) => e.eVoce);
    expect(proprio).toMatchObject({ posicao: 1, score: 5 });
  });

  test("variacaoPosicao null quando não há snapshot anterior — nunca inventa 'manteve'", async () => {
    temporadaAtiva = { temporadaId: "temp_1", nome: null, fimEm: null, estado: "ativa" };
    const clienteId = "hashed_11900000001";
    posicaoPorCliente.set(clienteId, { posicao: 3, score: 100 });
    topRanking = [{ clienteId, score: 100, posicao: 3 }];
    rankingCompleto = topRanking;
    identidadesPublicas.set(clienteId, { participaCampanha: false, nomePublico: null, telefoneMascarado: null, fotoPerfilUrl: null });
    posicaoAnteriorMock = null;

    const body = await (await GET(req("token-cli-a"))).json();
    expect(body.ranking.variacaoPosicao).toBeNull();
    expect(body.ranking.participantes.variacaoPosicao).toBeNull();
  });

  test("variacaoPosicao reflete subida real contra o snapshot anterior", async () => {
    temporadaAtiva = { temporadaId: "temp_1", nome: null, fimEm: null, estado: "ativa" };
    const clienteId = "hashed_11900000001";
    posicaoPorCliente.set(clienteId, { posicao: 2, score: 150 });
    topRanking = [
      { clienteId: "outro", score: 200, posicao: 1 },
      { clienteId, score: 150, posicao: 2 },
    ];
    rankingCompleto = topRanking;
    identidadesPublicas.set(clienteId, { participaCampanha: true, nomePublico: "Você", telefoneMascarado: null, fotoPerfilUrl: null });
    identidadesPublicas.set("outro", { participaCampanha: false, nomePublico: null, telefoneMascarado: null, fotoPerfilUrl: null });
    posicaoAnteriorMock = { geral: 5, participantes: 3 };

    const body = await (await GET(req("token-cli-a"))).json();
    expect(body.ranking.variacaoPosicao).toEqual({ direcao: "subiu", casas: 3 });
    // Único participante hoje → 1º entre participantes; ontem era 3º.
    expect(body.ranking.participantes.variacaoPosicao).toEqual({ direcao: "subiu", casas: 2 });
  });

  test("variacaoPosicao entre participantes fica null quando o cliente não participa hoje", async () => {
    temporadaAtiva = { temporadaId: "temp_1", nome: null, fimEm: null, estado: "ativa" };
    const clienteId = "hashed_11900000001";
    posicaoPorCliente.set(clienteId, { posicao: 1, score: 10 });
    topRanking = [{ clienteId, score: 10, posicao: 1 }];
    rankingCompleto = topRanking;
    identidadesPublicas.set(clienteId, { participaCampanha: false, nomePublico: null, telefoneMascarado: null, fotoPerfilUrl: null });
    posicaoAnteriorMock = { geral: 4, participantes: 2 };

    const body = await (await GET(req("token-cli-a"))).json();
    expect(body.ranking.variacaoPosicao).toEqual({ direcao: "subiu", casas: 3 });
    expect(body.ranking.participantes.posicao).toBeNull();
    expect(body.ranking.participantes.variacaoPosicao).toBeNull();
  });

  test("ranking null quando cliente não está no ranking", async () => {
    temporadaAtiva = { temporadaId: "temp_1", nome: null, fimEm: null, estado: "ativa" };
    // posicaoPorCliente vazio → posicaoClienteRanking retorna null
    const res = await GET(req("token-cli-a"));
    const body = await res.json();
    expect(body.ranking).toBeNull();
  });
});
