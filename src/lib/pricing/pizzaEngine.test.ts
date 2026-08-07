// Testes do motor nativo de preço de pizza — Fase 2.
//
// Duas frentes:
// 1) Equivalência: para toda combinação válida do cardápio atual, o preço
//    calculado nativamente (precificarPizzaPorId, por ID) precisa ser
//    EXATAMENTE igual ao preço legado (officialUnitPrice, name/detail) —
//    mesma garantia que a Fase 1 já dava para o motor que envolve
//    officialUnitPrice, agora para o motor que NÃO depende dele.
// 2) Regras novas da Fase 2 (validação nativa): tamanho inválido, sabor
//    repetido, sabor/borda inexistente ou esgotado, quantidade inválida,
//    número errado de sabores — nenhuma tem equivalente legado para
//    comparar (o motor antigo não valida a maioria disso), então são
//    testadas diretamente contra o resultado esperado.
import { describe, expect, it } from "vitest";
import { buildPizzaCatalog } from "@/lib/catalog/pizzas";
import { MENU } from "@/lib/menu";
import { officialUnitPrice, type ItemApp, type MenuPedidoApp } from "@/lib/pedidoAppItens";
import { precificarPizzaPorId } from "./pizzaEngine";

const menu = MENU;
const menuLegado = menu as unknown as MenuPedidoApp;
const catalog = buildPizzaCatalog(menu);

function precoLegadoReais(item: ItemApp): number | null {
  return officialUnitPrice(item, menuLegado);
}

function sizeIdByCode(code: string): string {
  const size = catalog.sizes.find((entry) => entry.code === code);
  if (!size) throw new Error(`Tamanho ${code} não encontrado no catálogo de teste`);
  return size.id;
}

function flavorIdByName(name: string): string {
  const flavor = catalog.flavors.find((entry) => entry.name === name);
  if (!flavor) throw new Error(`Sabor ${name} não encontrado no catálogo de teste`);
  return flavor.id;
}

function borderIdByLabel(label: string): string {
  const border = catalog.borders.find((entry) => entry.label === label);
  if (!border) throw new Error(`Borda ${label} não encontrada no catálogo de teste`);
  return border.id;
}

describe("motor nativo: equivalência de preço, pizza de um sabor, sem borda", () => {
  for (const size of menu.sizes) {
    for (const flavor of [...menu.saltyFlavors, ...menu.sweetFlavors]) {
      it(`Pizza ${size.code} · ${flavor}`, () => {
        const legado: ItemApp = { kind: "pizza", name: `Pizza ${size.code}`, detail: flavor, price: 0, qty: 1 };
        const esperadoCents = Math.round((precoLegadoReais(legado) ?? NaN) * 100);

        const resultado = precificarPizzaPorId(
          { sizeId: sizeIdByCode(size.code), flavorIds: [flavorIdByName(flavor)], quantity: 1 },
          catalog
        );

        expect(resultado.ok).toBe(true);
        if (resultado.ok) expect(resultado.unitPriceCents).toBe(esperadoCents);
      });
    }
  }
});

describe("motor nativo: equivalência de preço, pizza de um sabor, com cada borda", () => {
  for (const size of menu.sizes) {
    for (const border of menu.borders) {
      it(`Pizza ${size.code} · Calabresa · borda ${border.label}`, () => {
        const legado: ItemApp = {
          kind: "pizza",
          name: `Pizza ${size.code}`,
          detail: `Calabresa · borda ${border.label}`,
          price: 0,
          qty: 1,
        };
        const esperadoCents = Math.round((precoLegadoReais(legado) ?? NaN) * 100);

        const resultado = precificarPizzaPorId(
          {
            sizeId: sizeIdByCode(size.code),
            flavorIds: [flavorIdByName("Calabresa")],
            borderId: borderIdByLabel(border.label),
            quantity: 1,
          },
          catalog
        );

        expect(resultado.ok).toBe(true);
        if (resultado.ok) expect(resultado.unitPriceCents).toBe(esperadoCents);
      });
    }
  }
});

describe("motor nativo: equivalência de preço, pizza meio a meio (ordem não altera preço)", () => {
  const combos: [string, string][] = [
    ["Calabresa", "Frango Catupiry"],
    ["Portuguesa", "Sensacao"],
    ["Napolitana", "Chocolate"],
  ];

  for (const size of menu.sizes) {
    for (const [a, b] of combos) {
      it(`Pizza ${size.code} · ${a} / ${b} (e invertido)`, () => {
        const legado: ItemApp = {
          kind: "pizza",
          name: `Pizza ${size.code} (meio a meio)`,
          detail: `${a} / ${b}`,
          price: 0,
          qty: 1,
        };
        const esperadoCents = Math.round((precoLegadoReais(legado) ?? NaN) * 100);

        const direto = precificarPizzaPorId(
          { sizeId: sizeIdByCode(size.code), flavorIds: [flavorIdByName(a), flavorIdByName(b)], quantity: 1 },
          catalog
        );
        const invertido = precificarPizzaPorId(
          { sizeId: sizeIdByCode(size.code), flavorIds: [flavorIdByName(b), flavorIdByName(a)], quantity: 1 },
          catalog
        );

        expect(direto.ok).toBe(true);
        expect(invertido.ok).toBe(true);
        if (direto.ok) expect(direto.unitPriceCents).toBe(esperadoCents);
        if (invertido.ok) expect(invertido.unitPriceCents).toBe(esperadoCents);
      });
    }
  }
});

