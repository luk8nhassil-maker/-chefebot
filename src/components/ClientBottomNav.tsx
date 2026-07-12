"use client";

import { Home, ShoppingCart, Receipt, User } from "lucide-react";
import type { ClientBottomNavTab } from "@/lib/pedidoAtivoCliente";

type ClientBottomNavProps = {
  active: ClientBottomNavTab | null;
  cartCount?: number;
  inicioHref?: string;
  onInicioClick?: () => void;
  sacolaHref?: string;
  onSacolaClick?: () => void;
  pedidoHref?: string | null;
};

// Menu inferior compartilhado entre o cardápio público (/pedido e /cardapio
// sem sessão admin), a Área do Cliente (/cliente) e o rastreamento de pedido
// (/rastrear/[pedidoId]) — mesmo padrão visual/CSS do bottom nav original do
// cardápio (antes duplicado ali), com tokens globais de tema em vez dos
// aliases locais daquela página, para funcionar em qualquer tela.
//
// Início/Sacola aceitam um onClick (usado dentro do cardápio, que já navega
// internamente entre telas sem reload); sem onClick, viram link normal para
// inicioHref/sacolaHref (usado por /cliente e /rastrear, que precisam sair da
// página).
export default function ClientBottomNav({
  active,
  cartCount = 0,
  inicioHref = "/pedido",
  onInicioClick,
  sacolaHref = "/pedido",
  onSacolaClick,
  pedidoHref = null,
}: ClientBottomNavProps) {
  return (
    <>
      <nav className="cbn-nav" aria-label="Navegação principal">
        <div className="cbn-nav-inner">
          {onInicioClick ? (
            <button type="button" className={`cbn-item ${active === "inicio" ? "active" : ""}`} onClick={onInicioClick}>
              <span className="cbn-icon"><Home size={20} aria-hidden="true" /></span>
              <span className="cbn-label">Início</span>
            </button>
          ) : (
            <a className={`cbn-item ${active === "inicio" ? "active" : ""}`} href={inicioHref}>
              <span className="cbn-icon"><Home size={20} aria-hidden="true" /></span>
              <span className="cbn-label">Início</span>
            </a>
          )}

          {onSacolaClick ? (
            <button type="button" className={`cbn-item ${active === "sacola" ? "active" : ""}`} onClick={onSacolaClick}>
              <span className="cbn-icon-wrap">
                <span className="cbn-icon"><ShoppingCart size={20} aria-hidden="true" /></span>
                {cartCount > 0 && <span className="cbn-badge">{cartCount > 99 ? "99+" : cartCount}</span>}
              </span>
              <span className="cbn-label">Sacola</span>
            </button>
          ) : (
            <a className={`cbn-item ${active === "sacola" ? "active" : ""}`} href={sacolaHref}>
              <span className="cbn-icon-wrap">
                <span className="cbn-icon"><ShoppingCart size={20} aria-hidden="true" /></span>
                {cartCount > 0 && <span className="cbn-badge">{cartCount > 99 ? "99+" : cartCount}</span>}
              </span>
              <span className="cbn-label">Sacola</span>
            </a>
          )}

          {pedidoHref ? (
            <a className={`cbn-item ${active === "pedido" ? "active" : ""}`} href={pedidoHref}>
              <span className="cbn-icon"><Receipt size={20} aria-hidden="true" /></span>
              <span className="cbn-label">Pedido</span>
            </a>
          ) : (
            <span className="cbn-item disabled" aria-disabled="true">
              <span className="cbn-icon"><Receipt size={20} aria-hidden="true" /></span>
              <span className="cbn-label">Pedido</span>
            </span>
          )}

          <a className={`cbn-item ${active === "pontos" ? "active" : ""}`} href="/cliente">
            <span className="cbn-icon"><User size={20} aria-hidden="true" /></span>
            <span className="cbn-label">Pontos</span>
          </a>
        </div>
      </nav>
      <style>{`
        .cbn-nav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:540px;z-index:54;background:var(--surface);border-top:1px solid rgba(var(--overlay-rgb), 0.08);box-shadow:0 -6px 20px rgba(0,0,0,.16);padding:6px 8px calc(env(safe-area-inset-bottom) + 6px)}
        .cbn-nav-inner{display:flex;align-items:stretch;justify-content:space-around;gap:4px;min-height:46px}
        .cbn-item{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:4px 4px;border:none;background:none;color:var(--text-secondary);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:11px;font-weight:600;border-radius:12px;cursor:pointer;text-decoration:none;transition:color .15s}
        .cbn-item:active{transform:scale(.96)}
        .cbn-icon{font-size:20px;line-height:1;display:inline-flex;align-items:center;justify-content:center}
        .cbn-icon-wrap{position:relative;display:inline-flex}
        .cbn-item.active{color:var(--primary)}
        .cbn-item.active .cbn-label{color:var(--text-primary);font-weight:800}
        .cbn-item.disabled{opacity:.35;cursor:not-allowed}
        .cbn-label{line-height:1.1}
        .cbn-badge{position:absolute;top:-5px;right:-9px;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:var(--primary);color:var(--on-primary);font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;line-height:1;box-shadow:0 0 0 2px var(--surface)}
      `}</style>
    </>
  );
}
