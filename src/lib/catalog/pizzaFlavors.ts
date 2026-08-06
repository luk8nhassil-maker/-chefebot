// Catálogo oficial de sabores de pizza do Chefe da Pizza — Fase 2A.
//
// Fonte: cardápio oficial em PDF fornecido pelo cliente (nomes, categorias,
// ingredientes e preços por tamanho). Este módulo é dado estático, sem I/O,
// independente do Redis — os campos legados `saltyFlavors`/`sweetFlavors`
// (armazenados no cardápio dinâmico, ver @/lib/menu.server) continuam
// existindo só para compatibilidade com pedidos/carrinhos antigos; eles NÃO
// são mais a fonte de preço para pizzas.
//
// IDs são literais fixos, escolhidos uma vez — nunca derivados do nome
// visível — para que uma correção de texto (acento, grafia) não troque a
// identidade do produto nem invalide pedidos já persistidos.

export type PizzaFlavorCategory = "traditional" | "special" | "sweet";
export type PizzaSizeCode = "P" | "M" | "G" | "F";

export interface PizzaFlavorPrices {
  P: number;
  M: number;
  G: number;
  F: number;
}

export interface PizzaFlavor {
  id: string;
  name: string;
  category: PizzaFlavorCategory;
  description: string;
  pricesCents: PizzaFlavorPrices;
  available: boolean;
  /** Nomes antigos que devem continuar reconhecidos em pedidos/carrinhos já existentes. */
  legacyAliases?: string[];
}

function reais(valor: number): number {
  return Math.round(valor * 100);
}

function precos(F: number, G: number, M: number, P: number): PizzaFlavorPrices {
  return { F: reais(F), G: reais(G), M: reais(M), P: reais(P) };
}

// ---------------------------------------------------------------------------
// Pizzas Tradicionais
// ---------------------------------------------------------------------------
const TRADICIONAIS: PizzaFlavor[] = [
  { id: "flavor-a-moda-da-casa", name: "À Moda da Casa", category: "traditional", description: "Molho, Calabresa, Bacon, Requeijão Cremoso, Mussarela e Orégano.", pricesCents: precos(55, 50, 40, 35), available: true, legacyAliases: ["A Moda"] },
  { id: "flavor-baiana", name: "Baiana", category: "traditional", description: "Molho, Mussarela, Calabresa Processada, Azeite de Dendê, Orégano e Pimenta.", pricesCents: precos(55, 50, 40, 35), available: true },
  { id: "flavor-frango-com-cheddar", name: "Frango com Cheddar", category: "traditional", description: "Molho, Frango, Cheddar, Mussarela, Orégano e Bacon.", pricesCents: precos(55, 50, 40, 35), available: true },
  { id: "flavor-milho", name: "Milho", category: "traditional", description: "Molho, Mussarela, Milho e Orégano.", pricesCents: precos(50, 40, 35, 30), available: true },
  { id: "flavor-peruana", name: "Peruana", category: "traditional", description: "Molho, Mussarela, Peito de Peru e Orégano.", pricesCents: precos(55, 50, 40, 35), available: true },
  { id: "flavor-calabresa", name: "Calabresa", category: "traditional", description: "Molho, Mussarela, Linguiça Calabresa, Cebola e Orégano.", pricesCents: precos(50, 45, 38, 33), available: true },
  { id: "flavor-frango", name: "Frango", category: "traditional", description: "Molho de Tomate, Mussarela, Frango e Orégano.", pricesCents: precos(50, 45, 38, 33), available: true },
  { id: "flavor-mussarela", name: "Mussarela", category: "traditional", description: "Molho, Mussarela, Rodelas de Tomate e Orégano.", pricesCents: precos(50, 45, 38, 33), available: true },
  { id: "flavor-bacon", name: "Bacon", category: "traditional", description: "Molho, Bacon, Mussarela, Tomate e Orégano.", pricesCents: precos(50, 45, 38, 33), available: true },
  { id: "flavor-3-queijos", name: "3 Queijos", category: "traditional", description: "Molho, Mussarela, Parmesão, Requeijão Cremoso e Orégano.", pricesCents: precos(50, 45, 38, 33), available: true, legacyAliases: ["Tres Queijos"] },
  { id: "flavor-napolitana", name: "Napolitana", category: "traditional", description: "Molho, Mussarela, Rodelas de Tomate, Queijo Parmesão e Orégano.", pricesCents: precos(50, 45, 38, 33), available: true },
  { id: "flavor-presunto", name: "Presunto", category: "traditional", description: "Molho, Presunto, Mussarela e Orégano.", pricesCents: precos(47, 43, 38, 33), available: true },
  { id: "flavor-xuxa", name: "Xuxa", category: "traditional", description: "Molho, Mussarela, Milho, Bacon e Orégano.", pricesCents: precos(48, 43, 35, 30), available: true },
  { id: "flavor-4-queijos", name: "4 Queijos", category: "traditional", description: "Molho, Mussarela, Requeijão Cremoso, Gorgonzola e Parmesão.", pricesCents: precos(55, 50, 40, 35), available: true, legacyAliases: ["Quatro Queijos"] },
  { id: "flavor-siciliana", name: "Siciliana", category: "traditional", description: "Molho, Mussarela, Bacon, Champignon e Orégano.", pricesCents: precos(55, 50, 40, 35), available: true },
  { id: "flavor-caramussa", name: "Caramussa", category: "traditional", description: "Molho, Calabresa Coberta com Mussarela, Cebola e Orégano.", pricesCents: precos(55, 50, 40, 35), available: true },
  { id: "flavor-toscana", name: "Toscana", category: "traditional", description: "Molho, Calabresa Moída, Mussarela, Cebola e Orégano.", pricesCents: precos(55, 50, 40, 35), available: true },
  { id: "flavor-frango-com-requeijao", name: "Frango com Requeijão", category: "traditional", description: "Molho, Frango, Requeijão Cremoso, Mussarela e Orégano.", pricesCents: precos(55, 50, 40, 35), available: true },
];

