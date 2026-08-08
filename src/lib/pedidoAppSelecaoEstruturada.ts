// Ponte entre um item de pedido com seleção estruturada por ID
// (item.pizzaSelection / item.simpleSelection) e o formato ItemApp
// (name/detail) usado pelo resto do sistema (impressão, WhatsApp, edição de
// pedido, fidelidade) — Fase 2 (pizza) e Fase 6 (demais produtos
// configuráveis: calzone, mini-pizza, macarronada, sucos).
//
// Usada por POST /api/pedido-app e POST /api/pedido-app/[id]/editar/salvar —
// a mesma rota que já recebe pedidos do site do cliente, do pedido manual e
// do Salão (a origem só muda a sessão/telefone, nunca a validação de item).
//
// Um item reconhecido aqui como "novo formato" (tem pizzaSelection ou
// simpleSelection) que falha a validação é definitivo: o chamador NUNCA deve
// tentar de novo pelo caminho legado (officialUnitPrice) com o name/detail
// que o cliente possa ter mandado junto — ver POST /api/pedido-app.
import type { PizzaCatalog } from "@/lib/catalog/pizzas";
import { precificarPizzaPorId } from "@/lib/pricing/pizzaEngine";
import type { SimpleCatalog } from "@/lib/catalog/simpleProducts";
import { type ItemApp } from "@/lib/pedidoAppItens";
import type { Menu } from "@/lib/menu";

function centavosParaReais(cents: number): number {
  return Math.round(cents) / 100;
}

// Mesma regra de sempre para suco com leite (antes hardcoded dentro de
// officialUnitPrice, em @/lib/pedidoAppItens: `suco.price + 1`) — 1 real,
// nunca um valor novo. officialUnitPrice continua com essa regra intacta
// para itens legados (sem simpleSelection); aqui ela é só espelhada em
// centavos para a precificação por ID/estratégia.
const ACRESCIMO_LEITE_CENTS = 100;

// Detecta a PRESENÇA da propriedade, nunca a truthiness do valor. Um
// payload adulterado com `pizzaSelection: null` (ou false, "", 0, {} etc.)
// ainda assim declarou a intenção de usar o formato novo — precisa ser
// validado e rejeitado como seleção estruturada inválida, nunca reinterpretado
// como item legado (que cairia em officialUnitPrice com o name/detail que o
// cliente possa ter mandado junto no mesmo objeto).
export function temSelecaoEstruturada(item: object): boolean {
  return Object.prototype.hasOwnProperty.call(item, "pizzaSelection");
}

export function resolverItemComSelecaoEstruturada(
  item: ItemApp,
  catalog: PizzaCatalog
): { ok: true; item: ItemApp } | { ok: false; error: string } {
  if (item.kind !== "pizza") return { ok: false, error: "Seleção estruturada só é aceita para pizza" };
  if (!Number.isInteger(item.qty) || item.qty < 1) return { ok: false, error: "Quantidade inválida" };

  const selecao = item.pizzaSelection;
  if (!selecao || typeof selecao.sizeId !== "string" || !Array.isArray(selecao.flavorIds)) {
    return { ok: false, error: "Seleção de pizza inválida" };
  }

  const resultado = precificarPizzaPorId(
    { sizeId: selecao.sizeId, flavorIds: selecao.flavorIds, borderId: selecao.borderId, quantity: item.qty },
    catalog
  );
  if (!resultado.ok) return { ok: false, error: resultado.error };

  const meioAMeio = resultado.resolved.flavorNames.length > 1;
  const name = `Pizza ${resultado.resolved.sizeCode}${meioAMeio ? " (meio a meio)" : ""}`;
  const detail = resultado.resolved.borderLabel
    ? `${resultado.resolved.flavorNames.join(" / ")} · borda ${resultado.resolved.borderLabel}`
    : resultado.resolved.flavorNames.join(" / ");

  return {
    ok: true,
    item: { kind: "pizza", name, detail, price: centavosParaReais(resultado.unitPriceCents), qty: item.qty },
  };
}

