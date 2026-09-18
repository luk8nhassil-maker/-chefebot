import { describe, expect, test } from "vitest";
import { calcularEstrelasPorValorElegivel, calcularEstrelasV1, META_ESTRELAS_V1, REGRA_ESTRELAS_V1, progressoEstrelas } from "./estrelas";

describe("Estrelas V1 — progressão por faixas", () => {
  test.each([
    [0, 0], [1, 3], [3999, 3], [4000, 5], [6999, 5], [7000, 7],
    [9999, 7], [10000, 9], [14999, 9], [15000, 12], [30000, 12],
  ])("%s centavos gera %s Estrelas", (cents, expected) => {
    expect(calcularEstrelasPorValorElegivel(cents)).toBe(expected);
  });

  test("retorna a versão explícita e normaliza centavos inválidos", () => {
    expect(calcularEstrelasV1(-10)).toEqual({ estrelas: 0, valorElegivelCents: 0, regraVersao: REGRA_ESTRELAS_V1 });
    expect(calcularEstrelasV1(15000).estrelas).toBe(12);
  });

  test("progresso nunca passa do marco visual de 50", () => {
    expect(progressoEstrelas(31)).toEqual({ saldo: 31, meta: META_ESTRELAS_V1, faltam: 19, percentual: 62, marcoAtingido: false });
    expect(progressoEstrelas(60)).toMatchObject({ faltam: 0, percentual: 100, marcoAtingido: true });
  });
});
