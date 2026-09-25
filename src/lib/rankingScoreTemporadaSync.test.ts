import { beforeEach, describe, expect, test, vi } from "vitest";

const { obterExtratoPontosMock, obterTemporadaMock, projetarMock } = vi.hoisted(() => ({
  obterExtratoPontosMock: vi.fn(),
  obterTemporadaMock: vi.fn(),
  projetarMock: vi.fn(async () => undefined),
}));

vi.mock("./fidelidade", () => ({ obterExtratoPontos: obterExtratoPontosMock }));
vi.mock("./temporadas", () => ({ obterTemporada: obterTemporadaMock }));
vi.mock("./rankingScoreTemporada", () => ({ projetarScoreRankingComBonus: projetarMock }));

import { sincronizarScoreTemporadaComBonus } from "./rankingScoreTemporadaSync";

const T = "default";
const TEMP = "temp_1";
const CLI = "cli_a";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sincronizarScoreTemporadaComBonus", () => {
  test("recalcula a base do extrato e delega ao projetor único", async () => {
    obterTemporadaMock.mockResolvedValue({ ativadaEm: "2026-01-01T00:00:00.000Z", fimEm: "2026-02-01T00:00:00.000Z" });
    obterExtratoPontosMock.mockResolvedValue([
      { tipo: "confirmado", pontos: 50, createdAt: "2026-01-05T00:00:00.000Z", regraVersao: "estrelas-faixas-v1" },
    ]);

    await sincronizarScoreTemporadaComBonus(T, TEMP, CLI);

    expect(projetarMock).toHaveBeenCalledWith(T, TEMP, CLI, 50, expect.any(Number));
  });

  test("sem temporada ativada, não chama o projetor (fail-closed)", async () => {
    obterTemporadaMock.mockResolvedValue(null);
    await sincronizarScoreTemporadaComBonus(T, TEMP, CLI);
    expect(projetarMock).not.toHaveBeenCalled();
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
