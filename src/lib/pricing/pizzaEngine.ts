// Motor nativo de preço de pizza — cardápio 2026.
//
// Calcula o preço de uma pizza DIRETAMENTE a partir do catálogo oficial de
// pizzas (@/lib/catalog/pizzas) — nenhuma dependência de name/detail em
// nenhum momento; o cliente nunca é autoridade de preço.
//
// Regras comerciais aprovadas:
// - Cada sabor tem preço PRÓPRIO por tamanho (não existe mais uma tabela
//   única por tamanho) — ver @/lib/catalog/officialMenu2026.
// - Meio a meio cobra o MAIOR preço entre os sabores escolhidos, no tamanho
//   escolhido — a ordem dos sabores nunca altera o preço (Math.max,
//   comutativo por construção).
// - MINI é um TAMANHO de pizza Tradicional/Doce (nunca um produto à parte).
//   Pizzas Especiais NÃO têm tamanho MINI — a ausência da chave MINI em
//   `flavor.pricesBySizeCode` é o que rejeita a combinação (nenhuma lista
//   paralela de "sabores permitidos por tamanho").
// - MINI nunca aceita borda nem adicional (o PDF não define preço de borda
//   nem de adicional para MINI) — rejeitado explicitamente, nunca com
//   preço 0 nem herdado de outro tamanho.
// - Borda e adicionais são somados DEPOIS do preço-base (maior sabor);
//   quantidade multiplica o total no final, nunca o preço unitário.
import type { PizzaCatalog } from "@/lib/catalog/pizzas";

export type PizzaSelectionById = {
  sizeId: string;
  flavorIds: string[]; // 1 sabor, ou exatamente 2 para meio a meio
  borderId?: string;
  addOnIds?: string[];
  quantity: number;
};

export type PizzaNativeResolved = {
  sizeCode: string;
  flavorNames: string[];
  borderLabel?: string;
  addOnLabels: string[];
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
  const precosPorSabor: number[] = [];
  for (const flavorId of selection.flavorIds) {
    const flavor = catalog.flavors.find((entry) => entry.id === flavorId);
    if (!flavor) return { ok: false, error: "Sabor não encontrado" };
    if (!flavor.available) return { ok: false, error: `Sabor indisponível: ${flavor.name}` };
    // Ausência da chave = este sabor não tem preço para este tamanho — hoje
    // isso só acontece com Especial + MINI (Especiais nunca têm tamanho
    // MINI, decisão comercial aprovada). Nunca inventa um preço.
    const precoCents = flavor.pricesBySizeCode[size.code];
    if (precoCents === undefined) {
      return { ok: false, error: `Sabor ${flavor.name} não está disponível no tamanho ${size.label}` };
    }
    flavors.push(flavor);
    precosPorSabor.push(precoCents);
  }

  const isMini = size.code === "MINI";

  let borderLabel: string | undefined;
  let borderCents = 0;
  if (selection.borderId) {
    if (isMini) return { ok: false, error: "Mini não aceita borda" };
    const border = catalog.borders.find((entry) => entry.id === selection.borderId);
    if (!border) return { ok: false, error: "Borda não encontrada" };
    if (!border.available) return { ok: false, error: `Borda indisponível: ${border.label}` };
    borderLabel = border.label;
    borderCents = border.pricesBySizeCode[size.code as "P" | "M" | "G" | "F"];
  }

  const addOnLabels: string[] = [];
  let addOnCents = 0;
  const addOnIds = selection.addOnIds ?? [];
  if (addOnIds.length > 0) {
    if (isMini) return { ok: false, error: "Mini não aceita adicional" };
    if (new Set(addOnIds).size !== addOnIds.length) {
      return { ok: false, error: "Adicional duplicado" };
    }
    for (const addOnId of addOnIds) {
      const addOn = catalog.addOns.find((entry) => entry.id === addOnId);
      if (!addOn) return { ok: false, error: "Adicional não encontrado" };
      if (!addOn.available) return { ok: false, error: `Adicional indisponível: ${addOn.label}` };
      addOnLabels.push(addOn.label);
      addOnCents += addOn.pricesBySizeCode[size.code as "P" | "M" | "G" | "F"];
    }
  }

  // Meio a meio = maior preço entre os sabores no tamanho escolhido —
  // Math.max sobre o preço de cada sabor (nunca média, nunca metade de
  // cada, nunca depende da ordem em que os sabores foram enviados).
  const unitPriceCents = Math.max(...precosPorSabor) + borderCents + addOnCents;

  return {
    ok: true,
    unitPriceCents,
    totalCents: unitPriceCents * selection.quantity,
    resolved: { sizeCode: size.code, flavorNames: flavors.map((flavor) => flavor.name), borderLabel, addOnLabels },
  };
}
