import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verifyToken: vi.fn(),
  cofreChefCalibracaoHabilitada: vi.fn(),
  calibrarComportamentoCofre: vi.fn(),
  consultarEventosPorPeriodo: vi.fn(),
  periodo30Dias: vi.fn(),
  periodo60Dias: vi.fn(),
  periodo90Dias: vi.fn(),
  obterTemporadaAtivaSomenteLeitura: vi.fn(),
  obterRankingCompleto: vi.fn(),
  obterParticipacaoRankingParaClientes: vi.fn(),
  reindexarPorFiltro: vi.fn((entradas: Array<{ clienteId: string; score: number; posicao: number }>, incluir: (id: string) => boolean) =>
    entradas.filter((e) => incluir(e.clienteId)).map((e, index) => ({ ...e, posicao: index + 1 }))
  ),
}));

vi.mock("@/lib/auth", () => ({ verifyToken: mocks.verifyToken }));
vi.mock("@/lib/cofreChefCalibracao", () => ({
  cofreChefCalibracaoHabilitada: mocks.cofreChefCalibracaoHabilitada,
  calibrarComportamentoCofre: mocks.calibrarComportamentoCofre,
}));
vi.mock("@/lib/historicoAnalitico", () => ({
  TENANT_PADRAO_ANALYTICS: "default",
  consultarEventosPorPeriodo: mocks.consultarEventosPorPeriodo,
  periodo30Dias: mocks.periodo30Dias,
  periodo60Dias: mocks.periodo60Dias,
  periodo90Dias: mocks.periodo90Dias,
}));
vi.mock("@/lib/temporadas", () => ({
  obterTemporadaAtivaSomenteLeitura: mocks.obterTemporadaAtivaSomenteLeitura,
}));
vi.mock("@/lib/rankingClientes", () => ({
  obterRankingCompleto: mocks.obterRankingCompleto,
  reindexarPorFiltro: mocks.reindexarPorFiltro,
}));
vi.mock("@/lib/consentimentoRanking", () => ({
  obterParticipacaoRankingParaClientes: mocks.obterParticipacaoRankingParaClientes,
}));

import { GET } from "./route";

const FIM = Date.parse("2026-09-27T21:00:00.000Z");
const INICIO = FIM - 90 * 86400000;

function req(url = "https://chefedapizza.com.br/api/admin/cofre/calibracao") {
  const request = new NextRequest(url);
  request.cookies.set("auth-token", "token-teste");
  return request;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cofreChefCalibracaoHabilitada.mockReturnValue(true);
  mocks.verifyToken.mockResolvedValue({ username: "kellyne", name: "Kellyne", role: "admin" });
  mocks.periodo30Dias.mockReturnValue({ inicioMs: FIM - 30 * 86400000, fimMs: FIM });
  mocks.periodo60Dias.mockReturnValue({ inicioMs: FIM - 60 * 86400000, fimMs: FIM });
  mocks.periodo90Dias.mockReturnValue({ inicioMs: INICIO, fimMs: FIM });
  mocks.obterTemporadaAtivaSomenteLeitura.mockResolvedValue({
    temporadaId: "temp_1",
    tenantId: "default",
    nome: "Temporada",
    estado: "ativa",
    criadaEm: "2026-09-01T00:00:00.000Z",
  });
  mocks.obterRankingCompleto.mockResolvedValue([
    { clienteId: "cli_a", score: 100, posicao: 1 },
    { clienteId: "cli_b", score: 90, posicao: 2 },
    { clienteId: "cli_c", score: 80, posicao: 3 },
  ]);
  mocks.obterParticipacaoRankingParaClientes.mockResolvedValue(new Map([
    ["cli_a", true],
    ["cli_b", false],
    ["cli_c", true],
  ]));
  mocks.consultarEventosPorPeriodo.mockResolvedValue([]);
  mocks.calibrarComportamentoCofre.mockReturnValue({
    schemaVersao: 1,
    modo: "calibracao_somente_leitura",
    clientesParticipantesObservados: 2,
    cobertura: {
      inicioSolicitadoMs: INICIO,
      fimSolicitadoMs: FIM,
      primeiroEventoObservadoMs: null,
      ultimoEventoObservadoMs: null,
      diasObservados: null,
    },
    recorrencia: {
      clientesCom1Pedido: 0,
      clientesCom2OuMaisPedidos: 0,
      clientesCom3OuMaisPedidos: 0,
      clientesComCadenciaIndividual: 0,
      intervalosObservados: 0,
      intervaloEntrePedidosDias: { p25: null, p50: null, p75: null, p90: null },
      razaoGapAtualSobreMedianaIndividual: { p25: null, p50: null, p75: null, p90: null },
    },
    ticket: {
      pedidosValidos: 0,
      ticketElegivelCents: { p25: null, p50: null, p75: null, p90: null },
      clientesComBaseParaCompararUltimoTicket: 0,
      razaoUltimoTicketSobreMedianaAnterior: { p25: null, p50: null, p75: null, p90: null },
    },
    ativacaoAutomatica: {
      permitida: false,
      motivo: "calibracao_nao_define_regra_comercial",
    },
  });
});

describe("GET /api/admin/cofre/calibracao", () => {
  test("fica 404 com release gate fechado e não lê dados", async () => {
    mocks.cofreChefCalibracaoHabilitada.mockReturnValue(false);

    const res = await GET(req());

    expect(res.status).toBe(404);
    expect(mocks.verifyToken).not.toHaveBeenCalled();
    expect(mocks.consultarEventosPorPeriodo).not.toHaveBeenCalled();
  });

  test("exige role admin/dev", async () => {
    mocks.verifyToken.mockResolvedValue({ username: "salao", name: "Salao", role: "atendente" });

    const res = await GET(req());

    expect(res.status).toBe(401);
    expect(mocks.consultarEventosPorPeriodo).not.toHaveBeenCalled();
  });

  test("rejeita período fora da lista fechada", async () => {
    const res = await GET(req("https://chefedapizza.com.br/api/admin/cofre/calibracao?periodo=7"));

    expect(res.status).toBe(400);
    expect(mocks.consultarEventosPorPeriodo).not.toHaveBeenCalled();
  });

  test("calibra apenas participantes ativos e retorna somente agregados", async () => {
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(FIM);

    const res = await GET(req("https://chefedapizza.com.br/api/admin/cofre/calibracao?periodo=90"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-chefebot-cofre-mode")).toBe("calibration-read-only");
    expect(body.coberturaRanking).toEqual({
      clientesNoRanking: 3,
      participantesAtivos: 2,
    });
    expect(mocks.calibrarComportamentoCofre).toHaveBeenCalledTimes(1);
    const chamada = mocks.calibrarComportamentoCofre.mock.calls[0]![0];
    expect([...chamada.participantes]).toEqual(["cli_a", "cli_c"]);

    const serializado = JSON.stringify(body);
    expect(serializado).not.toContain("cli_a");
    expect(serializado).not.toContain("cli_b");
    expect(serializado).not.toContain("cli_c");
    expect(body.calibracao.ativacaoAutomatica.permitida).toBe(false);

    dateSpy.mockRestore();
  });

  test("sem temporada ativa não inventa participantes", async () => {
    mocks.obterTemporadaAtivaSomenteLeitura.mockResolvedValue(null);
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(FIM);

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.temporada).toBeNull();
    expect(body.coberturaRanking).toEqual({
      clientesNoRanking: 0,
      participantesAtivos: 0,
    });
    expect(mocks.obterRankingCompleto).not.toHaveBeenCalled();

    dateSpy.mockRestore();
  });
});
