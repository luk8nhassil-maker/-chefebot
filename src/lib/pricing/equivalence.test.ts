// Testes de equivalência de preço — Fase 1 da nova arquitetura.
//
// Para cada produto do cardápio ATUAL do ChefeBot, o preço calculado pelo
// motor central (calcularPreco, com seleção estruturada por ID) precisa ser
// EXATAMENTE igual ao preço calculado hoje por officialUnitPrice (com
// name/detail). Qualquer diferença aqui indica uma regressão de preço e
// bloqueia o merge — não deve haver nenhuma.
import { describe, expect, it } from "vitest";
import { buildCatalog } from "@/lib/catalog/adapter";
import { MENU } from "@/lib/menu";
import { officialUnitPrice, type ItemApp, type MenuPedidoApp } from "@/lib/pedidoAppItens";
import { calcularPreco } from "./engine";
import type { PizzaSelection, SimpleSelection } from "./types";

const menu = MENU;
const menuLegado = menu as unknown as MenuPedidoApp;
const catalog = buildCatalog(menu);

function precoLegadoReais(item: ItemApp): number | null {
  return officialUnitPrice(item, menuLegado);
}

function sizeIdByCode(code: string): string {
  const size = catalog.sizes.find((entry) => entry.code === code);
  if (!size) throw new Error(`Tamanho ${code} não encontrado no catálogo de teste`);
  return size.id;
}

function flavorIdByName(name: string): string {
  const flavor = [...catalog.saltyFlavors, ...catalog.sweetFlavors].find((entry) => entry.name === name);
  if (!flavor) throw new Error(`Sabor ${name} não encontrado no catálogo de teste`);
  return flavor.id;
}

function borderIdByLabel(label: string): string {
  const border = catalog.borders.find((entry) => entry.label === label);
  if (!border) throw new Error(`Borda ${label} não encontrada no catálogo de teste`);
  return border.id;
}

function productIdByName(name: string): string {
  const produto = [...catalog.lanches, ...catalog.bebidas, ...catalog.sucos].find((entry) => entry.name === name);
  if (!produto) throw new Error(`Produto ${name} não encontrado no catálogo de teste`);
  return produto.id;
}

describe("equivalência de preço: pizza de um sabor, sem borda", () => {
  for (const size of menu.sizes) {
    for (const flavor of [...menu.saltyFlavors, ...menu.sweetFlavors]) {
      it(`Pizza ${size.code} · ${flavor}`, () => {
        const legado: ItemApp = { kind: "pizza", name: `Pizza ${size.code}`, detail: flavor, price: 0, qty: 1 };
        const selection: PizzaSelection = {
          kind: "pizza",
          sizeId: sizeIdByCode(size.code),
          flavorIds: [flavorIdByName(flavor)],
          quantity: 1,
        };

        const esperadoCents = Math.round((precoLegadoReais(legado) ?? NaN) * 100);
        const resultado = calcularPreco(selection, menu);

        expect(resultado.ok).toBe(true);
        if (resultado.ok) expect(resultado.unitPriceCents).toBe(esperadoCents);
      });
    }
  }
});

describe("equivalência de preço: pizza de um sabor, com cada borda", () => {
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
        const selection: PizzaSelection = {
          kind: "pizza",
          sizeId: sizeIdByCode(size.code),
          flavorIds: [flavorIdByName("Calabresa")],
          borderId: borderIdByLabel(border.label),
          quantity: 1,
        };

        const esperadoCents = Math.round((precoLegadoReais(legado) ?? NaN) * 100);
        const resultado = calcularPreco(selection, menu);

        expect(resultado.ok).toBe(true);
        if (resultado.ok) expect(resultado.unitPriceCents).toBe(esperadoCents);
      });
    }
  }
});

describe("equivalência de preço: pizza meio a meio", () => {
  const combos: [string, string][] = [
    ["Calabresa", "Frango Catupiry"],
    ["Portuguesa", "Sensacao"],
    ["Napolitana", "Chocolate"],
  ];

  for (const size of menu.sizes) {
    for (const [a, b] of combos) {
      it(`Pizza ${size.code} · ${a} / ${b}`, () => {
        const legado: ItemApp = {
          kind: "pizza",
          name: `Pizza ${size.code} (meio a meio)`,
          detail: `${a} / ${b}`,
          price: 0,
          qty: 1,
        };
        const selection: PizzaSelection = {
          kind: "pizza",
          sizeId: sizeIdByCode(size.code),
          flavorIds: [flavorIdByName(a), flavorIdByName(b)],
          quantity: 1,
        };

        const esperadoCents = Math.round((precoLegadoReais(legado) ?? NaN) * 100);
        const resultado = calcularPreco(selection, menu);

        expect(resultado.ok).toBe(true);
        if (resultado.ok) expect(resultado.unitPriceCents).toBe(esperadoCents);
      });
    }
  }
});

