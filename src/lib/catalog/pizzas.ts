// Catálogo oficial de pizzas — cardápio 2026.
//
// Fonte comercial: @/lib/catalog/officialMenu2026 (versionada, em código —
// ver o cabeçalho daquele arquivo para o porquê de preço/produto/sabor NÃO
// morarem mais no Menu/Redis). Esta camada só ADICIONA o que só pode ser
// calculado em tempo de requisição: disponibilidade (lista "esgotados",
// Redis, a mesma fonte usada pelo bot do WhatsApp, pelo cardápio do
// cliente e pela montagem manual — ver src/app/api/cardapio/route.ts).
//
// Exceção comercial aprovada em 21/08/2026: somente Portuguesa e Carne Seca,
// ambas da categoria Especial, também podem ser vendidas no tamanho MINI por
// R$ 20,00. O cardápio impresso original continua preservado em
// officialMenu2026; esta exceção nova fica explícita por ID estável aqui, na
// camada de catálogo consumida por UI e precificação server-side.
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
   *  para este sabor. Especiais continuam sem MINI, exceto as exceções
   *  comerciais explícitas em MINI_ESPECIAIS_APROVADAS_CENTS. */
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

const MINI_ESPECIAIS_APROVADAS_CENTS: Readonly<Record<string, number>> = Object.freeze({
  "flavor-portuguesa": 2000,
  "flavor-carne-seca": 2000,
});

function estaEsgotado(nome: string, esgotadosNorm: string[]): boolean {
  return esgotadosNorm.includes(norm(nome));
}

function precosComExcecaoMini(flavor: OfficialPizzaFlavor): Partial<Record<PizzaSizeCode, number>> {
  const miniCents = MINI_ESPECIAIS_APROVADAS_CENTS[flavor.id];
  if (miniCents === undefined) return flavor.pricesBySizeCode;
  return { ...flavor.pricesBySizeCode, MINI: miniCents };
}

function toCatalogFlavor(flavor: OfficialPizzaFlavor, esgotadosNorm: string[], esgotadosIds: Set<string>): PizzaCatalogFlavor {
  return {
    id: flavor.id,
    name: flavor.name,
    category: flavor.category,
    ingredients: flavor.ingredients,
    aliases: flavor.aliases ?? [],
    available: !estaEsgotado(flavor.name, esgotadosNorm) && !esgotadosIds.has(flavor.id),
    pricesBySizeCode: precosComExcecaoMini(flavor),
  };
}

/**
 * Constrói o catálogo oficial de pizzas — sabores, preços por tamanho
 * (cardápio 2026, @/lib/catalog/officialMenu2026 + exceções comerciais
 * explicitamente versionadas acima), bordas, adicionais — com
 * disponibilidade em tempo real a partir de `esgotados` (Redis, nunca de um
 * valor vindo do cliente). Não faz I/O.
 */
export function buildPizzaCatalog(_menu: Menu, esgotados: readonly string[] = [], idsEsgotados: readonly string[] = []): PizzaCatalog {
  const esgotadosNorm = esgotados.map(norm);
  const esgotadosIds = new Set(idsEsgotados);

  return {
    sizes: PIZZA_SIZES.map((size) => ({ id: size.id, code: size.code, label: size.label, fatias: size.fatias })),
    flavors: PIZZA_FLAVORS.map((flavor) => toCatalogFlavor(flavor, esgotadosNorm, esgotadosIds)),
    borders: PIZZA_BORDERS.map((border) => ({
      id: border.id,
      label: border.label,
      pricesBySizeCode: border.pricesBySizeCode,
      available: !estaEsgotado(border.label, esgotadosNorm) && !esgotadosIds.has(border.id),
    })),
    addOns: PIZZA_ADDONS.map((addOn) => ({
      id: addOn.id,
      label: addOn.label,
      pricesBySizeCode: addOn.pricesBySizeCode,
      available: !estaEsgotado(addOn.label, esgotadosNorm) && !esgotadosIds.has(addOn.id),
    })),
  };
}
