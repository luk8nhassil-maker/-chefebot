import { afterEach, describe, expect, it, vi } from "vitest";
import {
  survivalForcedMode,
  survivalLoadSheddingEnabled,
  survivalManualFallbackEnabled,
  survivalModeEnabled,
} from "./flags";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("flags do Modo Sobrevivência", () => {
  it("todas as flags são false por padrão (env ausente)", () => {
    vi.stubEnv("SURVIVAL_MODE_ENABLED", "");
    vi.stubEnv("SURVIVAL_MANUAL_FALLBACK_ENABLED", "");
    vi.stubEnv("SURVIVAL_LOAD_SHEDDING_ENABLED", "");
    expect(survivalModeEnabled()).toBe(false);
    expect(survivalManualFallbackEnabled()).toBe(false);
    expect(survivalLoadSheddingEnabled()).toBe(false);
  });

  it("liga só com o valor exato 'true'", () => {
    vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
    expect(survivalModeEnabled()).toBe(true);
  });

  it("valores parecidos com 'true' não ligam a flag (comparação estrita)", () => {
    vi.stubEnv("SURVIVAL_MODE_ENABLED", "TRUE");
    expect(survivalModeEnabled()).toBe(false);
    vi.stubEnv("SURVIVAL_MODE_ENABLED", "1");
    expect(survivalModeEnabled()).toBe(false);
  });

  it("survivalForcedMode() é 'off' por padrão e para valor desconhecido", () => {
    vi.stubEnv("CHEFEBOT_SURVIVAL_MODE", "");
    expect(survivalForcedMode()).toBe("off");
    vi.stubEnv("CHEFEBOT_SURVIVAL_MODE", "xyz");
    expect(survivalForcedMode()).toBe("off");
  });

  it("survivalForcedMode() reconhece 'degraded' e 'manual' (case-insensitive)", () => {
    vi.stubEnv("CHEFEBOT_SURVIVAL_MODE", "degraded");
    expect(survivalForcedMode()).toBe("degraded");
    vi.stubEnv("CHEFEBOT_SURVIVAL_MODE", "MANUAL");
    expect(survivalForcedMode()).toBe("manual");
  });
});
