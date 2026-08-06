// Motor central de preços — Fase 1.
//
// Por segurança, esta camada ENVOLVE officialUnitPrice (@/lib/pedidoAppItens)
// em vez de reimplementar as regras de preço: recebe uma seleção estruturada
// (IDs), resolve os IDs contra o catálogo tipado, reconstrói o item no
// formato legado (name/detail) e delega o cálculo para o mesmo código que já
// é a fonte oficial de preço no checkout, pedido manual e Salão. Isso garante
// equivalência de preço por construção, não por coincidência — ver
// equivalence.test.ts.
//
// Não há interface, Redis ou requisição HTTP aqui: só transformação de dados
// em memória. Pura e testável sem mocks.
import { buildCatalog } from "@/lib/catalog/adapter";
import type { Menu } from "@/lib/menu";
import { norm, officialUnitPrice, type ItemApp, type MenuPedidoApp } from "@/lib/pedidoAppItens";
import type { PizzaSelection, PricingResult, Selection, SimpleSelection } from "./types";

function reaisParaCentavos(reais: number): number {
  return Math.round(reais * 100);
}

function resolverPizza(selection: PizzaSelection, menu: Menu): ItemApp | { error: string } {
  const catalog = buildCatalog(menu);

  const size = catalog.sizes.find((entry) => entry.id === selection.sizeId);
  if (!size) return { error: "Tamanho não encontrado" };

  const flavors = [...catalog.saltyFlavors, ...catalog.sweetFlavors];
  const chosenFlavors = selection.flavorIds.map((id) => flavors.find((entry) => entry.id === id));
  if (chosenFlavors.length === 0 || chosenFlavors.some((flavor) => !flavor)) {
    return { error: "Sabor não encontrado" };
  }

  let borderLabel: string | undefined;
  if (selection.borderId) {
    const border = catalog.borders.find((entry) => entry.id === selection.borderId);
    if (!border) return { error: "Borda não encontrada" };
    borderLabel = border.label;
  }

  const flavorsText = chosenFlavors.map((flavor) => flavor!.name).join(" / ");
  const name = `Pizza ${size.code}${chosenFlavors.length > 1 ? " (meio a meio)" : ""}`;
  const detail = borderLabel ? `${flavorsText} · borda ${borderLabel}` : flavorsText;

  return { kind: "pizza", name, detail, price: 0, qty: selection.quantity };
}

function resolverSimples(selection: SimpleSelection, menu: Menu): ItemApp | { error: string } {
  const catalog = buildCatalog(menu);
  const produtos = [...catalog.lanches, ...catalog.bebidas, ...catalog.sucos];
  const produto = produtos.find((entry) => entry.id === selection.productId);
  if (!produto) return { error: "Produto não encontrado" };

  const isSuco = catalog.sucos.some((entry) => entry.id === produto.id);
  if (isSuco) {
    const detail = selection.milk === "com" ? "com leite" : "sem leite";
    return { kind: "simple", name: produto.name, detail, price: 0, qty: selection.quantity };
  }

  if (norm(produto.name).includes("macarronada")) {
    const lanche = catalog.lanches.find((entry) => entry.id === produto.id);
    const size = lanche?.sizes?.find((entry) => entry.id === selection.sizeId);
    if (!size) return { error: "Tamanho não encontrado" };
    return { kind: "simple", name: produto.name, detail: `Tamanho ${size.code}`, price: 0, qty: selection.quantity };
  }

  if (norm(produto.name) === "calzone") {
    const flavors = [...catalog.saltyFlavors, ...catalog.sweetFlavors];
    const flavor = selection.flavorId ? flavors.find((entry) => entry.id === selection.flavorId) : undefined;
    if (!flavor) return { error: "Sabor não encontrado" };
    return { kind: "simple", name: produto.name, detail: `Sabor: ${flavor.name}`, price: 0, qty: selection.quantity };
  }

  return { kind: "simple", name: produto.name, price: 0, qty: selection.quantity };
}

/**
 * Calcula o preço oficial de uma seleção estruturada, em centavos.
 * `menu` deve vir de getMENUDinamico() (@/lib/menu.server) no servidor —
 * nunca de um valor enviado pelo cliente.
 */
export function calcularPreco(selection: Selection, menu: Menu): PricingResult {
  if (!Number.isInteger(selection.quantity) || selection.quantity < 1) {
    return { ok: false, error: "Quantidade inválida" };
  }

  const resolved = selection.kind === "pizza" ? resolverPizza(selection, menu) : resolverSimples(selection, menu);
  if ("error" in resolved) return { ok: false, error: resolved.error };

  const unitPriceReais = officialUnitPrice(resolved, menu as MenuPedidoApp);
  if (unitPriceReais === null) return { ok: false, error: "Combinação inválida" };

  const unitPriceCents = reaisParaCentavos(unitPriceReais);
  return { ok: true, unitPriceCents, totalCents: unitPriceCents * selection.quantity };
}
