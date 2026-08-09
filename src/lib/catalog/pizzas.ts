// Catálogo oficial de pizzas — cardápio 2026.
//
// Fonte comercial: @/lib/catalog/officialMenu2026 (versionada, em código —
// ver o cabeçalho daquele arquivo para o porquê de preço/produto/sabor NÃO
// morarem mais no Menu/Redis). Esta camada só ADICIONA o que só pode ser
// calculado em tempo de requisição: disponibilidade (lista "esgotados",
// Redis, a mesma fonte usada pelo bot do WhatsApp, pelo cardápio do
// cliente e pela montagem manual — ver src/app/api/cardapio/route.ts).
//
// `menu: Menu` continua no parâmetro por estabilidade de assinatura (todos
// os chamadores existentes passam o Menu já lido) mas não é mais lido para
// preço/produto/sabor de pizza — só a disponibilidade (`esgotados`) decide
// algo aqui agora.
import type { Menu } from "@/lib/menu";
import { norm } from "@/lib/pedidoAppItens";
import {
  PIZZA_ADDONS,
  PIZZA_BORDERS,
  PIZZA_FLAVORS,
  PIZZA_SIZES,
  type OfficialPizzaFlavor,
  type PizzaSizeCode,
} from "./officialMenu2026";

export type PizzaCategoryId = "tradicional" | "especial" | "doce";

export interface PizzaCatalogFlavor {
  id: string;
  name: string;
  category: PizzaCategoryId;
  ingredients: string;
  aliases: string[];
  available: boolean;
  /** Preço por tamanho, em centavos — chave ausente = tamanho não permitido
   *  para este sabor (Especiais nunca têm MINI). */
  pricesBySizeCode: Partial<Record<PizzaSizeCode, number>>;
  description?: string;
}

export interface PizzaCatalogSize {
  id: string;
  code: PizzaSizeCode;
  label: string;
  fatias: number;
}

export interface PizzaCatalogBorder {
  id: string;
  label: string;
  /** Preço por tamanho (P/M/G/F — nunca MINI), em centavos. */
  pricesBySizeCode: Record<"P" | "M" | "G" | "F", number>;
  available: boolean;
}

export interface PizzaCatalogAddOn {
  id: string;
  label: string;
  /** Preço por tamanho (P/M/G/F — nunca MINI), em centavos. */
  pricesBySizeCode: Record<"P" | "M" | "G" | "F", number>;
  available: boolean;
}

export interface PizzaCatalog {
  sizes: PizzaCatalogSize[];
  flavors: PizzaCatalogFlavor[];
  borders: PizzaCatalogBorder[];
  addOns: PizzaCatalogAddOn[];
}

function estaEsgotado(nome: string, esgotadosNorm: string[]): boolean {
  return esgotadosNorm.includes(norm(nome));
}

function toCatalogFlavor(flavor: OfficialPizzaFlavor, esgotadosNorm: string[]): PizzaCatalogFlavor {
  return {
    id: flavor.id,
    name: flavor.name,
    category: flavor.category,
    ingredients: flavor.ingredients,
    aliases: flavor.aliases ?? [],
    available: !estaEsgotado(flavor.name, esgotadosNorm),
    pricesBySizeCode: flavor.pricesBySizeCode,
  };
}

/**
 * Constrói o catálogo oficial de pizzas — sabores, preços por tamanho
 * (cardápio 2026, @/lib/catalog/officialMenu2026), bordas, adicionais — com
 * disponibilidade em tempo real a partir de `esgotados` (Redis, nunca de um
 * valor vindo do cliente). Não faz I/O.
 */
export function buildPizzaCatalog(_menu: Menu, esgotados: readonly string[] = []): PizzaCatalog {
  const esgotadosNorm = esgotados.map(norm);

  return {
    sizes: PIZZA_SIZES.map((size) => ({ id: size.id, code: size.code, label: size.label, fatias: size.fatias })),
    flavors: PIZZA_FLAVORS.map((flavor) => toCatalogFlavor(flavor, esgotadosNorm)),
    borders: PIZZA_BORDERS.map((border) => ({
      id: border.id,
      label: border.label,
      pricesBySizeCode: border.pricesBySizeCode,
      available: !estaEsgotado(border.label, esgotadosNorm),
    })),
    addOns: PIZZA_ADDONS.map((addOn) => ({
      id: addOn.id,
      label: addOn.label,
      pricesBySizeCode: addOn.pricesBySizeCode,
      available: !estaEsgotado(addOn.label, esgotadosNorm),
    })),
  };
}
