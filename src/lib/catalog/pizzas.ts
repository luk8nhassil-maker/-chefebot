// Catálogo oficial de pizzas — Fase 2.
//
// Camada especializada em cima do catálogo tipado genérico da Fase 1
// (./adapter, ./types) e dos apelidos já usados pelo bot do WhatsApp para
// reconhecer sabores digitados por clientes (APELIDOS_SABOR, @/lib/bot) —
// nenhum dado comercial novo é inventado aqui: é só uma VIEW mais rica,
// com IDs estáveis, agrupamento por categoria, apelidos e disponibilidade
// em tempo real (a partir da lista "esgotados", já a fonte oficial única
// de disponibilidade no ChefeBot — ver src/app/api/cardapio/route.ts).
//
// Categorização comercial (gap conhecido, ver docs de entrega da Fase 2):
// hoje o cardápio oficial só distingue sabores "Salgados" e "Doces"
// (menu.saltyFlavors / menu.sweetFlavors) — mesmo preço por tamanho para
// qualquer sabor dentro de cada grupo. NÃO existe, em nenhuma fonte oficial
// do ChefeBot, uma separação comercial entre "Tradicionais" e "Especiais"
// dentro dos salgados (ex.: sabores mais caros). "especial" fica reservado
// no tipo abaixo para o dia em que essa regra comercial existir de
// verdade — nenhum sabor é classificado nela hoje, para não inventar uma
// categoria/preço sem dado oficial.
import type { Menu } from "@/lib/menu";
import { norm } from "@/lib/pedidoAppItens";
import { APELIDOS_SABOR } from "@/lib/bot";
import { buildCatalog } from "./adapter";

export type PizzaCategoryId = "tradicional" | "especial" | "doce";

export interface PizzaCatalogFlavor {
  id: string;
  name: string;
  category: PizzaCategoryId;
  /** Apelidos/grafias alternativas já reconhecidas pelo bot do WhatsApp para este sabor (pode ser vazio). */
  aliases: string[];
  available: boolean;
  /** Nenhuma fonte oficial de texto de marketing existe hoje — sempre undefined até que exista. */
  description?: string;
}

export interface PizzaCatalogSize {
  id: string;
  code: string;
  label: string;
  priceCents: number;
}

export interface PizzaCatalogBorder {
  id: string;
  label: string;
  priceSmallCents: number;
  priceLargeCents: number;
  available: boolean;
}

export interface PizzaCatalog {
  sizes: PizzaCatalogSize[];
  flavors: PizzaCatalogFlavor[];
  borders: PizzaCatalogBorder[];
}

function estaEsgotado(nome: string, esgotadosNorm: string[]): boolean {
  return esgotadosNorm.includes(norm(nome));
}

/**
 * Constrói o catálogo oficial de pizzas a partir do Menu já lido
 * (getMENUDinamico(), nunca de um valor vindo do cliente) e da lista de
 * esgotados atual (Redis, chave "esgotados" — mesma fonte usada pelo bot,
 * pelo cardápio do cliente e pela montagem manual). Não faz I/O.
 */
export function buildPizzaCatalog(menu: Menu, esgotados: readonly string[] = []): PizzaCatalog {
  const catalog = buildCatalog(menu);
  const esgotadosNorm = esgotados.map(norm);

  const tradicionais: PizzaCatalogFlavor[] = catalog.saltyFlavors.map((flavor) => ({
    id: flavor.id,
    name: flavor.name,
    category: "tradicional",
    aliases: APELIDOS_SABOR[flavor.name] ?? [],
    available: !estaEsgotado(flavor.name, esgotadosNorm),
  }));

  const doces: PizzaCatalogFlavor[] = catalog.sweetFlavors.map((flavor) => ({
    id: flavor.id,
    name: flavor.name,
    category: "doce",
    aliases: APELIDOS_SABOR[flavor.name] ?? [],
    available: !estaEsgotado(flavor.name, esgotadosNorm),
  }));

  return {
    sizes: catalog.sizes.map((size) => ({ id: size.id, code: size.code, label: size.label, priceCents: size.priceCents })),
    flavors: [...tradicionais, ...doces],
    borders: catalog.borders.map((border) => ({
      id: border.id,
      label: border.label,
      priceSmallCents: border.priceSmallCents,
      priceLargeCents: border.priceLargeCents,
      available: !estaEsgotado(border.label, esgotadosNorm),
    })),
  };
}
