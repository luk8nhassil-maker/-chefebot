// Tamanhos de pizza inteira suportados pelo fluxo estruturado (Fase 2A).
//
// Mesmo formato de ID que @/lib/catalog/adapter já usa para tamanhos
// (`size-${code em minúsculo}`), mas como catálogo próprio — Pizzas
// Especiais não têm tamanho Mini, então esta lista intencionalmente só tem
// P/M/G/F. A pizza inteira nunca ofereceu Mini como tamanho no site (Mini é
// um produto separado, "Mini-Pizza", com sabor único); esta fase não muda
// isso.
import type { PizzaSizeCode } from "./pizzaFlavors";

export interface PizzaSize {
  id: string;
  code: PizzaSizeCode;
  label: string;
}

export const PIZZA_SIZES: PizzaSize[] = [
  { id: "size-p", code: "P", label: "Pequena" },
  { id: "size-m", code: "M", label: "Média" },
  { id: "size-g", code: "G", label: "Grande" },
  { id: "size-f", code: "F", label: "Família" },
];

export function getPizzaSizeById(id: string): PizzaSize | undefined {
  return PIZZA_SIZES.find((size) => size.id === id);
}
