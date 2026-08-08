// Catálogo oficial dos demais produtos configuráveis (Calzone, Mini-Pizza,
// Macarronada, sucos, e produtos simples planos) — Fase 6, hardening pós-
// auditoria (2ª rodada).
//
// Diferente do catálogo genérico de ./adapter (que não tem disponibilidade),
// esta camada adiciona disponibilidade EM TEMPO REAL (mesma lista
// "esgotados" já usada pelo bot do WhatsApp, pelo cardápio do cliente e pela
// montagem manual — ver src/app/api/cardapio/route.ts) a cada produto
// simples (lanche/bebida/suco) — igual ao que @/lib/catalog/pizzas já faz
// para pizza (Fase 2).
//
// Sabores de Calzone e Mini-Pizza: um sabor como "Calabresa" é a MESMA
// entidade comercial em pizza, calzone e mini-pizza — reutiliza o MESMO
// flavorId oficial do catálogo canônico de sabores (o mesmo id que
// @/lib/catalog/pizzas expõe para pizza), nunca um ID novo por produto.
// O que muda por produto são só (a) a LISTA de sabores permitidos — as
// listas oficiais JÁ EXISTENTES no cardápio, menu.calzoneFlavors/
// menu.miniPizzaFlavors, nunca inventadas aqui — e (b) a disponibilidade,
// recalculada de forma independente para cada lista (mesmo cálculo, mesma
// fonte "esgotados", mas nunca lida "por referência" do catálogo de outro
// produto). Um sabor fora da lista permitida de um produto (ex.: "Sensação",
// doce, fora de menu.calzoneFlavors) nunca resolve para aquele produto,
// mesmo com um flavorId válido de pizza.
import type { Menu } from "@/lib/menu";
import { norm } from "@/lib/pedidoAppItens";
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
  /** Sabores permitidos do Calzone (menu.calzoneFlavors), com o MESMO
   *  flavorId do catálogo canônico de sabores — produto de 1 sabor só. */
  calzoneFlavors: SimpleCatalogFlavor[];
  /** Sabores permitidos da Mini-Pizza (menu.miniPizzaFlavors), com o MESMO
   *  flavorId do catálogo canônico de sabores — produto de 1 sabor só. */
  miniPizzaFlavors: SimpleCatalogFlavor[];
}

function estaEsgotado(nome: string, esgotadosNorm: string[]): boolean {
  return esgotadosNorm.includes(norm(nome));
}

function comDisponibilidade<T extends { name: string }>(produto: T, esgotadosNorm: string[]): T & { available: boolean } {
  return { ...produto, available: !estaEsgotado(produto.name, esgotadosNorm) };
}

/**
 * Filtra o catálogo CANÔNICO de sabores (mesmos IDs/nomes que
 * @/lib/catalog/adapter e @/lib/catalog/pizzas usam para pizza) pelos nomes
 * permitidos de um produto específico, recalculando disponibilidade de
 * forma independente para essa lista — nunca por referência a outro
 * catálogo (pizza, ou o outro produto simples).
 */
function flavoresPermitidos(
  flavoresCanonicos: readonly { id: string; name: string }[],
  nomesPermitidos: readonly string[] | undefined,
  esgotadosNorm: string[]
): SimpleCatalogFlavor[] {
  const permitidosNorm = new Set((nomesPermitidos ?? []).map(norm));
  return flavoresCanonicos
    .filter((flavor) => permitidosNorm.has(norm(flavor.name)))
    .map((flavor) => ({ id: flavor.id, name: flavor.name, available: !estaEsgotado(flavor.name, esgotadosNorm) }));
}

/**
 * Constrói o catálogo oficial dos produtos simples configuráveis a partir do
 * Menu já lido (getMENUDinamico(), nunca de um valor vindo do cliente) e da
 * lista de esgotados atual (Redis, chave "esgotados"). Não faz I/O.
 */
export function buildSimpleCatalog(menu: Menu, esgotados: readonly string[] = []): SimpleCatalog {
  const catalog = buildCatalog(menu);
  const esgotadosNorm = esgotados.map(norm);
  // Catálogo canônico de sabores — mesma fonte/IDs que a pizza usa
  // (@/lib/catalog/adapter: `flavor-<slug>`), nunca um espaço de IDs novo.
  const flavoresCanonicos = [...catalog.saltyFlavors, ...catalog.sweetFlavors];

  return {
    lanches: catalog.lanches.map((p) => comDisponibilidade(p, esgotadosNorm)),
    bebidas: catalog.bebidas.map((p) => comDisponibilidade(p, esgotadosNorm)),
    sucos: catalog.sucos.map((p) => comDisponibilidade(p, esgotadosNorm)),
    calzoneFlavors: flavoresPermitidos(flavoresCanonicos, menu.calzoneFlavors, esgotadosNorm),
    miniPizzaFlavors: flavoresPermitidos(flavoresCanonicos, menu.miniPizzaFlavors, esgotadosNorm),
  };
}
