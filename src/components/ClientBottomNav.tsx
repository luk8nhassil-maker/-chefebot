"use client";

import { Home, ShoppingCart, Receipt, User } from "lucide-react";
import type { ClientBottomNavTab } from "@/lib/pedidoAtivoCliente";

// Altura real renderizada do .cbn-nav (medida via getBoundingClientRect em
// 390×844: 103px sem safe-area-inset-bottom) — o nav é uma "pill" flutuante
// (estilo 99): .cbn-nav é só a moldura fixa com a folga lateral/inferior
// (gutter) que separa a pill das bordas da tela, e .cbn-nav-inner é a
// superfície arredondada de verdade (fundo, sombra, borda). Exportada para
// quem precisa empilhar um elemento fixo imediatamente acima do nav (ver
// PixPendenteBar.tsx) sem duplicar um número mágico dessincronizável do CSS
// real.
export const CLIENT_BOTTOM_NAV_HEIGHT_PX = 103;

type ClientBottomNavProps = {
  active: ClientBottomNavTab | null;
  cartCount?: number;
  inicioHref?: string;
  onInicioClick?: () => void;
  sacolaHref?: string;
  onSacolaClick?: () => void;
  /** Indicador discreto (ponto, sem número) na aba Pedido — true só quando
   * o backend confirma um Pix pendente (ver usePixPendente). Nunca decide
   * isso a partir de localStorage sozinho. */
  pixPendente?: boolean;
};

// Menu inferior compartilhado entre o cardápio público (/pedido e /cardapio
// sem sessão admin), a Área do Cliente (/cliente, /cliente/pedidos) e o
// rastreamento de pedido (/rastrear/[pedidoId]) — mesmo padrão visual/CSS do
// bottom nav original do cardápio (antes duplicado ali), com tokens globais
// de tema em vez dos aliases locais daquela página, para funcionar em
// qualquer tela.
//
// Início/Sacola aceitam um onClick (usado dentro do cardápio, que já navega
// internamente entre telas sem reload); sem onClick, viram link normal para
// inicioHref/sacolaHref (usado por /cliente, /cliente/pedidos e /rastrear,
// que precisam sair da página). Pedido é sempre um link estático para
// /cliente/pedidos — nunca desabilitada, nunca depende de haver um "pedido
// recente" no localStorage (a própria listagem cobre o estado vazio).
export default function ClientBottomNav({
  active,
  cartCount = 0,
  inicioHref = "/pedido",
  onInicioClick,
  sacolaHref = "/pedido",
  onSacolaClick,
  pixPendente = false,
}: ClientBottomNavProps) {
  return (
    <>
      <nav className="cbn-nav" aria-label="Navegação principal">
        <div className="cbn-nav-inner">
          {onInicioClick ? (
            <button type="button" className={`cbn-item ${active === "inicio" ? "active" : ""}`} onClick={onInicioClick}>
              <span className="cbn-icon-circle"><span className="cbn-icon"><Home size={20} aria-hidden="true" /></span></span>
              <span className="cbn-label">Início</span>
            </button>
          ) : (
            <a className={`cbn-item ${active === "inicio" ? "active" : ""}`} href={inicioHref}>
              <span className="cbn-icon-circle"><span className="cbn-icon"><Home size={20} aria-hidden="true" /></span></span>
              <span className="cbn-label">Início</span>
            </a>
          )}

          {onSacolaClick ? (
            <button type="button" className={`cbn-item ${active === "sacola" ? "active" : ""}`} onClick={onSacolaClick}>
              <span className="cbn-icon-circle">
                <span className="cbn-icon-wrap">
                  <span className="cbn-icon"><ShoppingCart size={20} aria-hidden="true" /></span>
                  {cartCount > 0 && <span className="cbn-badge">{cartCount > 99 ? "99+" : cartCount}</span>}
                </span>
              </span>
              <span className="cbn-label">Sacola</span>
            </button>
          ) : (
            <a className={`cbn-item ${active === "sacola" ? "active" : ""}`} href={sacolaHref}>
              <span className="cbn-icon-circle">
                <span className="cbn-icon-wrap">
                  <span className="cbn-icon"><ShoppingCart size={20} aria-hidden="true" /></span>
                  {cartCount > 0 && <span className="cbn-badge">{cartCount > 99 ? "99+" : cartCount}</span>}
                </span>
              </span>
              <span className="cbn-label">Sacola</span>
            </a>
          )}

          <a
            className={`cbn-item ${active === "pedido" ? "active" : ""}`}
            href="/cliente/pedidos"
            aria-label={pixPendente ? "Pedido — pagamento Pix pendente" : undefined}
          >
            <span className="cbn-icon-circle">
              <span className="cbn-icon-wrap">
                <span className="cbn-icon"><Receipt size={20} aria-hidden="true" /></span>
                {pixPendente && <span className="cbn-dot" aria-hidden="true" />}
              </span>
            </span>
            <span className="cbn-label">Pedido</span>
          </a>

          <a className={`cbn-item ${active === "pontos" ? "active" : ""}`} href="/cliente">
            <span className="cbn-icon-circle"><span className="cbn-icon"><User size={20} aria-hidden="true" /></span></span>
            <span className="cbn-label">Pontos</span>
          </a>
        </div>
      </nav>
      <style>{`
        .cbn-nav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:540px;z-index:54;padding:0 12px calc(env(safe-area-inset-bottom) + 14px);pointer-events:none}
        .cbn-nav-inner{pointer-events:auto;display:flex;align-items:stretch;justify-content:space-around;gap:4px;min-height:48px;background:var(--surface);border:1px solid rgba(var(--overlay-rgb), 0.06);border-radius:26px;padding:7px 8px;box-shadow:0 12px 28px rgba(0,0,0,.20), 0 2px 8px rgba(0,0,0,.10)}
        .cbn-item{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:3px;padding:2px 4px;border:none;background:none;color:var(--text-secondary);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:11px;font-weight:600;border-radius:12px;cursor:pointer;text-decoration:none;transition:color .15s}
        .cbn-item:active{transform:scale(.96)}
        .cbn-icon{font-size:20px;line-height:1;display:inline-flex;align-items:center;justify-content:center}
        .cbn-icon-wrap{position:relative;display:inline-flex}
        .cbn-icon-circle{width:36px;height:36px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;color:var(--text-secondary);background:transparent;transition:background-color .18s ease,color .18s ease,transform .18s ease,box-shadow .18s ease,width .18s ease,height .18s ease}
        .cbn-item.active .cbn-icon-circle{width:54px;height:54px;background:var(--primary);color:var(--primary-foreground);transform:translateY(-16px);box-shadow:0 8px 16px rgba(0,0,0,.28), 0 0 0 5px var(--surface)}
        .cbn-item.active .cbn-label{color:var(--text-primary);font-weight:800}
        .cbn-label{line-height:1.1}
        .cbn-badge{position:absolute;top:-5px;right:-9px;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:var(--danger);color:var(--on-danger);font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;line-height:1;box-shadow:0 0 0 2px var(--surface)}
        .cbn-dot{position:absolute;top:-2px;right:-6px;width:9px;height:9px;border-radius:999px;background:var(--attention);box-shadow:0 0 0 2px var(--surface), 0 0 0 4px color-mix(in srgb, var(--attention) 30%, transparent)}
      `}</style>
    </>
  );
}
