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