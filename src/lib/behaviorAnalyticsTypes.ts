export const CLIENT_BEHAVIOR_EVENTS = [
  "app_open",
  "whatsapp_link_verified",
  "screen_view",
  "search_used",
  "category_view",
  "product_view",
  "cart_state",
  "cart_add",
  "cart_remove",
  "cart_quantity_change",
  "checkout_start",
  "delivery_step_view",
  "payment_step_view",
  "ranking_open",
  "cofre_open",
  "fidelity_open",
  "order_submit_attempt",
  "action_result",
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
  deviceClass?: "mobile" | "tablet" | "desktop" | "unknown";
  viewportClass?: "compact" | "medium" | "wide" | "unknown";
  displayMode?: "standalone" | "browser" | "unknown";
  referrerKind?: "direct" | "internal" | "external" | "whatsapp_link" | "unknown";
  engagementMs?: number;
  action?: "checkout_submit";
  outcome?: "success" | "failure";
  failureCode?: "request_rejected" | "service_unavailable" | "network_error" | "unknown";
};
