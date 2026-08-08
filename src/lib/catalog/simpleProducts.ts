// Catálogo oficial dos demais produtos configuráveis (Calzone, Mini-Pizza,
// Macarronada, sucos, e produtos simples planos) — Fase 6, hardening pós-
// auditoria (3ª rodada).
//
// Diferente do catálogo genérico de ./adapter (que não tem disponibilidade),
// esta camada adiciona disponibilidade EM TEMPO REAL (mesma lista
// "esgotados" já usada pelo bot do WhatsApp, pelo cardápio do cliente e pela
// montagem manual — ver src/app/api/cardapio/route.ts) a cada produto
// simples (lanche/bebida/suco) — igual ao que @/lib/catalog/pizzas já faz
// para pizza (Fase 2).
//
// ZERO acoplamento por nome: cada produto recebe uma `strategy` explícita,
// derivada SOMENTE da configuração oficial já existente do cardápio (nunca
// do texto do nome do produto):
//   - "milk"          — produto está na seção sucos do Menu (categoria).
//   - "size"           — o produto tem `sizes` (ex.: Macarronada).
//   - "single_flavor" — o produto tem `hasFlavors: true` + `flavorsKey`
//                        (ex.: Calzone, Mini-Pizza — menu.lanches[i]).
//   - "fixed"          — nenhuma das anteriores (produto sem configuração).
// Nenhum `norm(nome) === "calzone"` nem `.includes("macarronada")` em
// nenhum lugar: renomear o produto no cardápio nunca muda sua estratégia.
//
// Sabores de um produto "single_flavor": um sabor como "Calabresa" é a
// MESMA entidade comercial em pizza, calzone e mini-pizza — reutiliza o
// MESMO flavorId oficial do catálogo canônico de sabores (o mesmo id que
// @/lib/catalog/pizzas expõe para pizza), nunca um ID novo por produto. O
// que muda por produto é só (a) a LISTA de sabores permitidos — apontada
// pela própria configuração oficial (`flavorsKey`, ex.: "calzoneFlavors"),
// nunca inventada aqui — e (b) a disponibilidade, recalculada de forma
// independente para cada lista (mesmo cálculo, mesma fonte "esgotados", mas
// nunca lida "por referência" do catálogo de outro produto).
import type { Menu } from "@/lib/menu";
import { norm } from "@/lib/pedidoAppItens";
import { buildCatalog } from "./adapter";

export type SimpleCatalogStrategy = "fixed" | "size" | "single_flavor" | "milk";

export interface SimpleCatalogFlavor {
  id: string;
  name: string;
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
  /** Presente só quando strategy === "single_flavor" (ex.: Calzone,
   *  Mini-Pizza) — sabores permitidos DESTE produto, com o mesmo flavorId
   *  oficial do catálogo canônico (nunca um ID novo por produto). */
  flavors?: SimpleCatalogFlavor[];
}

export interface SimpleCatalog {
  lanches: SimpleCatalogProduct[];
  bebidas: SimpleCatalogProduct[];
  sucos: SimpleCatalogProduct[];
}

function estaEsgotado(nome: string, esgotadosNorm: string[]): boolean {
  return esgotadosNorm.includes(norm(nome));
}

/** Lê `menu[flavorsKey]` dinamicamente — a própria configuração oficial do
 *  produto (menu.lanches[i].flavorsKey) já diz qual seção do Menu contém a
 *  lista de sabores permitidos (ex.: "calzoneFlavors"). Nunca um nome de
 *  produto decide isso. */
function nomesDaListaOficial(menu: Menu, flavorsKey: string | undefined): readonly string[] {
  if (!flavorsKey) return [];
  const valor = (menu as unknown as Record<string, unknown>)[flavorsKey];
  return Array.isArray(valor) ? (valor as string[]) : [];
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

  function flavoresPermitidos(flavorsKey: string | undefined): SimpleCatalogFlavor[] {
    const permitidosNorm = new Set(nomesDaListaOficial(menu, flavorsKey).map(norm));
    return flavoresCanonicos
      .filter((flavor) => permitidosNorm.has(norm(flavor.name)))
      .map((flavor) => ({ id: flavor.id, name: flavor.name, available: !estaEsgotado(flavor.name, esgotadosNorm) }));
  }

  const lanches: SimpleCatalogProduct[] = catalog.lanches.map((produto) => {
    const available = !estaEsgotado(produto.name, esgotadosNorm);
    const base = { id: produto.id, name: produto.name, priceCents: produto.priceCents, available };

    if (produto.sizes && produto.sizes.length > 0) {
      return { ...base, strategy: "size" as const, sizes: produto.sizes };
    }
    if (produto.hasFlavors && produto.flavorsKey) {
      return { ...base, strategy: "single_flavor" as const, flavors: flavoresPermitidos(produto.flavorsKey) };
    }
    return { ...base, strategy: "fixed" as const };
  });

  const bebidas: SimpleCatalogProduct[] = catalog.bebidas.map((produto) => ({
    id: produto.id,
    name: produto.name,
    priceCents: produto.priceCents,
    available: !estaEsgotado(produto.name, esgotadosNorm),
    strategy: "fixed",
  }));

  // Categoria "sucos" (a própria seção do Menu) é o sinal — nunca o nome de
  // um suco específico — de que a estratégia é "milk".
  const sucos: SimpleCatalogProduct[] = catalog.sucos.map((produto) => ({
    id: produto.id,
    name: produto.name,
    priceCents: produto.priceCents,
    available: !estaEsgotado(produto.name, esgotadosNorm),
    strategy: "milk",
  }));

  return { lanches, bebidas, sucos };
}
