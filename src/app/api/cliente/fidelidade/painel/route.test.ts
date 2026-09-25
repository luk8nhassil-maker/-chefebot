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

let configFidelidadeMock: { ativo: boolean; regraVersao: string } = { ativo: true, regraVersao: "estrelas-faixas-v1" };

vi.mock("@/lib/fidelidade", async () => {
  const actual = await vi.importActual<typeof import("@/lib/fidelidade")>("@/lib/fidelidade");
  return {
    ...actual,
    derivarClienteIdPorTelefone: vi.fn((telefone: string) => `hashed_${telefone}`),
    obterConfigFidelidadePontos: vi.fn(async () => configFidelidadeMock),
    obterExtratoPontos: vi.fn(async () => [] as unknown[]),
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

const { registrarFatoMock, marcarLiderancaMock } = vi.hoisted(() => ({
  registrarFatoMock: vi.fn(async (_tipo: string, _eventoId: string) => true),
  marcarLiderancaMock: vi.fn(async (_tenantId: string, _temporadaId: string, _clienteId: string) => false),
}));

vi.mock("@/lib/rankingGamificacaoFatos", () => ({
  registrarFatoRankingGamificacao: registrarFatoMock,
  marcarLiderancaEVerificarSeJaFoiLider: marcarLiderancaMock,
}));

vi.mock("@/lib/rankingHistorico", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rankingHistorico")>("@/lib/rankingHistorico");
  return {
    ...actual,
    garantirSnapshotDiario: vi.fn(async () => {}),
    obterPosicaoAnterior: vi.fn(async () => posicaoAnteriorMock),
  };
});

let configGamificacaoMock: Record<string, unknown> = {
  missaoSemanalAtiva: false,
  missaoIndicacaoAtiva: false,
  impulsoPodioAtivo: false,
  carryoverAtivo: false,
  nivelChefAtivo: false,
  nivelChefLimiares: [],
};

const {
  obterConfigGamificacaoMock,
  obterBonusMock,
  aplicarCarryoverMock,
  sincronizarStatusSocialMock,
  sincronizarMissaoSemanalMock,
  obterEstadoMissaoIndicacaoMock,
  aplicarImpulsoPodioMock,
  sincronizarNivelChefMock,
} = vi.hoisted(() => ({
  obterConfigGamificacaoMock: vi.fn(),
  obterBonusMock: vi.fn(async () => 0),
  aplicarCarryoverMock: vi.fn(async () => undefined),
  sincronizarStatusSocialMock: vi.fn(async () => null as { status: string | null; temporadaOrigemId: string; atribuidoEm: string } | null),
  sincronizarMissaoSemanalMock: vi.fn(async () => ({
    status: "inativa" as "inativa" | "desbloqueada" | "consumida",
    desbloqueadaEm: null as string | null,
    consumidaEm: null as string | null,
    consumidaPedidoId: null as string | null,
  })),
  obterEstadoMissaoIndicacaoMock: vi.fn(async () => ({
    concluida: false,
    concluidaEm: null as string | null,
    pedidoId: null as string | null,
  })),
  aplicarImpulsoPodioMock: vi.fn(async () => undefined),
  sincronizarNivelChefMock: vi.fn(async () => undefined),
}));

vi.mock("@/lib/rankingGamificacaoConfig", () => ({ obterConfigGamificacao: obterConfigGamificacaoMock }));
vi.mock("@/lib/rankingBonusTemporada", () => ({ obterBonusCompeticaoDaTemporada: obterBonusMock }));
vi.mock("@/lib/rankingTransicaoTemporada", () => ({
  aplicarCarryoverClienteSeNecessario: aplicarCarryoverMock,
  sincronizarStatusSocialCliente: sincronizarStatusSocialMock,
}));
vi.mock("@/lib/rankingMissaoSemanalEstado", () => ({ sincronizarMissaoSemanalCliente: sincronizarMissaoSemanalMock }));
vi.mock("@/lib/rankingMissaoIndicacaoEstado", () => ({ obterEstadoMissaoIndicacao: obterEstadoMissaoIndicacaoMock }));
vi.mock("@/lib/rankingImpulsoPodioEstado", () => ({ aplicarImpulsoPodioSeElegivel: aplicarImpulsoPodioMock }));
vi.mock("@/lib/rankingNivelChefEstado", () => ({ sincronizarNivelChefCliente: sincronizarNivelChefMock }));

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
  configFidelidadeMock = { ativo: true, regraVersao: "estrelas-faixas-v1" };
  registrarFatoMock.mockClear();
  marcarLiderancaMock.mockClear().mockResolvedValue(false);
  configGamificacaoMock = {
    missaoSemanalAtiva: false,
    missaoIndicacaoAtiva: false,
    impulsoPodioAtivo: false,
    carryoverAtivo: false,
    nivelChefAtivo: false,
    nivelChefLimiares: [],
  };
  obterConfigGamificacaoMock.mockReset().mockImplementation(async () => configGamificacaoMock);
  obterBonusMock.mockReset().mockResolvedValue(0);
  aplicarCarryoverMock.mockReset().mockResolvedValue(undefined);
  sincronizarStatusSocialMock.mockReset().mockResolvedValue(null);
  sincronizarMissaoSemanalMock.mockReset().mockResolvedValue({ status: "inativa", desbloqueadaEm: null, consumidaEm: null, consumidaPedidoId: null });
  obterEstadoMissaoIndicacaoMock.mockReset().mockResolvedValue({ concluida: false, concluidaEm: null, pedidoId: null });
  aplicarImpulsoPodioMock.mockReset().mockResolvedValue(undefined);
  sincronizarNivelChefMock.mockReset().mockResolvedValue(undefined);
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
    // Fatos de negócio registrados no SERVIDOR (nunca pelo navegador,
    // correção do #445). Ontem já era #3 entre participantes (dentro do
    // Top 10 e do Top 3), então só "subiu" e "chegou ao #1" são fatos reais
    // — "entrou_top10"/"entrou_top3" corretamente NÃO disparam de novo.
    const tiposRegistrados = registrarFatoMock.mock.calls.map((c) => c[0]);
    expect(tiposRegistrados).toEqual(expect.arrayContaining(["subiu_posicao", "chegou_top1"]));
    expect(tiposRegistrados).not.toContain("entrou_top10");
    expect(tiposRegistrados).not.toContain("entrou_top3");
    // Todas as chamadas usam o MESMO eventoId do dia — idempotente mesmo
    // que a rota seja chamada várias vezes no mesmo dia.
    const eventoIds = new Set(registrarFatoMock.mock.calls.map((c) => c[1]));
    expect(eventoIds.size).toBe(1);
  });

  test("sem variação (sem snapshot anterior) nunca registra fato nenhum", async () => {
    temporadaAtiva = { temporadaId: "temp_1", nome: null, fimEm: null, estado: "ativa" };
    const clienteId = "hashed_11900000001";
    posicaoPorCliente.set(clienteId, { posicao: 1, score: 10 });
    topRanking = [{ clienteId, score: 10, posicao: 1 }];
    rankingCompleto = topRanking;
    identidadesPublicas.set(clienteId, { participaCampanha: true, nomePublico: "Você", telefoneMascarado: null, fotoPerfilUrl: null });
    posicaoAnteriorMock = null;

    await GET(req("token-cli-a"));
    expect(registrarFatoMock).not.toHaveBeenCalled();
  });

  test("manteve a posição não registra fato nenhum", async () => {
    temporadaAtiva = { temporadaId: "temp_1", nome: null, fimEm: null, estado: "ativa" };
    const clienteId = "hashed_11900000001";
    posicaoPorCliente.set(clienteId, { posicao: 4, score: 10 });
    topRanking = [{ clienteId, score: 10, posicao: 4 }];
    rankingCompleto = topRanking;
    identidadesPublicas.set(clienteId, { participaCampanha: true, nomePublico: "Você", telefoneMascarado: null, fotoPerfilUrl: null });
    posicaoAnteriorMock = { geral: 4, participantes: 1 };

    await GET(req("token-cli-a"));
    expect(registrarFatoMock).not.toHaveBeenCalled();
  });

  test("desceu do #1 registra perdeu_lideranca", async () => {
    temporadaAtiva = { temporadaId: "temp_1", nome: null, fimEm: null, estado: "ativa" };
    const clienteId = "hashed_11900000001";
    posicaoPorCliente.set(clienteId, { posicao: 2, score: 10 });
    topRanking = [
      { clienteId: "outro", score: 20, posicao: 1 },
      { clienteId, score: 10, posicao: 2 },
    ];
    rankingCompleto = topRanking;
    identidadesPublicas.set(clienteId, { participaCampanha: true, nomePublico: "Você", telefoneMascarado: null, fotoPerfilUrl: null });
    identidadesPublicas.set("outro", { participaCampanha: true, nomePublico: "Outro", telefoneMascarado: null, fotoPerfilUrl: null });
    posicaoAnteriorMock = { geral: 1, participantes: 1 };

    await GET(req("token-cli-a"));
    expect(registrarFatoMock).toHaveBeenCalledWith("perdeu_lideranca", expect.any(String));
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

  test("alvo e disputa calculados entre participantes com o vizinho real acima/abaixo", async () => {
    temporadaAtiva = { temporadaId: "temp_1", nome: null, fimEm: null, estado: "ativa" };
    const clienteId = "hashed_11900000001";
    posicaoPorCliente.set(clienteId, { posicao: 2, score: 20 });
    topRanking = [
      { clienteId: "ana", score: 30, posicao: 1 },
      { clienteId, score: 20, posicao: 2 },
      { clienteId: "carlos", score: 10, posicao: 3 },
    ];
    rankingCompleto = topRanking;
    identidadesPublicas = new Map([
      ["ana", { participaCampanha: true, nomePublico: "Ana", telefoneMascarado: null, fotoPerfilUrl: null }],
      [clienteId, { participaCampanha: true, nomePublico: "Você", telefoneMascarado: null, fotoPerfilUrl: null }],
      ["carlos", { participaCampanha: true, nomePublico: "Carlos", telefoneMascarado: null, fotoPerfilUrl: null }],
    ]);

    const body = await (await GET(req("token-cli-a"))).json();
    expect(body.ranking.participantes.alvo).toEqual({
      estado: "alcancar",
      alvoPosicao: 1,
      necessario: 11,
      scoreAlvo: 30,
    });
    expect(body.ranking.participantes.disputa).toEqual({
      acima: { posicao: 1, score: 30, eVoce: false, nomePublico: "Ana", telefoneMascarado: null },
      voce: { posicao: 2, score: 20, eVoce: true, nomePublico: "Você", telefoneMascarado: null },
      abaixo: { posicao: 3, score: 10, eVoce: false, nomePublico: "Carlos", telefoneMascarado: null },
      sozinho: false,
    });
  });

  test("único participante: alvo sozinho e disputa sem vizinhos", async () => {
    temporadaAtiva = { temporadaId: "temp_1", nome: null, fimEm: null, estado: "ativa" };
    const clienteId = "hashed_11900000001";
    posicaoPorCliente.set(clienteId, { posicao: 1, score: 5 });
    topRanking = [{ clienteId, score: 5, posicao: 1 }];
    rankingCompleto = topRanking;
    identidadesPublicas.set(clienteId, { participaCampanha: true, nomePublico: "Você", telefoneMascarado: null, fotoPerfilUrl: null });

    const body = await (await GET(req("token-cli-a"))).json();
    expect(body.ranking.participantes.alvo).toEqual({ estado: "sozinho" });
    expect(body.ranking.participantes.disputa).toEqual({
      acima: null,
      voce: { posicao: 1, score: 5, eVoce: true, nomePublico: "Você", telefoneMascarado: null },
      abaixo: null,
      sozinho: true,
    });
  });

  test("alvo e disputa ficam null quando o cliente não participa (sem posição entre participantes)", async () => {
    temporadaAtiva = { temporadaId: "temp_1", nome: null, fimEm: null, estado: "ativa" };
    const clienteId = "hashed_11900000001";
    posicaoPorCliente.set(clienteId, { posicao: 1, score: 5 });
    topRanking = [{ clienteId, score: 5, posicao: 1 }];
    rankingCompleto = topRanking;
    identidadesPublicas.set(clienteId, { participaCampanha: false, nomePublico: null, telefoneMascarado: null, fotoPerfilUrl: null });

    const body = await (await GET(req("token-cli-a"))).json();
    expect(body.ranking.participantes.alvo).toBeNull();
    expect(body.ranking.participantes.disputa).toBeNull();
  });

  test("premio da temporada é fail-closed: null sem aprovação explícita do admin", async () => {
    temporadaAtiva = {
      temporadaId: "temp_1",
      nome: "Temporada",
      fimEm: null,
      estado: "ativa",
      premioDescricao: "1 pizza família",
      // premioAprovado ausente — não deve declarar prêmio.
      premioQuantidadePremiados: 3,
    };
    const body = await (await GET(req("token-cli-a"))).json();
    expect(body.temporada.premio).toBeNull();
  });

  test("premio aparece só quando aprovado e com quantidade > 0", async () => {
    temporadaAtiva = {
      temporadaId: "temp_1",
      nome: "Temporada",
      fimEm: null,
      estado: "ativa",
      premioDescricao: "1 pizza família",
      premioAprovado: true,
      premioQuantidadePremiados: 3,
    };
    const body = await (await GET(req("token-cli-a"))).json();
    expect(body.temporada.premio).toEqual({ descricao: "1 pizza família", quantidadePremiados: 3 });
  });

  test("indicacao expõe a regra oficial (nunca hardcoded no frontend) quando Estrelas V1 está ativa", async () => {
    configFidelidadeMock = { ativo: true, regraVersao: "estrelas-faixas-v1" };
    const body = await (await GET(req("token-cli-a"))).json();
    expect(body.indicacao).toEqual({ ativa: true, estrelasPrimeiraCompra: 6 });
  });

  test("indicacao fica inativa quando as Estrelas V1 não estão ativas — nunca inventa o valor", async () => {
    configFidelidadeMock = { ativo: false, regraVersao: "estrelas-faixas-v1" };
    const body = await (await GET(req("token-cli-a"))).json();
    expect(body.indicacao).toEqual({ ativa: false, estrelasPrimeiraCompra: null });
  });

  test("consentimento revogado: cliente some do ranking de participantes (sem alvo/disputa fictícios)", async () => {
    temporadaAtiva = { temporadaId: "temp_1", nome: null, fimEm: null, estado: "ativa" };
    const clienteId = "hashed_11900000001";
    // O cliente TEM posição no ranking geral (continua acumulando estrelas),
    // mas revogou a autorização — não pode aparecer entre participantes.
    posicaoPorCliente.set(clienteId, { posicao: 2, score: 100 });
    topRanking = [
      { clienteId: "ana", score: 200, posicao: 1 },
      { clienteId, score: 100, posicao: 2 },
    ];
    rankingCompleto = topRanking;
    identidadesPublicas = new Map([
      ["ana", { participaCampanha: true, nomePublico: "Ana", telefoneMascarado: null, fotoPerfilUrl: null }],
      [clienteId, { participaCampanha: false, nomePublico: null, telefoneMascarado: null, fotoPerfilUrl: null }],
    ]);

    const body = await (await GET(req("token-cli-a"))).json();
    // Posição geral continua real — revogar não apaga estrelas nem histórico.
    expect(body.ranking.posicao).toBe(2);
    expect(body.ranking.participaCampanha).toBe(false);
    // Entre participantes, o cliente simplesmente não existe mais.
    expect(body.ranking.participantes.posicao).toBeNull();
    expect(body.ranking.participantes.alvo).toBeNull();
    expect(body.ranking.participantes.disputa).toBeNull();
  });

  test("temporada encerrada/expirada (obterTemporadaAtiva retorna null): sem ranking, sem alvo/disputa, sem quebrar", async () => {
    temporadaAtiva = null; // obterTemporadaAtiva já resolve para null quando a temporada ativa encerrou/expirou
    const res = await GET(req("token-cli-a"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.temporada).toBeNull();
    expect(body.ranking).toBeNull();
    // indicacao é independente de temporada — continua respondendo normalmente.
    expect(body.indicacao).toEqual({ ativa: true, estrelasPrimeiraCompra: 6 });
  });

  describe("gamificacao (V2)", () => {
    test("sem temporada, gamificacao vem toda fail-closed (null/0) e nunca quebra", async () => {
      temporadaAtiva = null;
      const res = await GET(req("token-cli-a"));
      const body = await res.json();
      expect(body.gamificacao).toEqual({
        statusSocial: null,
        bonusCompeticao: 0,
        missaoSemanal: null,
        missaoIndicacao: null,
        nivelChef: null,
      });
    });

    test("com temporada mas sem nenhuma config de gamificação ligada, tudo fica fail-closed", async () => {
      temporadaAtiva = { temporadaId: "temp_1", nome: null, fimEm: null, estado: "ativa" };
      const clienteId = "hashed_11900000001";
      posicaoPorCliente.set(clienteId, { posicao: 5, score: 100 });
      topRanking = [{ clienteId, score: 100, posicao: 5 }];
      const res = await GET(req("token-cli-a"));
      const body = await res.json();
      expect(body.gamificacao.missaoSemanal).toBeNull();
      expect(body.gamificacao.missaoIndicacao).toBeNull();
      expect(body.gamificacao.nivelChef).toBeNull();
      expect(aplicarCarryoverMock).toHaveBeenCalledWith("default", temporadaAtiva, clienteId);
    });

    test("expõe o status social vigente quando a transição já foi sincronizada", async () => {
      temporadaAtiva = { temporadaId: "temp_2", nome: null, fimEm: null, estado: "ativa" };
      sincronizarStatusSocialMock.mockResolvedValue({ status: "campeao", temporadaOrigemId: "temp_1", atribuidoEm: "x" });
      const res = await GET(req("token-cli-a"));
      const body = await res.json();
      expect(body.gamificacao.statusSocial).toBe("campeao");
    });

    test("expõe o bônus de competição já acumulado na temporada", async () => {
      temporadaAtiva = { temporadaId: "temp_1", nome: null, fimEm: null, estado: "ativa" };
      obterBonusMock.mockResolvedValue(75);
      const res = await GET(req("token-cli-a"));
      const body = await res.json();
      expect(body.gamificacao.bonusCompeticao).toBe(75);
    });

    test("missão semanal ativa por config expõe o status atual", async () => {
      temporadaAtiva = { temporadaId: "temp_1", nome: null, fimEm: null, estado: "ativa" };
      configGamificacaoMock.missaoSemanalAtiva = true;
      sincronizarMissaoSemanalMock.mockResolvedValue({ status: "desbloqueada", desbloqueadaEm: "x", consumidaEm: null, consumidaPedidoId: null });
      const res = await GET(req("token-cli-a"));
      const body = await res.json();
      expect(body.gamificacao.missaoSemanal).toEqual({ status: "desbloqueada" });
    });

    test("missão de indicação ativa por config expõe o progresso 0/1", async () => {
      temporadaAtiva = { temporadaId: "temp_1", nome: null, fimEm: null, estado: "ativa" };
      configGamificacaoMock.missaoIndicacaoAtiva = true;
      obterEstadoMissaoIndicacaoMock.mockResolvedValue({ concluida: true, concluidaEm: "x", pedidoId: "p1" });
      const res = await GET(req("token-cli-a"));
      const body = await res.json();
      expect(body.gamificacao.missaoIndicacao).toEqual({ concluida: true });
    });

    test("nível de chef ativo por config expõe o nível calculado a partir do extrato", async () => {
      temporadaAtiva = { temporadaId: "temp_1", nome: null, fimEm: null, estado: "ativa" };
      configGamificacaoMock.nivelChefAtivo = true;
      configGamificacaoMock.nivelChefLimiares = [{ nivel: 1, nome: "Aprendiz", xpMinimo: 0 }];
      const res = await GET(req("token-cli-a"));
      const body = await res.json();
      expect(body.gamificacao.nivelChef).toEqual({ nivel: 1, nome: "Aprendiz", xpAtual: 0, xpProximoNivel: null });
      expect(sincronizarNivelChefMock).toHaveBeenCalledWith("default", "hashed_11900000001", 1);
    });

    test("nível de chef ativo mas nível calculado é 0 (abaixo do primeiro limiar): fica null, nunca mostra Nível 0", async () => {
      temporadaAtiva = { temporadaId: "temp_1", nome: null, fimEm: null, estado: "ativa" };
      configGamificacaoMock.nivelChefAtivo = true;
      configGamificacaoMock.nivelChefLimiares = [{ nivel: 1, nome: "Aprendiz", xpMinimo: 1000 }];
      const res = await GET(req("token-cli-a"));
      const body = await res.json();
      expect(body.gamificacao.nivelChef).toBeNull();
      expect(sincronizarNivelChefMock).not.toHaveBeenCalled();
    });
  });
});
