import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  obterConfigGamificacao: vi.fn(),
  obterTemporadaAtiva: vi.fn(),
  obterParticipacaoRanking: vi.fn(),
  creditarBonusCompeticao: vi.fn(),
  sincronizarScoreTemporadaComBonus: vi.fn(),
  registrarBonusFotoRankingCliente: vi.fn(),
}));

vi.mock("./rankingGamificacaoConfig", () => ({
  obterConfigGamificacao: mocks.obterConfigGamificacao,
}));
vi.mock("./temporadas", () => ({
  obterTemporadaAtiva: mocks.obterTemporadaAtiva,
}));
vi.mock("./consentimentoRanking", () => ({
  obterParticipacaoRanking: mocks.obterParticipacaoRanking,
}));
vi.mock("./rankingBonusTemporada", () => ({
  creditarBonusCompeticao: mocks.creditarBonusCompeticao,
}));
vi.mock("./rankingScoreTemporadaSync", () => ({
  sincronizarScoreTemporadaComBonus: mocks.sincronizarScoreTemporadaComBonus,
}));
vi.mock("./clientes", () => ({
  registrarBonusFotoRankingCliente: mocks.registrarBonusFotoRankingCliente,
}));

import { concederBonusMissaoFotoRanking } from "./rankingMissaoFotoPerfil";

const cliente = {
  clienteId: "cli_1",
  telefone: "5599999999999",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  lastLoginAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.obterConfigGamificacao.mockResolvedValue({
    missaoFotoPerfilAtiva: true,
    missaoFotoPerfilBonus: 5,
  });
  mocks.obterTemporadaAtiva.mockResolvedValue({ temporadaId: "temp_1" });
  mocks.obterParticipacaoRanking.mockResolvedValue(true);
  mocks.creditarBonusCompeticao.mockResolvedValue("creditado");
  mocks.sincronizarScoreTemporadaComBonus.mockResolvedValue(undefined);
  mocks.registrarBonusFotoRankingCliente.mockResolvedValue(cliente);
});

describe("concederBonusMissaoFotoRanking", () => {
  test("credita uma vez no Ranking e sincroniza score", async () => {
    const r = await concederBonusMissaoFotoRanking({ tenantId: "default", cliente });
    expect(r).toEqual({ status: "creditado", pontos: 5, temporadaId: "temp_1" });
    expect(mocks.creditarBonusCompeticao).toHaveBeenCalledWith(expect.objectContaining({
      tipo: "missao_foto_perfil",
      pontos: 5,
      eventoId: "missao_foto_perfil:cli_1",
    }));
    expect(mocks.sincronizarScoreTemporadaComBonus).toHaveBeenCalledWith("default", "temp_1", "cli_1");
    expect(mocks.registrarBonusFotoRankingCliente).toHaveBeenCalledWith("5599999999999", "temp_1");
  });

  test("marco permanente impede novo bônus", async () => {
    const r = await concederBonusMissaoFotoRanking({
      tenantId: "default",
      cliente: {
        ...cliente,
        rankingFotoBonusConcedidoEm: "2026-10-07T00:00:00.000Z",
        rankingFotoBonusTemporadaId: "temp_antiga",
      },
    });
    expect(r).toEqual({ status: "ja_concluida", pontos: 0, temporadaId: "temp_antiga" });
    expect(mocks.creditarBonusCompeticao).not.toHaveBeenCalled();
  });

  test("missão desligada nunca credita", async () => {
    mocks.obterConfigGamificacao.mockResolvedValue({ missaoFotoPerfilAtiva: false, missaoFotoPerfilBonus: 5 });
    const r = await concederBonusMissaoFotoRanking({ tenantId: "default", cliente });
    expect(r.status).toBe("inativa");
    expect(mocks.creditarBonusCompeticao).not.toHaveBeenCalled();
  });

  test("sem temporada ou sem participação não credita", async () => {
    mocks.obterParticipacaoRanking.mockResolvedValue(false);
    const r = await concederBonusMissaoFotoRanking({ tenantId: "default", cliente });
    expect(r.status).toBe("inelegivel");
    expect(mocks.creditarBonusCompeticao).not.toHaveBeenCalled();
  });

  test("retry idempotente do ledger ainda marca missão como concluída", async () => {
    mocks.creditarBonusCompeticao.mockResolvedValue("ja_creditado");
    const r = await concederBonusMissaoFotoRanking({ tenantId: "default", cliente });
    expect(r.status).toBe("ja_creditado");
    expect(mocks.registrarBonusFotoRankingCliente).toHaveBeenCalledTimes(1);
  });
});
