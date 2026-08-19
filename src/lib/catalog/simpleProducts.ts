// Catálogo oficial dos demais produtos configuráveis — cardápio 2026.
//
// Fonte comercial principal: @/lib/catalog/officialMenu2026. O bloco de
// pastéis recebeu uma atualização comercial isolada em
// @/lib/catalog/pasteisAtualizados para substituir o item antigo de R$25 sem
// mexer nas demais categorias já validadas.
//
// Esta camada só ADICIONA disponibilidade EM TEMPO REAL (mesma lista
// "esgotados" usada pelo bot do WhatsApp, pelo cardápio do cliente e pela
// montagem manual — ver src/app/api/cardapio/route.ts) a cada produto/sabor.
//
// ZERO acoplamento por nome: cada produto tem uma `strategy` explícita,
// atribuída aqui por CATEGORIA (nunca por nome de produto):
//   - "fixed"          — preço único, sem tamanho/sabor/leite.
//   - "size"           — o produto tem `sizes[]` (Macarronada); pode
//                         carregar `addOnGroup`.
//   - "single_flavor"  — exige exatamente 1 sabor/recheio, preço do
//                         PRODUTO nunca muda por sabor (Pastel de Feira).
//   - "flavor_priced"  — exige exatamente 1 sabor, e o preço vem do
//                         PRÓPRIO SABOR (Calzone).
//   - "milk"           — produto está na seção Sucos; com/sem leite.
import type { Menu } from "@/lib/menu";
import { norm } from "@/lib/pedidoAppItens";
import {
  BEBIDAS,
  CALZONE_FLAVORS,
  HAMBURGUERES,
  LANCHES_FIXOS,
  MACARRONADAS,
  MACARRONADA_ADICIONAL_GRUPO,
  SUCOS,
  VITAMINAS,
} from "./officialMenu2026";
import { PASTEL_CARNE_SECA_ATUAL, PASTEL_FEIRA_ATUAL } from "./pasteisAtualizados";

export type SimpleCatalogStrategy = "fixed" | "size" | "single_flavor" | "flavor_priced" | "milk";

export interface SimpleCatalogFlavor {
  id: string;
  name: string;
  available: boolean;
  /** Só presente quando strategy === "flavor_priced" (Calzone) — preço
   *  PRÓPRIO deste sabor neste produto, independente de qualquer preço de
   *  pizza que o mesmo flavorId possa ter. */
  priceCents?: number;
  /** Rótulo específico deste produto, só quando difere do nome canônico do
   *  flavorId compartilhado. */
  displayLabel?: string;
  ingredients?: string;
}

export interface SimpleCatalogAddOnOption {
  id: string;
  label: string;
  priceCents: number;
  available: boolean;
}

export interface SimpleCatalogProduct {
  id: string;
  name: string;
  priceCents: number;
  available: boolean;
  strategy: SimpleCatalogStrategy;
  /** Presente só quando strategy === "size" (ex.: Macarronada). */
  sizes?: { id: string; code: string; priceCents: number }[];
  /** Presente só quando strategy === "single_flavor" ou "flavor_priced". */
  flavors?: SimpleCatalogFlavor[];
  /** Grupo de adicional opcional, no máximo 1 escolha. */
  addOnGroup?: { max: 1; options: SimpleCatalogAddOnOption[] };
  ingredients?: string;
}

export interface SimpleCatalog {
  lanches: SimpleCatalogProduct[];
  hamburgueres: SimpleCatalogProduct[];
  calzone: SimpleCatalogProduct[];
  /**
   * Nome interno histórico mantido para compatibilidade com a UI já
   * publicada. A seção agora representa "Pastéis" e contém exatamente:
   * Pastel de Carne Seca + Pastel de Feira.
   */
  pastelForno: SimpleCatalogProduct[];
  macarronadas: SimpleCatalogProduct[];
  sucos: SimpleCatalogProduct[];
  vitaminas: SimpleCatalogProduct[];
  bebidas: SimpleCatalogProduct[];
}

function estaEsgotado(nome: string, esgotadosNorm: string[]): boolean {
  return esgotadosNorm.includes(norm(nome));
}

/**
 * Constrói o catálogo oficial dos produtos simples configuráveis e aplica a
 * disponibilidade operacional atual. Não faz I/O.
 */
