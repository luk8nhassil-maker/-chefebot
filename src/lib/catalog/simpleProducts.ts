// Catálogo oficial dos demais produtos configuráveis (Calzone, Mini-Pizza,
// Macarronada, sucos, e produtos simples planos) — Fase 6, hardening pós-
// auditoria.
//
// Diferente do catálogo genérico de ./adapter (que não tem disponibilidade e
// não modela sabor nenhum fora de pizza), esta camada:
//
// 1) adiciona disponibilidade EM TEMPO REAL (mesma lista "esgotados" já
//    usada pelo bot do WhatsApp, pelo cardápio do cliente e pela montagem
//    manual — ver src/app/api/cardapio/route.ts) a cada produto simples
//    (lanche/bebida/suco) — igual ao que @/lib/catalog/pizzas já faz para
//    pizza (Fase 2);
//
// 2) modela os sabores de Calzone e Mini-Pizza a partir das listas OFICIAIS
//    JÁ EXISTENTES no cardápio (menu.calzoneFlavors / menu.miniPizzaFlavors)
//    — nunca a lista de sabores de pizza (menu.saltyFlavors/sweetFlavors),
//    que é uma lista comercial DIFERENTE, ainda que hoje tenha os mesmos
//    valores (ver src/lib/menu.ts). Nenhum dado comercial novo é inventado
//    aqui: as duas listas já existem e já são a fonte usada pelo bot
//    (MENU.miniPizzaFlavors em src/lib/bot.ts) e pelo cardápio do cliente
//    (menu.miniPizzaFlavors em src/app/cardapio/page.tsx) para os mesmos
//    produtos.
import type { Menu } from "@/lib/menu";
import { norm } from "@/lib/pedidoAppItens";
import { slugify } from "./ids";
import { buildCatalog } from "./adapter";

export interface SimpleCatalogProduct {
  id: string;
  name: string;
  priceCents: number;
  available: boolean;
  sizes?: { id: string; code: string; priceCents: number }[];
}

export interface SimpleCatalogFlavor {
  id: string;
  name: string;
  available: boolean;
}

export interface SimpleCatalog {
  lanches: SimpleCatalogProduct[];
  bebidas: SimpleCatalogProduct[];
  sucos: SimpleCatalogProduct[];
  /** Sabores oficiais do Calzone (menu.calzoneFlavors) — produto de 1 sabor só. */
  calzoneFlavors: SimpleCatalogFlavor[];
  /** Sabores oficiais da Mini-Pizza (menu.miniPizzaFlavors) — produto de 1 sabor só. */
  miniPizzaFlavors: SimpleCatalogFlavor[];
}

function estaEsgotado(nome: string, esgotadosNorm: string[]): boolean {
  return esgotadosNorm.includes(norm(nome));
}

function comDisponibilidade<T extends { name: string }>(produto: T, esgotadosNorm: string[]): T & { available: boolean } {
  return { ...produto, available: !estaEsgotado(produto.name, esgotadosNorm) };
}

/**
 * Constrói o catálogo oficial dos produtos simples configuráveis a partir do
 * Menu já lido (getMENUDinamico(), nunca de um valor vindo do cliente) e da
 * lista de esgotados atual (Redis, chave "esgotados"). Não faz I/O.
 */
export function buildSimpleCatalog(menu: Menu, esgotados: readonly string[] = []): SimpleCatalog {
  const catalog = buildCatalog(menu);
  const esgotadosNorm = esgotados.map(norm);

  return {
    lanches: catalog.lanches.map((p) => comDisponibilidade(p, esgotadosNorm)),
    bebidas: catalog.bebidas.map((p) => comDisponibilidade(p, esgotadosNorm)),
    sucos: catalog.sucos.map((p) => comDisponibilidade(p, esgotadosNorm)),
    calzoneFlavors: (menu.calzoneFlavors ?? []).map((name) => ({
      id: `calzone-flavor-${slugify(name)}`,
      name,
      available: !estaEsgotado(name, esgotadosNorm),
    })),
    miniPizzaFlavors: (menu.miniPizzaFlavors ?? []).map((name) => ({
      id: `minipizza-flavor-${slugify(name)}`,
      name,
      available: !estaEsgotado(name, esgotadosNorm),
    })),
  };
}
