import { describe, expect, it } from "vitest";
import { VERIFIED_BASELINES } from "./verifiedBaselines";

describe("VERIFIED_BASELINES", () => {
  it("percentUsed está sempre na escala 0–100 (porcentagem, nunca fração 0–1)", () => {
    for (const point of VERIFIED_BASELINES) {
      expect(point.percentUsed).toBeGreaterThan(1); // uma fração 0–1 nunca passaria disso, exceto por acaso — todas as baselines reais são > 1%
      expect(point.percentUsed).toBeLessThanOrEqual(100);
    }
  });

  it("percentUsed é coerente com usedBytes/capacityBytes de cada ponto (mesma fórmula do coletor: (used/capacity)*100)", () => {
    for (const point of VERIFIED_BASELINES) {
      const esperado = (point.usedBytes / point.capacityBytes) * 100;
      expect(point.percentUsed).toBeCloseTo(esperado, 6);
    }
  });

  it("todas as baselines são identificadas como railway-ui-manual", () => {
    expect(VERIFIED_BASELINES.every((p) => p.origin === "railway-ui-manual")).toBe(true);
  });

  it("está ordenado cronologicamente", () => {
    for (let i = 1; i < VERIFIED_BASELINES.length; i++) {
      expect(VERIFIED_BASELINES[i].ts).toBeGreaterThan(VERIFIED_BASELINES[i - 1].ts);
    }
  });
});
