"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

type MenuType = {
  sizes: { code: string; label: string; price: number }[];
  saltyFlavors: string[];
  sweetFlavors: string[];
  lanches: { name: string; price: number }[];
  bebidas: { name: string; price: number }[];
  sucos: { name: string; price: number }[];
  borders: { label: string; priceSmall: number; priceLarge: number }[];
  neighborhoods: { name: string; fee: number }[];
  payments: string[];
  esgotados?: string[];
};

// ==================== ADMIN CARDÁPIO ====================

type Produto = { nome: string; categoria: string; preco?: number }

function normStr(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
}

function AdminCardapio({ menu, onSair }: { menu: MenuType; onSair: () => void }) {
  const router = useRouter()
  const [esgotados, setEsgotados] = useState<string[]>(menu.esgotados || [])
  const [salvando, setSalvando] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<{ msg: string; nome: string; era: boolean } | null>(null)
  const [busca, setBusca] = useState("")
  const [filtroStatus, setFiltroStatus] = useState<"todos" | "disponivel" | "esgotado">("todos")
  const [filtroCat, setFiltroCat] = useState("todas")
  const [modoSel, setModoSel] = useState(false)
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [confirmLote, setConfirmLote] = useState<"esgotado" | "disponivel" | null>(null)
  const toastTimer = useRef<any>(null)

  const todos: Produto[] = [
    ...(menu.saltyFlavors || []).map(f => ({ nome: f, categoria: "Salgados" })),
    ...(menu.sweetFlavors || []).map(f => ({ nome: f, categoria: "Doces" })),
    ...(menu.lanches || []).map(l => ({ nome: l.name, categoria: "Lanches", preco: l.price || undefined })),
    ...(menu.bebidas || []).map(b => ({ nome: b.name, categoria: "Bebidas", preco: b.price })),
    ...(menu.sucos || []).map(s => ({ nome: s.name, categoria: "Sucos", preco: s.price })),
    ...(menu.borders || []).map(b => ({ nome: b.label, categoria: "Bordas" })),
  ]

  const CATS = ["todas", ...Array.from(new Set(todos.map(p => p.categoria)))]
  const CAT_ICON: Record<string, string> = { todas: "☰", Salgados: "🍕", Doces: "🍬", Lanches: "🍔", Bebidas: "🥤", Sucos: "🧃", Bordas: "🧀" }

  const totalProd = todos.length
  const totalEsg = esgotados.length
  const totalDisp = totalProd - totalEsg

  const bNorm = normStr(busca)
  const lista = todos
    .filter(p => {
      if (bNorm && !normStr(p.nome).includes(bNorm)) return false
      if (filtroCat !== "todas" && p.categoria !== filtroCat) return false
      if (filtroStatus === "disponivel" && esgotados.includes(p.nome)) return false
      if (filtroStatus === "esgotado" && !esgotados.includes(p.nome)) return false
      return true
    })
    .sort((a, b) => {
      const ae = esgotados.includes(a.nome), be = esgotados.includes(b.nome)
      return ae === be ? 0 : ae ? -1 : 1
    })

  async function toggleEsgotado(nome: string, novoEstado: boolean, withToast = true) {
    setSalvando(prev => new Set([...prev, nome]))
    try {
      const r = await fetch("/api/cardapio", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome, esgotado: novoEstado }),
      })
      const d = await r.json()
      if (d.ok) {
        setEsgotados(d.esgotados || [])
        if (withToast) {
          clearTimeout(toastTimer.current)
          const msg = novoEstado
            ? `${nome} esgotado. O bot não vai vender esse produto.`
            : `${nome} disponível. O bot já pode vender novamente.`
          setToast({ msg, nome, era: !novoEstado })
          toastTimer.current = setTimeout(() => setToast(null), 5500)
        }
      }
    } catch {}
    setSalvando(prev => { const n = new Set(prev); n.delete(nome); return n })
  }

  async function desfazer() {
    if (!toast || !toast.nome) return
    clearTimeout(toastTimer.current)
    const voltarPara = toast.era
    setToast(null)
    await toggleEsgotado(toast.nome, voltarPara, false)
  }

  function toggleSel(nome: string) {
    setSelecionados(prev => {
      const n = new Set(prev)
      if (n.has(nome)) n.delete(nome); else n.add(nome)
      return n
    })
  }

  async function aplicarLote(esgotado: boolean) {
    setConfirmLote(null)
    const lista = Array.from(selecionados)
    for (const nome of lista) {
      await toggleEsgotado(nome, esgotado, false)
    }
    const count = lista.length
    setSelecionados(new Set())
    setModoSel(false)
    clearTimeout(toastTimer.current)
    const msg = esgotado
      ? `${count} produto${count > 1 ? "s" : ""} marcado${count > 1 ? "s" : ""} como esgotado${count > 1 ? "s" : ""}. O bot não vai vender.`
      : `${count} produto${count > 1 ? "s" : ""} voltou${count > 1 ? "ram" : ""} a ficar disponíve${count > 1 ? "is" : "l"}. O bot já pode vender.`
    setToast({ msg, nome: "", era: !esgotado })
    toastTimer.current = setTimeout(() => setToast(null), 4000)
  }

  const inputStyle: React.CSSProperties = { width: "100%", height: 48, background: "#0d0d0d", border: "1px solid #242220", borderRadius: 12, padding: "0 42px 0 14px", color: "#f5f2ee", fontSize: 15, fontWeight: 700, fontFamily: "'Archivo', sans-serif", boxSizing: "border-box", outline: "none", transition: "border-color .15s, box-shadow .15s" }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800;900&display=swap');
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        html, body { margin: 0; padding: 0; background: #060606; }
        button { cursor: pointer; font-family: 'Archivo', sans-serif; }
        @keyframes cbToastIn { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:none} }
        @keyframes cbFadeIn { from{opacity:0} to{opacity:1} }
        @keyframes cbSheetUp { from{transform:translateY(100%)} to{transform:none} }
        @keyframes cbItemIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
        .cbBusca::placeholder { color: #3a3730; }
        .cbBusca:focus { border-color: #ff6b00 !important; box-shadow: 0 0 0 3px rgba(255,107,0,.1); }
        .cbCatScroll { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; scrollbar-width: none; }
        .cbCatScroll::-webkit-scrollbar { display: none; }
        .cbItem { transition: border-color .12s, background .12s; }
        .cbItem:active { opacity: 0.85; }
      `}</style>

      <div style={{ minHeight: "100svh", maxWidth: 375, margin: "0 auto", background: "#060606", color: "#f5f2ee", fontFamily: "'Archivo', sans-serif", display: "flex", flexDirection: "column", paddingBottom: "calc(env(safe-area-inset-bottom) + 90px)" }}>

        {/* Header sticky */}
        <header style={{ position: "sticky", top: 0, zIndex: 30, background: "#060606", borderBottom: "1px solid #181614", padding: "calc(env(safe-area-inset-top) + 12px) 16px 12px" }}>

          {/* Título + ações */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 20, fontWeight: 900, letterSpacing: "-0.4px" }}>Cardápio</span>
            </div>
            <button
              onClick={() => { setModoSel(!modoSel); setSelecionados(new Set()) }}
              style={{ height: 34, padding: "0 12px", border: `1px solid ${modoSel ? "#ff6b00" : "#242220"}`, borderRadius: 10, background: modoSel ? "rgba(255,107,0,.15)" : "transparent", color: modoSel ? "#ff6b00" : "#5a564d", fontSize: 12, fontWeight: 900 }}
            >{modoSel ? "Cancelar" : "Selecionar"}</button>
            <button onClick={onSair} style={{ height: 34, padding: "0 12px", border: "1px solid #1f1d1a", borderRadius: 10, background: "transparent", color: "#5a564d", fontSize: 12, fontWeight: 800 }}>Sair</button>
          </div>

          {/* Métricas */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 10 }}>
            <div style={{ background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: 12, padding: "10px 8px", textAlign: "center" }}>
              <div style={{ fontSize: 24, fontWeight: 900, color: "#22c55e", lineHeight: 1 }}>{totalDisp}</div>
              <div style={{ fontSize: 9, fontWeight: 900, color: "#22c55e", textTransform: "uppercase", letterSpacing: ".5px", marginTop: 3, opacity: .7 }}>Disponíveis</div>
            </div>
            <div style={{ background: totalEsg > 0 ? "rgba(239,68,68,.06)" : "#0e0e0e", border: `1px solid ${totalEsg > 0 ? "rgba(239,68,68,.3)" : "#1a1a1a"}`, borderRadius: 12, padding: "10px 8px", textAlign: "center" }}>
              <div style={{ fontSize: 24, fontWeight: 900, color: totalEsg > 0 ? "#ef4444" : "#3a3730", lineHeight: 1 }}>{totalEsg}</div>
              <div style={{ fontSize: 9, fontWeight: 900, color: totalEsg > 0 ? "#ef4444" : "#3a3730", textTransform: "uppercase", letterSpacing: ".5px", marginTop: 3, opacity: .7 }}>Esgotados</div>
            </div>
            <div style={{ background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: 12, padding: "10px 8px", textAlign: "center" }}>
              <div style={{ fontSize: 24, fontWeight: 900, color: "#a39b8b", lineHeight: 1 }}>{totalProd}</div>
              <div style={{ fontSize: 9, fontWeight: 900, color: "#56524b", textTransform: "uppercase", letterSpacing: ".5px", marginTop: 3, opacity: .7 }}>Total</div>
            </div>
          </div>

          {/* Aviso bot */}
          {totalEsg > 0 && (
            <div style={{ background: "rgba(239,68,68,.05)", border: "1px solid rgba(239,68,68,.18)", borderRadius: 10, padding: "8px 12px", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ef4444", flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: "#f87171" }}>Bot bloqueando {totalEsg} produto{totalEsg > 1 ? "s" : ""} esgotado{totalEsg > 1 ? "s" : ""}.</span>
            </div>
          )}

          {/* Busca */}
          <div style={{ position: "relative", marginBottom: 8 }}>
            <input
              className="cbBusca"
              type="text"
              placeholder="Buscar produto..."
              value={busca}
              onChange={e => setBusca(e.target.value)}
              style={inputStyle}
            />
            {busca
              ? <button onClick={() => setBusca("")} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#5a564d", fontSize: 20, lineHeight: 1, padding: "2px 4px" }}>×</button>
              : <svg style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="#3a3730" strokeWidth="2.2"/><path d="M16.5 16.5l3.5 3.5" stroke="#3a3730" strokeWidth="2.2" strokeLinecap="round"/></svg>
            }
          </div>

          {/* Filtros status */}
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            {(["todos", "disponivel", "esgotado"] as const).map(f => {
              const COUNT = { todos: totalProd, disponivel: totalDisp, esgotado: totalEsg }
              const LABEL = { todos: "Todos", disponivel: "Disponíveis", esgotado: "Esgotados" }
              const COLOR = { todos: "#ff6b00", disponivel: "#22c55e", esgotado: "#ef4444" }
              const active = filtroStatus === f
              return (
                <button key={f} onClick={() => setFiltroStatus(f)} style={{ flex: 1, height: 36, border: `1px solid ${active ? COLOR[f] : "#1f1d1a"}`, borderRadius: 10, background: active ? `${COLOR[f]}1a` : "transparent", color: active ? COLOR[f] : "#5a564d", fontSize: 11, fontWeight: 900, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1 }}>
                  <span style={{ fontSize: 14, fontWeight: 900, lineHeight: 1 }}>{COUNT[f]}</span>
                  <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".3px" }}>{LABEL[f]}</span>
                </button>
              )
            })}
          </div>

          {/* Filtros categoria */}
          <div className="cbCatScroll">
            {CATS.map(cat => (
              <button key={cat} onClick={() => setFiltroCat(cat)} style={{ height: 30, padding: "0 10px", border: `1px solid ${filtroCat === cat ? "#ff6b00" : "#1f1d1a"}`, borderRadius: 8, background: filtroCat === cat ? "rgba(255,107,0,.15)" : "#0e0e0e", color: filtroCat === cat ? "#ff6b00" : "#56524b", fontSize: 11, fontWeight: 900, whiteSpace: "nowrap", flexShrink: 0 }}>
                {CAT_ICON[cat] || "•"} {cat === "todas" ? "Tudo" : cat}
              </button>
            ))}
          </div>
        </header>

        {/* Barra lote */}
        {modoSel && selecionados.size > 0 && (
          <div style={{ background: "#0f0e0c", borderBottom: "1px solid #1f1d1a", padding: "10px 16px", display: "flex", alignItems: "center", gap: 8, zIndex: 29 }}>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 800, color: "#c9c2b4" }}>{selecionados.size} selecionado{selecionados.size > 1 ? "s" : ""}</span>
            <button onClick={() => setConfirmLote("esgotado")} style={{ height: 36, padding: "0 12px", border: "1px solid rgba(239,68,68,.35)", borderRadius: 10, background: "rgba(239,68,68,.1)", color: "#ef4444", fontSize: 12, fontWeight: 900 }}>Esgotar</button>
            <button onClick={() => setConfirmLote("disponivel")} style={{ height: 36, padding: "0 12px", border: "1px solid rgba(34,197,94,.35)", borderRadius: 10, background: "rgba(34,197,94,.1)", color: "#22c55e", fontSize: 12, fontWeight: 900 }}>Disponibilizar</button>
          </div>
        )}

        {/* Lista */}
        <main style={{ padding: "10px 16px", display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>

          {/* Estado vazio */}
          {lista.length === 0 && (
            <div style={{ background: "#0e0e0e", border: "1px dashed #242220", borderRadius: 16, padding: "40px 20px", textAlign: "center", marginTop: 4 }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>{busca ? "🔍" : filtroStatus === "esgotado" ? "✅" : "📦"}</div>
              <div style={{ fontSize: 15, fontWeight: 900, color: "#c9c2b4" }}>
                {busca
                  ? "Nenhum produto encontrado com esse nome."
                  : filtroStatus === "esgotado"
                  ? "Nenhum produto esgotado agora."
                  : "Nenhum produto disponível."}
              </div>
            </div>
          )}

          {lista.map((produto, idx) => {
            const esg = esgotados.includes(produto.nome)
            const loading = salvando.has(produto.nome)
            const sel = selecionados.has(produto.nome)

            return (
              <div
                key={produto.nome}
                className="cbItem"
                onClick={() => modoSel && toggleSel(produto.nome)}
                style={{
                  background: sel ? "rgba(255,107,0,.05)" : esg ? "rgba(239,68,68,.04)" : "#0e0e0e",
                  border: `1.5px solid ${sel ? "#ff6b00" : esg ? "rgba(239,68,68,.28)" : "#1a1a1a"}`,
                  borderRadius: 14,
                  padding: "14px 14px",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  cursor: modoSel ? "pointer" : "default",
                  animation: `cbItemIn .2s ease ${Math.min(idx * 0.02, 0.15)}s both`,
                }}
              >
                {/* Checkbox seleção */}
                {modoSel && (
                  <div style={{ width: 26, height: 26, borderRadius: 8, border: `2px solid ${sel ? "#ff6b00" : "#3a3730"}`, background: sel ? "#ff6b00" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 15, color: "#fff", fontWeight: 900, transition: "all .12s" }}>
                    {sel ? "✓" : ""}
                  </div>
                )}

                {/* Informações */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: esg ? "#ef4444" : "#f4f1ec", textDecoration: esg ? "line-through" : "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 5 }}>
                    {produto.nome}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ fontSize: 10, fontWeight: 900, color: "#56524b", background: "#181614", padding: "2px 8px", borderRadius: 6 }}>{produto.categoria}</span>
                    {produto.preco != null && produto.preco > 0 && (
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#a39b8b" }}>R$ {produto.preco.toFixed(2).replace(".", ",")}</span>
                    )}
                    <span style={{ fontSize: 11, fontWeight: 900, color: esg ? "#ef4444" : "#22c55e" }}>
                      {esg ? "Bot bloqueado" : "Vendendo agora"}
                    </span>
                  </div>
                </div>

                {/* Botão ação */}
                {!modoSel && (
                  <button
                    onClick={e => { e.stopPropagation(); if (!loading) toggleEsgotado(produto.nome, !esg) }}
                    disabled={loading}
                    style={{
                      height: 46,
                      padding: "0 14px",
                      border: `1.5px solid ${esg ? "rgba(34,197,94,.4)" : "rgba(239,68,68,.4)"}`,
                      borderRadius: 12,
                      background: esg ? "rgba(34,197,94,.1)" : "rgba(239,68,68,.1)",
                      color: esg ? "#22c55e" : "#ef4444",
                      fontSize: 12,
                      fontWeight: 900,
                      flexShrink: 0,
                      minWidth: 120,
                      opacity: loading ? 0.6 : 1,
                      transition: "opacity .15s",
                    }}
                  >
                    {loading ? "..." : esg ? "Voltar a vender" : "Marcar esgotado"}
                  </button>
                )}
              </div>
            )
          })}
        </main>

        {/* Toast com desfazer */}
        {toast && (
          <div style={{ position: "fixed", bottom: "calc(env(safe-area-inset-bottom) + 92px)", left: 0, right: 0, margin: "0 auto", width: "calc(100% - 32px)", maxWidth: 375, background: "#1c1a16", border: "1px solid #2e2b26", borderRadius: 16, padding: "13px 14px", display: "flex", alignItems: "center", gap: 10, animation: "cbToastIn .25s ease both", zIndex: 50, boxShadow: "0 8px 28px rgba(0,0,0,.6)", fontFamily: "'Archivo', sans-serif" }}>
            <p style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "#c9c2b4", margin: 0, lineHeight: 1.45 }}>{toast.msg}</p>
            {toast.nome && (
              <button onClick={desfazer} style={{ border: "none", background: "rgba(255,107,0,.15)", color: "#ff6b00", fontSize: 12, fontWeight: 900, padding: "9px 13px", borderRadius: 10, flexShrink: 0 }}>Desfazer</button>
            )}
          </div>
        )}

        {/* Modal confirmação lote */}
        {confirmLote && (
          <>
            <div onClick={() => setConfirmLote(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.72)", zIndex: 60, animation: "cbFadeIn .2s ease" }} />
            <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, margin: "0 auto", maxWidth: 375, background: "#121110", border: "1px solid #242220", borderBottom: "none", borderRadius: "24px 24px 0 0", zIndex: 61, animation: "cbSheetUp .3s cubic-bezier(.2,.9,.3,1) both", padding: "20px 20px calc(env(safe-area-inset-bottom) + 28px)", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ width: 44, height: 5, borderRadius: 3, background: "#2e2b26", margin: "0 auto 4px" }} />
              <p style={{ margin: 0, fontSize: 18, fontWeight: 900, letterSpacing: "-0.3px" }}>
                {confirmLote === "esgotado"
                  ? `Esgotar ${selecionados.size} produto${selecionados.size > 1 ? "s" : ""}?`
                  : `Disponibilizar ${selecionados.size} produto${selecionados.size > 1 ? "s" : ""}?`}
              </p>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#a39b8b", lineHeight: 1.5 }}>
                {confirmLote === "esgotado"
                  ? "O bot vai parar de vender esses produtos imediatamente."
                  : "O bot vai voltar a oferecer esses produtos."}
              </p>
              <button onClick={() => aplicarLote(confirmLote === "esgotado")} style={{ height: 54, border: "none", borderRadius: 14, background: confirmLote === "esgotado" ? "#ef4444" : "#22c55e", color: "#fff", fontSize: 16, fontWeight: 900 }}>
                {confirmLote === "esgotado" ? "Marcar esgotados" : "Disponibilizar todos"}
              </button>
              <button onClick={() => setConfirmLote(null)} style={{ height: 44, border: "none", background: "transparent", color: "#a39b8b", fontSize: 14, fontWeight: 800 }}>Cancelar</button>
            </div>
          </>
        )}

        {/* Nav */}
        <nav style={{ position: "fixed", bottom: 0, left: 0, right: 0, margin: "0 auto", maxWidth: 375, background: "rgba(8,8,8,.94)", backdropFilter: "blur(14px)", borderTop: "1px solid #1f1d1a", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", padding: "10px 8px calc(env(safe-area-inset-bottom) + 18px)", zIndex: 40 }}>
          <button onClick={() => router.push("/pedidos")} style={{ border: "none", background: "transparent", display: "flex", flexDirection: "column", alignItems: "center", gap: 5, padding: "6px 0" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><rect x="4" y="3" width="16" height="18" rx="3" stroke="#5a564d" strokeWidth="2.2"/><line x1="8" y1="9" x2="16" y2="9" stroke="#5a564d" strokeWidth="2.2" strokeLinecap="round"/><line x1="8" y1="14" x2="13" y2="14" stroke="#5a564d" strokeWidth="2.2" strokeLinecap="round"/></svg>
            <span style={{ fontSize: 11, fontWeight: 800, color: "#5a564d" }}>Pedidos</span>
          </button>
          <button onClick={() => router.push("/conversas")} style={{ border: "none", background: "transparent", display: "flex", flexDirection: "column", alignItems: "center", gap: 5, padding: "6px 0" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="14" rx="5" stroke="#5a564d" strokeWidth="2.2"/><circle cx="8.5" cy="11" r="1.4" fill="#5a564d"/><circle cx="12" cy="11" r="1.4" fill="#5a564d"/><circle cx="15.5" cy="11" r="1.4" fill="#5a564d"/></svg>
            <span style={{ fontSize: 11, fontWeight: 800, color: "#5a564d" }}>Conversas</span>
          </button>
          <button style={{ border: "none", background: "transparent", display: "flex", flexDirection: "column", alignItems: "center", gap: 5, padding: "6px 0" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="7" height="7" rx="2" stroke="#ff6b00" strokeWidth="2.2"/><rect x="13" y="4" width="7" height="7" rx="2" stroke="#ff6b00" strokeWidth="2.2"/><rect x="4" y="13" width="7" height="7" rx="2" stroke="#ff6b00" strokeWidth="2.2"/><rect x="13" y="13" width="7" height="7" rx="2" stroke="#ff6b00" strokeWidth="2.2"/></svg>
            <span style={{ fontSize: 11, fontWeight: 900, color: "#ff6b00" }}>Cardápio</span>
          </button>
        </nav>
      </div>
    </>
  )
}

// ==================== PUBLIC CARDÁPIO ====================

type CartItem = {
  emoji: string;
  kind: "pizza" | "simple";
  name: string;
  detail: string;
  price: number;
  qty: number;
};

const money = (v: number) => "R$ " + v.toFixed(2).replace(".", ",");
const bigBorder = (sz: string) => !(sz === "P" || sz === "M");

function PublicCardapio({ menu }: { menu: MenuType }) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [screen, setScreen] = useState("sc-start");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [sending, setSending] = useState(false);

  const [size, setSize] = useState<string | null>(null);
  const [sizePrice, setSizePrice] = useState(0);
  const [mam, setMam] = useState(false);
  const [f1, setF1] = useState<string | null>(null);
  const [f2, setF2] = useState<string | null>(null);
  const [border, setBorder] = useState<string | null>(null);
  const [borderPrice, setBorderPrice] = useState(0);
  const [plan, setPlan] = useState<{ total: number; current: number; openEnded: boolean }>({ total: 0, current: 0, openEnded: false });
  const [listCat, setListCat] = useState<"lanche" | "bebida" | "suco">("lanche");
  const [delType, setDelType] = useState<"delivery" | "retirada" | null>(null);
  const [bairroIdx, setBairroIdx] = useState<string>("");
  const [rua, setRua] = useState("");
  const [nome, setNome] = useState("");
  const [payment, setPayment] = useState<string | null>(null);
  const [troco, setTroco] = useState("");
  const [toast, setToast] = useState("");
  const toastTimer = useRef<any>(null);

  useEffect(() => { document.documentElement.setAttribute("data-theme", theme); }, [theme]);

  function showToast(m: string) { setToast(m); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(""), 1700); }
  function go(s: string) { setScreen(s); window.scrollTo({ top: 0, behavior: "smooth" }); }

  function resetBuild() { setSize(null); setSizePrice(0); setMam(false); setF1(null); setF2(null); setBorder(null); setBorderPrice(0); }
  function goPizza() { go("sc-qty"); }
  function setPizzaQty(q: number) { setPlan(q === 0 ? { total: 0, current: 1, openEnded: true } : { total: q, current: 1, openEnded: false }); resetBuild(); go("sc-build"); }
  function pizzasNoCarrinho() { return cart.filter((c) => c.kind === "pizza").length; }
  function pickSize(code: string) { const s = (menu.sizes || []).find((x) => x.code === code); if (!s) return; setSize(code); setSizePrice(s.price); }
  function toggleMam() { setMam(!mam); setF1(null); setF2(null); }
  function pickFlavor(f: string) {
    if (!mam) { setF1(f); return; }
    if (f1 === f) { setF1(f2); setF2(null); } else if (f2 === f) { setF2(null); } else if (!f1) setF1(f); else if (!f2) setF2(f); else setF2(f);
  }
  const flavorOk = mam ? !!(f1 && f2) : !!f1;
  const buildOk = !!size && flavorOk;
  function pickBorder(idx: string) {
    if (idx === "") { setBorder(null); setBorderPrice(0); }
    else { const b = (menu.borders || [])[+idx]; if (!b) return; setBorder(b.label); setBorderPrice(bigBorder(size!) ? b.priceLarge : b.priceSmall); }
  }
  function addPizza() {
    const flavor = mam ? `${f1} / ${f2}` : f1;
    const newItem: CartItem = { emoji: "🍕", kind: "pizza", name: `Pizza ${size}${mam ? " (meio a meio)" : ""}`, detail: `${flavor}${border ? ` · borda ${border}` : ""}`, price: sizePrice + borderPrice, qty: 1 };
    const newCart = [...cart, newItem];
    setCart(newCart);
    const feitas = newCart.filter((c) => c.kind === "pizza").length;
    if (!plan.openEnded && plan.current < plan.total) { setPlan({ ...plan, current: plan.current + 1 }); showToast(`Pizza pronta! 🍕`); resetBuild(); go("sc-build"); }
    else if (plan.openEnded) { showToast("Pizza adicionada! 🍕"); go("sc-another"); }
    else { showToast("Tudo pronto! 🍕"); go("sc-cart"); }
  }
  function addAnother() { setPlan({ total: 0, current: pizzasNoCarrinho() + 1, openEnded: true }); resetBuild(); go("sc-build"); }
  function goCat(cat: "lanche" | "bebida" | "suco") { setListCat(cat); go("sc-list"); }
  function addSimple(it: { name: string; price: number }, emoji: string) {
    const ex = cart.find((c) => c.kind === "simple" && c.name === it.name);
    if (ex) { setCart(cart.map((c) => (c === ex ? { ...c, qty: c.qty + 1 } : c))); }
    else { setCart([...cart, { emoji, kind: "simple", name: it.name, detail: "", price: it.price, qty: 1 }]); }
    showToast(`${it.name} adicionado!`);
  }
  const cartTotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const cartCount = cart.reduce((s, i) => s + i.qty, 0);
  function chQty(idx: number, d: number) { setCart(cart.map((c, i) => (i === idx ? { ...c, qty: Math.max(1, c.qty + d) } : c))); }
  function rmItem(idx: number) { const nc = cart.filter((_, i) => i !== idx); setCart(nc); if (nc.length === 0) go("sc-start"); }
  const fee = delType === "delivery" && bairroIdx !== "" ? ((menu.neighborhoods || [])[+bairroIdx]?.fee ?? 0) : 0;
  const delOk = delType === "retirada" || (delType === "delivery" && bairroIdx !== "");
  const payOk = !!nome.trim() && !!payment;

  const esgotados = menu.esgotados || [];

  async function finish() {
    if (sending) return; setSending(true);
    const payload = { cliente: nome.trim(), itens: cart.map((c) => ({ kind: c.kind, name: c.name, detail: c.detail, price: c.price, qty: c.qty })), tipoEntrega: delType, bairro: delType === "delivery" ? menu.neighborhoods[+bairroIdx].name : undefined, endereco: delType === "delivery" ? rua : undefined, taxaEntrega: fee, pagamento: payment, troco: payment === "Dinheiro" && troco ? troco : undefined };
    try {
      const r = await fetch("/api/pedido-app", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await r.json();
      if (data.ok) { go("sc-done"); } else { showToast("Erro ao enviar. Tente de novo."); }
    } catch { showToast("Sem conexão. Tente de novo."); } finally { setSending(false); }
  }
  function resetAll() { setCart([]); resetBuild(); setDelType(null); setBairroIdx(""); setRua(""); setNome(""); setPayment(null); setTroco(""); go("sc-start"); }

  const stepMap: Record<string, number> = { "sc-start": 0, "sc-qty": 0, "sc-build": 0, "sc-border": 0, "sc-another": 0, "sc-list": 0, "sc-cart": 0, "sc-delivery": 1, "sc-pay": 2, "sc-done": 2 };
  const stepIdx = stepMap[screen] ?? 0;
  const STEPS = ["Itens", "Entrega", "Pagar"];
  const feitas = pizzasNoCarrinho();
  let ctxBadge = "", ctxTxt = "", ctxDots: { cls: string }[] = [];
  if (plan.openEnded) { ctxBadge = `Pizza ${feitas + 1}`; ctxTxt = feitas === 0 ? "Sua 1ª pizza" : `${feitas} já no carrinho`; }
  else if (plan.total > 0) { ctxBadge = `Pizza ${plan.current} de ${plan.total}`; ctxTxt = `Montando a pizza ${plan.current}`; for (let i = 1; i <= plan.total; i++) ctxDots.push({ cls: i < plan.current ? "done" : i === plan.current ? "cur" : "" }); }

  const PizzaCtx = () => (ctxBadge ? (
    <div className="pizza-ctx"><span className="pc-badge">{ctxBadge}</span><span className="pc-txt" dangerouslySetInnerHTML={{ __html: ctxTxt }} />{ctxDots.length > 0 && <span className="pizza-dots">{ctxDots.map((d, i) => <span key={i} className={`pd ${d.cls}`} />)}</span>}</div>
  ) : null);

  return (
    <>
      <style>{CSS}</style>
      <div className="wrap">
        <header>
          <div className="head-row">
            <div className="logo"><div className="logo-mark">🍕</div><div><h1>Chefe da Pizza</h1><p>Alto Alegre do MA</p></div></div>
            <button className="theme-btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Trocar tema">{theme === "dark" ? "🌙" : "☀️"}</button>
          </div>
          <div className="status"><span className="dot" /> Aberto · entrega 40–60 min</div>
        </header>
        <div className="steps">
          {STEPS.map((s, i) => (
            <span key={s} style={{ display: "contents" }}>
              <div className={`step-chip ${i === stepIdx ? "active" : i < stepIdx ? "done" : ""}`}><span className="num">{i < stepIdx ? "✓" : i + 1}</span>{s}</div>
              {i < STEPS.length - 1 && <div className={`step-line ${i < stepIdx ? "done" : ""}`} />}
            </span>
          ))}
        </div>
        <main>
          {screen === "sc-start" && (
            <section className="screen active">
              <div className="screen-head"><div className="eyebrow">Bora montar</div><h2>O que vai ser hoje?</h2><p>Escolha por onde começar.</p></div>
              <div className="opt" onClick={goPizza}><div className="opt-emoji">🍕</div><div className="opt-body"><div className="opt-title">Pizza</div><div className="opt-desc">{(menu.saltyFlavors || []).filter(f => !esgotados.includes(f)).length} salgadas, {(menu.sweetFlavors || []).filter(f => !esgotados.includes(f)).length} doces · meio a meio</div></div><div className="opt-price">{menu.sizes?.[0] ? money(menu.sizes[0].price) + "+" : ""}</div></div>
              <div className="opt" onClick={() => goCat("lanche")}><div className="opt-emoji">🥪</div><div className="opt-body"><div className="opt-title">Lanches & Porções</div><div className="opt-desc">Calzone, X-burguer, batata…</div></div></div>
              <div className="opt" onClick={() => goCat("bebida")}><div className="opt-emoji">🥤</div><div className="opt-body"><div className="opt-title">Bebidas</div><div className="opt-desc">Refri, guaraná, água, cerveja</div></div></div>
              <div className="opt" onClick={() => goCat("suco")}><div className="opt-emoji">🧃</div><div className="opt-body"><div className="opt-title">Sucos naturais</div><div className="opt-desc">Cajá, caju, maracujá…</div></div></div>
            </section>
          )}
          {screen === "sc-qty" && (
            <section className="screen active">
              <div className="screen-head"><div className="eyebrow">Pizza</div><h2>Quantas pizzas?</h2><p>Pode mudar depois, fica tranquilo.</p></div>
              <div className="grid2">
                <div className="opt" onClick={() => setPizzaQty(1)}><div className="opt-emoji">🍕</div><div className="opt-body"><div className="opt-title">1 pizza</div></div></div>
                <div className="opt" onClick={() => setPizzaQty(2)}><div className="opt-emoji">🍕🍕</div><div className="opt-body"><div className="opt-title">2 pizzas</div></div></div>
                <div className="opt" onClick={() => setPizzaQty(3)}><div className="opt-emoji">🍕🍕🍕</div><div className="opt-body"><div className="opt-title">3 pizzas</div></div></div>
                <div className="opt" onClick={() => setPizzaQty(0)}><div className="opt-emoji">➕</div><div className="opt-body"><div className="opt-title">Vou adicionando</div></div></div>
              </div>
              <div className="btn-row"><button className="btn btn-ghost btn-sm" onClick={() => go("sc-start")}>Voltar</button></div>
            </section>
          )}
          {screen === "sc-build" && (
            <section className="screen active">
              <PizzaCtx />
              <div className="screen-head"><div className="eyebrow">Monte sua pizza</div><h2>Tamanho e sabor</h2></div>
              <div className="section-label">📏 Tamanho</div>
              <div className="grid2">{(menu.sizes || []).map((s) => (<div key={s.code} className={`opt ${size === s.code ? "sel" : ""}`} onClick={() => pickSize(s.code)}><div className="opt-check" /><div className="opt-emoji">🍕</div><div className="opt-body"><div className="opt-title">{s.label}</div><div className="opt-desc">{money(s.price)}</div></div></div>))}</div>
              <div className="section-label">🍕 Sabor</div>
              <div className={`mam ${mam ? "on" : ""}`} onClick={toggleMam}><div className="mam-txt"><strong>Meio a meio</strong><p>Dois sabores numa pizza</p></div><div className="switch" /></div>
              {mam && <div className="half-hint show">{!f1 ? "Toque na 1ª metade" : !f2 ? `1ª: ${f1} — agora a 2ª` : `✓ ${f1} / ${f2}`}</div>}
              <div className="section-label">Salgadas</div>
              {(menu.saltyFlavors || []).map((f) => {
                const esg = esgotados.includes(f)
                return (
                  <div key={f} className={`opt ${f === f1 || f === f2 ? "sel" : ""} ${esg ? "esg" : ""}`} onClick={() => !esg && pickFlavor(f)} style={{ opacity: esg ? 0.5 : 1, cursor: esg ? "not-allowed" : "pointer" }}>
                    <div className="opt-emoji">🍕</div><div className="opt-body"><div className="opt-title">{f}</div>{esg && <div className="opt-desc" style={{ color: "#ef4444" }}>Esgotado</div>}</div><div className="opt-check" />
                  </div>
                )
              })}
              <div className="section-label">Doces</div>
              {(menu.sweetFlavors || []).map((f) => {
                const esg = esgotados.includes(f)
                return (
                  <div key={f} className={`opt ${f === f1 || f === f2 ? "sel" : ""}`} onClick={() => !esg && pickFlavor(f)} style={{ opacity: esg ? 0.5 : 1, cursor: esg ? "not-allowed" : "pointer" }}>
                    <div className="opt-emoji">🍕</div><div className="opt-body"><div className="opt-title">{f}</div>{esg && <div className="opt-desc" style={{ color: "#ef4444" }}>Esgotado</div>}</div><div className="opt-check" />
                  </div>
                )
              })}
              <div className="btn-row"><button className="btn btn-ghost btn-back" onClick={() => go("sc-qty")}>←</button><button className="btn btn-sm" disabled={!buildOk} onClick={() => go("sc-border")}>Escolher borda</button></div>
            </section>
          )}
          {screen === "sc-border" && (
            <section className="screen active">
              <PizzaCtx />
              <div className="screen-head"><div className="eyebrow">Quase pronta</div><h2>Borda recheada?</h2><p>Opcional.</p></div>
              <div className={`opt ${border === null ? "sel" : ""}`} onClick={() => pickBorder("")}><div className="opt-emoji">⭕</div><div className="opt-body"><div className="opt-title">Sem borda</div><div className="opt-desc">Tradicional</div></div><div className="opt-price">Grátis</div><div className="opt-check" /></div>
              {(menu.borders || []).map((b, i) => { const p = bigBorder(size!) ? b.priceLarge : b.priceSmall; return (<div key={i} className={`opt ${border === b.label ? "sel" : ""}`} onClick={() => pickBorder(String(i))}><div className="opt-emoji">🧀</div><div className="opt-body"><div className="opt-title">{b.label}</div></div><div className="opt-price">+{money(p)}</div><div className="opt-check" /></div>); })}
              <div className="btn-row"><button className="btn btn-ghost btn-back" onClick={() => go("sc-build")}>←</button><button className="btn btn-sm" onClick={addPizza}>Adicionar ao pedido</button></div>
            </section>
          )}
          {screen === "sc-another" && (
            <section className="screen active">
              <div className="screen-head"><div className="eyebrow">Pizza adicionada ✓</div><h2>Mais uma pizza?</h2><p>{pizzasNoCarrinho()} pizza{pizzasNoCarrinho() > 1 ? "s" : ""} no pedido</p></div>
              <div className="opt" onClick={addAnother}><div className="opt-emoji">🍕</div><div className="opt-body"><div className="opt-title">Montar outra pizza</div></div></div>
              <div className="opt" onClick={() => go("sc-start")}><div className="opt-emoji">🥤</div><div className="opt-body"><div className="opt-title">Adicionar bebida ou lanche</div></div></div>
              <div className="opt" onClick={() => go("sc-cart")}><div className="opt-emoji">✅</div><div className="opt-body"><div className="opt-title">Pronto, ver meu pedido</div></div></div>
            </section>
          )}
          {screen === "sc-list" && (
            <section className="screen active">
              {(() => {
                const cfg = { lanche: { eb: "Lanches & Porções", t: "Escolha seu lanche", data: menu.lanches || [], emoji: "🍽️" }, bebida: { eb: "Bebidas", t: "Bebidas geladas", data: menu.bebidas || [], emoji: "🥤" }, suco: { eb: "Sucos naturais", t: "Sucos da casa", data: menu.sucos || [], emoji: "🧃" } }[listCat];
                return (<><div className="screen-head"><div className="eyebrow">{cfg.eb}</div><h2>{cfg.t}</h2><p>Toque para adicionar.</p></div>{cfg.data.map((it, i) => { const esg = esgotados.includes(it.name); return (<div key={i} className="opt" onClick={() => !esg && addSimple(it, cfg.emoji)} style={{ opacity: esg ? 0.5 : 1, cursor: esg ? "not-allowed" : "pointer" }}><div className="opt-emoji">{cfg.emoji}</div><div className="opt-body"><div className="opt-title">{it.name}</div>{esg && <div className="opt-desc" style={{ color: "#ef4444" }}>Esgotado</div>}</div><div className="opt-price">{money(it.price)}</div></div>); })}<div className="btn-row"><button className="btn btn-ghost btn-sm" onClick={() => go("sc-start")}>Voltar ao início</button></div></>);
              })()}
            </section>
          )}
          {screen === "sc-cart" && (
            <section className="screen active">
              <div className="screen-head"><div className="eyebrow">Seu pedido</div><h2>Confira tudo</h2></div>
              {cart.length === 0 ? (<div className="empty"><div className="big">🛒</div><div>Seu pedido está vazio.</div></div>) : (
                <>{(() => { let pn = 0; return cart.map((it, i) => { let tag = null; if (it.kind === "pizza") { pn++; tag = <span className="ci-tag">Pizza {pn}</span>; } const nm = it.kind === "pizza" ? it.name.replace(/^Pizza /, "") : it.name; return (<div key={i} className="cart-item"><div className="ci-emoji">{it.emoji}</div><div className="ci-body"><div className="ci-name">{tag}{nm}{it.qty > 1 ? ` ×${it.qty}` : ""}</div>{it.detail && <div className="ci-detail">{it.detail}</div>}<div className="ci-price">{money(it.price * it.qty)}</div>{it.kind === "simple" && (<div className="qty-pill"><button onClick={() => chQty(i, -1)}>−</button><span>{it.qty}</span><button onClick={() => chQty(i, 1)}>+</button></div>)}</div><button className="ci-remove" onClick={() => rmItem(i)}>✕</button></div>); }); })()}<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 4px 4px", fontFamily: "Fraunces,serif", fontWeight: 900, fontSize: 20 }}><span>Subtotal</span><span>{money(cartTotal)}</span></div></>
              )}
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 4 }} onClick={() => go("sc-start")}>+ Adicionar mais</button>
              {cart.length > 0 && <button className="btn" style={{ marginTop: 11 }} onClick={() => go("sc-delivery")}>Ir para entrega</button>}
            </section>
          )}
          {screen === "sc-delivery" && (
            <section className="screen active">
              <div className="screen-head"><div className="eyebrow">Entrega</div><h2>Como prefere receber?</h2></div>
              <div className={`opt ${delType === "delivery" ? "sel" : ""}`} onClick={() => setDelType("delivery")}><div className="opt-emoji">🛵</div><div className="opt-body"><div className="opt-title">Entrega (delivery)</div><div className="opt-desc">Levamos até você</div></div><div className="opt-check" /></div>
              <div className={`opt ${delType === "retirada" ? "sel" : ""}`} onClick={() => { setDelType("retirada"); setBairroIdx(""); }}><div className="opt-emoji">🏪</div><div className="opt-body"><div className="opt-title">Buscar na loja</div><div className="opt-desc">Sem taxa de entrega</div></div><div className="opt-check" /></div>
              {delType === "delivery" && (<div><div className="section-label">Endereço</div><div className="field"><label>Bairro</label><select value={bairroIdx} onChange={(e) => setBairroIdx(e.target.value)}><option value="">Selecione o bairro…</option>{(menu.neighborhoods || []).map((b, i) => <option key={i} value={i}>{b.name} — {money(b.fee)}</option>)}</select></div><div className="field"><label>Rua, número e referência</label><input value={rua} onChange={(e) => setRua(e.target.value)} placeholder="Rua das Flores, 123 — perto do mercado" /></div></div>)}
              <div className="btn-row"><button className="btn btn-ghost btn-back" onClick={() => go("sc-cart")}>←</button><button className="btn btn-sm" disabled={!delOk} onClick={() => go("sc-pay")}>Continuar</button></div>
            </section>
          )}
          {screen === "sc-pay" && (
            <section className="screen active">
              <div className="screen-head"><div className="eyebrow">Pagamento</div><h2>Quase lá!</h2></div>
              <div className="field"><label>Seu nome</label><input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Como te chamamos?" /></div>
              <div className="section-label">Forma de pagamento</div>
              {(menu.payments || []).map((p) => { const e: Record<string, string> = { Pix: "⚡", Dinheiro: "💵", Cartao: "💳" }; return (<div key={p} className={`opt ${payment === p ? "sel" : ""}`} onClick={() => setPayment(p)}><div className="opt-emoji">{e[p] || "💰"}</div><div className="opt-body"><div className="opt-title">{p === "Cartao" ? "Cartão" : p}</div></div><div className="opt-check" /></div>); })}
              {payment === "Dinheiro" && <div className="field" style={{ marginTop: 8 }}><label>Troco para quanto?</label><input value={troco} onChange={(e) => setTroco(e.target.value)} inputMode="numeric" placeholder="Ex: 50" /></div>}
              <div className="btn-row"><button className="btn btn-ghost btn-back" onClick={() => go("sc-delivery")}>←</button><button className="btn btn-sm" disabled={!payOk || sending} onClick={finish}>{sending ? "Enviando…" : "Enviar pedido"}</button></div>
            </section>
          )}
          {screen === "sc-done" && (
            <section className="screen active">
              <div className="success"><div className="check">✓</div><h2>Pedido enviado!</h2><p>Valeu, {nome.split(" ")[0]}! 🍕</p><p>A pizzaria já recebeu e vai preparar.</p><button className="btn" style={{ marginTop: 22 }} onClick={resetAll}>Fazer outro pedido</button></div>
            </section>
          )}
        </main>
      </div>
      {cartCount > 0 && screen !== "sc-done" && (<div className="cartbar show"><div className="cartbar-inner"><div className="cartbar-info"><div className="cartbar-count">{cartCount} {cartCount === 1 ? "item" : "itens"}</div><div className="cartbar-total">{money(cartTotal)}</div></div><button className="btn" onClick={() => go("sc-cart")}>Ver pedido</button></div></div>)}
      {toast && <div className="toast show">{toast}</div>}
    </>
  )
}

// ==================== ROOT ====================

export default function CardapioPage() {
  const [menu, setMenu] = useState<MenuType | null>(null);
  const [erro, setErro] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    fetch("/api/cardapio")
      .then((r) => { if (!r.ok) throw new Error("api error"); return r.json(); })
      .then((data) => {
        if (data && typeof data === "object") setMenu(data);
        else setErro(true);
      })
      .catch(() => setErro(true));

    try {
      const cookies = document.cookie.split(";")
      for (const c of cookies) {
        const t = c.trim()
        if (t.startsWith("auth-user=")) {
          const raw = t.substring("auth-user=".length)
          let decoded = raw
          try { decoded = decodeURIComponent(raw) } catch {}
          const user = JSON.parse(decoded)
          if (user && (user.role === "admin" || user.role === "atendente" || user.role === "dev")) {
            setIsAdmin(true)
          }
        }
      }
    } catch {}
  }, []);

  if (erro) return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, background: "#060606", color: "#f5f2ee", fontFamily: "system-ui", padding: 24 }}>
      <div style={{ fontSize: 40 }}>🍕</div>
      <p style={{ fontWeight: 700, fontSize: 16, margin: 0 }}>Não foi possível carregar o cardápio.</p>
      <button onClick={() => { setErro(false); fetch("/api/cardapio").then(r => r.json()).then(setMenu).catch(() => setErro(true)); }} style={{ border: "1px solid #333", background: "transparent", color: "#f5f2ee", padding: "10px 20px", borderRadius: 10, cursor: "pointer", fontSize: 14 }}>Tentar de novo</button>
    </div>
  );

  if (!menu) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#060606", color: "#f5f2ee", fontFamily: "system-ui" }}>
      <div style={{ textAlign: "center" }}><div style={{ fontSize: 36, marginBottom: 12 }}>🍕</div><p>Carregando cardápio…</p></div>
    </div>
  );

  if (isAdmin) return <AdminCardapio menu={menu} onSair={() => setIsAdmin(false)} />;
  return <PublicCardapio menu={menu} />;
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,900&family=DM+Sans:wght@400;500;600;700&display=swap');
:root[data-theme="dark"]{--bg:#171210;--surface:#221b18;--surface2:#2c2320;--text:#f6efe7;--text-sub:#a89a8b;--text-faint:#6f655c;--brand:#f0512f;--brand-press:#d2421f;--brand-soft:rgba(240,81,47,.13);--gold:#edb24a;--green:#62a256;--green-soft:rgba(98,162,86,.16);--line:rgba(246,239,231,.08);--line-strong:rgba(246,239,231,.16);--shadow-sm:0 2px 10px rgba(0,0,0,.25);}
:root[data-theme="light"]{--bg:#f7f2ea;--surface:#fff;--surface2:#fbf6ee;--text:#2a1d16;--text-sub:#8a7a6c;--text-faint:#b3a596;--brand:#e8472b;--brand-press:#c2371f;--brand-soft:rgba(232,71,43,.09);--gold:#c98a17;--green:#4f8a43;--green-soft:rgba(79,138,67,.12);--line:rgba(42,29,22,.08);--line-strong:rgba(42,29,22,.14);--shadow-sm:0 2px 12px rgba(120,80,40,.08);}
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{font-family:'DM Sans',system-ui,sans-serif;background:var(--bg);color:var(--text);line-height:1.5;overflow-x:hidden;padding-bottom:104px;transition:background .35s,color .35s}
.wrap{max-width:540px;margin:0 auto;min-height:100vh;position:relative}
header{background:var(--surface);padding:18px 20px;position:sticky;top:0;z-index:40;border-bottom:1px solid var(--line);transition:background .35s}
.head-row{display:flex;align-items:center;justify-content:space-between;gap:12px}
.logo{display:flex;align-items:center;gap:11px}
.logo-mark{width:42px;height:42px;border-radius:13px;background:var(--brand);display:flex;align-items:center;justify-content:center;font-size:22px;box-shadow:0 4px 14px var(--brand-soft)}
.logo h1{font-family:'Fraunces',serif;font-weight:900;font-size:21px;letter-spacing:-.5px;line-height:1}
.logo p{font-size:12px;color:var(--text-sub);margin-top:2px}
.theme-btn{width:40px;height:40px;border-radius:12px;border:1px solid var(--line-strong);background:var(--surface2);color:var(--text);font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:.2s}
.theme-btn:active{transform:scale(.92)}
.status{display:inline-flex;align-items:center;gap:7px;margin-top:13px;background:var(--green-soft);color:var(--green);padding:5px 11px;border-radius:20px;font-size:12px;font-weight:600}
.status .dot{width:7px;height:7px;border-radius:50%;background:var(--green);animation:pulse 2s infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 var(--green-soft)}70%{box-shadow:0 0 0 7px transparent}100%{box-shadow:0 0 0 0 transparent}}
.steps{display:flex;gap:8px;padding:16px 20px 2px;align-items:center}
.step-chip{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:600;color:var(--text-faint)}
.step-chip .num{width:22px;height:22px;border-radius:50%;border:1.5px solid var(--line-strong);display:flex;align-items:center;justify-content:center;font-size:11px;transition:.25s}
.step-chip.active{color:var(--text)}
.step-chip.active .num{background:var(--brand);border-color:var(--brand);color:#fff}
.step-chip.done{color:var(--green)}
.step-chip.done .num{background:var(--green);border-color:var(--green);color:#fff}
.step-line{flex:1;height:1.5px;background:var(--line);border-radius:2px}
.step-line.done{background:var(--green)}
main{padding:6px 20px 20px}
.screen.active{display:block;animation:slide .4s cubic-bezier(.2,.8,.2,1)}
@keyframes slide{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:none}}
.screen-head{margin:16px 0 18px}
.eyebrow{font-size:11.5px;font-weight:700;color:var(--brand);text-transform:uppercase;letter-spacing:1.2px}
.screen-head h2{font-family:'Fraunces',serif;font-weight:600;font-size:25px;letter-spacing:-.4px;margin-top:5px;line-height:1.15}
.screen-head p{font-size:14px;color:var(--text-sub);margin-top:6px}
.pizza-ctx{display:flex;align-items:center;gap:11px;background:var(--brand-soft);border-radius:14px;padding:12px 15px;margin:16px 0 2px}
.pc-badge{background:var(--brand);color:#fff;font-weight:700;font-size:12px;padding:5px 11px;border-radius:20px;white-space:nowrap}
.pc-txt{font-size:13px;color:var(--text-sub);flex:1}
.pc-txt strong{color:var(--text);font-weight:600}
.pizza-dots{display:flex;gap:5px}
.pd{width:7px;height:7px;border-radius:50%;background:var(--line-strong)}
.pd.done{background:var(--green)}.pd.cur{background:var(--brand);transform:scale(1.3)}
.opt{background:var(--surface);border:1.5px solid var(--line);border-radius:16px;padding:16px;margin-bottom:11px;cursor:pointer;display:flex;align-items:center;gap:14px;transition:transform .14s,border-color .14s,background .14s;box-shadow:var(--shadow-sm)}
.opt:active{transform:scale(.98)}
.opt.sel{border-color:var(--brand);background:var(--brand-soft)}
.opt-emoji{font-size:27px;flex:0 0 auto;width:32px;text-align:center}
.opt-body{flex:1;min-width:0}
.opt-title{font-weight:600;font-size:15.5px}
.opt-desc{font-size:12.5px;color:var(--text-sub);margin-top:2px;line-height:1.35}
.opt-price{font-weight:700;font-size:14.5px;color:var(--gold);white-space:nowrap}
.opt-check{width:23px;height:23px;border-radius:50%;border:2px solid var(--line-strong);flex:0 0 auto;display:flex;align-items:center;justify-content:center;font-size:13px;color:#fff;transition:.16s}
.opt.sel .opt-check{background:var(--brand);border-color:var(--brand)}
.opt.sel .opt-check::after{content:"✓"}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:11px}
.grid2 .opt{flex-direction:column;align-items:flex-start;gap:7px;padding:17px;position:relative}
.grid2 .opt-check{position:absolute;top:13px;right:13px;width:20px;height:20px}
.grid2 .opt-emoji{width:auto}
.section-label{font-size:12px;font-weight:700;color:var(--text-sub);text-transform:uppercase;letter-spacing:.8px;margin:20px 0 10px;display:flex;align-items:center;gap:7px}
.mam{display:flex;align-items:center;justify-content:space-between;background:var(--surface);border:1.5px solid var(--line);border-radius:16px;padding:15px 16px;margin-bottom:14px;cursor:pointer;box-shadow:var(--shadow-sm)}
.mam.on{border-color:var(--brand);background:var(--brand-soft)}
.mam-txt strong{font-weight:600;font-size:15px}
.mam-txt p{font-size:12px;color:var(--text-sub);margin-top:1px}
.switch{width:48px;height:28px;border-radius:20px;background:var(--line-strong);position:relative;flex:0 0 auto;transition:.22s}
.switch::after{content:"";position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;transition:.22s;box-shadow:0 1px 3px rgba(0,0,0,.3)}
.mam.on .switch{background:var(--brand)}
.mam.on .switch::after{left:23px}
.half-hint{font-size:13px;color:var(--gold);margin:-4px 0 12px;font-weight:600;padding-left:2px}
.btn{width:100%;background:var(--brand);color:#fff;border:none;border-radius:15px;padding:17px;font-family:'DM Sans';font-size:15.5px;font-weight:700;cursor:pointer;transition:transform .14s,background .14s;box-shadow:0 6px 18px var(--brand-soft)}
.btn:active{transform:scale(.98);background:var(--brand-press)}
.btn:disabled{opacity:.35;box-shadow:none;cursor:not-allowed}
.btn-ghost{background:transparent;border:1.5px solid var(--line-strong);color:var(--text);box-shadow:none}
.btn-row{display:flex;gap:11px;margin-top:16px}
.btn-row .btn{margin:0}
.btn-sm{padding:15px;font-size:14.5px}
.btn-back{flex:0 0 auto;width:54px;padding:15px 0}
.cart-item{background:var(--surface);border:1px solid var(--line);border-radius:15px;padding:14px 15px;margin-bottom:10px;display:flex;gap:12px;align-items:flex-start;box-shadow:var(--shadow-sm)}
.ci-emoji{font-size:23px}
.ci-body{flex:1;min-width:0}
.ci-tag{background:var(--brand-soft);color:var(--brand);font-size:11px;font-weight:700;padding:2px 9px;border-radius:20px;margin-right:7px}
.ci-name{font-weight:600;font-size:14.5px}
.ci-detail{font-size:12.5px;color:var(--text-sub);margin-top:3px}
.ci-price{font-weight:700;color:var(--gold);font-size:14px;margin-top:5px}
.ci-remove{background:none;border:none;color:var(--text-faint);font-size:18px;cursor:pointer;padding:2px 4px;line-height:1}
.qty-pill{display:inline-flex;align-items:center;gap:14px;background:var(--surface2);border:1px solid var(--line);border-radius:30px;padding:5px 7px;margin-top:9px}
.qty-pill button{width:30px;height:30px;border-radius:50%;border:none;background:var(--brand);color:#fff;font-size:18px;cursor:pointer;font-weight:700}
.qty-pill span{font-weight:700;min-width:20px;text-align:center}
.field{margin-bottom:14px}
.field label{display:block;font-size:13px;font-weight:600;margin-bottom:7px}
.field input,.field select{width:100%;background:var(--surface);border:1.5px solid var(--line-strong);border-radius:13px;padding:14px;color:var(--text);font-family:'DM Sans';font-size:15px;transition:.16s}
.field input:focus,.field select:focus{outline:none;border-color:var(--brand)}
.cartbar{position:fixed;bottom:0;left:0;right:0;z-index:50;background:var(--surface);border-top:1px solid var(--line);padding:14px 20px;box-shadow:0 -6px 24px rgba(0,0,0,.12)}
.cartbar-inner{max-width:540px;margin:0 auto;display:flex;align-items:center;gap:14px}
.cartbar-info{flex:1}
.cartbar-count{font-size:12px;color:var(--text-sub);font-weight:600}
.cartbar-total{font-family:'Fraunces',serif;font-weight:900;font-size:22px;line-height:1.1}
.cartbar .btn{margin:0;width:auto;padding:15px 24px}
.empty{text-align:center;padding:54px 20px;color:var(--text-sub)}
.empty .big{font-size:56px;margin-bottom:14px;opacity:.4}
.success{text-align:center;padding:34px 8px}
.success .check{width:80px;height:80px;border-radius:50%;background:var(--green);margin:0 auto 20px;display:flex;align-items:center;justify-content:center;font-size:42px;color:#fff;animation:pop .55s cubic-bezier(.2,1.4,.4,1)}
@keyframes pop{from{transform:scale(0)}to{transform:scale(1)}}
.success h2{font-family:'Fraunces',serif;font-weight:600;font-size:27px;margin-bottom:9px}
.success p{color:var(--text-sub);font-size:14.5px;margin-bottom:5px}
.toast{position:fixed;bottom:116px;left:50%;transform:translateX(-50%);background:var(--green);color:#fff;padding:12px 22px;border-radius:30px;font-size:13.5px;font-weight:600;z-index:60;white-space:nowrap}
`;
