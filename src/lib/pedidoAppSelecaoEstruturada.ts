// Ponte entre um item de pedido com seleção estruturada por ID
// (item.pizzaSelection) e o formato ItemApp (name/detail) usado pelo resto
// do sistema (impressão, WhatsApp, edição de pedido, fidelidade) — Fase 2.
//
// Usada só por POST /api/pedido-app e POST /api/pedido-app/[id]/editar/salvar
// (o site do cliente) — nunca pelo bot do WhatsApp, Salão ou pedido manual,
// que continuam 100% em name/detail via officialUnitPrice
// (@/lib/pedidoAppItens), inalterado.
//
// Um item reconhecido aqui como "novo formato" (tem pizzaSelection) que
// falha a validação é definitivo: o chamador NUNCA deve tentar de novo pelo
// caminho legado (officialUnitPrice) com o name/detail que o cliente possa
// ter mandado junto — ver POST /api/pedido-app.
import type { PizzaCatalog } from "@/lib/catalog/pizzas";
import { precificarPizzaPorId } from "@/lib/pricing/pizzaEngine";
import type { ItemApp } from "@/lib/pedidoAppItens";

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