// Mesma regra de temSelecaoEstruturada (Fase 6): detecta a PRESENÇA da
// propriedade simpleSelection, nunca a truthiness do valor — um payload
// adulterado com `simpleSelection: null` (ou false, "", 0, {} etc.) ainda
// assim declarou a intenção de usar o formato novo.
export function temSelecaoSimplesEstruturada(item: object): boolean {
  return Object.prototype.hasOwnProperty.call(item, "simpleSelection");
}

/**
 * Resolve um item "simple" com seleção estruturada (Calzone, Mini-Pizza,
 * Macarronada, sucos com/sem leite) — Fase 6, hardening pós-auditoria (2ª
 * rodada).
 *
 * `catalog` (@/lib/catalog/simpleProducts, construído pelo chamador a partir
 * de getMENUDinamico() + a lista "esgotados" FRESCA do Redis) é a única
 * fonte de IDs e disponibilidade: um produto ou sabor esgotado é rejeitado
 * aqui, mesmo que o item tenha sido montado antes de esgotar (mesma garantia
 * que a pizza já tem via @/lib/pricing/pizzaEngine). Os sabores de Calzone e
 * Mini-Pizza vêm das listas oficiais já existentes no cardápio (expostas por
 * produto em `produto.flavors`, ver @/lib/catalog/simpleProducts), com o
 * MESMO flavorId oficial que a pizza usa para o mesmo sabor — nunca um ID
 * novo por produto.
 *
 * ZERO acoplamento por nome: a decisão de quais campos são exigidos/
 * rejeitados usa exclusivamente `produto.strategy` (calculada uma vez em
 * @/lib/catalog/simpleProducts a partir da configuração oficial do Menu —
 * hasFlavors/flavorsKey/sizes/categoria sucos). Nenhuma comparação com o
 * nome do produto (ex.: `.includes("macarronada")`, `=== "calzone"`,
 * normalização de "mini-pizza") — renomear o produto no cardápio nunca muda
 * sua estratégia nem o resultado da validação.
 *
 * ESTRITAMENTE TIPADA POR ESTRATÉGIA: cada tipo de produto aceita só os
 * campos que fazem sentido para ele — um campo que não se aplica ao produto
 * resolvido (ex.: `milk` numa Macarronada, `sizeId` num Calzone) é rejeitado
 * como seleção inválida, nunca ignorado em silêncio. Isso fecha a brecha de
 * um payload adulterado carregar campos de mais de uma estratégia ao mesmo
 * tempo torcendo para que algum "cole".
 *
 * PREÇO POR ESTRATÉGIA/CATÁLOGO (hardening pós-auditoria, 3ª rodada): o
 * preço nunca mais passa por `officialUnitPrice`/name-detail para itens com
 * `simpleSelection` — esse caminho legado compara o nome do produto
 * (`.includes("macarronada")`, `=== "calzone"`) para decidir COMO precificar,
 * e por isso quebra silenciosamente (preço 0, nunca `null`) quando o produto
 * é renomeado. Em vez disso, o preço é lido em CENTAVOS diretamente do
 * catálogo oficial já validado acima, pela própria `strategy`: "size" usa
 * exclusivamente o `priceCents` do `sizeId` validado (nunca o preço base do
 * produto); "fixed"/"single_flavor" usam o `priceCents` oficial do produto
 * (sabor nunca muda o preço); "milk" usa o `priceCents` do produto, com o
 * MESMO acréscimo de sempre para "com leite" (`ACRESCIMO_LEITE_CENTS`,
 * espelhando `officialUnitPrice` — nenhum valor novo). `officialUnitPrice`
 * continua intacto e é quem precifica itens legados (sem `simpleSelection`).
 */
