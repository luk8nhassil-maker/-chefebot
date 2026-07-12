// Lógica pura compartilhada pelo menu inferior do cliente (/pedido, /cliente,
// /rastrear/[pedidoId]) — extraída para ser testável sem depender de DOM/React
// e para não duplicar a mesma regra (TTL de 3h do "pedido ativo", flag de
// "abrir sacola" entre páginas) em cada tela.

export type ClientBottomNavTab = "inicio" | "sacola" | "pedido" | "pontos";

const TRES_HORAS_MS = 3 * 60 * 60 * 1000;

type PedidoAtivoRaw = { id?: unknown; ts?: unknown };

// Mesma regra usada pelo cardápio público (localStorage "cf_ultimo_pedido"):
// só considera o pedido "ativo" (para o link da aba Pedido) se tiver id e
// tiver sido registrado há no máximo 3h.
export function lerPedidoAtivoId(raw: string | null, agora: number = Date.now()): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PedidoAtivoRaw;
    if (!parsed || !parsed.id || typeof parsed.ts !== "number") return null;
    if (agora - parsed.ts > TRES_HORAS_MS) return null;
    return String(parsed.id);
  } catch {
    return null;
  }
}

// Mapeia a tela atual do cardápio público (/pedido, /cardapio sem admin) para
// a aba correspondente do menu inferior. Telas fora dessas três (ex.: sc-list)
// não destacam nenhuma aba — igual ao comportamento original.
export function tabAtivaCardapio(screen: string): ClientBottomNavTab | null {
  if (screen === "sc-start") return "inicio";
  if (screen === "sc-cart") return "sacola";
  if (screen === "sc-done") return "pedido";
  return null;
}

export const CF_OPEN_CART_KEY = "cf_open_cart";

export interface StorageLike {
  getItem(key: string): string | null;
  removeItem(key: string): void;
}

// Consome (lê e remove) a flag gravada por /cliente ou /rastrear antes de
// navegar para /pedido pedindo para abrir a sacola. Só true uma vez.
export function consumirFlagAbrirSacola(storage: StorageLike): boolean {
  try {
    const valor = storage.getItem(CF_OPEN_CART_KEY);
    if (!valor) return false;
    storage.removeItem(CF_OPEN_CART_KEY);
    return true;
  } catch {
    return false;
  }
}
