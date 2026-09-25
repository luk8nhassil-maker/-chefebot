import { beforeEach, describe, expect, test, vi } from "vitest";

const { obterConfigGamificacaoMock, obterMovimentosMock, creditarBonusMock, sincronizarScoreMock } = vi.hoisted(() => ({
  obterConfigGamificacaoMock: vi.fn(),
  obterMovimentosMock: vi.fn(async () => [] as { tipo: string; pontos: number }[]),
  creditarBonusMock: vi.fn(async () => "creditado" as const),
  sincronizarScoreMock: vi.fn(async () => undefined),
}));

vi.mock("./rankingGamificacaoConfig", () => ({ obterConfigGamificacao: obterConfigGamificacaoMock }));
vi.mock("./rankingBonusTemporada", async (importActual) => {
  const actual = await importActual<typeof import("./rankingBonusTemporada")>();
  return {
    calcularTotalBonusPorTipo: actual.calcularTotalBonusPorTipo,
    obterMovimentosBonusTemporada: obterMovimentosMock,
    creditarBonusCompeticao: creditarBonusMock,
  };
});
vi.mock("./rankingScoreTemporada", () => ({ sincronizarScoreTemporadaComBonus: sincronizarScoreMock }));

import { aplicarImpulsoPodioSeElegivel } from "./rankingImpulsoPodioEstado";

const T = "default";
const TEMP = "temp_1";
const CLI = "cli_a";

beforeEach(() => {
  vi.clearAllMocks();
  obterMovimentosMock.mockResolvedValue([]);
  creditarBonusMock.mockResolvedValue("creditado");
});

describe("aplicarImpulsoPodioSeElegivel", () => {
  test("fail-closed: sem impulsoPodioAtivo, nunca credita", async () => {
    obterConfigGamificacaoMock.mockResolvedValue({ impulsoPodioAtivo: false, impulsoPodioBonus: 30, impulsoPodioCapTemporada: 100 });
    await aplicarImpulsoPodioSeElegivel({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: "e1" });
    expect(creditarBonusMock).not.toHaveBeenCalled();
  });

  test("credita o bônus configurado respeitando o teto já aplicado", async () => {
    obterConfigGamificacaoMock.mockResolvedValue({ impulsoPodioAtivo: true, impulsoPodioBonus: 30, impulsoPodioCapTemporada: 100 });
    obterMovimentosMock.mockResolvedValue([{ tipo: "impulso_podio", pontos: 80 }]);

    await aplicarImpulsoPodioSeElegivel({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: "e1" });

    expect(creditarBonusMock).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: "e1", tipo: "impulso_podio", pontos: 20,
    }));
    expect(sincronizarScoreMock).toHaveBeenCalledWith(T, TEMP, CLI);
  });

  test("cap esgotado nunca credita", async () => {
    obterConfigGamificacaoMock.mockResolvedValue({ impulsoPodioAtivo: true, impulsoPodioBonus: 30, impulsoPodioCapTemporada: 100 });
    obterMovimentosMock.mockResolvedValue([{ tipo: "impulso_podio", pontos: 100 }]);

    await aplicarImpulsoPodioSeElegivel({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: "e1" });

    expect(creditarBonusMock).not.toHaveBeenCalled();
  });
});
