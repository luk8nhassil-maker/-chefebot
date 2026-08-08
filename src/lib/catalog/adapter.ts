// Adaptador puro: Menu (formato de armazenamento atual, valores em reais
// inteiros) -> Catalog (view tipada, IDs estáveis, preços em centavos).
//
// Não lê Redis, não faz I/O. Quem chama já buscou o Menu (via
// getMENUDinamico em @/lib/menu.server, ou o MENU estático de @/lib/menu) e
// passa aqui. Isso mantém esta camada pura e testável sem mocks.
import type { Menu } from "@/lib/menu";
import { slugify } from "./ids";
import type { Catalog, CatalogBorder, CatalogFlavor, CatalogSimpleProduct, FlavorGroup } from "./types";

function toCents(reais: number): number {
  return Math.round(reais * 100);
}

function buildFlavors(names: string[], group: FlavorGroup): CatalogFlavor[] {
  return names.map((name) => ({ id: `flavor-${slugify(name)}`, name, group }));
}

export function buildCatalog(menu: Menu): Catalog {
  const sizes = menu.sizes.map((size) => ({
    id: `size-${slugify(size.code)}`,
    code: size.code,
    label: size.label,
    priceCents: toCents(size.price),
  }));

  const lanches: CatalogSimpleProduct[] = menu.lanches.map((lanche) => ({
    id: `product-${slugify(lanche.name)}`,
    name: lanche.name,
    priceCents: toCents(lanche.price),
    sizes: lanche.sizes?.map((size) => ({
      id: `size-${slugify(size.code)}`,
      code: size.code,
      priceCents: toCents(size.price),
    })),
    hasFlavors: lanche.hasFlavors,
    flavorsKey: lanche.flavorsKey,
    flavorsMode: lanche.flavorsMode,
  }));

  const bebidas = menu.bebidas.map((bebida) => ({
    id: `product-${slugify(bebida.name)}`,
    name: bebida.name,
    priceCents: toCents(bebida.price),
  }));

  const sucos = menu.sucos.map((suco) => ({
    id: `product-${slugify(suco.name)}`,
    name: suco.name,
    priceCents: toCents(suco.price),
  }));

  const borders: CatalogBorder[] = menu.borders.map((border) => ({
    id: `border-${slugify(border.label)}`,
    label: border.label,
    priceSmallCents: toCents(border.priceSmall),
    priceLargeCents: toCents(border.priceLarge),
  }));

  return {
    sizes,
    saltyFlavors: buildFlavors(menu.saltyFlavors, "salty"),
    sweetFlavors: buildFlavors(menu.sweetFlavors, "sweet"),
    lanches,
    bebidas,
    sucos,
    borders,
  };
}
