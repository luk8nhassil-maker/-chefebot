"use client"
import { usePathname, useRouter } from "next/navigation"

interface PanelShellProps {
  children: React.ReactNode
  pedidosCount?: number
  conversasCount?: number
  conversasUrgent?: boolean
}

export default function PanelShell({
  children,
  pedidosCount = 0,
  conversasCount = 0,
  conversasUrgent = false,
}: PanelShellProps) {
  const router = useRouter()
  const pathname = usePathname()

  const onPedidos = pathname.startsWith("/pedidos")
  const onConversas = pathname.startsWith("/conversas")
  const onCardapio = pathname.startsWith("/cardapio")

  const convBadgeColor = conversasUrgent ? "#e05050" : "#ff6b00"

  return (
    <>
      <style>{`
        .ps-sidebar { display: none; }
        .ps-bottom-nav {
          position: fixed; bottom: 0; left: 0; right: 0;
          background: rgba(6,6,6,.96);
          backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
          border-top: 1px solid #181614;
          display: grid; grid-template-columns: 1fr 1fr 1fr;
          padding: 10px 8px calc(env(safe-area-inset-bottom) + 16px);
          z-index: 200;
        }
        .ps-nav-btn {
          border: none; background: transparent;
          display: flex; flex-direction: column; align-items: center; gap: 5px;
          padding: 6px 0; cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }
        .ps-content {
          padding-bottom: calc(88px + env(safe-area-inset-bottom));
          background: #060606; color: #f5f2ee;
          font-family: 'Archivo', sans-serif;
          min-height: 100svh;
        }
        @media (min-width: 768px) {
          .ps-sidebar {
            display: flex; flex-direction: column; gap: 4px;
            position: fixed; top: 0; left: 0; bottom: 0; width: 220px;
            background: #060606; border-right: 1px solid #1a1816;
            z-index: 100; overflow-y: auto; padding: 24px 0;
          }
          .ps-sidebar-brand { padding: 0 20px 20px; border-bottom: 1px solid #1a1816; margin-bottom: 8px; }
          .ps-sidebar-btn {
            display: flex; align-items: center; gap: 10px;
            padding: 10px 20px;
            font-family: 'Archivo', sans-serif; font-size: 13px; font-weight: 800;
            color: #4a4640; background: transparent; border: none;
            border-radius: 10px; cursor: pointer; transition: background .15s;
            text-align: left; width: 100%;
          }
          .ps-sidebar-btn:hover { background: rgba(255,255,255,.04); }
          .ps-sidebar-btn.ps-active { color: #ff6b00; background: rgba(255,107,0,.08); }
          .ps-bottom-nav { display: none; }
          .ps-content { margin-left: 220px; padding-bottom: 40px; min-height: 100vh; }
        }
        @media (min-width: 1024px) {
          .ps-sidebar { width: 240px; }
          .ps-content { margin-left: 240px; }
        }
      `}</style>

      {/* Desktop: fixed sidebar */}
      <nav className="ps-sidebar">
        <div className="ps-sidebar-brand">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(255,107,0,.15)", border: "1px solid rgba(255,107,0,.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, flexShrink: 0 }}>🍕</div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 900, letterSpacing: "-0.4px", color: "#f5f2ee" }}>ChefeBot</div>
              <div style={{ fontSize: 10, color: "#4a4640", fontWeight: 700 }}>Painel operacional</div>
            </div>
          </div>
        </div>
        <div style={{ padding: "0 12px", marginBottom: 4 }}>
          <div style={{ height: 1, background: "#1a1816" }} />
        </div>
        <button className={`ps-sidebar-btn${onPedidos ? " ps-active" : ""}`} onClick={() => router.push("/pedidos")}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><rect x="4" y="3" width="16" height="18" rx="3" stroke="currentColor" strokeWidth="2.2"/><line x1="8" y1="9" x2="16" y2="9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/><line x1="8" y1="14" x2="13" y2="14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/></svg>
          Pedidos
          {pedidosCount > 0 && <span style={{ marginLeft: "auto", minWidth: 20, height: 20, borderRadius: 10, background: "#ff6b00", color: "#fff", fontSize: 10, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>{pedidosCount}</span>}
        </button>
        <button className={`ps-sidebar-btn${onConversas ? " ps-active" : ""}`} onClick={() => router.push("/conversas")}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="14" rx="5" stroke="currentColor" strokeWidth="2.2"/><circle cx="8.5" cy="11" r="1.3" fill="currentColor"/><circle cx="12" cy="11" r="1.3" fill="currentColor"/><circle cx="15.5" cy="11" r="1.3" fill="currentColor"/></svg>
          Conversas
          {conversasCount > 0 && <span style={{ marginLeft: "auto", minWidth: 20, height: 20, borderRadius: 10, background: convBadgeColor, color: "#fff", fontSize: 10, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>{conversasCount}</span>}
        </button>
        <button className={`ps-sidebar-btn${onCardapio ? " ps-active" : ""}`} onClick={() => router.push("/cardapio")}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="2.2"/><rect x="13" y="4" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="2.2"/><rect x="4" y="13" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="2.2"/><rect x="13" y="13" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="2.2"/></svg>
          Cardápio
        </button>
      </nav>

      {/* Mobile: fixed bottom nav */}
      <nav className="ps-bottom-nav">
        <button className="ps-nav-btn" onClick={() => router.push("/pedidos")}>
          <span style={{ position: "relative", display: "flex" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><rect x="4" y="3" width="16" height="18" rx="3" stroke={onPedidos ? "#ff6b00" : "#5a564d"} strokeWidth="2.2"/><line x1="8" y1="9" x2="16" y2="9" stroke={onPedidos ? "#ff6b00" : "#5a564d"} strokeWidth="2.2" strokeLinecap="round"/><line x1="8" y1="14" x2="13" y2="14" stroke={onPedidos ? "#ff6b00" : "#5a564d"} strokeWidth="2.2" strokeLinecap="round"/></svg>
            {pedidosCount > 0 && <span style={{ position: "absolute", top: -5, right: -9, minWidth: 17, height: 17, borderRadius: 9, background: "#ff6b00", color: "#fff", fontSize: 10.5, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>{pedidosCount}</span>}
          </span>
          <span style={{ fontSize: 11, fontWeight: onPedidos ? 900 : 800, color: onPedidos ? "#ff6b00" : "#5a564d" }}>Pedidos</span>
        </button>
        <button className="ps-nav-btn" onClick={() => router.push("/conversas")}>
          <span style={{ position: "relative", display: "flex" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="14" rx="5" stroke={onConversas ? "#ff6b00" : "#5a564d"} strokeWidth="2.2"/><circle cx="8.5" cy="11" r="1.4" fill={onConversas ? "#ff6b00" : "#5a564d"}/><circle cx="12" cy="11" r="1.4" fill={onConversas ? "#ff6b00" : "#5a564d"}/><circle cx="15.5" cy="11" r="1.4" fill={onConversas ? "#ff6b00" : "#5a564d"}/></svg>
            {conversasCount > 0 && <span style={{ position: "absolute", top: -5, right: -9, minWidth: 17, height: 17, borderRadius: 9, background: convBadgeColor, color: "#fff", fontSize: 10.5, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>{conversasCount}</span>}
          </span>
          <span style={{ fontSize: 11, fontWeight: onConversas ? 900 : 800, color: onConversas ? "#ff6b00" : "#5a564d" }}>Conversas</span>
        </button>
        <button className="ps-nav-btn" onClick={() => router.push("/cardapio")}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="7" height="7" rx="2" stroke={onCardapio ? "#ff6b00" : "#5a564d"} strokeWidth="2.2"/><rect x="13" y="4" width="7" height="7" rx="2" stroke={onCardapio ? "#ff6b00" : "#5a564d"} strokeWidth="2.2"/><rect x="4" y="13" width="7" height="7" rx="2" stroke={onCardapio ? "#ff6b00" : "#5a564d"} strokeWidth="2.2"/><rect x="13" y="13" width="7" height="7" rx="2" stroke={onCardapio ? "#ff6b00" : "#5a564d"} strokeWidth="2.2"/></svg>
          <span style={{ fontSize: 11, fontWeight: onCardapio ? 900 : 800, color: onCardapio ? "#ff6b00" : "#5a564d" }}>Cardápio</span>
        </button>
      </nav>

      {/* Page content */}
      <div className="ps-content">
        {children}
      </div>
    </>
  )
}
