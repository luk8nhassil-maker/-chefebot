import { beforeEach, describe, expect, test, vi } from "vitest";

const { obterExtratoPontosMock, obterTemporadaMock, atualizarScoreRankingMock, obterBonusMock } = vi.hoisted(() => ({
  obterExtratoPontosMock: vi.fn(),
  obterTemporadaMock: vi.fn(),
  atualizarScoreRankingMock: vi.fn(async () => undefined),
  obterBonusMock: vi.fn(),
}));

vi.mock("./fidelidade", () => ({ obterExtratoPontos: obterExtratoPontosMock }));
vi.mock("./temporadas", () => ({ obterTemporada: obterTemporadaMock }));
vi.mock("./rankingClientes", async (importActual) => {
  const actual = await importActual<typeof import("./rankingClientes")>();
  return { ...actual, atualizarScoreRanking: atualizarScoreRankingMock };
});
vi.mock("./rankingBonusTemporada", () => ({ obterBonusCompeticaoDaTemporada: obterBonusMock }));

import { sincronizarScoreTemporadaComBonus } from "./rankingScoreTemporada";

const T = "default";
const TEMP = "temp_1";
const CLI = "cli_a";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sincronizarScoreTemporadaComBonus", () => {
  test("escreve base + bônus na projeção de ranking", async () => {
    obterTemporadaMock.mockResolvedValue({ ativadaEm: "2026-01-01T00:00:00.000Z", fimEm: "2026-02-01T00:00:00.000Z" });
    obterExtratoPontosMock.mockResolvedValue([
      { tipo: "confirmado", pontos: 50, createdAt: "2026-01-05T00:00:00.000Z", regraVersao: "estrelas-faixas-v1" },
    ]);
    obterBonusMock.mockResolvedValue(30);

    await sincronizarScoreTemporadaComBonus(T, TEMP, CLI);

    expect(atualizarScoreRankingMock).toHaveBeenCalledWith(T, TEMP, CLI, 80, expect.any(Number));
  });

  test("sem temporada ativada, não escreve nada (fail-closed)", async () => {
    obterTemporadaMock.mockResolvedValue(null);
    await sincronizarScoreTemporadaComBonus(T, TEMP, CLI);
    expect(atualizarScoreRankingMock).not.toHaveBeenCalled();
  });

  test("falha ao ler qualquer dependência nunca propaga (best-effort)", async () => {
    obterTemporadaMock.mockRejectedValue(new Error("timeout"));
    await expect(sincronizarScoreTemporadaComBonus(T, TEMP, CLI)).resolves.toBeUndefined();
  });

  test("parâmetros vazios são no-op", async () => {
    await sincronizarScoreTemporadaComBonus("", TEMP, CLI);
    expect(obterTemporadaMock).not.toHaveBeenCalled();
  });
});
