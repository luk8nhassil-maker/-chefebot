/**
 * Novidades do cardápio lançado em 10/08/2026.
 *
 * A lista foi obtida comparando o catálogo oficial 2026 com o catálogo
 * imediatamente anterior ao merge que o colocou em produção. Correções de
 * grafia, acento e mudança de categoria do mesmo item não entram como
 * novidade. IDs mantêm a regra independente do texto exibido na interface.
 */
export const CATALOG_LAUNCH_AT = "2026-08-10T00:00:00-03:00";
export const NOVELTY_DURATION_DAYS = 30;

export const NEW_CATALOG_ITEM_IDS = new Set<string>([
  // Pizzas tradicionais
  "flavor-frango-com-chedder",
  "flavor-milho",
  "flavor-frango",
  "flavor-presunto",
  "flavor-xuxa",
  "flavor-siciliana",
  "flavor-caramussa",
  "flavor-toscana",

  // Pizzas especiais
  "flavor-calabresa-suprema",
  "flavor-frango-catupiry-original",
  "flavor-6-queijos",
  "flavor-nordestina",
  "flavor-carne-seca-especial",
  "flavor-atum",
  "flavor-5-queijos",
  "flavor-caipira",
  "flavor-peper-cheddar",
  "flavor-delicia",
  "flavor-pizza-do-chefe",
  "flavor-calabresa-com-barbecue",
  "flavor-calabresa-especial",
  "flavor-calabresa-suprema-2",
  "flavor-carne-de-sol-da-casa",
  "flavor-carne-de-sol-especial-da-casa",

  // Pizzas doces
  "flavor-choconinho",
  "flavor-m-m",
  "flavor-dois-amores",

  // Categorias e produtos simples novos
  "product-pastel-de-forno",
  "product-pastel-de-feira",
  "hamburguer-x-calabresa",
  "hamburguer-x-salada",
  "lanche-coxinha-de-frango",
  "lanche-coxinha-de-frango-c-catupiry",
  "lanche-pastel-de-carne-seca",
  "suco-graviola",
  "suco-abacaxi",
  "suco-abacaxi-com-hortela",
  "bebida-coca-cola-1l",
  "bebida-jesus-1l",
  "bebida-fanta-laranja-1l",
  "bebida-kuat-1l",
  "bebida-coca-cola-2l",
  "bebida-jesus-2l",
  "bebida-fanta-laranja-2l",
  "bebida-fanta-uva-2l",
  "bebida-kuat-2l",
]);

export function noveltyExpiresAt(): Date {
  const expiresAt = new Date(CATALOG_LAUNCH_AT);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + NOVELTY_DURATION_DAYS);
  return expiresAt;
}

export function isNoveltyPeriodActive(now: Date = new Date()): boolean {
  const launchAt = new Date(CATALOG_LAUNCH_AT);
  return now.getTime() >= launchAt.getTime() && now.getTime() < noveltyExpiresAt().getTime();
}

export function isNewCatalogItem(id: string | undefined, now: Date = new Date()): boolean {
  return isNewCatalogItemId(id) && isNoveltyPeriodActive(now);
}

export function isNewCatalogItemId(id: string | undefined): boolean {
  return !!id && NEW_CATALOG_ITEM_IDS.has(id);
}
