// Garante que o espelho JS usado pelo script de migração
// (scripts/_pizzaFlavorsEspelho.mjs) nunca diverge da fonte oficial
// (src/lib/catalog/pizzaFlavors.ts) — nome, categoria e aliases legados
// precisam bater exatamente, senão a migração poderia gravar um nome
// desatualizado no Redis.
import { describe, expect, it } from "vitest";
import { PIZZA_FLAVORS } from "./pizzaFlavors";
import { PIZZA_FLAVORS_ESPELHO, TOTAL_ESPERADO } from "../../../scripts/_pizzaFlavorsEspelho.mjs";

describe("espelho de migração (scripts/_pizzaFlavorsEspelho.mjs) em sincronia com o catálogo oficial", () => {
  it("tem a mesma contagem total declarada", () => {
    expect(TOTAL_ESPERADO).toBe(PIZZA_FLAVORS.length);
    expect(PIZZA_FLAVORS_ESPELHO).toHaveLength(PIZZA_FLAVORS.length);
  });

  it("cada sabor do catálogo oficial tem uma entrada correspondente no espelho — mesmo nome, categoria e aliases", () => {
    for (const flavor of PIZZA_FLAVORS) {
      const espelho = PIZZA_FLAVORS_ESPELHO.find((f: { name: string }) => f.name === flavor.name);
      if (!espelho) throw new Error(`sabor "${flavor.name}" ausente no espelho de migração`);
      expect(espelho.category).toBe(flavor.category);
      expect(espelho.legacyAliases || []).toEqual(flavor.legacyAliases || []);
    }
  });

  it("o espelho não tem nenhum sabor a mais que não exista na fonte oficial", () => {
    for (const espelho of PIZZA_FLAVORS_ESPELHO) {
      expect(PIZZA_FLAVORS.some((f) => f.name === espelho.name)).toBe(true);
    }
  });
});
