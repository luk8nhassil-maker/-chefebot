import "server-only";

import { MENU, type Menu } from "./menu";
import { redis } from "./redis";

export class CardapioIndisponivelError extends Error {
  readonly originalError: unknown;

  constructor(originalError: unknown) {
    super("Cardápio temporariamente indisponível");
    this.name = "CardapioIndisponivelError";
    this.originalError = originalError;
  }
}

function secaoPersistida<K extends keyof Menu>(
  cardapio: Partial<Menu>,
  chave: K,
): Menu[K] {
  const valor = cardapio[chave];
  return Array.isArray(valor) && valor.length > 0 ? (valor as Menu[K]) : MENU[chave];
}

/**
 * Lê o catálogo oficial persistido.
 *
 * A ausência da chave representa uma instalação ainda não inicializada e usa
 * o catálogo-base do próprio ChefeBot. Uma falha de Redis é diferente: ela
 * precisa chegar ao chamador para impedir venda com preço possivelmente antigo.
 */
export async function getMENUDinamico(): Promise<Menu> {
  let cardapio: Partial<Menu> | null;

  try {
    cardapio = await redis.get<Partial<Menu>>("cardapio");
  } catch (error) {
    throw new CardapioIndisponivelError(error);
  }

  if (!cardapio) return MENU;

  return {
    sizes: secaoPersistida(cardapio, "sizes"),
    saltyFlavors: secaoPersistida(cardapio, "saltyFlavors"),
    sweetFlavors: secaoPersistida(cardapio, "sweetFlavors"),
    calzoneFlavors: secaoPersistida(cardapio, "calzoneFlavors"),
    miniPizzaFlavors: secaoPersistida(cardapio, "miniPizzaFlavors"),
    lanches: secaoPersistida(cardapio, "lanches"),
    bebidas: secaoPersistida(cardapio, "bebidas"),
    sucos: secaoPersistida(cardapio, "sucos"),
    borders: secaoPersistida(cardapio, "borders"),
    neighborhoods: secaoPersistida(cardapio, "neighborhoods"),
    payments: secaoPersistida(cardapio, "payments"),
  };
}
