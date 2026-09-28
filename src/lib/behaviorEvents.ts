export const PUBLIC_BEHAVIOR_EVENTS = [
  "app_open",
  "app_background",
  "app_resume",
  "page_view",
  "funnel_step",
  "search_used",
  "product_open",
  "cart_add",
  "cart_remove",
  "checkout_exit_observed",
  "ranking_open",
  "cofre_open",
] as const;

export const SERVER_BEHAVIOR_EVENTS = [
  "order_created",
] as const;

export type PublicBehaviorEventType = (typeof PUBLIC_BEHAVIOR_EVENTS)[number];
export type ServerBehaviorEventType = (typeof SERVER_BEHAVIOR_EVENTS)[number];
export type BehaviorEventType = PublicBehaviorEventType | ServerBehaviorEventType;

export const BEHAVIOR_PAGES = [
  "home",
  "cardapio",
  "cliente",
  "cliente_pedidos",
  "rastrear",
  "pedido_editar",
  "promocoes",
  "ranking",
  "cofre",
  "outro_publico",
] as const;
export type BehaviorPage = (typeof BEHAVIOR_PAGES)[number];

export const BEHAVIOR_FUNNEL_STEPS = [
  "inicio",
  "lista",
  "montagem",
  "sacola",
  "entrega",
  "pagamento",
  "concluido",
  "promocao",
  "outro",
] as const;
export type BehaviorFunnelStep = (typeof BEHAVIOR_FUNNEL_STEPS)[number];

export type BehaviorDeviceClass = "mobile" | "tablet" | "desktop";
export type BehaviorDisplayMode = "browser" | "standalone";
export type BehaviorSource = "direct" | "internal" | "whatsapp" | "search" | "social" | "other";
export type BehaviorItemKind = "pizza" | "simple" | "promo" | "reward" | "unknown";
export type BehaviorDeliveryType = "delivery" | "retirada" | "dine_in";
export type BehaviorPaymentMethod = "pix" | "dinheiro" | "cartao" | "misto" | "outro";

export type BehaviorEventData = {
  page?: BehaviorPage;
  source?: BehaviorSource;
  deviceClass?: BehaviorDeviceClass;
  displayMode?: BehaviorDisplayMode;
  step?: BehaviorFunnelStep;
  category?: string;
  itemRef?: string;
  itemKind?: BehaviorItemKind;
  cartItems?: number;
  cartDistinctItems?: number;
  queryLength?: number;
  resultCount?: number;
  hiddenDurationSec?: number;
  deliveryType?: BehaviorDeliveryType;
  paymentMethod?: BehaviorPaymentMethod;
  orderRef?: string;
  orderTotalCents?: number;
  orderItemCount?: number;
};

export function classifyPublicBehaviorPage(pathname: string): BehaviorPage | null {
  const path = pathname.split("?")[0]?.split("#")[0] ?? "/";
  if (
    path.startsWith("/admin") ||
    path.startsWith("/salao") ||
    path.startsWith("/dev") ||
    path.startsWith("/login") ||
    path.startsWith("/api")
  ) {
    return null;
  }
  if (path === "/") return "home";
  if (path === "/cardapio" || path.startsWith("/cardapio/")) return "cardapio";
  if (path === "/cliente") return "cliente";
  if (path.startsWith("/cliente/pedidos")) return "cliente_pedidos";
  if (path.startsWith("/rastrear")) return "rastrear";
  if (path.startsWith("/pedido/editar")) return "pedido_editar";
  if (path.startsWith("/promocoes") || path.startsWith("/cardapio/promocoes")) return "promocoes";
  return "outro_publico";
}
