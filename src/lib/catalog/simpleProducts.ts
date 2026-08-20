// Catálogo oficial dos demais produtos configuráveis — cardápio 2026.
//
// Fonte comercial principal: @/lib/catalog/officialMenu2026. O bloco de
// pastéis recebeu uma atualização comercial isolada em
// @/lib/catalog/pasteisAtualizados para ADICIONAR novos produtos sem remover
// o Pastel de Forno já existente. O Salão possui uma extensão comercial
// própria de sucos (copo/jarra), aprovada em 2026-08-20, que substitui SOMENTE
// a seção de sucos quando o catálogo é construído com escopo "salao".
//
// Esta camada só ADICIONA disponibilidade EM TEMPO REAL (mesma lista
// "esgotados" usada pelo bot do WhatsApp, pelo cardápio do cliente e pela
// montagem manual — ver src/app/api/cardapio/route.ts) a cada produto/sabor.
//
// ZERO acoplamento por nome: cada produto tem uma `strategy` explícita,
// atribuída aqui por CATEGORIA (nunca por nome de produto):
//   - "fixed"          — preço único, sem tamanho/sabor/leite.
//   - "size"           — o produto tem `sizes[]` (Macarronada e sucos do
//                         Salão por Copo/Jarra); pode carregar `addOnGroup`.
//   - "single_flavor"  — exige exatamente 1 sabor/recheio, preço do
//                         PRODUTO nunca muda por sabor (Pastel de Forno e
//                         Pastel de Feira).
//   - "flavor_priced"  — exige exatamente 1 sabor, e o preço vem do
//                         PRÓPRIO SABOR (Calzone).
//   - "milk"           — produto está na seção Sucos pública; com/sem leite.
import type { Menu } from "@/lib/menu";
import { norm } from "@/lib/pedidoAppItens";
import {
  BEBIDAS,
  CALZONE_FLAVORS,
  HAMBURGUERES,
  LANCHES_FIXOS,
  MACARRONADAS,
  MACARRONADA_ADICIONAL_GRUPO,
  PASTEL_FORNO_FLAVORS,
  SUCOS,
  VITAMINAS,
} from "./officialMenu2026";
import { PASTEL_CARNE_SECA_ATUAL, PASTEL_FEIRA_ATUAL } from "./pasteisAtualizados";

export type SimpleCatalogStrategy = "fixed" | "size" | "single_flavor" | "flavor_priced" | "milk";
export type SimpleCatalogScope = "public" | "salao";

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
  /** Presente só quando strategy === "size" (ex.: Macarronada/Suco Salão). */
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
  /** Nome interno histórico mantido para compatibilidade com a UI. */
  pastelForno: SimpleCatalogProduct[];
  macarronadas: SimpleCatalogProduct[];
  sucos: SimpleCatalogProduct[];
  vitaminas: SimpleCatalogProduct[];
  bebidas: SimpleCatalogProduct[];
}

type SucoSalao = {
  id: string;
  name: string;
  copoCents: number;
  jarraCents: number;
};

// Fonte comercial: decisão explícita do usuário em 2026-08-20.
// P = Copo; G = Jarra. Estes produtos NUNCA entram no escopo público.
const SUCOS_SALAO: readonly SucoSalao[] = [
  { id: "salao-suco-maracuja", name: "Maracujá", copoCents: 2000, jarraCents: 4000 },
  { id: "salao-suco-acerola", name: "Acerola", copoCents: 1400, jarraCents: 2800 },
  { id: "salao-suco-goiaba", name: "Goiaba", copoCents: 1400, jarraCents: 2800 },
  { id: "salao-suco-caju", name: "Caju", copoCents: 1400, jarraCents: 2800 },
  { id: "salao-suco-caja", name: "Cajá", copoCents: 1400, jarraCents: 3200 },
  { id: "salao-suco-bacuri", name: "Bacuri", copoCents: 2000, jarraCents: 4000 },
  { id: "salao-suco-cupuacu", name: "Cupuaçu", copoCents: 1900, jarraCents: 3800 },
  { id: "salao-suco-graviola", name: "Graviola", copoCents: 2000, jarraCents: 4000 },
  { id: "salao-suco-abacaxi", name: "Abacaxi", copoCents: 1400, jarraCents: 2800 },
  { id: "salao-suco-abacate-hortela", name: "Abacate + hortelã", copoCents: 2000, jarraCents: 4000 },
  { id: "salao-suco-laranja", name: "Laranja", copoCents: 2000, jarraCents: 4000 },
];

function estaEsgotado(nome: string, esgotadosNorm: string[]): boolean {
  return esgotadosNorm.includes(norm(nome));
}

/**
 * Constrói o catálogo oficial dos produtos simples configuráveis e aplica a
 * disponibilidade operacional atual. Não faz I/O.
 *
 * `scope="public"` é o comportamento histórico e continua sendo o default.
 * `scope="salao"` troca SOMENTE a seção `sucos` pelos produtos exclusivos do
 * atendimento de mesa. Isso evita duplicar os mesmos sabores na UI e impede
 * que preços de Copo/Jarra vazem para o link do cliente.
 */
export function buildSimpleCatalog(
  _menu: Menu,
  esgotados: readonly string[] = [],
  idsEsgotados: readonly string[] = [],
  scope: SimpleCatalogScope = "public"
): SimpleCatalog {
  const esgotadosNorm = esgotados.map(norm);
  const esgotadosIds = new Set(idsEsgotados);
  const disponivel = (nome: string, id: string) => !estaEsgotado(nome, esgotadosNorm) && !esgotadosIds.has(id);

  // Pastel de Carne Seca vive junto dos demais pastéis na tela, mas preserva
  // o ID histórico para não perder estado de disponibilidade/novidade.
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

  const pastelFornoFlavors: SimpleCatalogFlavor[] = PASTEL_FORNO_FLAVORS.map((sabor) => ({
    id: sabor.flavorId,
    name: sabor.displayLabel ?? sabor.name,
    available: disponivel(sabor.name, sabor.flavorId),
    displayLabel: sabor.displayLabel,
    ingredients: sabor.ingredients,
  }));

  // Mantém os três produtos juntos: o Pastel de Forno original de R$25 e os
  // dois produtos adicionados agora. Nada do cardápio anterior é removido.
  const pastelForno: SimpleCatalogProduct[] = [
    {
      id: "product-pastel-de-forno",
      name: "Pastel de Forno",
      priceCents: PASTEL_FORNO_FLAVORS[0]?.priceCents ?? 0,
      available: disponivel("Pastel de Forno", "product-pastel-de-forno"),
      strategy: "single_flavor",
      flavors: pastelFornoFlavors,
    },
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

  const sucosPublicos: SimpleCatalogProduct[] = SUCOS.map((produto) => ({
    id: produto.id,
    name: produto.name,
    priceCents: produto.priceCents,
    available: disponivel(produto.name, produto.id),
    strategy: "milk",
  }));

  const sucosSalao: SimpleCatalogProduct[] = SUCOS_SALAO.map((produto) => ({
    id: produto.id,
    name: produto.name,
    // Valor de referência para listagem; a cobrança real vem SEMPRE do sizeId.
    priceCents: Math.min(produto.copoCents, produto.jarraCents),
    available: disponivel(produto.name, produto.id),
    strategy: "size",
    sizes: [
      { id: `${produto.id}-copo`, code: "Copo", priceCents: produto.copoCents },
      { id: `${produto.id}-jarra`, code: "Jarra", priceCents: produto.jarraCents },
    ],
  }));

  const sucos = scope === "salao" ? sucosSalao : sucosPublicos;

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