describe("motor nativo: quantidade multiplica o total, nunca o unitário", () => {
  it("3x Pizza G Calabresa", () => {
    const resultado = precificarPizzaPorId(
      { sizeId: sizeIdByCode("G"), flavorIds: [flavorIdByName("Calabresa")], quantity: 3 },
      catalog
    );
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.totalCents).toBe(resultado.unitPriceCents * 3);
    }
  });
});

describe("motor nativo: regras de validação (Fase 2, sem equivalente legado)", () => {
  it("rejeita tamanho inexistente", () => {
    const resultado = precificarPizzaPorId(
      { sizeId: "size-inexistente", flavorIds: [flavorIdByName("Calabresa")], quantity: 1 },
      catalog
    );
    expect(resultado).toEqual({ ok: false, error: "Tamanho não encontrado" });
  });

  it("rejeita sabor inexistente", () => {
    const resultado = precificarPizzaPorId(
      { sizeId: sizeIdByCode("G"), flavorIds: ["flavor-inexistente"], quantity: 1 },
      catalog
    );
    expect(resultado).toEqual({ ok: false, error: "Sabor não encontrado" });
  });

  it("rejeita sabor repetido (meio a meio do mesmo sabor duas vezes)", () => {
    const id = flavorIdByName("Calabresa");
    const resultado = precificarPizzaPorId({ sizeId: sizeIdByCode("G"), flavorIds: [id, id], quantity: 1 }, catalog);
    expect(resultado).toEqual({ ok: false, error: "Sabor repetido" });
  });

  it("rejeita zero sabores", () => {
    const resultado = precificarPizzaPorId({ sizeId: sizeIdByCode("G"), flavorIds: [], quantity: 1 }, catalog);
    expect(resultado).toEqual({ ok: false, error: "Selecione 1 ou 2 sabores" });
  });

  it("rejeita mais de dois sabores", () => {
    const resultado = precificarPizzaPorId(
      {
        sizeId: sizeIdByCode("G"),
        flavorIds: [flavorIdByName("Calabresa"), flavorIdByName("Portuguesa"), flavorIdByName("Mussarela")],
        quantity: 1,
      },
      catalog
    );
    expect(resultado).toEqual({ ok: false, error: "Selecione 1 ou 2 sabores" });
  });

  it("rejeita sabor esgotado", () => {
    const catalogComEsgotado = buildPizzaCatalog(menu, ["Calabresa"]);
    const resultado = precificarPizzaPorId(
      { sizeId: sizeIdByCode("G"), flavorIds: [flavorIdByName("Calabresa")], quantity: 1 },
      catalogComEsgotado
    );
    expect(resultado).toEqual({ ok: false, error: "Sabor indisponível: Calabresa" });
  });

  it("rejeita borda esgotada", () => {
    const catalogComEsgotado = buildPizzaCatalog(menu, ["Catupiry"]);
    const resultado = precificarPizzaPorId(
      {
        sizeId: sizeIdByCode("G"),
        flavorIds: [flavorIdByName("Calabresa")],
        borderId: borderIdByLabel("Catupiry"),
        quantity: 1,
      },
      catalogComEsgotado
    );
    expect(resultado).toEqual({ ok: false, error: "Borda indisponível: Catupiry" });
  });

  it("rejeita borda inexistente", () => {
    const resultado = precificarPizzaPorId(
      { sizeId: sizeIdByCode("G"), flavorIds: [flavorIdByName("Calabresa")], borderId: "border-inexistente", quantity: 1 },
      catalog
    );
    expect(resultado).toEqual({ ok: false, error: "Borda não encontrada" });
  });

  it("rejeita quantidade zero", () => {
    const resultado = precificarPizzaPorId(
      { sizeId: sizeIdByCode("G"), flavorIds: [flavorIdByName("Calabresa")], quantity: 0 },
      catalog
    );
    expect(resultado).toEqual({ ok: false, error: "Quantidade inválida" });
  });

  it("rejeita quantidade fracionária", () => {
    const resultado = precificarPizzaPorId(
      { sizeId: sizeIdByCode("G"), flavorIds: [flavorIdByName("Calabresa")], quantity: 1.5 },
      catalog
    );
    expect(resultado).toEqual({ ok: false, error: "Quantidade inválida" });
  });
});