export function buildSimpleCatalog(_menu: Menu, esgotados: readonly string[] = [], idsEsgotados: readonly string[] = []): SimpleCatalog {
  const esgotadosNorm = esgotados.map(norm);
  const esgotadosIds = new Set(idsEsgotados);
  const disponivel = (nome: string, id: string) => !estaEsgotado(nome, esgotadosNorm) && !esgotadosIds.has(id);

  // Pastel de Carne Seca saiu de "Lanches" e agora vive junto do Pastel de
  // Feira na seção de pastéis. O ID foi PRESERVADO para não perder estado de
  // disponibilidade/novidade já existente.
  const lanches: SimpleCatalogProduct[] = LANCHES_FIXOS
    .filter((produto) => produto.id !== PASTEL_CARNE_SECA_ATUAL.id)
    .map((produto) => ({
      id: produto.id,
      name: produto.name,
      priceCents: produto.priceCents,
      available: disponivel(produto.name, produto.id),
      strategy: "fixed" as const,
      ingredients: produto.ingredients,
    }));

  const hamburgueres: SimpleCatalogProduct[] = HAMBURGUERES.map((produto) => ({
    id: produto.id,
    name: produto.name,
    priceCents: produto.priceCents,
    available: disponivel(produto.name, produto.id),
    strategy: "fixed",
    ingredients: produto.ingredients,
  }));

  const calzoneFlavors: SimpleCatalogFlavor[] = CALZONE_FLAVORS.map((sabor) => ({
    id: sabor.flavorId,
    name: sabor.displayLabel ?? sabor.name,
    available: disponivel(sabor.name, sabor.flavorId),
    priceCents: sabor.priceCents,
    displayLabel: sabor.displayLabel,
    ingredients: sabor.ingredients,
  }));
  const calzone: SimpleCatalogProduct[] = [
    {
      id: "product-calzone",
      name: "Calzone",
      // Preço-base de exibição ("a partir de") = menor preço entre os
      // sabores; a precificação real vem sempre do sabor escolhido.
      priceCents: Math.min(...calzoneFlavors.map((f) => f.priceCents ?? Infinity)),
      available: disponivel("Calzone", "product-calzone"),
      strategy: "flavor_priced",
      flavors: calzoneFlavors,
    },
  ];

  // Mantém a chave interna `pastelForno` para não quebrar a UI já publicada,
  // mas remove o produto genérico antigo "Pastel de Forno" de R$25.
  // A tela passa a receber exatamente os dois produtos aprovados agora.
  const pastelForno: SimpleCatalogProduct[] = [
    {
      id: PASTEL_CARNE_SECA_ATUAL.id,
      name: PASTEL_CARNE_SECA_ATUAL.name,
      priceCents: PASTEL_CARNE_SECA_ATUAL.priceCents,
      available: disponivel(PASTEL_CARNE_SECA_ATUAL.name, PASTEL_CARNE_SECA_ATUAL.id),
      strategy: "fixed",
      ingredients: PASTEL_CARNE_SECA_ATUAL.ingredients,
    },
    {
      id: PASTEL_FEIRA_ATUAL.id,
      name: PASTEL_FEIRA_ATUAL.name,
      priceCents: PASTEL_FEIRA_ATUAL.priceCents,
      available: disponivel(PASTEL_FEIRA_ATUAL.name, PASTEL_FEIRA_ATUAL.id),
      strategy: "single_flavor",
      flavors: PASTEL_FEIRA_ATUAL.recheios.map((recheio) => ({
        id: recheio.id,
        name: recheio.name,
        available: disponivel(recheio.name, recheio.id),
        ingredients: recheio.ingredients,
      })),
    },
  ];

  const macarronadaAddOnGroup = {
    max: 1 as const,
    options: MACARRONADA_ADICIONAL_GRUPO.options.map((opt) => ({
      id: opt.id,
      label: opt.label,
      priceCents: opt.priceCents,
      available: disponivel(opt.label, opt.id),
    })),
  };
  const macarronadas: SimpleCatalogProduct[] = MACARRONADAS.map((produto) => ({
    id: produto.id,
    name: produto.name,
    priceCents: Math.min(...Object.values(produto.pricesBySizeCode)),
    available: disponivel(produto.name, produto.id),
    strategy: "size",
    ingredients: produto.ingredients,
    sizes: (Object.entries(produto.pricesBySizeCode) as [string, number][]).map(([code, priceCents]) => ({
      id: `${produto.id}-size-${code.toLowerCase()}`,
      code,
      priceCents,
    })),
    addOnGroup: macarronadaAddOnGroup,
  }));

  const sucos: SimpleCatalogProduct[] = SUCOS.map((produto) => ({
    id: produto.id,
    name: produto.name,
    priceCents: produto.priceCents,
    available: disponivel(produto.name, produto.id),
    strategy: "milk",
  }));

  const vitaminas: SimpleCatalogProduct[] = VITAMINAS.map((produto) => ({
    id: produto.id,
    name: produto.name,
    priceCents: produto.priceCents,
    available: disponivel(produto.name, produto.id),
    strategy: "fixed",
  }));

  const bebidas: SimpleCatalogProduct[] = BEBIDAS.map((produto) => ({
    id: produto.id,
    name: produto.name,
    priceCents: produto.priceCents,
    available: disponivel(produto.name, produto.id),
    strategy: "fixed",
  }));

  return { lanches, hamburgueres, calzone, pastelForno, macarronadas, sucos, vitaminas, bebidas };
}

/** Todos os produtos de um catálogo simples, achatados — usado pelos
 *  resolvers para procurar por `productId` sem se importar com a seção. */
export function todosOsProdutos(catalog: SimpleCatalog): SimpleCatalogProduct[] {
  return [
    ...catalog.lanches,
    ...catalog.hamburgueres,
    ...catalog.calzone,
    ...catalog.pastelForno,
    ...catalog.macarronadas,
    ...catalog.sucos,
    ...catalog.vitaminas,
    ...catalog.bebidas,
  ];
}
