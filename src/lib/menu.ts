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
    {
      group: "Centro / Tucum / Santo Antônio",
      areas: ["Centro", "Tucum", "Santo Antônio"],
      fee: 3,
    },
    {
      group: "DR / Santa Luzia / Mocambo / Jerumenha",
      areas: ["DR", "Santa Luzia", "Mocambo", "Jerumenha"],
      fee: 4,
    },
    {
      group: "Caxuxa / Ville",
      areas: ["Caxuxa", "Ville"],
      fee: 5,
    },
    {
      group: "Barro Preto / Matinha",
      areas: ["Barro Preto", "Matinha"],
      fee: 7,
    },
  ],

  payments: ["Pix", "Dinheiro", "Cartão"],
};

export function getBorderPrice(size: string): number {
  return size === "P" || size === "M" ? 8 : 10;
}

export function getDeliveryFee(neighborhood: string): number {
  for (const n of MENU.neighborhoods) {
    if (
      n.areas.some(
        (a) => a.toLowerCase() === neighborhood.toLowerCase()
      ) ||
      n.group.toLowerCase().includes(neighborhood.toLowerCase())
    ) {
      return n.fee;
    }
  }
  return 0;
}

export function getSizePrice(size: string): number {
  return MENU.sizes.find((s) => s.code === size)?.price ?? 0;
}
