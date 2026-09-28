import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  obterParticipacaoRanking: vi.fn(),
  obterParticipacaoRankingParaClientes: vi.fn(),
  obterConfigFidelidadePontos: vi.fn(),
  estrelasV1Ativa: vi.fn(),
  obterExtratoPontos: vi.fn(),
  calcularSaldoEstrelas: vi.fn(),
  consultarEventosCliente: vi.fn(),
  obterTemporadaAtivaSomenteLeitura: vi.fn(),
  obterRankingCompleto: vi.fn(),
  reindexarPorFiltro: vi.fn((entradas: Array<{ clienteId: string; score: number; posicao: number }>, incluir: (id: string) => boolean) =>
    entradas.filter((e) => incluir(e.clienteId)).map((e, index) => ({ ...e, posicao: index + 1 }))
  ),
}));

vi.mock("./consentimentoRanking", () => ({
  obterParticipacaoRanking: mocks.obterParticipacaoRanking,
  obterParticipacaoRankingParaClientes: mocks.obterParticipacaoRankingParaClientes,
}));

vi.mock("./fidelidade", () => ({
  obterConfigFidelidadePontos: mocks.obterConfigFidelidadePontos,
  estrelasV1Ativa: mocks.estrelasV1Ativa,
  obterExtratoPontos: mocks.obterExtratoPontos,
  calcularSaldoEstrelas: mocks.calcularSaldoEstrelas,
}));

vi.mock("./historicoAnalitico", () => ({
  TENANT_PADRAO_ANALYTICS: "default",
  consultarEventosCliente: mocks.consultarEventosCliente,
}));

vi.mock("./temporadas", () => ({
  obterTemporadaAtivaSomenteLeitura: mocks.obterTemporadaAtivaSomenteLeitura,
}));

vi.mock("./rankingClientes", () => ({
  obterRankingCompleto: mocks.obterRankingCompleto,
  reindexarPorFiltro: mocks.reindexarPorFiltro,
}));

import {
  cofreChefReadModelHabilitado,
  obterCofreClienteSomenteLeitura,
} from "./cofreChefReadModel";

const AGORA = Date.parse("2026-09-27T21:00:00.000Z");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cofreChefReadModelHabilitado", () => {
  test("fica fechado por padrão e só abre com true explícito", () => {
    vi.stubEnv("COFRE_CHEFE_READMODEL_ATIVO", "");
    expect(cofreChefReadModelHabilitado()).toBe(false);

    vi.stubEnv("COFRE_CHEFE_READMODEL_ATIVO", "false");
    expect(cofreChefReadModelHabilitado()).toBe(false);

    vi.stubEnv("COFRE_CHEFE_READMODEL_ATIVO", "true");
    expect(cofreChefReadModelHabilitado()).toBe(true);
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.obterParticipacaoRanking.mockResolvedValue(true);
  mocks.obterConfigFidelidadePontos.mockResolvedValue({
    ativo: true,
    regraVersao: "estrelas-faixas-v1",
    descricaoRecompensa: "fixture",
  });
  mocks.estrelasV1Ativa.mockReturnValue(true);
  mocks.obterExtratoPontos.mockResolvedValue([]);
  mocks.calcularSaldoEstrelas.mockReturnValue(35);
  mocks.consultarEventosCliente.mockResolvedValue([]);
  mocks.obterTemporadaAtivaSomenteLeitura.mockResolvedValue(null);
  mocks.obterRankingCompleto.mockResolvedValue([]);
  mocks.obterParticipacaoRankingParaClientes.mockResolvedValue(new Map());
});

