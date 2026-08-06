// Catálogo central tipado — fonte única para IDs estáveis de produtos,
// sabores, tamanhos, bordas etc.
//
// Esta camada NÃO substitui o armazenamento atual (Redis, chave "cardapio",
// lido por getMENUDinamico em @/lib/menu.server). Ela é uma VIEW tipada e com
// IDs estáveis construída a partir dele (ver ./adapter). Preços aqui são
// sempre em centavos inteiros — nunca reais fracionários, nunca string.

export type SizeId = string;
export type FlavorId = string;
export type ProductId = string;
export type BorderId = string;

export interface CatalogSize {
  id: SizeId;
  code: string;
  label: string;
  priceCents: number;
}

export type FlavorGroup = "salty" | "sweet";

export interface CatalogFlavor {
  id: FlavorId;
  name: string;
  group: FlavorGroup;
}

export interface CatalogBorder {
  id: BorderId;
  label: string;
  priceSmallCents: number;
  priceLargeCents: number;
}

export interface CatalogSimpleProduct {
  id: ProductId;
  name: string;
  priceCents: number;
  sizes?: { id: SizeId; code: string; priceCents: number }[];
}

export interface CatalogDrink {
  id: ProductId;
  name: string;
  priceCents: number;
}

export interface CatalogJuice {
  id: ProductId;
  name: string;
  priceCents: number;
}

export interface Catalog {
  sizes: CatalogSize[];
  saltyFlavors: CatalogFlavor[];
  sweetFlavors: CatalogFlavor[];
  lanches: CatalogSimpleProduct[];
  bebidas: CatalogDrink[];
  sucos: CatalogJuice[];
  borders: CatalogBorder[];
}
