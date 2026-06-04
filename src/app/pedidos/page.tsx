export const MENU = {
  sizes: [
    { code: "P", label: "Pequena", price: 35 },
    { code: "M", label: "Média", price: 40 },
    { code: "G", label: "Grande", price: 50 },
    { code: "F", label: "Família", price: 55 },
  ],
  saltyFlavors: [
    "Calabresa",
    "Frango Catupiry",
    "Portuguesa",
    "Carne Seca",
    "Quatro Queijos",
    "Três Queijos",
    "Napolitana",
    "Baiana",
    "Peruana",
    "Bacon",
    "Mexicana",
    "Mussarela",
    "À Moda",
    "Mazzine",
  ],
  sweetFlavors: ["Sensação", "Chocolate", "Cartola", "Romeu e Julieta"],
  calzoneFlavors: [
    "Carne Seca",
    "Bacon",
    "Portuguesa",
    "Três Queijos",
    "Baiana",
    "Frango Catupiry",
    "Calabresa",
    "Mussarela",
  ],
  miniPizzaFlavors: [
    "Carne Seca",
    "Bacon",
    "Portuguesa",
    "Três Queijos",
    "Baiana",
    "Frango Catupiry",
    "Calabresa",
    "Mussarela",
  ],
  lanches: [
    { name: "Calzone", price: 35, hasFlavors: true, flavorsKey: "calzoneFlavors" },
    { name: "Mini-Pizza", price: 17, hasFlavors: true, flavorsKey: "miniPizzaFlavors" },
    { name: "Macarronada de Carne", sizes: [{ code: "P", price: 28 }, { code: "M", price: 40 }, { code: "G", price: 50 }], hasFlavors: false },
    { name: "X-Burguer", price: 15, hasFlavors: false },
    { name: "X-Bacon", price: 18, hasFlavors: false },
    { name: "X-Tudo", price: 22, hasFlavors: false },
    { name: "Porção de Batatas", price: 12, hasFlavors: false },
  ],
  bebidas: [
    { name: "Refrigerante 1L", price: 11 },
    { name: "Refrigerante 1,5L", price: 13 },
    { name: "Refrigerante 2L", price: 15 },
    { name: "Refrigerante Lata", price: 6 },
    { name: "Refrigerante Retornável", price: 10 },
    { name: "Água sem Gás", price: 3 },
    { name: "Água com Gás", price: 4 },
    { name: "Cerveja Long Neck", price: 10 },
    { name: "Guaraná 1L", price: 9 },
    { name: "Guaraná 1,5L", price: 11 },
    { name: "Guaraná 2L", price: 13 },
    { name: "Guaraná Lata", price: 6 },
    { name: "Guaraná Zero Lata", price: 5 },
    { name: "Guaraná Zero 1L", price: 9 },
    { name: "Guaraná Zero 2L", price: 13 },
    { name: "Pepsi Lata", price: 5 },
  ],
  sucos: [
    { name: "Cajá", price: 7 },
    { name: "Caju", price: 7 },
    { name: "Acerola", price: 7 },
    { name: "Goiaba", price: 7 },
    { name: "Bacuri", price: 9 },
    { name: "Cupuaçu", price: 8 },
    { name: "Laranja", price: 9 },
    { name: "Maracujá", price: 9 },
    { name: "Vitamina de Banana", price: 9 },
  ],
  borders: [
    { label: "Sem borda", price: 0 },
    { label: "Borda recheada", priceSmall: 8, priceLarge: 10 },
  ],
  neighborhoods: [
    { name: "Centro", fee: 3 },
    { name: "Tucum", fee: 3 },
    { name: "Santo Antônio", fee: 3 },
    { name: "DR", fee: 4 },
    { name: "Santa Luzia", fee: 4 },
    { name: "Mocambo", fee: 4 },
    { name: "Jerumenha", fee: 4 },
    { name: "Caxuxa", fee: 5 },
    { name: "Ville", fee: 5 },
    { name: "Barro Preto", fee: 7 },
    { name: "Matinha", fee: 7 },
  ],
  payments: ["Pix", "Dinheiro", "Cartão"],
};

export function getBorderPrice(size: string): number {
  return size === "P" || size === "M" ? 8 : 10;
}

export function getDeliveryFee(neighborhood: string): number {
  const found = MENU.neighborhoods.find(
    (n) => n.name.toLowerCase() === neighborhood.toLowerCase()
  );
  return found?.fee ?? 0;
}

export function getSizePrice(size: string): number {
  return MENU.sizes.find((s) => s.code === size)?.price ?? 0;
}

export function getMacarronadaPrice(size: string): number {
  const map: Record<string, number> = { P: 28, M: 40, G: 50 };
  return map[size] ?? 0;
}