// ---------------------------------------------------------------------------
// Pizzas Especiais (sem tamanho Mini)
// ---------------------------------------------------------------------------
const ESPECIAIS: PizzaFlavor[] = [
  { id: "flavor-calabresa-suprema", name: "Calabresa Suprema", category: "special", description: "Molho, Mussarela, Calabresa, Cream Cheese, Barbecue, Azeitona e Orégano.", pricesCents: precos(70, 62, 55, 42), available: true },
  { id: "flavor-frango-catupiry-original", name: "Frango Catupiry Original", category: "special", description: "Molho, Frango Catupiry Original, Mussarela, Azeitona e Orégano.", pricesCents: precos(70, 62, 55, 42), available: true, legacyAliases: ["Frango Catupiry"] },
  { id: "flavor-6-queijos", name: "6 Queijos", category: "special", description: "Molho, Requeijão Cremoso, Cheddar, Parmesão, Provolone, Gorgonzola, Mussarela e Orégano.", pricesCents: precos(65, 55, 50, 40), available: true },
  { id: "flavor-nordestina", name: "Nordestina", category: "special", description: "Molho de Tomate, Mussarela, Carne Seca, Requeijão Cremoso, Pimentão, Tomate, Cebola, Azeitona e Orégano.", pricesCents: precos(60, 55, 45, 38), available: true },
  { id: "flavor-mexicana", name: "Mexicana", category: "special", description: "Molho, Calabresa, Bacon, Requeijão Cremoso, Mussarela, Cebola, Pimenta e Orégano.", pricesCents: precos(60, 55, 43, 38), available: true },
  { id: "flavor-portuguesa", name: "Portuguesa", category: "special", description: "Molho, Presunto, Ervilha, Milho, Mussarela, Cebola, Azeitona e Orégano.", pricesCents: precos(60, 53, 43, 38), available: true },
  { id: "flavor-carne-seca-especial", name: "Carne Seca Especial", category: "special", description: "Molho, Mussarela, Carne Seca, Catupiry Original, Queijo Coalho, Geleia de Pimenta, Pimenta Biquinho e Orégano.", pricesCents: precos(70, 62, 55, 42), available: true },
  { id: "flavor-mazini", name: "Mazini", category: "special", description: "Molho, Frango, Bacon, Requeijão Cremoso, Banana, Mussarela e Orégano.", pricesCents: precos(60, 55, 45, 38), available: true, legacyAliases: ["Mazzine"] },
  { id: "flavor-carne-seca", name: "Carne Seca", category: "special", description: "Molho, Mussarela, Carne Seca, Requeijão Cremoso e Orégano.", pricesCents: precos(60, 55, 45, 40), available: true },
  { id: "flavor-atum", name: "Atum", category: "special", description: "Molho, Atum, Cebola, Mussarela e Orégano.", pricesCents: precos(60, 55, 45, 40), available: true },
  { id: "flavor-5-queijos", name: "5 Queijos", category: "special", description: "Molho, Requeijão Cremoso, Cheddar, Gorgonzola, Parmesão, Provolone e Orégano.", pricesCents: precos(60, 55, 45, 40), available: true },
  { id: "flavor-caipira", name: "Caipira", category: "special", description: "Molho, Frango, Bacon, Requeijão Cremoso, Milho, Mussarela e Orégano.", pricesCents: precos(60, 55, 45, 40), available: true },
  { id: "flavor-peper-cheddar", name: "Peper Cheddar", category: "special", description: "Molho, Mussarela, Peperone, Cheddar, Bacon, Azeitona e Orégano.", pricesCents: precos(60, 55, 45, 40), available: true },
  { id: "flavor-delicia", name: "Delícia", category: "special", description: "Molho, Frango, Milho, Palmito, Tomate, Requeijão Cremoso, Bacon e Orégano.", pricesCents: precos(65, 58, 50, 45), available: true },
  { id: "flavor-pizza-do-chefe", name: "Pizza do Chefe", category: "special", description: "Molho, Presunto, Mussarela, Bacon, Palmito, Milho, Tomate, Cebola, Ovos e Orégano.", pricesCents: precos(65, 55, 45, 40), available: true },
  { id: "flavor-calabresa-com-barbecue", name: "Calabresa com Barbecue", category: "special", description: "Molho, Mussarela, Calabresa, Bacon, Cebola, Barbecue e Orégano.", pricesCents: precos(60, 55, 45, 40), available: true },
  { id: "flavor-calabresa-especial", name: "Calabresa Especial", category: "special", description: "Molho, Mussarela, Calabresa, Pimenta Calabresa, Pimenta Biquinho, Queijo Coalho, Cebola e Orégano.", pricesCents: precos(60, 52, 43, 38), available: true },
  { id: "flavor-calabresa-suprema-2", name: "Calabresa Suprema 2", category: "special", description: "Molho de Tomate, Mussarela, Calabresa, Barbecue, Cream Cheese e Orégano.", pricesCents: precos(70, 62, 55, 42), available: true },
  { id: "flavor-carne-de-sol-da-casa", name: "Carne de Sol da Casa", category: "special", description: "Molho, Carne de Sol, Queijo Coalho, Pimenta Biquinho, Mussarela, Azeitona e Cebola.", pricesCents: precos(70, 62, 55, 42), available: true },
  { id: "flavor-carne-de-sol-especial-da-casa", name: "Carne de Sol Especial da Casa", category: "special", description: "Molho, Mussarela, Carne de Sol, Geleia de Pimenta, Cream Cheese, Pimenta Biquinho e Cebola.", pricesCents: precos(70, 62, 55, 42), available: true },
];

