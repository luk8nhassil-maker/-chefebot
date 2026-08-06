// Motor de preço nativo para pizza estruturada — Fase 2A.
//
// Pura, sem I/O. Recebe uma seleção por ID (tamanho, 1 ou 2 sabores, borda e
// adicionais opcionais) e o catálogo oficial (sabores/adicionais desta fase,
// bordas da Fase 1 — bordas não fazem parte do escopo desta etapa e
// continuam com a mesma fonte/preço de sempre). Nunca reconstrói o preço a
// partir de `name`/`detail`: esses campos são só apresentação.
//
// Regra de meio a meio (validada com o cliente): cobra o MAIOR preço entre
// os sabores escolhidos, no tamanho escolhido — nunca média, nunca soma de
// metades. A ordem dos sabores nunca importa. Borda e adicionais são somados
// só depois desse preço-base.
import { buildCatalog } from "@/lib/catalog/adapter";
import type { CatalogBorder } from "@/lib/catalog/types";
import { getPizzaAdditionalById, type PizzaAdditional } from "@/lib/catalog/pizzaAdditionals";
import { getPizzaFlavorById, type PizzaFlavor } from "@/lib/catalog/pizzaFlavors";
import { getPizzaSizeById, type PizzaSize } from "@/lib/catalog/pizzaSizes";
import type { Menu } from "@/lib/menu";
import { officialUnitPrice, type ItemApp, type MenuPedidoApp } from "@/lib/pedidoAppItens";
import type { PricingResult } from "./types";

export interface PizzaEstruturadaSelection {
  sizeId: string;
  flavorIds: string[];
  borderId?: string;
  additionalIds?: string[];
  quantity: number;
}

export interface PizzaEstruturadaResultado extends Extract<PricingResult, { ok: true }> {
  size: PizzaSize;
  flavors: PizzaFlavor[];
  /** Sabor cujo preço foi cobrado (o mais caro dos escolhidos). */
  precoDoFlavor: PizzaFlavor;
  border?: CatalogBorder;
  additionals: PizzaAdditional[];
}

export type PizzaPricingDeps = {
  borders?: CatalogBorder[];
};

function erro(mensagem: string): { ok: false; error: string } {
  return { ok: false, error: mensagem };
}

export function calcularPrecoPizzaEstruturada(
  selection: PizzaEstruturadaSelection,
  deps: PizzaPricingDeps = {}
): PizzaEstruturadaResultado | { ok: false; error: string } {
  if (!Number.isInteger(selection.quantity) || selection.quantity < 1) {
    return erro("Quantidade inválida");
  }

  const size = getPizzaSizeById(selection.sizeId);
  if (!size) return erro("Tamanho não encontrado");

  if (!Array.isArray(selection.flavorIds) || selection.flavorIds.length < 1 || selection.flavorIds.length > 2) {
    return erro("Escolha 1 ou 2 sabores");
  }

  if (new Set(selection.flavorIds).size !== selection.flavorIds.length) {
    return erro("Sabores repetidos");
  }

  const flavors: PizzaFlavor[] = [];
  for (const flavorId of selection.flavorIds) {
    const flavor = getPizzaFlavorById(flavorId);
    if (!flavor) return erro("Sabor não encontrado");
    if (!flavor.available) return erro("Sabor indisponível");
    flavors.push(flavor);
  }

  const precosNoTamanho = flavors.map((flavor) => ({ flavor, preco: flavor.pricesCents[size.code] }));
  if (precosNoTamanho.some((entry) => !Number.isFinite(entry.preco))) {
    return erro("Sabor sem preço para este tamanho");
  }

  const maisCaro = precosNoTamanho.reduce((atual, entry) => (entry.preco > atual.preco ? entry : atual));
  let unitPriceCents = maisCaro.preco;

  let border: CatalogBorder | undefined;
  if (selection.borderId) {
    border = (deps.borders || []).find((entry) => entry.id === selection.borderId);
    if (!border) return erro("Borda não encontrada");
    const isSmallOrMedium = size.code === "P" || size.code === "M";
    unitPriceCents += isSmallOrMedium ? border.priceSmallCents : border.priceLargeCents;
  }

  const additionals: PizzaAdditional[] = [];
  const additionalIds = selection.additionalIds || [];
  if (new Set(additionalIds).size !== additionalIds.length) {
    return erro("Adicional repetido");
  }
  for (const additionalId of additionalIds) {
    const additional = getPizzaAdditionalById(additionalId);
    if (!additional) return erro("Adicional não encontrado");
    if (!additional.available) return erro("Adicional indisponível");
    additionals.push(additional);
    unitPriceCents += additional.pricesCents[size.code];
  }

  return {
    ok: true,
    unitPriceCents,
    totalCents: unitPriceCents * selection.quantity,
    size,
    flavors,
    precoDoFlavor: maisCaro.flavor,
    border,
    additionals,
  };
}

/**
 * Ponte entre o checkout (fluxo legado, name/detail) e o novo motor de
 * pizza estruturada — usada em `/api/pedido-app`. Item sem
 * `pizzaEstruturada` continua validado exatamente como antes
 * (`officialUnitPrice`, sem nenhuma mudança de comportamento); item com
 * `pizzaEstruturada` é recalculado 100% pelo catálogo oficial desta fase,
 * nunca confiando no preço vindo do navegador. Retorna preço em REAIS
 * (mesma unidade usada pelo resto do sistema hoje — a conversão de/para
 * centavos fica só dentro deste módulo).
 */
export function unitPriceReaisPizza(item: ItemApp, menu: Menu): number | null {
  if (item.kind === "pizza" && item.pizzaEstruturada) {
    const catalog = buildCatalog(menu);
    const resultado = calcularPrecoPizzaEstruturada(
      { ...item.pizzaEstruturada, quantity: item.qty },
      { borders: catalog.borders }
    );
    return resultado.ok ? resultado.unitPriceCents / 100 : null;
  }
  return officialUnitPrice(item, menu as unknown as MenuPedidoApp);
}