describe("equivalência de preço: produtos simples (lanches sem sabor/tamanho)", () => {
  const semExtras = menu.lanches.filter((lanche) => !lanche.hasFlavors && !lanche.sizes);
  for (const lanche of semExtras) {
    it(lanche.name, () => {
      const legado: ItemApp = { kind: "simple", name: lanche.name, price: 0, qty: 1 };
      const selection: SimpleSelection = { kind: "simple", productId: productIdByName(lanche.name), quantity: 1 };

      const esperadoCents = Math.round((precoLegadoReais(legado) ?? NaN) * 100);
      const resultado = calcularPreco(selection, menu);

      expect(resultado.ok).toBe(true);
      if (resultado.ok) expect(resultado.unitPriceCents).toBe(esperadoCents);
    });
  }
});

describe("equivalência de preço: macarronadas por tamanho", () => {
  const macarronadas = menu.lanches.filter((lanche) => lanche.sizes && lanche.sizes.length > 0);
  for (const macarronada of macarronadas) {
    for (const size of macarronada.sizes ?? []) {
      it(`${macarronada.name} · Tamanho ${size.code}`, () => {
        const legado: ItemApp = {
          kind: "simple",
          name: macarronada.name,
          detail: `Tamanho ${size.code}`,
          price: 0,
          qty: 1,
        };
        const selection: SimpleSelection = {
          kind: "simple",
          productId: productIdByName(macarronada.name),
          sizeId: sizeIdByCode(size.code),
          quantity: 1,
        };

        const esperadoCents = Math.round((precoLegadoReais(legado) ?? NaN) * 100);
        const resultado = calcularPreco(selection, menu);

        expect(resultado.ok).toBe(true);
        if (resultado.ok) expect(resultado.unitPriceCents).toBe(esperadoCents);
      });
    }
  }
});

describe("equivalência de preço: calzone por sabor", () => {
  for (const flavor of [...menu.saltyFlavors, ...menu.sweetFlavors]) {
    it(`Calzone · ${flavor}`, () => {
      const legado: ItemApp = { kind: "simple", name: "Calzone", detail: `Sabor: ${flavor}`, price: 0, qty: 1 };
      const selection: SimpleSelection = {
        kind: "simple",
        productId: productIdByName("Calzone"),
        flavorId: flavorIdByName(flavor),
        quantity: 1,
      };

      const esperadoCents = Math.round((precoLegadoReais(legado) ?? NaN) * 100);
      const resultado = calcularPreco(selection, menu);

      expect(resultado.ok).toBe(true);
      if (resultado.ok) expect(resultado.unitPriceCents).toBe(esperadoCents);
    });
  }
});

describe("equivalência de preço: mini-pizza por sabor", () => {
  // Mini-Pizza está em flavorsMode "own" (lista própria miniPizzaFlavors,
  // inalterada por esta correção) — só sabores dessa lista são aceitos.
  for (const flavor of menu.miniPizzaFlavors) {
    it(`Mini-Pizza · ${flavor}`, () => {
      const legado: ItemApp = { kind: "simple", name: "Mini-Pizza", detail: `Sabor: ${flavor}`, price: 0, qty: 1 };
      const selection: SimpleSelection = {
        kind: "simple",
        productId: productIdByName("Mini-Pizza"),
        flavorId: flavorIdByName(flavor),
        quantity: 1,
      };

      const esperadoCents = Math.round((precoLegadoReais(legado) ?? NaN) * 100);
      const resultado = calcularPreco(selection, menu);

      expect(resultado.ok).toBe(true);
      if (resultado.ok) expect(resultado.unitPriceCents).toBe(esperadoCents);
    });
  }

  // REGRESSÃO (auditoria independente pós-7ª rodada) — um sabor de pizza
  // válido mas FORA de miniPizzaFlavors precisa ser rejeitado, nunca aceito
  // só por ser um flavorId oficial válido de outro produto (officialUnitPrice
  // agora valida flavorsMode de QUALQUER produto single_flavor pela
  // configuração oficial, não só pelo nome "Calzone" — ver
  // src/lib/pedidoAppItens.test.ts).
  const saboresForaDaListaPropria = [...menu.saltyFlavors, ...menu.sweetFlavors].filter(
    (flavor) => !menu.miniPizzaFlavors.includes(flavor)
  );
  for (const flavor of saboresForaDaListaPropria) {
    it(`Mini-Pizza · ${flavor} (fora de miniPizzaFlavors) é rejeitado`, () => {
      const selection: SimpleSelection = {
        kind: "simple",
        productId: productIdByName("Mini-Pizza"),
        flavorId: flavorIdByName(flavor),
        quantity: 1,
      };
      expect(calcularPreco(selection, menu).ok).toBe(false);
    });
  }

  it("rejeita mini-pizza sem sabor escolhido", () => {
    const selection: SimpleSelection = { kind: "simple", productId: productIdByName("Mini-Pizza"), quantity: 1 };
    expect(calcularPreco(selection, menu).ok).toBe(false);
  });
});

