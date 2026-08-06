import { afterEach, describe, expect, it } from "vitest";
import type { CatalogBorder } from "@/lib/catalog/types";
import { getPizzaFlavorById, PIZZA_FLAVORS, type PizzaSizeCode } from "@/lib/catalog/pizzaFlavors";
import { PIZZA_ADDITIONALS } from "@/lib/catalog/pizzaAdditionals";
import { PIZZA_SIZES } from "@/lib/catalog/pizzaSizes";
import { calcularPrecoPizzaEstruturada } from "./pizzaEngine";

const SIZES: PizzaSizeCode[] = ["P", "M", "G", "F"];

const BORDERS: CatalogBorder[] = [
  { id: "border-catupiry", label: "Catupiry", priceSmallCents: 800, priceLargeCents: 1000 },
  { id: "border-cheddar", label: "Cheddar", priceSmallCents: 800, priceLargeCents: 1000 },
];

function sizeId(code: PizzaSizeCode): string {
  return PIZZA_SIZES.find((s) => s.code === code)!.id;
}

describe("motor de preço de pizza estruturada — Fase 2A", () => {
  describe("pizza de um sabor: cobra o preço do PDF em cada tamanho permitido", () => {
    for (const flavor of PIZZA_FLAVORS) {
      for (const size of SIZES) {
        it(`${flavor.name} · ${size}`, () => {
          const resultado = calcularPrecoPizzaEstruturada(
            { sizeId: sizeId(size), flavorIds: [flavor.id], quantity: 1 },
            { borders: BORDERS }
          );
          expect(resultado.ok).toBe(true);
          if (resultado.ok) {
            expect(resultado.unitPriceCents).toBe(flavor.pricesCents[size]);
            expect(resultado.totalCents).toBe(flavor.pricesCents[size]);
          }
        });
      }
    }
  });

  describe("meio a meio: cobra sempre o maior preço, nunca média nem soma de metades", () => {
    it("tradicional + tradicional com preços diferentes — À Moda da Casa (mais cara) + Calabresa", () => {
      const aModa = getPizzaFlavorById("flavor-a-moda-da-casa")!;
      const calabresa = getPizzaFlavorById("flavor-calabresa")!;
      expect(aModa.pricesCents.G).not.toBe(calabresa.pricesCents.G);
      const maior = Math.max(aModa.pricesCents.G, calabresa.pricesCents.G);

      const resultado = calcularPrecoPizzaEstruturada(
        { sizeId: sizeId("G"), flavorIds: [aModa.id, calabresa.id], quantity: 1 },
        { borders: BORDERS }
      );
      expect(resultado.ok).toBe(true);
      if (resultado.ok) expect(resultado.unitPriceCents).toBe(maior);
    });

    it("a ordem dos sabores não muda o resultado", () => {
      const aModa = getPizzaFlavorById("flavor-a-moda-da-casa")!;
      const calabresa = getPizzaFlavorById("flavor-calabresa")!;
      const r1 = calcularPrecoPizzaEstruturada({ sizeId: sizeId("G"), flavorIds: [aModa.id, calabresa.id], quantity: 1 }, { borders: BORDERS });
      const r2 = calcularPrecoPizzaEstruturada({ sizeId: sizeId("G"), flavorIds: [calabresa.id, aModa.id], quantity: 1 }, { borders: BORDERS });
      expect(r1.ok && r2.ok).toBe(true);
      if (r1.ok && r2.ok) expect(r1.unitPriceCents).toBe(r2.unitPriceCents);
    });

    it("tradicional + especial — cobra o preço do sabor mais caro (exemplo do cliente: 52 e 62 no G → 62)", () => {
      // Calabresa Especial G = 5200, Calabresa Suprema G = 6200 (exemplo dado pelo cliente)
      const calabresaEspecial = getPizzaFlavorById("flavor-calabresa-especial")!;
      const calabresaSuprema = getPizzaFlavorById("flavor-calabresa-suprema")!;
      expect(calabresaEspecial.pricesCents.G).toBe(5200);
      expect(calabresaSuprema.pricesCents.G).toBe(6200);

      const resultado = calcularPrecoPizzaEstruturada(
        { sizeId: sizeId("G"), flavorIds: [calabresaEspecial.id, calabresaSuprema.id], quantity: 1 },
        { borders: BORDERS }
      );
      expect(resultado.ok).toBe(true);
      if (resultado.ok) expect(resultado.unitPriceCents).toBe(6200);
    });

    it("um sabor tradicional comum + um especial — o especial (mais caro) vence", () => {
      const mussarela = getPizzaFlavorById("flavor-mussarela")!; // tradicional barata
      const carneDeSol = getPizzaFlavorById("flavor-carne-de-sol-da-casa")!; // especial cara
      const resultado = calcularPrecoPizzaEstruturada(
        { sizeId: sizeId("F"), flavorIds: [mussarela.id, carneDeSol.id], quantity: 1 },
        { borders: BORDERS }
      );
      expect(resultado.ok).toBe(true);
      if (resultado.ok) {
        expect(resultado.unitPriceCents).toBe(carneDeSol.pricesCents.F);
        expect(resultado.precoDoFlavor.id).toBe(carneDeSol.id);
      }
    });

    it("especial + especial com preços diferentes — maior vence", () => {
      const seisQueijos = getPizzaFlavorById("flavor-6-queijos")!; // F 6500
      const nordestina = getPizzaFlavorById("flavor-nordestina")!; // F 6000
      expect(seisQueijos.pricesCents.F).not.toBe(nordestina.pricesCents.F);
      const resultado = calcularPrecoPizzaEstruturada(
        { sizeId: sizeId("F"), flavorIds: [seisQueijos.id, nordestina.id], quantity: 1 },
        { borders: BORDERS }
      );
      expect(resultado.ok).toBe(true);
      if (resultado.ok) expect(resultado.unitPriceCents).toBe(seisQueijos.pricesCents.F);
    });
  });

  describe("borda e adicionais são somados só depois do preço-base", () => {
    it("borda soma depois do maior preço entre os sabores", () => {
      const calabresa = getPizzaFlavorById("flavor-calabresa")!;
      const semBorda = calcularPrecoPizzaEstruturada({ sizeId: sizeId("G"), flavorIds: [calabresa.id], quantity: 1 }, { borders: BORDERS });
      const comBorda = calcularPrecoPizzaEstruturada(
        { sizeId: sizeId("G"), flavorIds: [calabresa.id], borderId: "border-catupiry", quantity: 1 },
        { borders: BORDERS }
      );
      expect(semBorda.ok && comBorda.ok).toBe(true);
      if (semBorda.ok && comBorda.ok) {
        expect(comBorda.unitPriceCents).toBe(semBorda.unitPriceCents + 1000); // G usa priceLargeCents
      }
    });

    it("adicionais somam depois do preço-base, cada um pelo preço do tamanho escolhido", () => {
      const calabresa = getPizzaFlavorById("flavor-calabresa")!;
      const bacon = PIZZA_ADDITIONALS.find((a) => a.id === "additional-bacon")!;
      const barbecue = PIZZA_ADDITIONALS.find((a) => a.id === "additional-barbecue")!;
      const resultado = calcularPrecoPizzaEstruturada(
        { sizeId: sizeId("P"), flavorIds: [calabresa.id], additionalIds: [bacon.id, barbecue.id], quantity: 1 },
        { borders: BORDERS }
      );
      expect(resultado.ok).toBe(true);
      if (resultado.ok) {
        expect(resultado.unitPriceCents).toBe(calabresa.pricesCents.P + bacon.pricesCents.P + barbecue.pricesCents.P);
      }
    });

    it("borda + adicionais juntos, na ordem certa: base, depois borda, depois adicionais", () => {
      const aModa = getPizzaFlavorById("flavor-a-moda-da-casa")!;
      const cremeCheese = PIZZA_ADDITIONALS.find((a) => a.id === "additional-cream-cheese")!;
      const resultado = calcularPrecoPizzaEstruturada(
        { sizeId: sizeId("F"), flavorIds: [aModa.id], borderId: "border-cheddar", additionalIds: [cremeCheese.id], quantity: 1 },
        { borders: BORDERS }
      );
      expect(resultado.ok).toBe(true);
      if (resultado.ok) {
        expect(resultado.unitPriceCents).toBe(aModa.pricesCents.F + 1000 + cremeCheese.pricesCents.F);
      }
    });
  });

  it("Pizzas Especiais não têm tamanho Mini — ID de tamanho Mini não existe no motor estruturado", () => {
    const especial = getPizzaFlavorById("flavor-6-queijos")!;
    const resultado = calcularPrecoPizzaEstruturada({ sizeId: "size-mini", flavorIds: [especial.id], quantity: 1 }, { borders: BORDERS });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error).toMatch(/tamanho/i);
  });

  it("bloqueia sabor repetido no meio a meio", () => {
    const calabresa = getPizzaFlavorById("flavor-calabresa")!;
    const resultado = calcularPrecoPizzaEstruturada(
      { sizeId: sizeId("G"), flavorIds: [calabresa.id, calabresa.id], quantity: 1 },
      { borders: BORDERS }
    );
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error).toMatch(/repetid/i);
  });

  describe("sabor marcado indisponível é bloqueado", () => {
    const flavor = getPizzaFlavorById("flavor-xuxa")!;
    afterEach(() => {
      flavor.available = true;
    });

    it("rejeita quando available=false", () => {
      flavor.available = false;
      const resultado = calcularPrecoPizzaEstruturada({ sizeId: sizeId("M"), flavorIds: [flavor.id], quantity: 1 }, { borders: BORDERS });
      expect(resultado.ok).toBe(false);
      if (!resultado.ok) expect(resultado.error).toMatch(/indisponível/i);
    });
  });

  it("rejeita ID de tamanho inexistente", () => {
    const resultado = calcularPrecoPizzaEstruturada({ sizeId: "size-inexistente", flavorIds: ["flavor-calabresa"], quantity: 1 }, { borders: BORDERS });
    expect(resultado.ok).toBe(false);
  });

  it("rejeita ID de sabor inexistente", () => {
    const resultado = calcularPrecoPizzaEstruturada({ sizeId: sizeId("G"), flavorIds: ["flavor-inexistente"], quantity: 1 }, { borders: BORDERS });
    expect(resultado.ok).toBe(false);
  });

  it("rejeita ID de borda inexistente", () => {
    const resultado = calcularPrecoPizzaEstruturada(
      { sizeId: sizeId("G"), flavorIds: ["flavor-calabresa"], borderId: "border-inexistente", quantity: 1 },
      { borders: BORDERS }
    );
    expect(resultado.ok).toBe(false);
  });

  it("rejeita ID de adicional inexistente", () => {
    const resultado = calcularPrecoPizzaEstruturada(
      { sizeId: sizeId("G"), flavorIds: ["flavor-calabresa"], additionalIds: ["additional-inexistente"], quantity: 1 },
      { borders: BORDERS }
    );
    expect(resultado.ok).toBe(false);
  });

  it("rejeita mais de 2 sabores ou nenhum sabor", () => {
    expect(calcularPrecoPizzaEstruturada({ sizeId: sizeId("G"), flavorIds: [], quantity: 1 }, { borders: BORDERS }).ok).toBe(false);
    expect(
      calcularPrecoPizzaEstruturada(
        { sizeId: sizeId("G"), flavorIds: ["flavor-calabresa", "flavor-bacon", "flavor-mussarela"], quantity: 1 },
        { borders: BORDERS }
      ).ok
    ).toBe(false);
  });

  it("preço vindo do navegador nunca é considerado — o motor sempre recalcula do zero a partir dos IDs", () => {
    const selecaoComCampoAdulterado = {
      sizeId: sizeId("G"),
      flavorIds: ["flavor-calabresa"],
      quantity: 1,
      // Campo extra simulando um payload adulterado — o motor nem aceita
      // preço como entrada, então não há como isso influenciar o resultado.
      unitPriceCents: 1,
    } as unknown as Parameters<typeof calcularPrecoPizzaEstruturada>[0];
    const resultado = calcularPrecoPizzaEstruturada(selecaoComCampoAdulterado, { borders: BORDERS });
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.unitPriceCents).toBe(getPizzaFlavorById("flavor-calabresa")!.pricesCents.G);
  });

  it("total = preço unitário × quantidade", () => {
    const resultado = calcularPrecoPizzaEstruturada({ sizeId: sizeId("F"), flavorIds: ["flavor-a-moda-da-casa"], quantity: 3 }, { borders: BORDERS });
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.totalCents).toBe(resultado.unitPriceCents * 3);
  });

  it("rejeita quantidade inválida", () => {
    expect(calcularPrecoPizzaEstruturada({ sizeId: sizeId("G"), flavorIds: ["flavor-calabresa"], quantity: 0 }, { borders: BORDERS }).ok).toBe(false);
    expect(calcularPrecoPizzaEstruturada({ sizeId: sizeId("G"), flavorIds: ["flavor-calabresa"], quantity: 1.5 }, { borders: BORDERS }).ok).toBe(false);
  });
});
