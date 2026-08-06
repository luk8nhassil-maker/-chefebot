// Adicionais oficiais de pizza do Chefe da Pizza — Fase 2A.
//
// Fonte: cardápio oficial em PDF. Preço varia por tamanho de pizza (P/M/G/F).
// Recurso novo (o sistema hoje não tinha adicionais, só borda) — o motor de
// preços sabe somá-los, mas nenhuma etapa de seleção foi adicionada à
// interface pública nesta fase (fora do escopo pedido: só a categorização de
// sabores Tradicional/Especial).

export interface PizzaAdditionalPrices {
  P: number;
  M: number;
  G: number;
  F: number;
}

export interface PizzaAdditional {
  id: string;
  label: string;
  pricesCents: PizzaAdditionalPrices;
  available: boolean;
}

function reais(valor: number): number {
  return Math.round(valor * 100);
}

function precos(P: number, M: number, G: number, F: number): PizzaAdditionalPrices {
  return { P: reais(P), M: reais(M), G: reais(G), F: reais(F) };
}

export const PIZZA_ADDITIONALS: PizzaAdditional[] = [
  { id: "additional-requeijao-cremoso", label: "Requeijão Cremoso", pricesCents: precos(5, 5, 5, 7), available: true },
  { id: "additional-cheddar-cremoso", label: "Cheddar Cremoso", pricesCents: precos(5, 5, 5, 7), available: true },
  { id: "additional-geleia-de-pimenta", label: "Geleia de Pimenta", pricesCents: precos(6, 7, 10, 15), available: true },
  { id: "additional-catupiry-original", label: "Catupiry (Original)", pricesCents: precos(8, 10, 12, 15), available: true },
  { id: "additional-cream-cheese", label: "Cream Cheese", pricesCents: precos(8, 10, 12, 15), available: true },
  { id: "additional-bacon", label: "Bacon", pricesCents: precos(6, 8, 10, 12), available: true },
  { id: "additional-calabresa", label: "Calabresa", pricesCents: precos(5, 7, 9, 12), available: true },
  { id: "additional-barbecue", label: "Barbecue", pricesCents: precos(8, 10, 12, 15), available: true },
];

export function getPizzaAdditionalById(id: string): PizzaAdditional | undefined {
  return PIZZA_ADDITIONALS.find((additional) => additional.id === id);
}
