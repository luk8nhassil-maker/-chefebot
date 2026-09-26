import { beforeEach, describe, expect, test, vi } from "vitest";

const { obterConfigGamificacaoMock, creditarBonusComTetoMock, sincronizarScoreMock } = vi.hoisted(() => ({
  obterConfigGamificacaoMock: vi.fn(),
  creditarBonusComTetoMock: vi.fn(async (_params: { calcularPontosDisponiveis: (jaAplicado: number) => number } & Record<string, unknown>) => "creditado" as "creditado" | "ja_creditado" | "invalido"),
  sincronizarScoreMock: vi.fn(async () => undefined),
}));

vi.mock("./rankingGamificacaoConfig", () => ({ obterConfigGamificacao: obterConfigGamificacaoMock }));
// BLOCKER (auditoria — cap do Impulso do Pódio sob concorrência):
// aplicarImpulsoPodioSeElegivel não lê/calcula/credita mais em passos
// separados (o que permitia dois eventos concorrentes ultrapassarem o
// teto) — delega tudo, atomicamente, a creditarBonusCompeticaoComTeto. A
// prova de concorrência real (o teto nunca é ultrapassado com eventoIds
// concorrentes) fica em rankingBonusTemporada.test.ts, onde essa função é
// real; aqui só testamos a fiação (config → função de cálculo do teto).
vi.mock("./rankingBonusTemporada", () => ({ creditarBonusCompeticaoComTeto: creditarBonusComTetoMock }));
vi.mock("./rankingScoreTemporadaSync", () => ({ sincronizarScoreTemporadaComBonus: sincronizarScoreMock }));

import { aplicarImpulsoPodioSeElegivel } from "./rankingImpulsoPodioEstado";

const T = "default";
const TEMP = "temp_1";
const CLI = "cli_a";

beforeEach(() => {
  vi.clearAllMocks();
  creditarBonusComTetoMock.mockResolvedValue("creditado");
});

describe("aplicarImpulsoPodioSeElegivel", () => {
  test("fail-closed: sem impulsoPodioAtivo, nunca credita", async () => {
    obterConfigGamificacaoMock.mockResolvedValue({ impulsoPodioAtivo: false, impulsoPodioBonus: 30, impulsoPodioCapTemporada: 100 });
    await aplicarImpulsoPodioSeElegivel({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: "e1" });
    expect(creditarBonusComTetoMock).not.toHaveBeenCalled();
  });

  test("delega ao crédito atômico com teto, passando a função de cálculo correta", async () => {
    obterConfigGamificacaoMock.mockResolvedValue({ impulsoPodioAtivo: true, impulsoPodioBonus: 30, impulsoPodioCapTemporada: 100 });

    await aplicarImpulsoPodioSeElegivel({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: "e1" });

    expect(creditarBonusComTetoMock).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: "e1", tipo: "impulso_podio",
    }));
    // A função de cálculo passada respeita o teto já aplicado — testada
    // isoladamente, sem depender de concorrência real (isso é coberto pela
    // atomicidade de creditarBonusCompeticaoComTeto).
    const chamada = creditarBonusComTetoMock.mock.calls[0][0] as { calcularPontosDisponiveis: (jaAplicado: number) => number };
    expect(chamada.calcularPontosDisponiveis(0)).toBe(30);
    expect(chamada.calcularPontosDisponiveis(80)).toBe(20);
    expect(chamada.calcularPontosDisponiveis(100)).toBe(0);
    expect(chamada.calcularPontosDisponiveis(150)).toBe(0);
  });

  test("'creditado' ou 'ja_creditado' sincronizam o score; 'invalido' nunca sincroniza", async () => {
    obterConfigGamificacaoMock.mockResolvedValue({ impulsoPodioAtivo: true, impulsoPodioBonus: 30, impulsoPodioCapTemporada: 100 });

    creditarBonusComTetoMock.mockResolvedValueOnce("creditado");
    await aplicarImpulsoPodioSeElegivel({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: "e1" });
    expect(sincronizarScoreMock).toHaveBeenCalledTimes(1);

    creditarBonusComTetoMock.mockResolvedValueOnce("ja_creditado");
    await aplicarImpulsoPodioSeElegivel({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: "e1" });
    expect(sincronizarScoreMock).toHaveBeenCalledTimes(2);

    creditarBonusComTetoMock.mockResolvedValueOnce("invalido");
    await aplicarImpulsoPodioSeElegivel({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: "e2" });
    expect(sincronizarScoreMock).toHaveBeenCalledTimes(2);
  });
});
