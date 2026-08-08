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
import { resolverSimples } from "@/lib/pricing/engine";
import type { SimpleSelection } from "@/lib/pricing/types";
import { officialUnitPrice, type ItemApp, type MenuPedidoApp } from "@/lib/pedidoAppItens";
import type { Menu } from "@/lib/menu";

function centavosParaReais(cents: number): number {
  return Math.round(cents) / 100;
}

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
 * Macarronada, sucos com/sem leite) — Fase 6. Reaproveita
 * @/lib/pricing/engine (resolverSimples) para reconstruir o mesmo
 * name/detail que o cardápio público, o pedido manual e o Salão já produzem
 * hoje, e officialUnitPrice (a mesma fonte oficial de preço de sempre) para
 * o preço — nenhuma regra de preço nova, só o mesmo cálculo endereçado por
 * ID em vez de texto livre.
 */
export function resolverItemComSelecaoSimplesEstruturada(
  item: ItemApp,
  menu: Menu
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

  const selection: SimpleSelection = {
    kind: "simple",
    productId: selecao.productId,
    sizeId: selecao.sizeId,
    flavorId: selecao.flavorId,
    milk: selecao.milk,
    quantity: item.qty,
  };

  const resolvido = resolverSimples(selection, menu);
  if ("error" in resolvido) return { ok: false, error: resolvido.error };

  const unitPriceReais = officialUnitPrice(resolvido, menu as MenuPedidoApp);
  if (unitPriceReais === null) return { ok: false, error: "Combinação inválida" };

  return { ok: true, item: { ...resolvido, price: unitPriceReais } };
}
