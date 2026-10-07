import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  temporada: vi.fn(),
  participa: vi.fn(),
  creditar: vi.fn(),
  movimentos: vi.fn(),
  sync: vi.fn(),
  extrato: vi.fn(),
  origem: vi.fn(),
}));

vi.mock("./rankingGamificacaoConfig", () => ({ obterConfigGamificacao: mocks.config }));
vi.mock("./temporadas", () => ({ obterTemporadaAtiva: mocks.temporada }));
vi.mock("./consentimentoRanking", () => ({ obterParticipacaoRanking: mocks.participa }));
vi.mock("./rankingBonusTemporada", () => ({
  creditarBonusCompeticao: mocks.creditar,
  obterMovimentosBonusTemporada: mocks.movimentos,
}));
vi.mock("./rankingScoreTemporadaSync", () => ({ sincronizarScoreTemporadaComBonus: mocks.sync }));
vi.mock("./fidelidade", () => ({
  obterExtratoPontos: mocks.extrato,
  classificarOrigemMovimentoPontos: mocks.origem,
}));

import {
  creditarMissaoDivulgacaoDiaria,
  obterEstadoMissaoDivulgacaoDiaria,
} from "./rankingMissaoDivulgacaoDiaria";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.mockResolvedValue({
    missaoDivulgacaoDiariaAtiva: true,
    missaoDivulgacaoDiariaBonus: 3,
  });
  mocks.temporada.mockResolvedValue({ temporadaId: "temp_1" });
  mocks.participa.mockResolvedValue(true);
  mocks.extrato.mockResolvedValue([]);
  mocks.origem.mockReturnValue("pedido");
  mocks.creditar.mockResolvedValue("creditado");
  mocks.sync.mockResolvedValue(undefined);
  mocks.movimentos.mockResolvedValue([]);
});

describe("missão diária de divulgação", () => {
  test("nova pessoa credita bônus de competição e sincroniza o Ranking", async () => {
    const agora = new Date("2026-10-07T18:00:00-03:00").getTime();
    const r = await creditarMissaoDivulgacaoDiaria({
      indicadorId: "cli_indicador",
      indicadoId: "cli_novo",
      agora,
    });
    expect(r).toEqual({ status: "creditado", pontos: 3, temporadaId: "temp_1" });
    expect(mocks.creditar).toHaveBeenCalledWith(expect.objectContaining({
      clienteId: "cli_indicador",
      tipo: "missao_divulgacao_diaria",
      pontos: 3,
      eventoId: "missao_divulgacao_diaria:cli_indicador:2026-10-07",
    }));
    expect(mocks.sync).toHaveBeenCalledWith("default", "temp_1", "cli_indicador");
  });

  test("mesmo expediente usa o mesmo evento idempotente", async () => {
    mocks.creditar.mockResolvedValue("ja_creditado");
    const r = await creditarMissaoDivulgacaoDiaria({
      indicadorId: "cli_indicador",
      indicadoId: "cli_novo_2",
      agora: new Date("2026-10-07T23:30:00-03:00").getTime(),
    });
    expect(r.status).toBe("ja_creditado");
    expect(mocks.creditar.mock.calls[0][0].eventoId).toBe(
      "missao_divulgacao_diaria:cli_indicador:2026-10-07",
    );
  });

  test("virada operacional às 03h libera um novo dia", async () => {
    await creditarMissaoDivulgacaoDiaria({
      indicadorId: "cli_indicador",
      indicadoId: "cli_a",
      agora: new Date("2026-10-08T02:30:00-03:00").getTime(),
    });
    await creditarMissaoDivulgacaoDiaria({
      indicadorId: "cli_indicador",
      indicadoId: "cli_b",
      agora: new Date("2026-10-08T03:30:00-03:00").getTime(),
    });
    expect(mocks.creditar.mock.calls[0][0].eventoId).toContain("2026-10-07");
    expect(mocks.creditar.mock.calls[1][0].eventoId).toContain("2026-10-08");
  });

  test("cliente com pedido comercial anterior não gera aquisição", async () => {
    mocks.extrato.mockResolvedValue([
      { tipo: "confirmado", pedidoId: "ped_1", eventoId: "confirmado:ped_1", pontos: 50 },
    ]);
    const r = await creditarMissaoDivulgacaoDiaria({
      indicadorId: "cli_indicador",
      indicadoId: "cli_antigo",
    });
    expect(r.status).toBe("cliente_existente");
    expect(mocks.creditar).not.toHaveBeenCalled();
  });

  test("falha ao provar que indicado é novo fica fail-closed", async () => {
    mocks.extrato.mockRejectedValue(new Error("redis down"));
    const r = await creditarMissaoDivulgacaoDiaria({
      indicadorId: "cli_indicador",
      indicadoId: "cli_incerto",
    });
    expect(r.status).toBe("cliente_existente");
    expect(mocks.creditar).not.toHaveBeenCalled();
  });

  test("missão desligada ou indicador fora do Ranking nunca credita", async () => {
    mocks.config.mockResolvedValue({
      missaoDivulgacaoDiariaAtiva: false,
      missaoDivulgacaoDiariaBonus: 3,
    });
    expect((await creditarMissaoDivulgacaoDiaria({
      indicadorId: "cli_a",
      indicadoId: "cli_b",
    })).status).toBe("inativa");
    expect(mocks.creditar).not.toHaveBeenCalled();

    mocks.config.mockResolvedValue({
      missaoDivulgacaoDiariaAtiva: true,
      missaoDivulgacaoDiariaBonus: 3,
    });
    mocks.participa.mockResolvedValue(false);
    expect((await creditarMissaoDivulgacaoDiaria({
      indicadorId: "cli_a",
      indicadoId: "cli_b",
    })).status).toBe("inelegivel");
    expect(mocks.creditar).not.toHaveBeenCalled();
  });

  test("estado de hoje lê o ledger sem criar pontos", async () => {
    mocks.movimentos.mockResolvedValue([{
      movimentoId: "m1",
      eventoId: "missao_divulgacao_diaria:cli_a:2026-10-07",
      tipo: "missao_divulgacao_diaria",
      pontos: 3,
      motivo: "ok",
      createdAt: "2026-10-07T20:00:00.000Z",
    }]);
    const estado = await obterEstadoMissaoDivulgacaoDiaria({
      temporadaId: "temp_1",
      indicadorId: "cli_a",
      agora: new Date("2026-10-07T18:00:00-03:00").getTime(),
    });
    expect(estado).toEqual({ concluidaHoje: true });
    expect(mocks.creditar).not.toHaveBeenCalled();
  });
});