describe("obterCofreClienteSomenteLeitura", () => {
  test("cliente fora do Ranking falha fechado e não lê histórico/ledger", async () => {
    mocks.obterParticipacaoRanking.mockResolvedValue(false);

    const estado = await obterCofreClienteSomenteLeitura({
      clienteId: "cli_111",
      agoraMs: AGORA,
    });

    expect(estado.disponivel).toBe(false);
    expect(estado.motivoIndisponibilidade).toBe("nao_participa_ranking");
    expect(estado.ofertas).toEqual([]);
    expect(estado.economia.beneficiosFinanceirosLiberados).toBe(false);
    expect(mocks.obterExtratoPontos).not.toHaveBeenCalled();
    expect(mocks.consultarEventosCliente).not.toHaveBeenCalled();
  });

  test("Estrelas inativas bloqueiam antes de ler dados comportamentais", async () => {
    mocks.estrelasV1Ativa.mockReturnValue(false);

    const estado = await obterCofreClienteSomenteLeitura({
      clienteId: "cli_111",
      agoraMs: AGORA,
    });

    expect(estado.disponivel).toBe(false);
    expect(estado.motivoIndisponibilidade).toBe("estrelas_inativas");
    expect(mocks.consultarEventosCliente).not.toHaveBeenCalled();
    expect(mocks.obterRankingCompleto).not.toHaveBeenCalled();
  });

  test("lê somente o histórico do próprio cliente autenticado", async () => {
    mocks.consultarEventosCliente.mockResolvedValue([
      {
        pedidoId: "p1",
        clienteId: "cli_111",
        tenantId: "default",
        criadoEmMs: AGORA - 7 * 86400000,
        expedienteId: "2026-09-20",
        valorElegivelCents: 5200,
        statusAnalitico: "entregue",
        canal: "app",
        estrelasGeradas: 5,
        schemaVersao: 1,
        regraVersao: "estrelas-faixas-v1",
      },
    ]);

    const estado = await obterCofreClienteSomenteLeitura({
      clienteId: "cli_111",
      agoraMs: AGORA,
    });

    expect(mocks.consultarEventosCliente).toHaveBeenCalledTimes(1);
    expect(mocks.consultarEventosCliente).toHaveBeenCalledWith(
      "default",
      "cli_111",
      0,
      AGORA,
    );
    expect(estado.comportamento?.pedidosEntregues).toBe(1);
    expect(estado.estrelas.disponiveis).toBe(35);
    expect(estado.proximaAcao?.acao).toBe("coletando_dados");
  });

  test("reindexa apenas participantes e reconhece Pódio sem liberar oferta financeira", async () => {
    mocks.obterTemporadaAtivaSomenteLeitura.mockResolvedValue({
      temporadaId: "temp_1",
      tenantId: "default",
      nome: "Temporada Teste",
      estado: "ativa",
      criadaEm: "2026-09-01T00:00:00.000Z",
      ativadaEm: "2026-09-01T00:00:00.000Z",
    });
    mocks.obterRankingCompleto.mockResolvedValue([
      { clienteId: "cli_fora", score: 150, posicao: 1 },
      { clienteId: "cli_top", score: 120, posicao: 2 },
      { clienteId: "cli_111", score: 90, posicao: 3 },
      { clienteId: "cli_outro", score: 80, posicao: 4 },
    ]);
    mocks.obterParticipacaoRankingParaClientes.mockResolvedValue(new Map([
      ["cli_fora", false],
      ["cli_top", true],
      ["cli_111", true],
      ["cli_outro", true],
    ]));

    const estado = await obterCofreClienteSomenteLeitura({
      clienteId: "cli_111",
      agoraMs: AGORA,
    });

    expect(estado.ranking).toEqual({
      temporadaId: "temp_1",
      nomeTemporada: "Temporada Teste",
      posicaoParticipantes: 2,
      totalParticipantes: 3,
    });
    expect(estado.estrelas.scoreRankingTemporada).toBe(90);
    expect(estado.proximaAcao?.acao).toBe("podio_exclusivo");
    expect(estado.ofertas).toEqual([]);
    expect(estado.economia).toEqual({
      beneficiosFinanceirosLiberados: false,
      motivo: "regras_economicas_nao_aprovadas",
    });
  });

  test("não transforma thresholds fictícios do Preview em regra real", async () => {
    mocks.consultarEventosCliente.mockResolvedValue([
      {
        pedidoId: "p1",
        clienteId: "cli_111",
        tenantId: "default",
        criadoEmMs: AGORA - 30 * 86400000,
        expedienteId: "2026-08-28",
        valorElegivelCents: 8000,
        statusAnalitico: "entregue",
        canal: "app",
        estrelasGeradas: 7,
        schemaVersao: 1,
        regraVersao: "estrelas-faixas-v1",
      },
      {
        pedidoId: "p2",
        clienteId: "cli_111",
        tenantId: "default",
        criadoEmMs: AGORA - 20 * 86400000,
        expedienteId: "2026-09-07",
        valorElegivelCents: 8000,
        statusAnalitico: "entregue",
        canal: "app",
        estrelasGeradas: 7,
        schemaVersao: 1,
        regraVersao: "estrelas-faixas-v1",
      },
      {
        pedidoId: "p3",
        clienteId: "cli_111",
        tenantId: "default",
        criadoEmMs: AGORA - 10 * 86400000,
        expedienteId: "2026-09-17",
        valorElegivelCents: 3000,
        statusAnalitico: "entregue",
        canal: "app",
        estrelasGeradas: 3,
        schemaVersao: 1,
        regraVersao: "estrelas-faixas-v1",
      },
    ]);

    const estado = await obterCofreClienteSomenteLeitura({
      clienteId: "cli_111",
      agoraMs: AGORA,
    });

    expect(estado.comportamento?.pedidosEntregues).toBe(3);
    expect(estado.proximaAcao?.acao).toBe("coletando_dados");
    expect(estado.proximaAcao?.motivo).toBe("dados_insuficientes");
  });
});