describe("equivalência de preço: bebidas", () => {
  for (const bebida of menu.bebidas) {
    it(bebida.name, () => {
      const legado: ItemApp = { kind: "simple", name: bebida.name, price: 0, qty: 1 };
      const selection: SimpleSelection = { kind: "simple", productId: productIdByName(bebida.name), quantity: 1 };

      const esperadoCents = Math.round((precoLegadoReais(legado) ?? NaN) * 100);
      const resultado = calcularPreco(selection, menu);

      expect(resultado.ok).toBe(true);
      if (resultado.ok) expect(resultado.unitPriceCents).toBe(esperadoCents);
    });
  }
});

describe("equivalência de preço: sucos, sem leite e com leite", () => {
  for (const suco of menu.sucos) {
    for (const milk of ["sem", "com"] as const) {
      it(`${suco.name} · ${milk} leite`, () => {
        const legado: ItemApp = { kind: "simple", name: suco.name, detail: `${milk} leite`, price: 0, qty: 1 };
        const selection: SimpleSelection = {
          kind: "simple",
          productId: productIdByName(suco.name),
          milk,
          quantity: 1,
        };

        const esperadoCents = Math.round((precoLegadoReais(legado) ?? NaN) * 100);
        const resultado = calcularPreco(selection, menu);

        expect(resultado.ok).toBe(true);
        if (resultado.ok) expect(resultado.unitPriceCents).toBe(esperadoCents);
      });
    }
  }
});

describe("quantidade e totais", () => {
  it("multiplica unitPriceCents por quantity para obter totalCents", () => {
    const selection: PizzaSelection = {
      kind: "pizza",
      sizeId: sizeIdByCode("G"),
      flavorIds: [flavorIdByName("Calabresa")],
      quantity: 3,
    };
    const resultado = calcularPreco(selection, menu);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.totalCents).toBe(resultado.unitPriceCents * 3);
  });
});

describe("rejeição de combinações inválidas — mesmo comportamento do motor legado", () => {
  it("rejeita ID de tamanho inexistente", () => {
    const selection: PizzaSelection = {
      kind: "pizza",
      sizeId: "size-inexistente",
      flavorIds: [flavorIdByName("Calabresa")],
      quantity: 1,
    };
    expect(calcularPreco(selection, menu).ok).toBe(false);
  });

  it("rejeita ID de sabor inexistente", () => {
    const selection: PizzaSelection = {
      kind: "pizza",
      sizeId: sizeIdByCode("G"),
      flavorIds: ["flavor-inexistente"],
      quantity: 1,
    };
    expect(calcularPreco(selection, menu).ok).toBe(false);
  });

  it("rejeita ID de borda inexistente", () => {
    const selection: PizzaSelection = {
      kind: "pizza",
      sizeId: sizeIdByCode("G"),
      flavorIds: [flavorIdByName("Calabresa")],
      borderId: "border-inexistente",
      quantity: 1,
    };
    expect(calcularPreco(selection, menu).ok).toBe(false);
  });

  it("rejeita ID de produto inexistente", () => {
    const selection: SimpleSelection = { kind: "simple", productId: "product-inexistente", quantity: 1 };
    expect(calcularPreco(selection, menu).ok).toBe(false);
  });

  it("rejeita calzone sem sabor escolhido", () => {
    const selection: SimpleSelection = { kind: "simple", productId: productIdByName("Calzone"), quantity: 1 };
    expect(calcularPreco(selection, menu).ok).toBe(false);
  });

  it("rejeita macarronada sem tamanho escolhido", () => {
    const selection: SimpleSelection = {
      kind: "simple",
      productId: productIdByName("Macarronada de Carne"),
      quantity: 1,
    };
    expect(calcularPreco(selection, menu).ok).toBe(false);
  });

  it("rejeita quantidade zero ou fracionária", () => {
    const base: PizzaSelection = {
      kind: "pizza",
      sizeId: sizeIdByCode("G"),
      flavorIds: [flavorIdByName("Calabresa")],
      quantity: 0,
    };
    expect(calcularPreco(base, menu).ok).toBe(false);
    expect(calcularPreco({ ...base, quantity: 1.5 }, menu).ok).toBe(false);
  });
});
