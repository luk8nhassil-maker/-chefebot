import { describe, expect, it } from "vitest";
import { avaliarEstadoSobrevivencia, type SurvivalSignals } from "./state";

function signals(overrides: Partial<SurvivalSignals> = {}): SurvivalSignals {
  return {
    forcedMode: "off",
    pedidoPersistenceUnhealthy: false,
    appReachable: true,
    ...overrides,
  };
}

describe("avaliarEstadoSobrevivencia", () => {
  it("NORMAL quando tudo saudável e nada forçado", () => {
    expect(avaliarEstadoSobrevivencia(signals())).toBe("NORMAL");
  });

  it("INDISPONIVEL quando o app não está acessível, mesmo sem outros sinais ruins", () => {
    expect(avaliarEstadoSobrevivencia(signals({ appReachable: false }))).toBe("INDISPONIVEL");
  });

  it("INDISPONIVEL tem prioridade sobre modo manual forçado", () => {
    expect(
      avaliarEstadoSobrevivencia(signals({ appReachable: false, forcedMode: "manual" }))
    ).toBe("INDISPONIVEL");
  });

  it("MANUAL quando forçado explicitamente", () => {
    expect(avaliarEstadoSobrevivencia(signals({ forcedMode: "manual" }))).toBe("MANUAL");
  });

  it("MANUAL quando a persistência do pedido está reconhecidamente ruim, mesmo sem flag forçada", () => {
    expect(avaliarEstadoSobrevivencia(signals({ pedidoPersistenceUnhealthy: true }))).toBe("MANUAL");
  });

  it("DEGRADADO quando forçado e a persistência do pedido está saudável", () => {
    expect(avaliarEstadoSobrevivencia(signals({ forcedMode: "degraded" }))).toBe("DEGRADADO");
  });

  it("MANUAL tem prioridade sobre DEGRADADO forçado quando a persistência falha", () => {
    expect(
      avaliarEstadoSobrevivencia(signals({ forcedMode: "degraded", pedidoPersistenceUnhealthy: true }))
    ).toBe("MANUAL");
  });
});
