import { describe, expect, it } from "vitest";
import type { Menu } from "@/lib/menu";
import { buildPizzaCatalog } from "./pizzas";
import { precificarPizzaPorId } from "@/lib/pricing/pizzaEngine";

function catalogo() {
  return buildPizzaCatalog({} as Menu);
}

function sabor(nome: string) {
  const flavor = catalogo().flavors.find((entry) => entry.name === nome);
  if (!flavor) throw new Error(`Sabor não encontrado: ${nome}`);
  return flavor;
}

describe("Mini Pizza — exceções Especiais aprovadas em 21/08/2026", () => {
  it("libera Portuguesa e Carne Seca como Especiais por R$ 20,00 no MINI", () => {
    const portuguesa = sabor("Portuguesa");
    const carneSeca = sabor("Carne Seca");

    expect(portuguesa.category).toBe("especial");
    expect(portuguesa.pricesBySizeCode).toEqual({ F: 6000, G: 5300, M: 4300, P: 3800, MINI: 2000 });

    expect(carneSeca.category).toBe("especial");
    expect(carneSeca.pricesBySizeCode).toEqual({ F: 6000, G: 5500, M: 4500, P: 4000, MINI: 2000 });
  });

  it("não libera MINI para nenhum outro sabor Especial", () => {
    const especiaisComMini = catalogo().flavors
      .filter((flavor) => flavor.category === "especial" && flavor.pricesBySizeCode.MINI !== undefined)
      .map((flavor) => flavor.name)
      .sort();

    expect(especiaisComMini).toEqual(["Carne Seca", "Portuguesa"]);
  });

  it("o motor server-side cobra R$ 20,00 para cada uma no tamanho MINI", () => {
    const catalog = catalogo();
    const mini = catalog.sizes.find((size) => size.code === "MINI");
    if (!mini) throw new Error("Tamanho MINI não encontrado");

    for (const nome of ["Portuguesa", "Carne Seca"]) {
      const flavor = catalog.flavors.find((entry) => entry.name === nome);
      if (!flavor) throw new Error(`Sabor não encontrado: ${nome}`);

      const resultado = precificarPizzaPorId(
        { sizeId: mini.id, flavorIds: [flavor.id], quantity: 1 },
        catalog,
      );

      expect(resultado.ok, nome).toBe(true);
      if (resultado.ok) expect(resultado.unitPriceCents, nome).toBe(2000);
    }
  });

  it("continua rejeitando MINI para um Especial não aprovado", () => {
    const catalog = catalogo();
    const mini = catalog.sizes.find((size) => size.code === "MINI");
    const atum = catalog.flavors.find((entry) => entry.name === "Atum");
    if (!mini || !atum) throw new Error("Fixtures do catálogo não encontradas");

    const resultado = precificarPizzaPorId(
      { sizeId: mini.id, flavorIds: [atum.id], quantity: 1 },
      catalog,
    );

    expect(resultado.ok).toBe(false);
  });
});