export function resolverItemComSelecaoSimplesEstruturada(
  item: ItemApp,
  menu: Menu,
  catalog: SimpleCatalog
): { ok: true; item: ItemApp } | { ok: false; error: string } {
  if (item.kind !== "simple") return { ok: false, error: "Seleção estruturada só é aceita para produto simples" };
  if (!Number.isInteger(item.qty) || item.qty < 1) return { ok: false, error: "Quantidade inválida" };

  const selecao = item.simpleSelection;
  if (!selecao || typeof selecao.productId !== "string") {
    return { ok: false, error: "Seleção de produto inválida" };
  }
  if (selecao.sizeId !== undefined && typeof selecao.sizeId !== "string") {
    return { ok: false, error: "Seleção de produto inválida" };
  }
  if (selecao.flavorId !== undefined && typeof selecao.flavorId !== "string") {
    return { ok: false, error: "Seleção de produto inválida" };
  }
  if (selecao.milk !== undefined && selecao.milk !== "com" && selecao.milk !== "sem") {
    return { ok: false, error: "Seleção de produto inválida" };
  }

  const produto = [...catalog.lanches, ...catalog.bebidas, ...catalog.sucos].find((p) => p.id === selecao.productId);
  if (!produto) return { ok: false, error: "Produto não encontrado" };
  if (!produto.available) return { ok: false, error: `Produto indisponível: ${produto.name}` };

  let detail: string | undefined;
  // Preço base = priceCents oficial do produto no catálogo. "size" o
  // substitui pelo priceCents do tamanho validado; "milk" soma o acréscimo
  // de sempre para "com leite". Nunca lido de name/detail.
  let priceCents = produto.priceCents;

  switch (produto.strategy) {
    case "milk": {
      // Suco EXIGE milk e REJEITA sizeId/flavorId.
      if (selecao.sizeId !== undefined || selecao.flavorId !== undefined) {
        return { ok: false, error: "Seleção de produto inválida" };
      }
      if (selecao.milk === undefined) return { ok: false, error: "Seleção de produto inválida" };
      detail = selecao.milk === "com" ? "com leite" : "sem leite";
      if (selecao.milk === "com") priceCents += ACRESCIMO_LEITE_CENTS;
      break;
    }
    case "size": {
      // Produto com tamanho (ex.: Macarronada) EXIGE sizeId e REJEITA
      // milk/flavorId.
      if (selecao.milk !== undefined || selecao.flavorId !== undefined) {
        return { ok: false, error: "Seleção de produto inválida" };
      }
      const size = produto.sizes?.find((s) => s.id === selecao.sizeId);
      if (!size) return { ok: false, error: "Tamanho não encontrado" };
      detail = `Tamanho ${size.code}`;
      // Preço exclusivo do tamanho validado — nunca o priceCents base do
      // produto (que, para produtos vendidos só por tamanho, nem representa
      // um preço vendável de verdade).
      priceCents = size.priceCents;
      break;
    }
    case "single_flavor": {
      // Produto com sabor único (ex.: Calzone, Mini-Pizza) EXIGE flavorId e
      // REJEITA sizeId/milk.
      if (selecao.sizeId !== undefined || selecao.milk !== undefined) {
        return { ok: false, error: "Seleção de produto inválida" };
      }
      const flavor = selecao.flavorId ? produto.flavors?.find((f) => f.id === selecao.flavorId) : undefined;
      if (!flavor) return { ok: false, error: "Sabor não encontrado" };
      if (!flavor.available) return { ok: false, error: `Sabor indisponível: ${flavor.name}` };
      detail = `Sabor: ${flavor.name}`;
      // Preço flat do produto — o sabor nunca muda o preço (mesma regra de
      // sempre: Calzone/Mini-Pizza são vendidos por um preço único).
      break;
    }
    case "fixed": {
      // Produto plano (sem tamanho/sabor/leite): REJEITA qualquer escolha
      // extra — não há nada a configurar para ele.
      if (selecao.sizeId !== undefined || selecao.flavorId !== undefined || selecao.milk !== undefined) {
        return { ok: false, error: "Seleção de produto inválida" };
      }
      break;
    }
  }

  return {
    ok: true,
    item: {
      kind: "simple",
      name: produto.name,
      ...(detail ? { detail } : {}),
      price: centavosParaReais(priceCents),
      qty: item.qty,
    },
  };
}
