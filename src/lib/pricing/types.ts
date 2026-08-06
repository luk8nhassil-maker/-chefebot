// Seleção estruturada de um item — o servidor nunca reconstrói o pedido a
// partir de texto livre (name/detail) quando esta forma está disponível.
// Hoje ela convive com o formato legado (ItemApp, em @/lib/pedidoAppItens);
// ver @/lib/pricing/engine para a ponte entre os dois.
export type PizzaSelection = {
  kind: "pizza";
  sizeId: string;
  flavorIds: string[]; // 1 sabor, ou 2 para meio a meio
  borderId?: string;
  quantity: number;
};

export type SimpleSelection = {
  kind: "simple";
  productId: string; // id do lanche, bebida ou suco
  sizeId?: string; // presente só quando o produto tem tamanhos (ex: macarronada)
  flavorId?: string; // presente só quando o produto exige 1 sabor (ex: calzone)
  milk?: "com" | "sem"; // presente só para sucos
  quantity: number;
};

export type Selection = PizzaSelection | SimpleSelection;

export type PricingResult =
  | { ok: true; unitPriceCents: number; totalCents: number }
  | { ok: false; error: string };
