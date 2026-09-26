import { beforeEach, describe, expect, test, vi } from "vitest";

const { atualizarScoreRankingMock, obterBonusMock } = vi.hoisted(() => ({
  atualizarScoreRankingMock: vi.fn(async () => undefined),
  obterBonusMock: vi.fn(),
}));

vi.mock("./rankingClientes", async (importActual) => {
  const actual = await importActual<typeof import("./rankingClientes")>();
  return { ...actual, atualizarScoreRanking: atualizarScoreRankingMock };
});
vi.mock("./rankingBonusTemporada", () => ({ obterBonusCompeticaoDaTemporada: obterBonusMock }));

import { projetarScoreRankingComBonus } from "./rankingScoreTemporada";

const T = "default";
const TEMP = "temp_1";
const CLI = "cli_a";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("projetarScoreRankingComBonus", () => {
  test("soma o score base recebido com o bônus atual e escreve na projeção", async () => {
    obterBonusMock.mockResolvedValue(30);
    await projetarScoreRankingComBonus(T, TEMP, CLI, 50, 12345);
    expect(atualizarScoreRankingMock).toHaveBeenCalledWith(T, TEMP, CLI, 80, 12345);
  });

  test("sem bônus, escreve só a base (comportamento idêntico ao anterior)", async () => {
    obterBonusMock.mockResolvedValue(0);
    await projetarScoreRankingComBonus(T, TEMP, CLI, 50, 12345);
    expect(atualizarScoreRankingMock).toHaveBeenCalledWith(T, TEMP, CLI, 50, 12345);
  });

  test("score base inválido (negativo/NaN) nunca gera um score negativo", async () => {
    obterBonusMock.mockResolvedValue(10);
    await projetarScoreRankingComBonus(T, TEMP, CLI, -5, 1);
    expect(atualizarScoreRankingMock).toHaveBeenCalledWith(T, TEMP, CLI, 10, 1);
    atualizarScoreRankingMock.mockClear();
    await projetarScoreRankingComBonus(T, TEMP, CLI, NaN, 1);
    expect(atualizarScoreRankingMock).toHaveBeenCalledWith(T, TEMP, CLI, 10, 1);
  });

  test("parâmetros vazios são no-op", async () => {
    await projetarScoreRankingComBonus("", TEMP, CLI, 10, 1);
    expect(atualizarScoreRankingMock).not.toHaveBeenCalled();
    expect(obterBonusMock).not.toHaveBeenCalled();
  });

  test("falha ao ler o bônus nunca propaga (best-effort)", async () => {
    obterBonusMock.mockRejectedValue(new Error("timeout"));
    await expect(projetarScoreRankingComBonus(T, TEMP, CLI, 50, 1)).resolves.toBeUndefined();
    expect(atualizarScoreRankingMock).not.toHaveBeenCalled();
  });
});
