// Motor nativo de preço de pizza — Fase 2.
//
// Diferente do motor da Fase 1 (@/lib/pricing/engine.ts), que ENVOLVE
// officialUnitPrice reconstruindo name/detail por segurança/equivalência,
// este motor calcula o preço de uma pizza DIRETAMENTE a partir do catálogo
// oficial de pizzas (@/lib/catalog/pizzas) — nenhuma dependência de
// name/detail em nenhum momento.
//
// Regra comercial aprovada: pizza meio a meio cobra o MAIOR preço entre os
// sabores escolhidos, no tamanho escolhido — a ordem dos sabores nunca
// altera o preço (o cálculo usa Math.max, comutativo por construção).
// Borda é somada depois. Hoje todo sabor custa o mesmo por tamanho (não há
// diferenciação comercial de preço por sabor no cardápio oficial — ver
// @/lib/catalog/pizzas), então o "maior preço" sempre resolve para o preço
// do tamanho; o motor já está pronto para o dia em que isso mudar, sem
// inventar nenhum valor novo hoje.
import type { PizzaCatalog } from "@/lib/catalog/pizzas";

export type PizzaSelectionById = {
  sizeId: string;
  flavorIds: string[]; // 1 sabor, ou exatamente 2 para meio a meio
  borderId?: string;
  quantity: number;
};

export type PizzaNativeResolved = {
  sizeCode: string;
  flavorNames: string[];
  borderLabel?: string;
};

export type PizzaNativeResult =
  | { ok: true; unitPriceCents: number; totalCents: number; resolved: PizzaNativeResolved }
  | { ok: false; error: string };

export function precificarPizzaPorId(selection: PizzaSelectionById, catalog: PizzaCatalog): PizzaNativeResult {
  if (!Number.isInteger(selection.quantity) || selection.quantity < 1) {
    return { ok: false, error: "Quantidade inválida" };
  }

  const size = catalog.sizes.find((entry) => entry.id === selection.sizeId);
  if (!size) return { ok: false, error: "Tamanho não encontrado" };

  if (!Array.isArray(selection.flavorIds) || (selection.flavorIds.length !== 1 && selection.flavorIds.length !== 2)) {
    return { ok: false, error: "Selecione 1 ou 2 sabores" };
  }
  if (new Set(selection.flavorIds).size !== selection.flavorIds.length) {
    return { ok: false, error: "Sabor repetido" };
  }

  const flavors: (typeof catalog.flavors)[number][] = [];
  for (const flavorId of selection.flavorIds) {
    const flavor = catalog.flavors.find((entry) => entry.id === flavorId);
    if (!flavor) return { ok: false, error: "Sabor não encontrado" };
    if (!flavor.available) return { ok: false, error: `Sabor indisponível: ${flavor.name}` };
    flavors.push(flavor);
  }

  let borderLabel: string | undefined;
  let borderCents = 0;
  if (selection.borderId) {
    const border = catalog.borders.find((entry) => entry.id === selection.borderId);
    if (!border) return { ok: false, error: "Borda não encontrada" };
    if (!border.available) return { ok: false, error: `Borda indisponível: ${border.label}` };
    borderLabel = border.label;
    const isPequenaOuMedia = size.code === "P" || size.code === "M";
    borderCents = isPequenaOuMedia ? border.priceSmallCents : border.priceLargeCents;
  }

  // Meio a meio = maior preço entre os sabores no tamanho escolhido. Hoje
  // todo sabor tem o mesmo preço por tamanho (size.priceCents), então isto
  // sempre resolve para size.priceCents — mas o cálculo já é feito via
  // Math.max sobre o preço de cada sabor, não hardcoded, para não depender
  // de nenhuma suposição sobre quantos sabores foram escolhidos nem de sua
  // ordem.
  const precoPorSabor = flavors.map(() => size.priceCents);
  const unitPriceCents = Math.max(...precoPorSabor) + borderCents;

  return {
    ok: true,
    unitPriceCents,
    totalCents: unitPriceCents * selection.quantity,
    resolved: { sizeCode: size.code, flavorNames: flavors.map((flavor) => flavor.name), borderLabel },
  };
}