// ---------------------------------------------------------------------------
// Pizzas Doces
// ---------------------------------------------------------------------------
const DOCES: PizzaFlavor[] = [
  { id: "flavor-chocolate", name: "Chocolate", category: "sweet", description: "Chocolate Preto.", pricesCents: precos(55, 50, 40, 35), available: true },
  { id: "flavor-choconinho", name: "Choconinho", category: "sweet", description: "Creme de Leite, Creme de Ninho, Chocolate ao Leite.", pricesCents: precos(60, 55, 45, 40), available: true },
  { id: "flavor-m-e-m", name: "M&M", category: "sweet", description: "Creme de Leite, Chocolate ao Leite, Coberto com M&M.", pricesCents: precos(55, 50, 40, 35), available: true },
  { id: "flavor-dois-amores", name: "Dois Amores", category: "sweet", description: "Creme de Leite, Chocolate ao Leite e Chocolate Branco.", pricesCents: precos(60, 55, 45, 40), available: true, legacyAliases: ["2 amores (chocolate branco e chocolate preto)", "2 amores"] },
  { id: "flavor-sensacao", name: "Sensação", category: "sweet", description: "Chocolate, Granulado e Morango.", pricesCents: precos(55, 50, 40, 35), available: true, legacyAliases: ["Sensacao"] },
  { id: "flavor-romeu-e-julieta", name: "Romeu e Julieta", category: "sweet", description: "Creme de Leite, Queijo e Goiabada.", pricesCents: precos(55, 50, 40, 35), available: true },
  { id: "flavor-cartola", name: "Cartola", category: "sweet", description: "Banana Caramelizada, Canela, Leite Condensado e Creme de Leite.", pricesCents: precos(55, 50, 40, 35), available: true },
];

export const PIZZA_FLAVORS: PizzaFlavor[] = [...TRADICIONAIS, ...ESPECIAIS, ...DOCES];

export function getPizzaFlavorById(id: string): PizzaFlavor | undefined {
  return PIZZA_FLAVORS.find((flavor) => flavor.id === id);
}

/** Busca por nome oficial OU por alias legado — usada para reconhecer pedidos/carrinhos antigos. */
export function findPizzaFlavorByLegacyName(name: string): PizzaFlavor | undefined {
  const alvo = normalizar(name);
  return PIZZA_FLAVORS.find(
    (flavor) => normalizar(flavor.name) === alvo || (flavor.legacyAliases || []).some((alias) => normalizar(alias) === alvo)
  );
}

export function listPizzaFlavorsByCategory(category: PizzaFlavorCategory): PizzaFlavor[] {
  return PIZZA_FLAVORS.filter((flavor) => flavor.category === category);
}

function normalizar(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}
