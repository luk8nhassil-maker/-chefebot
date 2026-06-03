export const MENU = {
  sizes: [
    { code: "P", label: "Pequena", price: 35 },
    { code: "M", label: "Media", price: 40 },
    { code: "G", label: "Grande", price: 50 },
    { code: "F", label: "Familia", price: 55 },
  ],
  saltyFlavors: [
    "Calabresa",
    "Frango Catupiry",
    "Portuguesa",
    "Carne Seca",
    "Quatro Queijos",
    "Tres Queijos",
    "Napolitana",
    "Baiana",
    "Peruana",
    "Bacon",
    "Mexicana",
    "Mussarela",
    "A Moda",
    "Mazzine",
  ] as string[],
  sweetFlavors: ["Sensacao", "Chocolate", "Cartola", "Romeu e Julieta"] as string[],
  calzoneFlavors: [
    "Carne Seca",
    "Bacon",
    "Portuguesa",
    "Tres Queijos",
    "Baiana",
    "Frango Catupiry",
    "Calabresa",
    "Mussarela",
  ] as string[],
  miniPizzaFlavors: [
    "Carne Seca",
    "Bacon",
    "Portuguesa",
    "Tres Queijos",
    "Baiana",
    "Frango Catupiry",
    "Calabresa",
    "Mussarela",
  ] as string[],
  lanches: [
    { name: "Calzone", price: 35, hasFlavors: true, flavorsKey: "calzoneFlavors" },
    { name: "Mini-Pizza", price: 17, hasFlavors: true, flavorsKey: "miniPizzaFlavors" },
    { name: "Macarronada de Carne", sizes: [{ code: "P", price: 28 }, { code: "M", price: 40 }, { code: "G", price: 50 }], hasFlavors: false, price: 0, flavorsKey: "" },
    { name: "X-Burguer", price: 15, hasFlavors: false, flavorsKey: "" },
    { name: "X-Bacon", price: 18, hasFlavors: false, flavorsKey: "" },
    { name: "X-Tudo", price: 22, hasFlavors: false, flavorsKey: "" },
    { name: "Porcao de Batatas", price: 12, hasFlavors: false, flavorsKey: "" },
  ] as { name: string; price: number; hasFlavors: boolean; flavorsKey: string; sizes?: { code: string; price: number }[] }[],
  bebidas: [
    { name: "Refrigerante 1L", price: 11 },
    { name: "Refrigerante 1,5L", price: 13 },
    { name: "Refrigerante 2L", price: 15 },
    { name: "Refrigerante Lata", price: 6 },
    { name: "Refrigerante Retornavel", price: 10 },
    { name: "Agua sem Gas", price: 3 },
    { name: "Agua com Gas", price: 4 },
    { name: "Cerveja Long Neck", price: 10 },
    { name: "Guarana 1L", price: 9 },
    { name: "Guarana 1,5L", price: 11 },
    { name: "Guarana 2L", price: 13 },
    { name: "Guarana Lata", price: 6 },
    { name: "Guarana Zero Lata", price: 5 },
    { name: "Guarana Zero 1L", price: 9 },
    { name: "Guarana Zero 2L", price: 13 },
    { name: "Pepsi Lata", price: 5 },
  ] as { name: string; price: number }[],
  sucos: [
    { name: "Caja", price: 7 },
    { name: "Caju", price: 7 },
    { name: "Acerola", price: 7 },
    { name: "Goiaba", price: 7 },
    { name: "Bacuri", price: 9 },
    { name: "Cupuacu", price: 8 },
    { name: "Laranja", price: 9 },
    { name: "Maracuja", price: 9 },
    { name: "Vitamina de Banana", price: 9 },
  ] as { name: string; price: number }[],
  borders: [
    { label: "Sem borda", price: 0 },
    { label: "Borda recheada", priceSmall: 8, priceLarge: 10 },
  ],
  neighborhoods: [
    { name: "Centro", fee: 3 },
    { name: "Tucum", fee: 3 },
    { name: "Santo Antonio", fee: 3 },
    { name: "DR", fee: 4 },
    { name: "Santa Luzia", fee: 4 },
    { name: "Mocambo", fee: 4 },
    { name: "Jerumenha", fee: 4 },
    { name: "Caxuxa", fee: 5 },
    { name: "Ville", fee: 5 },
    { name: "Barro Preto", fee: 7 },
    { name: "Matinha", fee: 7 },
  ],
  payments: ["Pix", "Dinheiro", "Cartao"],
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
