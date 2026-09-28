export const CLIENT_BEHAVIOR_EVENTS = [
  "app_open",
  "screen_view",
  "search_used",
  "category_view",
  "product_view",
  "cart_state",
  "checkout_start",
  "delivery_step_view",
  "payment_step_view",
  "ranking_open",
  "cofre_open",
  "fidelity_open",
  "order_submit_attempt",
  "page_exit",
] as const;

export type ClientBehaviorEventType = (typeof CLIENT_BEHAVIOR_EVENTS)[number];
export type ServerBehaviorEventType = "order_created";
export type BehaviorEventType = ClientBehaviorEventType | ServerBehaviorEventType;

export type BehaviorContext = {
  screen?: string;
  source?: "cardapio" | "cliente" | "ranking" | "cofre" | "checkout" | "tracking" | "orders" | "other";
  categoryId?: string;
  productId?: string;
  cartItems?: number;
  cartDistinctItems?: number;
  queryLength?: number;
  resultCount?: number;
  deliveryType?: "delivery" | "retirada" | "dine_in" | "unknown";
  paymentFamily?: "pix" | "dinheiro" | "cartao" | "misto" | "unknown";
  target?: "ranking" | "cofre" | "fidelity" | "cart" | "checkout" | "orders" | "tracking";
  pedidoId?: string;
};
