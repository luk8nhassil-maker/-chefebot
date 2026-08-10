import type { Menu } from "@/lib/menu";
import {
  BEBIDAS,
  CALZONE_FLAVORS,
  HAMBURGUERES,
  LANCHES_FIXOS,
  MACARRONADAS,
  PASTEL_FEIRA_PRICE_CENTS,
  PASTEL_FEIRA_RECHEIOS,
  PASTEL_FORNO_FLAVORS,
  PIZZA_BORDERS,
  PIZZA_FLAVORS,
  PIZZA_SIZES,
  SUCOS,
  VITAMINAS,
} from "./officialMenu2026";

export type BotMenuItem = {
  name: string;
  price: number;
  hasFlavors: boolean;
  flavorsKey: string;
  flavorsMode?: "pizza" | "own";
  sizes?: { code: string; price: number }[];
  flavors?: string[];
  flavorPrices?: Record<string, number>;
};

export type BotDrinkItem = { name: string; price: number; acceptsMilk?: boolean };

export type BotMenu = Omit<Menu, "lanches" | "bebidas" | "sucos" | "sizes" | "borders"> & {
  lanches: BotMenuItem[];
  bebidas: BotDrinkItem[];
  sucos: BotDrinkItem[];
  sizes: { code: string; label: string; price: number }[];
  borders: {
    label: string;
    priceSmall: number;
    priceLarge: number;
    pricesBySizeCode: Record<"P" | "M" | "G" | "F", number>;
  }[];
};

const reais = (cents: number) => cents / 100;

function menorPrecoPizza(sizeCode: string): number {
  const valores = PIZZA_FLAVORS
    .map((flavor) => flavor.pricesBySizeCode[sizeCode as keyof typeof flavor.pricesBySizeCode])
    .filter((price): price is number => price !== undefined);
  return valores.length > 0 ? reais(Math.min(...valores)) : 0;
}

/**
 * Projeta o catálogo comercial oficial no formato conversacional já usado
 * pelo bot. Bairros, pagamentos e demais configurações operacionais continuam
 * vindo do Menu/Redis; produto e preço nunca vêm dele.
 */
export function buildBotMenu2026(operationalMenu: Menu): BotMenu {
  const calzoneFlavors = CALZONE_FLAVORS.map((flavor) => flavor.displayLabel ?? flavor.name);
  const pastelFornoFlavors = PASTEL_FORNO_FLAVORS.map((flavor) => flavor.displayLabel ?? flavor.name);
  const flavorPriceMap = Object.fromEntries(
    CALZONE_FLAVORS.map((flavor) => [flavor.displayLabel ?? flavor.name, reais(flavor.priceCents)]),
  );

  const lanches: BotMenuItem[] = [
    {
      name: "Calzone",
      price: Math.min(...CALZONE_FLAVORS.map((flavor) => reais(flavor.priceCents))),
      hasFlavors: true,
      flavorsKey: "calzoneFlavors",
      flavorsMode: "own",
      flavors: calzoneFlavors,
      flavorPrices: flavorPriceMap,
    },
    ...MACARRONADAS.map((produto) => ({
      name: produto.name,
      price: 0,
      hasFlavors: false,
      flavorsKey: "",
      sizes: Object.entries(produto.pricesBySizeCode).map(([code, price]) => ({ code, price: reais(price) })),
    })),
    ...HAMBURGUERES.slice(0, 3).map((produto) => ({ name: produto.name, price: reais(produto.priceCents), hasFlavors: false, flavorsKey: "" })),
    ...LANCHES_FIXOS.slice(0, 1).map((produto) => ({ name: produto.name, price: reais(produto.priceCents), hasFlavors: false, flavorsKey: "" })),
    ...HAMBURGUERES.slice(3).map((produto) => ({ name: produto.name, price: reais(produto.priceCents), hasFlavors: false, flavorsKey: "" })),
    ...LANCHES_FIXOS.slice(1).map((produto) => ({ name: produto.name, price: reais(produto.priceCents), hasFlavors: false, flavorsKey: "" })),
    {
      name: "Pastel de Forno",
      price: reais(PASTEL_FORNO_FLAVORS[0]?.priceCents ?? 0),
      hasFlavors: true,
      flavorsKey: "pastelFornoFlavors",
      flavorsMode: "own",
      flavors: pastelFornoFlavors,
    },
    {
      name: "Pastel de Feira",
      price: reais(PASTEL_FEIRA_PRICE_CENTS),
      hasFlavors: true,
      flavorsKey: "pastelFeiraFlavors",
      flavorsMode: "own",
      flavors: PASTEL_FEIRA_RECHEIOS.map((recheio) => recheio.name),
    },
  ];

  return {
    ...operationalMenu,
    // Mantém a ordem histórica do atendimento (P/M/G/F) e acrescenta MINI
    // ao final. Assim, os números que clientes recorrentes já usam não mudam.
    sizes: (["P", "M", "G", "F", "MINI"] as const).map((code) => {
      const size = PIZZA_SIZES.find((entry) => entry.code === code)!;
      return { code: size.code, label: size.label, price: menorPrecoPizza(size.code) };
    }),
    saltyFlavors: PIZZA_FLAVORS.filter((flavor) => flavor.category !== "doce").map((flavor) => flavor.name),
    sweetFlavors: PIZZA_FLAVORS.filter((flavor) => flavor.category === "doce").map((flavor) => flavor.name),
    calzoneFlavors,
    miniPizzaFlavors: PIZZA_FLAVORS.filter((flavor) => flavor.pricesBySizeCode.MINI !== undefined).map((flavor) => flavor.name),
    lanches,
    bebidas: BEBIDAS.map((produto) => ({ name: produto.name, price: reais(produto.priceCents) })),
    sucos: [
      ...SUCOS.map((produto) => ({ name: produto.name, price: reais(produto.priceCents), acceptsMilk: true })),
      ...VITAMINAS.map((produto) => ({ name: produto.name, price: reais(produto.priceCents), acceptsMilk: false })),
    ],
    borders: PIZZA_BORDERS.map((border) => ({
      label: border.label,
      priceSmall: reais(border.pricesBySizeCode.P),
      priceLarge: reais(border.pricesBySizeCode.G),
      pricesBySizeCode: {
        P: reais(border.pricesBySizeCode.P),
        M: reais(border.pricesBySizeCode.M),
        G: reais(border.pricesBySizeCode.G),
        F: reais(border.pricesBySizeCode.F),
      },
    })),
  };
}
