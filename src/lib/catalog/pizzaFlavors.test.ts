import { describe, expect, it } from "vitest";
import {
  findPizzaFlavorByLegacyName,
  getPizzaFlavorById,
  listPizzaFlavorsByCategory,
  PIZZA_FLAVORS,
} from "./pizzaFlavors";

describe("catálogo de sabores de pizza — Fase 2A (fonte: PDF oficial)", () => {
  it("tem os totais exatos do PDF: 18 tradicionais, 20 especiais, 7 doces", () => {
    expect(listPizzaFlavorsByCategory("traditional")).toHaveLength(18);
    expect(listPizzaFlavorsByCategory("special")).toHaveLength(20);
    expect(listPizzaFlavorsByCategory("sweet")).toHaveLength(7);
    expect(PIZZA_FLAVORS).toHaveLength(45);
  });

  it("todo sabor tem ID estável, preço inteiro em centavos para P/M/G/F e está disponível por padrão", () => {
    for (const flavor of PIZZA_FLAVORS) {
      expect(flavor.id).toMatch(/^flavor-/);
      expect(flavor.available).toBe(true);
      for (const size of ["P", "M", "G", "F"] as const) {
        expect(Number.isInteger(flavor.pricesCents[size])).toBe(true);
        expect(flavor.pricesCents[size]).toBeGreaterThan(0);
      }
    }
  });

  it("nenhum ID se repete", () => {
    const ids = PIZZA_FLAVORS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("Carne Seca e Carne Seca Especial são sabores distintos, ambos Especiais", () => {
    const carneSeca = getPizzaFlavorById("flavor-carne-seca");
    const carneSecaEspecial = getPizzaFlavorById("flavor-carne-seca-especial");
    expect(carneSeca).toBeDefined();
    expect(carneSecaEspecial).toBeDefined();
    expect(carneSeca!.id).not.toBe(carneSecaEspecial!.id);
    expect(carneSeca!.category).toBe("special");
    expect(carneSecaEspecial!.category).toBe("special");
    expect(carneSeca!.pricesCents.F).toBe(6000);
    expect(carneSecaEspecial!.pricesCents.F).toBe(7000);
  });

  it("Calabresa Suprema e Calabresa Suprema 2 são sabores distintos, mesmo com preços iguais", () => {
    const suprema = getPizzaFlavorById("flavor-calabresa-suprema");
    const suprema2 = getPizzaFlavorById("flavor-calabresa-suprema-2");
    expect(suprema).toBeDefined();
    expect(suprema2).toBeDefined();
    expect(suprema!.id).not.toBe(suprema2!.id);
    expect(suprema!.description).not.toBe(suprema2!.description);
  });

  it("Portuguesa, Mexicana e Mazini são Pizzas Especiais", () => {
    expect(getPizzaFlavorById("flavor-portuguesa")?.category).toBe("special");
    expect(getPizzaFlavorById("flavor-mexicana")?.category).toBe("special");
    expect(getPizzaFlavorById("flavor-mazini")?.category).toBe("special");
  });

  it("Mazzine (nome antigo) resolve para Mazini via alias, sem duplicar sabor", () => {
    const viaAliasAntigo = findPizzaFlavorByLegacyName("Mazzine");
    const viaNomeNovo = findPizzaFlavorByLegacyName("Mazini");
    expect(viaAliasAntigo?.id).toBe("flavor-mazini");
    expect(viaAliasAntigo?.id).toBe(viaNomeNovo?.id);
  });

  it("Frango Catupiry (nome antigo) resolve para Frango Catupiry Original, nunca para Frango com Cheddar", () => {
    const viaAliasAntigo = findPizzaFlavorByLegacyName("Frango Catupiry");
    expect(viaAliasAntigo?.id).toBe("flavor-frango-catupiry-original");
    expect(viaAliasAntigo?.name).toBe("Frango Catupiry Original");
    expect(getPizzaFlavorById("flavor-frango-com-cheddar")?.name).toBe("Frango com Cheddar");
  });

  it("aliases legados de nomes renomeados resolvem para o sabor oficial certo", () => {
    expect(findPizzaFlavorByLegacyName("A Moda")?.id).toBe("flavor-a-moda-da-casa");
    expect(findPizzaFlavorByLegacyName("Tres Queijos")?.id).toBe("flavor-3-queijos");
    expect(findPizzaFlavorByLegacyName("Quatro Queijos")?.id).toBe("flavor-4-queijos");
    expect(findPizzaFlavorByLegacyName("2 amores")?.id).toBe("flavor-dois-amores");
    expect(findPizzaFlavorByLegacyName("Sensacao")?.id).toBe("flavor-sensacao");
  });

  it("a interface só precisa exibir nomes oficiais — todo alias tem um nome oficial diferente dele", () => {
    for (const flavor of PIZZA_FLAVORS) {
      for (const alias of flavor.legacyAliases || []) {
        expect(alias).not.toBe(flavor.name);
      }
    }
  });
});
