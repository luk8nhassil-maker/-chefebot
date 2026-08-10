// Catálogo oficial dos demais produtos configuráveis — cardápio 2026.
//
// Fonte comercial: @/lib/catalog/officialMenu2026 (versionada, em código —
// ver o cabeçalho daquele arquivo). Esta camada só ADICIONA disponibilidade
// EM TEMPO REAL (mesma lista "esgotados" usada pelo bot do WhatsApp, pelo
// cardápio do cliente e pela montagem manual — ver
// src/app/api/cardapio/route.ts) a cada produto/sabor.
//
// ZERO acoplamento por nome: cada produto tem uma `strategy` explícita,
// atribuída aqui por CATEGORIA (nunca por nome de produto):
//   - "fixed"          — preço único, sem tamanho/sabor/leite (Hambúrguer,
//                         Lanches fixos, Vitaminas, Bebidas).
//   - "size"           — o produto tem `sizes[]` (Macarronada); pode
//                         carregar `addOnGroup` (grupo opcional, no máximo
//                         1 escolha — Bacon OU Ovo).
//   - "single_flavor"  — exige exatamente 1 sabor/recheio, preço do
//                         PRODUTO nunca muda por sabor (Pastel de Forno,
//                         Pastel de Feira).
//   - "flavor_priced"  — exige exatamente 1 sabor, e o preço vem do
//                         PRÓPRIO SABOR, não do produto (Calzone — cada
//                         sabor tem preço diferente no PDF).
//   - "milk"            — produto está na seção Sucos; com/sem leite.
//
// Sabores compartilhados: quando um sabor de Calzone/Pastel de Forno é a
// MESMA entidade comercial de um sabor de pizza (ingredientes idênticos no
// PDF), reaproveita o MESMO flavorId — nunca um ID novo (ver
// officialMenu2026 CALZONE_FLAVORS/PASTEL_FORNO_FLAVORS). Recheios de
// Pastel de Feira são uma entidade comercial PRÓPRIA (mesmo quando o nome
// coincide, ex. "Frango") — nunca reaproveitam flavorId de pizza.
//
// `menu: Menu` continua no parâmetro por estabilidade de assinatura, mas não
// é mais lido para preço/produto/sabor destas categorias — só a
// disponibilidade (`esgotados`) decide algo aqui agora.
import type { Menu } from "@/lib/menu";
import { norm } from "@/lib/pedidoAppItens";
import {
  BEBIDAS,
  CALZONE_FLAVORS,
  HAMBURGUERES,
  LANCHES_FIXOS,
  MACARRONADAS,
  MACARRONADA_ADICIONAL_GRUPO,
  PASTEL_FEIRA_PRICE_CENTS,
  PASTEL_FEIRA_RECHEIOS,
  PASTEL_FORNO_FLAVORS,
  SUCOS,
  VITAMINAS,
} from "./officialMenu2026";

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
   *  flavorId compartilhado (ex.: "Mazine" no Calzone vs "Mazini" na
   *  Pizza) — nunca duplica a identidade, só o texto exibido. */
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
  /** Grupo de adicional opcional, no máximo 1 escolha (ex.: Macarronada —
   *  Bacon OU Ovo, nunca os dois). Só presente quando o produto tem esse
   *  grupo. */
  addOnGroup?: { max: 1; options: SimpleCatalogAddOnOption[] };
  ingredients?: string;
}

export interface SimpleCatalog {
  lanches: SimpleCatalogProduct[];
  hamburgueres: SimpleCatalogProduct[];
  calzone: SimpleCatalogProduct[];
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
 * Constrói o catálogo oficial dos produtos simples configuráveis a partir do
 * cardápio 2026 (@/lib/catalog/officialMenu2026) e da lista de esgotados
 * atual (Redis, chave "esgotados"). Não faz I/O.
 */
export function buildSimpleCatalog(_menu: Menu, esgotados: readonly string[] = [], idsEsgotados: readonly string[] = []): SimpleCatalog {
  const esgotadosNorm = esgotados.map(norm);
  const esgotadosIds = new Set(idsEsgotados);
  const disponivel = (nome: string, id: string) => !estaEsgotado(nome, esgotadosNorm) && !esgotadosIds.has(id);

  const lanches: SimpleCatalogProduct[] = [
    ...LANCHES_FIXOS.map((produto) => ({
      id: produto.id,
      name: produto.name,
      priceCents: produto.priceCents,
      available: disponivel(produto.name, produto.id),
      strategy: "fixed" as const,
      ingredients: produto.ingredients,
    })),
    {
      id: "product-pastel-de-feira",
      name: "Pastel de Feira",
      priceCents: PASTEL_FEIRA_PRICE_CENTS,
      available: disponivel("Pastel de Feira", "product-pastel-de-feira"),
      strategy: "single_flavor",
      flavors: PASTEL_FEIRA_RECHEIOS.map((recheio) => ({
        id: recheio.id,
        name: recheio.name,
        available: disponivel(recheio.name, recheio.id),
        ingredients: recheio.ingredients,
      })),
    },
  ];

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
      // sabores; a precificação real vem sempre do sabor escolhido (ver
      // resolverItemComSelecaoSimplesEstruturada, strategy "flavor_priced").
      priceCents: Math.min(...calzoneFlavors.map((f) => f.priceCents ?? Infinity)),
      available: disponivel("Calzone", "product-calzone"),
      strategy: "flavor_priced",
      flavors: calzoneFlavors,
    },
  ];

  const pastelFornoFlavors: SimpleCatalogFlavor[] = PASTEL_FORNO_FLAVORS.map((sabor) => ({
    id: sabor.flavorId,
    name: sabor.displayLabel ?? sabor.name,
    available: disponivel(sabor.name, sabor.flavorId),
    displayLabel: sabor.displayLabel,
    ingredients: sabor.ingredients,
  }));
  const pastelForno: SimpleCatalogProduct[] = [
    {
      id: "product-pastel-de-forno",
      name: "Pastel de Forno",
      priceCents: PASTEL_FORNO_FLAVORS[0]?.priceCents ?? 0,
      available: disponivel("Pastel de Forno", "product-pastel-de-forno"),
      strategy: "single_flavor",
      flavors: pastelFornoFlavors,
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
