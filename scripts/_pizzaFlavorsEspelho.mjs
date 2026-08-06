// Espelho em JavaScript puro de src/lib/catalog/pizzaFlavors.ts — só os
// campos que a migração (scripts/migracao-pizza-flavors-fase2a.mjs)
// precisa (name/category/legacyAliases), para rodar como script Node
// standalone sem depender do bundler do Next.js. Mantenha em sincronia com
// a fonte oficial (mesmos nomes, mesmas categorias, mesmos aliases); o
// script de migração falha alto se a contagem total divergir.
export const TOTAL_ESPERADO = 45;

export const PIZZA_FLAVORS_ESPELHO = [
  // Tradicionais (18)
  { name: "À Moda da Casa", category: "traditional", legacyAliases: ["A Moda"] },
  { name: "Baiana", category: "traditional" },
  { name: "Frango com Cheddar", category: "traditional" },
  { name: "Milho", category: "traditional" },
  { name: "Peruana", category: "traditional" },
  { name: "Calabresa", category: "traditional" },
  { name: "Frango", category: "traditional" },
  { name: "Mussarela", category: "traditional" },
  { name: "Bacon", category: "traditional" },
  { name: "3 Queijos", category: "traditional", legacyAliases: ["Tres Queijos"] },
  { name: "Napolitana", category: "traditional" },
  { name: "Presunto", category: "traditional" },
  { name: "Xuxa", category: "traditional" },
  { name: "4 Queijos", category: "traditional", legacyAliases: ["Quatro Queijos"] },
  { name: "Siciliana", category: "traditional" },
  { name: "Caramussa", category: "traditional" },
  { name: "Toscana", category: "traditional" },
  { name: "Frango com Requeijão", category: "traditional" },
  // Especiais (20)
  { name: "Calabresa Suprema", category: "special" },
  { name: "Frango Catupiry Original", category: "special", legacyAliases: ["Frango Catupiry"] },
  { name: "6 Queijos", category: "special" },
  { name: "Nordestina", category: "special" },
  { name: "Mexicana", category: "special" },
  { name: "Portuguesa", category: "special" },
  { name: "Carne Seca Especial", category: "special" },
  { name: "Mazini", category: "special", legacyAliases: ["Mazzine"] },
  { name: "Carne Seca", category: "special" },
  { name: "Atum", category: "special" },
  { name: "5 Queijos", category: "special" },
  { name: "Caipira", category: "special" },
  { name: "Peper Cheddar", category: "special" },
  { name: "Delícia", category: "special" },
  { name: "Pizza do Chefe", category: "special" },
  { name: "Calabresa com Barbecue", category: "special" },
  { name: "Calabresa Especial", category: "special" },
  { name: "Calabresa Suprema 2", category: "special" },
  { name: "Carne de Sol da Casa", category: "special" },
  { name: "Carne de Sol Especial da Casa", category: "special" },
  // Doces (7)
  { name: "Chocolate", category: "sweet" },
  { name: "Choconinho", category: "sweet" },
  { name: "M&M", category: "sweet" },
  { name: "Dois Amores", category: "sweet", legacyAliases: ["2 amores (chocolate branco e chocolate preto)", "2 amores"] },
  { name: "Sensação", category: "sweet", legacyAliases: ["Sensacao"] },
  { name: "Romeu e Julieta", category: "sweet" },
  { name: "Cartola", category: "sweet" },
];
