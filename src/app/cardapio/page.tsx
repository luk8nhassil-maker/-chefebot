"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import PanelShell from "@/components/PanelShell";
import { useLiveMenu, cartItemEsgotado } from "./liveMenu";

type EsgMetadata = Record<string, { desde: string; ultimaRevisao?: string }>

export type MenuType = {
  sizes: { code: string; label: string; price: number }[];
  saltyFlavors: string[];
  sweetFlavors: string[];
  miniPizzaFlavors?: string[];
  lanches: { name: string; price: number; sizes?: { code: string; price: number }[] }[];
  bebidas: { name: string; price: number }[];
  sucos: { name: string; price: number }[];
  borders: { label: string; priceSmall: number; priceLarge: number }[];
  neighborhoods: { name: string; fee: number }[];
  payments: string[];
  esgotados?: string[];
  esgotadosMetadata?: EsgMetadata;
};

// ==================== ADMIN CARDÁPIO ====================

type Produto = { nome: string; categoria: string; preco?: number }

function normStr(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
}

function AdminCardapio({ menu, onSair }: { menu: MenuType; onSair: () => void }) {
  const router = useRouter()
  const [esgotados, setEsgotados] = useState<string[]>(menu.esgotados || [])
  const [esgotadosMetadata, setEsgotadosMetadata] = useState<EsgMetadata>(menu.esgotadosMetadata || {})
  const [salvando, setSalvando] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<{ msg: string; nome: string; era: boolean } | null>(null)
  const [busca, setBusca] = useState("")
  const [filtroStatus, setFiltroStatus] = useState<"todos" | "disponivel" | "esgotado">("todos")
  const [filtroCat, setFiltroCat] = useState("todas")
  const [modoSel, setModoSel] = useState(false)
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [confirmLote, setConfirmLote] = useState<"esgotado" | "disponivel" | null>(null)
  const [conversasBadge, setConversasBadge] = useState(0)
  const toastTimer = useRef<any>(null)

  const hojeStr = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })

  // Badge conversas pendentes
  useEffect(() => {
    const atualizar = () => {
      fetch("/api/orders")
        .then(r => r.ok ? r.json() : [])
        .then((data: any[]) => {
          if (Array.isArray(data)) {
            setConversasBadge(data.filter((p: any) => p.escalonado && p.status === "novo").length)
          }
        })
        .catch(() => {})
    }
    atualizar()
    const iv = setInterval(atualizar, 20000)
    return () => clearInterval(iv)
  }, [])

  // Bebidas + Sucos unificados numa categoria só
  const todos: Produto[] = [
    ...(menu.saltyFlavors || []).map(f => ({ nome: f, categoria: "Salgados" })),
    ...(menu.sweetFlavors || []).map(f => ({ nome: f, categoria: "Doces" })),
    ...(menu.lanches || []).map(l => ({ nome: l.name, categoria: "Lanches", preco: l.price > 0 ? l.price : undefined })),
    ...(menu.bebidas || []).map(b => ({ nome: b.name, categoria: "Bebidas", preco: b.price })),
    ...(menu.sucos || []).map(s => ({ nome: s.name, categoria: "Bebidas", preco: s.price })),
    ...(menu.borders || []).map(b => ({ nome: b.label, categoria: "Bordas" })),
  ]

  const CATS = ["todas", "Salgados", "Doces", "Lanches", "Bebidas", "Bordas"].filter(
    c => c === "todas" || todos.some(p => p.categoria === c)
  )
  const CAT_ICON: Record<string, string> = { todas: "Tudo", Salgados: "🍕", Doces: "🍬", Lanches: "🍔", Bebidas: "🥤", Bordas: "🧀" }

  const totalProd = todos.length
  const totalEsg = esgotados.filter(e => todos.some(p => p.nome === e)).length
  const totalDisp = totalProd - totalEsg

  const produtosParaRevisar = esgotados.filter(nome => {
    const meta = esgotadosMetadata[nome]
    if (!meta) return false
    return meta.desde !== hojeStr && (!meta.ultimaRevisao || meta.ultimaRevisao !== hojeStr)
  }).filter(nome => todos.some(p => p.nome === nome))

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
        if (d.esgotadosMetadata) setEsgotadosMetadata(d.esgotadosMetadata)
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

  async function revisarHoje(nome: string) {
    try {
      const r = await fetch("/api/cardapio", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome, revisaoHoje: true }),
      })
      const d = await r.json()
      if (d.ok && d.esgotadosMetadata) setEsgotadosMetadata(d.esgotadosMetadata)
    } catch {}
  }

  async function aplicarLote(esgotado: boolean) {
    setConfirmLote(null)
    const nomes = Array.from(selecionados)
    for (const nome of nomes) await toggleEsgotado(nome, esgotado, false)
    const count = nomes.length
    setSelecionados(new Set())
    setModoSel(false)
    clearTimeout(toastTimer.current)
    const msg = esgotado
      ? `${count} produto${count > 1 ? "s" : ""} marcado${count > 1 ? "s" : ""} como esgotado${count > 1 ? "s" : ""}. O bot não vai vender.`
      : `${count} produto${count > 1 ? "s" : ""} voltou${count > 1 ? "ram" : ""} a ficar disponíve${count > 1 ? "is" : "l"}. O bot já pode vender.`
    setToast({ msg, nome: "", era: !esgotado })
    toastTimer.current = setTimeout(() => setToast(null), 4500)
  }

  async function copiarLinkCliente() {
    const url = `${window.location.origin}/pedido`
    let ok = false
    try { await navigator.clipboard.writeText(url); ok = true } catch {}
    if (!ok) {
      try {
        const ta = document.createElement("textarea")
        ta.value = url
        ta.style.position = "fixed"
        ta.style.opacity = "0"
        document.body.appendChild(ta)
        ta.select()
        ok = document.execCommand("copy")
        document.body.removeChild(ta)
      } catch {}
    }
    clearTimeout(toastTimer.current)
    setToast({ msg: ok ? "Link copiado" : `Não consegui copiar. Link: ${url}`, nome: "", era: false })
    toastTimer.current = setTimeout(() => setToast(null), 4500)
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800;900&display=swap');
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        html, body { margin: 0; padding: 0; background: #060606; }
        button { cursor: pointer; font-family: 'Archivo', sans-serif; border: none; }
        @keyframes cbToastIn { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:none} }
        @keyframes cbFadeIn { from{opacity:0} to{opacity:1} }
        @keyframes cbSheetUp { from{transform:translateY(100%)} to{transform:none} }
        .cbBusca::placeholder { color: #383430; }
        .cbBusca:focus { border-color: rgba(255,107,0,.6) !important; outline: none; }
        .cbScroll { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; }
        .cbScroll::-webkit-scrollbar { display: none; }
        .cbItem:active { opacity: 0.8; }
        .cbBtn:active { opacity: 0.75; }
        .cb-header { background:#060606; border-bottom:1px solid #1a1816; padding:calc(env(safe-area-inset-top) + 10px) 16px 10px; position:sticky; top:0; z-index:10; }
        .cb-main { }
        .cbCardGrid { display:flex; flex-direction:column; }
        .cbGridFull {}
        @media (min-width: 768px) {
          .cb-header { border-bottom:1px solid #1a1816; padding:24px 28px 20px; position:static; }
          .cb-main { padding:20px 28px; }
          .cbCardGrid { display:grid !important; grid-template-columns:1fr 1fr !important; gap:8px !important; }
          .cbGridFull { grid-column:1/-1; }
        }
        @media (min-width: 1100px) {
          .cbCardGrid { grid-template-columns:1fr 1fr 1fr !important; }
        }
      `}</style>

      <PanelShell conversasCount={conversasBadge}>

        {/* ── HEADER ── */}
        <header className="cb-header">

          {/* Linha 1: título + botões */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ flex: 1, fontSize: 19, fontWeight: 900, letterSpacing: "-0.5px" }}>Cardápio</span>
            <button
              onClick={() => { setModoSel(!modoSel); setSelecionados(new Set()) }}
              style={{
                height: 32, padding: "0 11px",
                border: `1px solid ${modoSel ? "rgba(255,107,0,.6)" : "#272320"}`,
                borderRadius: 9,
                background: modoSel ? "rgba(255,107,0,.12)" : "transparent",
                color: modoSel ? "#ff6b00" : "#56524b",
                fontSize: 12, fontWeight: 900,
              }}
            >{modoSel ? "Cancelar" : "Selecionar"}</button>
            <a
              href="/pedido"
              target="_blank"
              rel="noopener noreferrer"
              style={{ height: 32, padding: "0 11px", border: "1px solid #1f1d1a", borderRadius: 9, background: "transparent", color: "#4a4640", fontSize: 12, fontWeight: 700, display: "inline-flex", alignItems: "center", textDecoration: "none" }}
            >🌐 Link cliente</a>
            <button
              onClick={copiarLinkCliente}
              title="Copiar link do cliente"
              aria-label="Copiar link do cliente"
              style={{ height: 32, width: 32, padding: 0, border: "1px solid #1f1d1a", borderRadius: 9, background: "transparent", color: "#4a4640", fontSize: 13, fontWeight: 700 }}
            >📋</button>
            <button
              onClick={onSair}
              style={{ height: 32, padding: "0 11px", border: "1px solid #1f1d1a", borderRadius: 9, background: "transparent", color: "#4a4640", fontSize: 12, fontWeight: 700 }}
            >Sair</button>
          </div>

          <a href="/cardapio/promocoes" style={{ display: "block", textAlign: "center", padding: "9px 0", marginBottom: 10, border: "1px solid #272320", borderRadius: 10, background: "#0c0c0c", color: "#c9c2b4", fontSize: 12.5, fontWeight: 800, textDecoration: "none" }}>🏷️ Gerenciar promoções</a>

          {/* Linha 2: métricas compactas */}
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <div style={{ flex: 1, background: "#0c0c0c", border: "1px solid #1e1c19", borderRadius: 10, padding: "8px 10px", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 900, color: "#f4f1ec" }}>{totalDisp}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#4a4640", textTransform: "uppercase", letterSpacing: ".4px" }}>disponíveis</span>
            </div>
            <div style={{
              flex: 1,
              background: totalEsg > 0 ? "rgba(239,68,68,.05)" : "#0c0c0c",
              border: `1px solid ${totalEsg > 0 ? "rgba(239,68,68,.22)" : "#1e1c19"}`,
              borderRadius: 10, padding: "8px 10px", display: "flex", alignItems: "center", gap: 8,
            }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: totalEsg > 0 ? "#ef4444" : "#2e2b26", flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 900, color: totalEsg > 0 ? "#ef4444" : "#3a3730" }}>{totalEsg}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: totalEsg > 0 ? "rgba(239,68,68,.6)" : "#3a3730", textTransform: "uppercase", letterSpacing: ".4px" }}>esgotados</span>
            </div>
            <div style={{ flex: 0, background: "#0c0c0c", border: "1px solid #1e1c19", borderRadius: 10, padding: "8px 12px", display: "flex", alignItems: "center" }}>
              <span style={{ fontSize: 13, fontWeight: 900, color: "#4a4640" }}>{totalProd}</span>
            </div>
          </div>

          {/* Aviso bot — só quando há esgotados */}
          {totalEsg > 0 && (
            <div style={{ background: "rgba(239,68,68,.05)", border: "1px solid rgba(239,68,68,.15)", borderRadius: 9, padding: "7px 11px", marginBottom: 10, fontSize: 12, fontWeight: 700, color: "#f87171" }}>
              Bot bloqueando {totalEsg} produto{totalEsg > 1 ? "s" : ""} — cliente{totalEsg > 1 ? "s" : ""} não {totalEsg > 1 ? "receberão" : "receberá"} esse{totalEsg > 1 ? "s" : ""} item{totalEsg > 1 ? "ns" : ""}.
            </div>
          )}

          {/* Linha 3: busca */}
          <div style={{ position: "relative", marginBottom: 8 }}>
            <input
              className="cbBusca"
              type="text"
              placeholder="Buscar produto..."
              value={busca}
              onChange={e => setBusca(e.target.value)}
              style={{
                width: "100%", height: 44,
                background: "#0d0d0d",
                border: "1px solid #252220",
                borderRadius: 11,
                padding: "0 38px 0 13px",
                color: "#f5f2ee",
                fontSize: 14, fontWeight: 700,
                fontFamily: "'Archivo', sans-serif",
                transition: "border-color .15s",
              }}
            />
            {busca
              ? <button onClick={() => setBusca("")} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", color: "#56524b", fontSize: 19, lineHeight: 1, padding: "2px 5px" }}>×</button>
              : <svg style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="#343028" strokeWidth="2.2"/><path d="M16.5 16.5l3.5 3.5" stroke="#343028" strokeWidth="2.2" strokeLinecap="round"/></svg>
            }
          </div>

          {/* Linha 4: filtros status */}
          <div style={{ display: "flex", gap: 5, marginBottom: 7 }}>
            {(["todos", "disponivel", "esgotado"] as const).map(f => {
              const COUNT = { todos: totalProd, disponivel: totalDisp, esgotado: totalEsg }
              const LABEL = { todos: "Todos", disponivel: "Disponíveis", esgotado: "Esgotados" }
              const COLOR = { todos: "#ff6b00", disponivel: "#22c55e", esgotado: "#ef4444" }
              const active = filtroStatus === f
              return (
                <button
                  key={f}
                  onClick={() => setFiltroStatus(f)}
                  style={{
                    flex: 1, height: 38,
                    border: `1px solid ${active ? COLOR[f] + "66" : "#1f1d1a"}`,
                    borderRadius: 10,
                    background: active ? COLOR[f] + "18" : "transparent",
                    color: active ? COLOR[f] : "#4a4640",
                    fontSize: 11, fontWeight: 900,
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 0,
                  }}
                >
                  <span style={{ fontSize: 15, fontWeight: 900, lineHeight: 1.1 }}>{COUNT[f]}</span>
                  <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".2px", opacity: .85 }}>{LABEL[f]}</span>
                </button>
              )
            })}
          </div>

          {/* Linha 5: filtros categoria */}
          <div className="cbScroll">
            {CATS.map(cat => {
              const active = filtroCat === cat
              return (
                <button
                  key={cat}
                  onClick={() => setFiltroCat(cat)}
                  style={{
                    height: 29, padding: "0 11px",
                    border: `1px solid ${active ? "rgba(255,107,0,.55)" : "#1f1d1a"}`,
                    borderRadius: 8,
                    background: active ? "rgba(255,107,0,.14)" : "#0c0c0c",
                    color: active ? "#ff6b00" : "#56524b",
                    fontSize: 11, fontWeight: 900,
                    whiteSpace: "nowrap", flexShrink: 0,
                  }}
                >{CAT_ICON[cat] || cat}</button>
              )
            })}
          </div>
        </header>

        {/* Barra de lote (quando há selecionados) */}
        {modoSel && selecionados.size > 0 && (
          <div style={{ flexShrink: 0, background: "#0e0c0a", borderBottom: "1px solid #1f1d1a", padding: "9px 16px", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 800, color: "#c9c2b4" }}>{selecionados.size} selecionado{selecionados.size > 1 ? "s" : ""}</span>
            <button onClick={() => setConfirmLote("esgotado")} style={{ height: 34, padding: "0 12px", border: "1px solid rgba(239,68,68,.3)", borderRadius: 9, background: "rgba(239,68,68,.08)", color: "#ef4444", fontSize: 12, fontWeight: 900 }}>Esgotar</button>
            <button onClick={() => setConfirmLote("disponivel")} style={{ height: 34, padding: "0 12px", border: "1px solid rgba(34,197,94,.3)", borderRadius: 9, background: "rgba(34,197,94,.08)", color: "#22c55e", fontSize: 12, fontWeight: 900 }}>Disponibilizar</button>
          </div>
        )}

        {/* ── LISTA ── */}
        <main
          className="cb-main cbCardGrid"
          style={{ padding: "8px 16px 28px", display: "flex", flexDirection: "column", gap: 6 }}
        >
          {/* Verificar reposição */}
          {produtosParaRevisar.length > 0 && (
            <div className="cbGridFull" style={{ background: "rgba(250,204,21,.04)", border: "1px solid rgba(250,204,21,.2)", borderRadius: 14, padding: "14px 16px", marginBottom: 4, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#facc15", flexShrink: 0 }} />
                <span style={{ fontSize: 10, fontWeight: 900, color: "#facc15", textTransform: "uppercase", letterSpacing: "1px" }}>Verificar reposição hoje</span>
              </div>
              {produtosParaRevisar.map(nome => (
                <div key={nome} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#0e0c0a", borderRadius: 10, border: "1px solid #1e1c18" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: "#c9c2b4", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nome}</div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#5a564d", marginTop: 2 }}>Esgotado desde {esgotadosMetadata[nome]?.desde}</div>
                  </div>
                  <button
                    onClick={() => toggleEsgotado(nome, false)}
                    style={{ height: 32, padding: "0 10px", border: "1px solid rgba(34,197,94,.35)", borderRadius: 8, background: "rgba(34,197,94,.08)", color: "#22c55e", fontSize: 11, fontWeight: 900, flexShrink: 0 }}
                  >Voltou</button>
                  <button
                    onClick={() => revisarHoje(nome)}
                    style={{ height: 32, padding: "0 10px", border: "1px solid #2a2723", borderRadius: 8, background: "transparent", color: "#8a8278", fontSize: 11, fontWeight: 900, flexShrink: 0 }}
                  >Continua esgotado</button>
                </div>
              ))}
            </div>
          )}

          {lista.length === 0 && (
            <div className="cbGridFull" style={{ background: "#0c0c0c", border: "1px dashed #252220", borderRadius: 14, padding: "40px 20px", textAlign: "center", marginTop: 6 }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>{busca ? "🔍" : filtroStatus === "esgotado" ? "✅" : "📦"}</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#a39b8b" }}>
                {busca
                  ? "Nenhum produto encontrado."
                  : filtroStatus === "esgotado"
                  ? "Nenhum produto esgotado agora."
                  : "Nenhum produto disponível."}
              </div>
            </div>
          )}

          {lista.map(produto => {
            const esg = esgotados.includes(produto.nome)
            const loading = salvando.has(produto.nome)
            const sel = selecionados.has(produto.nome)

            return (
              <div
                key={produto.nome}
                className="cbItem"
                onClick={() => modoSel && toggleSel(produto.nome)}
                style={{
                  background: sel ? "rgba(255,107,0,.05)" : esg ? "rgba(239,68,68,.03)" : "#0c0c0c",
                  border: `1px solid ${sel ? "rgba(255,107,0,.5)" : esg ? "rgba(239,68,68,.2)" : "#1a1816"}`,
                  borderRadius: 13,
                  padding: "14px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  cursor: modoSel ? "pointer" : "default",
                }}
              >
                {/* Checkbox modo seleção */}
                {modoSel && (
                  <div style={{
                    width: 24, height: 24,
                    borderRadius: 7,
                    border: `2px solid ${sel ? "#ff6b00" : "#3a3730"}`,
                    background: sel ? "#ff6b00" : "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0, fontSize: 14, color: "#fff", fontWeight: 900,
                  }}>
                    {sel && "✓"}
                  </div>
                )}

                {/* Conteúdo do card */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Nome */}
                  <div style={{
                    fontSize: 15, fontWeight: 800,
                    color: esg ? "#a06060" : "#f0ede8",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    marginBottom: 6, lineHeight: 1.3,
                  }}>
                    {produto.nome}
                  </div>
                  {/* Metadados */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10, fontWeight: 800, color: "#3e3b37", background: "#161412", padding: "3px 8px", borderRadius: 5, lineHeight: 1.5 }}>
                      {produto.categoria}
                    </span>
                    {produto.preco != null && produto.preco > 0 && (
                      <span style={{ fontSize: 11, fontWeight: 600, color: "#6a6460", lineHeight: 1.4 }}>
                        R$ {produto.preco.toFixed(2).replace(".", ",")}
                      </span>
                    )}
                    <span style={{ fontSize: 11, fontWeight: 800, color: esg ? "#b85555" : "#3d8a54", lineHeight: 1.4 }}>
                      {esg ? "Esgotado" : "Vendendo"}
                    </span>
                  </div>
                </div>

                {/* Botão de ação — só fora do modo seleção */}
                {!modoSel && (
                  <button
                    className="cbBtn"
                    onClick={e => { e.stopPropagation(); if (!loading) toggleEsgotado(produto.nome, !esg) }}
                    disabled={loading}
                    style={{
                      height: 40,
                      padding: "0 13px",
                      border: `1px solid ${esg ? "rgba(34,197,94,.35)" : "rgba(239,68,68,.35)"}`,
                      borderRadius: 10,
                      background: esg ? "rgba(34,197,94,.08)" : "rgba(239,68,68,.08)",
                      color: esg ? "#22c55e" : "#e05555",
                      fontSize: 12, fontWeight: 900,
                      flexShrink: 0,
                      minWidth: 108,
                      opacity: loading ? 0.5 : 1,
                    }}
                  >
                    {loading ? "..." : esg ? "Voltar a vender" : "Marcar esgotado"}
                  </button>
                )}
              </div>
            )
          })}

          {/* Espaço extra no final para o toast não cobrir */}
          <div style={{ height: 4, flexShrink: 0 }} />
        </main>

      </PanelShell>

      {/* Toast com desfazer — fora do app-shell para ficar sobre tudo */}
      {toast && (
        <div style={{
          position: "fixed",
          bottom: "calc(env(safe-area-inset-bottom) + 80px)",
          left: "50%", transform: "translateX(-50%)",
          width: "calc(100% - 32px)", maxWidth: 358,
          background: "#1a1816",
          border: "1px solid #2a2723",
          borderRadius: 14,
          padding: "12px 14px",
          display: "flex", alignItems: "center", gap: 10,
          animation: "cbToastIn .22s ease both",
          zIndex: 80,
          boxShadow: "0 8px 30px rgba(0,0,0,.7)",
          fontFamily: "'Archivo', sans-serif",
        }}>
          <p style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "#b8b0a4", margin: 0, lineHeight: 1.4 }}>{toast.msg}</p>
          {toast.nome && (
            <button
              onClick={desfazer}
              style={{ background: "rgba(255,107,0,.14)", color: "#ff6b00", fontSize: 12, fontWeight: 900, padding: "8px 12px", borderRadius: 9, flexShrink: 0 }}
            >Desfazer</button>
          )}
        </div>
      )}

      {/* Modal confirmação lote */}
      {confirmLote && (
        <>
          <div onClick={() => setConfirmLote(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 90, animation: "cbFadeIn .2s ease" }} />
          <div style={{
            position: "fixed", bottom: 0, left: 0, right: 0,
            margin: "0 auto", maxWidth: 390,
            background: "#111009",
            border: "1px solid #242220", borderBottom: "none",
            borderRadius: "22px 22px 0 0",
            zIndex: 91,
            animation: "cbSheetUp .3s cubic-bezier(.2,.9,.3,1) both",
            padding: "18px 20px calc(env(safe-area-inset-bottom) + 28px)",
            display: "flex", flexDirection: "column", gap: 12,
          }}>
            <div style={{ width: 40, height: 4, borderRadius: 2, background: "#2e2b26", margin: "0 auto 6px" }} />
            <p style={{ margin: 0, fontSize: 17, fontWeight: 900, letterSpacing: "-0.3px" }}>
              {confirmLote === "esgotado"
                ? `Esgotar ${selecionados.size} produto${selecionados.size > 1 ? "s" : ""}?`
                : `Disponibilizar ${selecionados.size} produto${selecionados.size > 1 ? "s" : ""}?`}
            </p>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#8a8278", lineHeight: 1.5 }}>
              {confirmLote === "esgotado"
                ? "O bot vai parar de vender esses produtos imediatamente."
                : "O bot vai voltar a oferecer esses produtos."}
            </p>
            <button
              onClick={() => aplicarLote(confirmLote === "esgotado")}
              style={{ height: 52, borderRadius: 13, background: confirmLote === "esgotado" ? "#c53333" : "#1e8a47", color: "#fff", fontSize: 15, fontWeight: 900 }}
            >
              {confirmLote === "esgotado" ? "Confirmar — marcar esgotados" : "Confirmar — disponibilizar"}
            </button>
            <button onClick={() => setConfirmLote(null)} style={{ height: 42, background: "transparent", color: "#6a6460", fontSize: 13, fontWeight: 800 }}>Cancelar</button>
          </div>
        </>
      )}
    </>
  )
}

// ==================== PUBLIC CARDÁPIO ====================

type CartItem = {
  emoji: string;
  kind: "pizza" | "simple" | "promo";
  name: string;
  detail: string;
  price: number;
  qty: number;
  // Nomes de produtos (sabores/borda da pizza ou nome do item simples) usados
  // para detectar se o item ficou esgotado depois de adicionado ao carrinho.
  keys?: string[];
  // Presente quando o item veio de uma promoção do cardápio.
  promoId?: string;
};

type PromocaoPublica = {
  id: string;
  badge: string;
  title: string;
  description: string;
  buttonText: string;
  promotionalPrice?: number;
  includedText: string;
  maxUsesPerOrder?: number;
  mainItems: { productId: string; productName: string; category: string; sizeRequired?: string; quantity: number; customerMustChooseFlavor?: boolean }[];
  freeItems: { productId: string; productName: string; category: string; quantity: number }[];
};

type PedidoConfirmadoStatus = "novo" | "em_preparo" | "saiu_entrega" | "entregue" | "cancelado";

const STATUS_PEDIDO_LABEL: Record<PedidoConfirmadoStatus, string> = {
  novo: "Pedido recebido",
  em_preparo: "Preparando seu pedido",
  saiu_entrega: "Saiu para entrega",
  entregue: "Pedido entregue",
  cancelado: "Pedido cancelado",
};

type PixClientePedido = {
  provider: "mercadopago";
  qrCode: string;
  ticketUrl?: string;
  valorEsperado?: number;
};

const money = (v: number) => "R$ " + v.toFixed(2).replace(".", ",");
const bigBorder = (sz: string) => !(sz === "P" || sz === "M");
const itemSlug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const isMiniPizzaName = (value: string) => itemSlug(value) === "minipizza";

async function copiarTexto(texto: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(texto); return true } catch {}
  try {
    const ta = document.createElement("textarea")
    ta.value = texto
    ta.style.position = "fixed"
    ta.style.opacity = "0"
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand("copy")
    document.body.removeChild(ta)
    return ok
  } catch { return false }
}

export function PublicCardapio({ menu }: { menu: MenuType }) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [screen, setScreen] = useState("sc-start");
  const [previousStepBeforeCart, setPreviousStepBeforeCart] = useState<string | null>(null);
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
  const [listCat, setListCat] = useState<"lanche" | "macarronada" | "bebida" | "suco">("lanche");
  const [macarronadaPendente, setMacarronadaPendente] = useState<{ name: string; price: number; sizes?: { code: string; price: number }[] } | null>(null);
  const [sucoPendente, setSucoPendente] = useState<{ name: string; price: number } | null>(null);
  const [delType, setDelType] = useState<"delivery" | "retirada" | "dine_in" | null>(null);
  const [bairroIdx, setBairroIdx] = useState<string>("");
  const [rua, setRua] = useState("");
  const [nome, setNome] = useState("");
  const [payment, setPayment] = useState<string | null>(null);
  const [troco, setTroco] = useState("");
  const [telefone, setTelefone] = useState("");
  const [numero, setNumero] = useState("");
  const [referencia, setReferencia] = useState("");
  const [observacao, setObservacao] = useState("");
  const [toast, setToast] = useState("");
  const [pedidoConfirmado, setPedidoConfirmado] = useState<{ id: string; numero: number; total: number; pix?: PixClientePedido } | null>(null);
  const [statusPedidoConfirmado, setStatusPedidoConfirmado] = useState<PedidoConfirmadoStatus>("novo");
  const [erroNome, setErroNome] = useState("");
  const [erroTelefone, setErroTelefone] = useState("");
  const [erroPagamento, setErroPagamento] = useState("");
  const [erroEntrega, setErroEntrega] = useState("");
  const [erroTroco, setErroTroco] = useState("");
  const [trocoOpcao, setTrocoOpcao] = useState<"nao" | "sim" | null>(null);
  const [miniPizzaMode, setMiniPizzaMode] = useState(false);
  const [paymentModal, setPaymentModal] = useState<string | null>(null);
  const [editandoIdentidade, setEditandoIdentidade] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [restoredDraft, setRestoredDraft] = useState(false);
  // Último pedido confirmado neste navegador (sem telefone/endereço), para o
  // cliente reencontrar o rastreio se fechar a página. Expira em 3 horas.
  const [pedidoRecente, setPedidoRecente] = useState<{ id: string; numero?: number; ts: number } | null>(null);
  // Promoções ativas vindas do servidor (substituem o antigo card fixo).
  const [promos, setPromos] = useState<PromocaoPublica[]>([]);
  const [promoSel, setPromoSel] = useState<PromocaoPublica | null>(null);
  const [promoSabor, setPromoSabor] = useState<string | null>(null);
  const promoScrollRef = useRef<HTMLDivElement>(null);
  const promoUserInteractRef = useRef(false);
  const pagamentoRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<any>(null);
  const nomeRef = useRef<HTMLInputElement>(null);
  const telefoneRef = useRef<HTMLInputElement>(null);

  useEffect(() => { document.documentElement.setAttribute("data-theme", theme); }, [theme]);

  useEffect(() => {
    try {
      const n = localStorage.getItem("cf_nome"); const t = localStorage.getItem("cf_tel");
      if (n) setNome(n); if (t) setTelefone(t);
      if (n && t && n.trim() && t.replace(/\D/g, "").length >= 10) setEditandoIdentidade(false);
      else setEditandoIdentidade(true);
    } catch { setEditandoIdentidade(true); }
    try {
      const rawPedido = localStorage.getItem("cf_ultimo_pedido");
      if (rawPedido) {
        const up = JSON.parse(rawPedido);
        if (up && up.id && typeof up.ts === "number" && Date.now() - up.ts <= 3 * 60 * 60 * 1000) {
          setPedidoRecente({ id: String(up.id), numero: typeof up.numero === "number" ? up.numero : undefined, ts: up.ts });
        } else {
          localStorage.removeItem("cf_ultimo_pedido");
        }
      }
    } catch {}
    try {
      const raw = sessionStorage.getItem("cf_draft");
      if (raw) {
        const d = JSON.parse(raw);
        if (Array.isArray(d.cart) && d.cart.length > 0) {
          setCart(d.cart);
          if (d.delType) setDelType(d.delType);
          if (d.bairroIdx) setBairroIdx(d.bairroIdx);
          if (d.rua) setRua(d.rua);
          if (d.numero) setNumero(d.numero);
          if (d.referencia) setReferencia(d.referencia);
          if (d.payment) setPayment(d.payment);
          if (d.trocoOpcao) setTrocoOpcao(d.trocoOpcao);
          if (d.troco) setTroco(d.troco);
          if (d.observacao) setObservacao(d.observacao);
          if (d.plan) setPlan(d.plan);
          const safeScreens = ["sc-cart", "sc-delivery", "sc-pay", "sc-another"];
          setScreen(safeScreens.includes(d.screen) ? d.screen : "sc-cart");
          setRestoredDraft(true);
        }
      }
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (screen === "sc-done") return;
    if (cart.length === 0) { try { sessionStorage.removeItem("cf_draft"); } catch {}; return; }
    try {
      sessionStorage.setItem("cf_draft", JSON.stringify({ cart, screen, delType, bairroIdx, rua, numero, referencia, payment, trocoOpcao, troco, observacao, plan }));
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, cart, screen, delType, bairroIdx, rua, numero, referencia, payment, trocoOpcao, troco, observacao, plan]);

  useEffect(() => {
    if (!restoredDraft) return;
    const t = setTimeout(() => setRestoredDraft(false), 5000);
    return () => clearTimeout(t);
  }, [restoredDraft]);

  useEffect(() => {
    const pedidoId = pedidoConfirmado?.id;
    if (!pedidoId) return;
    let active = true;

    async function fetchStatusPedido() {
      try {
        const res = await fetch(`/api/pedido-status?pedidoId=${pedidoId}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (active && data.status && data.status in STATUS_PEDIDO_LABEL) {
          setStatusPedidoConfirmado(data.status);
        }
      } catch {}
    }

    fetchStatusPedido();
    const interval = setInterval(fetchStatusPedido, 5000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [pedidoConfirmado?.id]);

  function showToast(m: string) { setToast(m); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(""), 1700); }
  function dispensarPedidoRecente() { setPedidoRecente(null); try { localStorage.removeItem("cf_ultimo_pedido"); } catch {} }

  useEffect(() => {
    let alive = true;
    fetch("/api/promocoes-cardapio", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => { if (alive && Array.isArray(d)) setPromos(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Carrossel de promoções: avança sozinho a cada ~4,5s só quando há mais de
  // 1 promoção e o cliente está na tela inicial. Um toque/arraste do cliente
  // pausa apenas o próximo avanço automático, sem travar a rolagem manual.
  useEffect(() => {
    if (screen !== "sc-start" || promos.length < 2) return;
    const el = promoScrollRef.current;
    if (!el) return;
    const id = setInterval(() => {
      if (promoUserInteractRef.current) { promoUserInteractRef.current = false; return; }
      const card = el.children[0] as HTMLElement | undefined;
      const step = card ? card.offsetWidth + 12 : el.clientWidth;
      const max = el.scrollWidth - el.clientWidth;
      const next = el.scrollLeft + step >= max - 4 ? 0 : el.scrollLeft + step;
      el.scrollTo({ left: next, behavior: "smooth" });
    }, 4500);
    return () => clearInterval(id);
  }, [screen, promos.length]);

  function abrirPromocao(p: PromocaoPublica) { setPromoSel(p); setPromoSabor(null); go("sc-promo"); }
  function promoPrecisaSabor(p: PromocaoPublica) { return p.mainItems.some((m) => m.category === "pizza" && m.customerMustChooseFlavor !== false); }
  function promoInclusos(p: PromocaoPublica) {
    return p.freeItems.map((f) => `${f.quantity > 1 ? `${f.quantity}x ` : ""}${f.productName} grátis`).join(" + ");
  }
  function adicionarPromocao() {
    if (!promoSel || typeof promoSel.promotionalPrice !== "number") return;
    if (promoPrecisaSabor(promoSel) && !promoSabor) { showToast("Escolha o sabor da pizza primeiro."); return; }
    const limite = promoSel.maxUsesPerOrder;
    const jaNoCarrinho = cart.filter((c) => c.kind === "promo" && c.promoId === promoSel.id).length;
    if (limite && jaNoCarrinho >= limite) { showToast(`Essa promoção é limitada a ${limite} por pedido.`); return; }
    const inclusos = promoInclusos(promoSel);
    const detail = `${promoSabor ? `Sabor: ${promoSabor} · ` : ""}${inclusos ? `Inclui: ${inclusos} · ` : ""}Preço promocional: ${money(promoSel.promotionalPrice)}`;
    const keys = [promoSabor, ...promoSel.mainItems.filter((m) => m.category !== "pizza").map((m) => m.productName), ...promoSel.freeItems.map((f) => f.productName)].filter(Boolean) as string[];
    setCart([...cart, { emoji: "🏷️", kind: "promo", name: `Promoção: ${promoSel.title}`, detail, price: promoSel.promotionalPrice, qty: 1, keys, promoId: promoSel.id }]);
    showToast("Promoção adicionada! 🏷️");
    setPromoSel(null); setPromoSabor(null);
    go("sc-cart");
  }
  const safeCartReturnScreens = ["sc-start", "sc-qty", "sc-build", "sc-border", "sc-list", "sc-suco-leite", "sc-macarronada-size", "sc-another", "sc-delivery", "sc-pay", "sc-promo"];
  function go(s: string) {
    if (s === "sc-cart" && screen !== "sc-cart" && safeCartReturnScreens.includes(screen)) {
      setPreviousStepBeforeCart(screen);
    }
    setScreen(s);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function backFromCart() {
    go(previousStepBeforeCart && safeCartReturnScreens.includes(previousStepBeforeCart) ? previousStepBeforeCart : "sc-start");
  }
  function formatTel(v: string) {
    const d = v.replace(/\D/g, "").slice(0, 11);
    if (d.length <= 2) return d;
    if (d.length <= 6) return `(${d.slice(0,2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
    return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  }
  function telefoneValido(t: string) { return t.replace(/\D/g, "").length >= 10; }

  const esgotados = menu.esgotados || [];
  const miniPizzaItem = (menu.lanches || []).find((it) => isMiniPizzaName(it.name) && Number.isFinite(it.price));
  const miniPizzaEsgotada = !!miniPizzaItem && esgotados.includes(miniPizzaItem.name);
  const miniPizzaFlavors = (menu.miniPizzaFlavors?.length ? menu.miniPizzaFlavors : [...(menu.saltyFlavors || []), ...(menu.sweetFlavors || [])]).filter(Boolean);

  function resetBuild() { setSize(null); setSizePrice(0); setMam(false); setF1(null); setF2(null); setBorder(null); setBorderPrice(0); setMiniPizzaMode(false); }
  function goPizza() { go("sc-qty"); }
  function setPizzaQty(q: number) { setPlan(q === 0 ? { total: 0, current: 1, openEnded: true } : { total: q, current: 1, openEnded: false }); resetBuild(); go("sc-build"); }
  function pizzasNoCarrinho() { return cart.filter((c) => c.kind === "pizza" || (c.kind === "simple" && isMiniPizzaName(c.name))).length; }
  function pickSize(code: string) { const s = (menu.sizes || []).find((x) => x.code === code); if (!s) return; setMiniPizzaMode(false); setSize(code); setSizePrice(s.price); }
  function pickMiniPizza() { if (!miniPizzaItem || miniPizzaEsgotada) return; setMiniPizzaMode(true); setSize("MINI"); setSizePrice(miniPizzaItem.price); setMam(false); setF2(null); }
  function setFlavorMode(nextMam: boolean) { if (miniPizzaMode && nextMam) return; setMam(nextMam); setF1(null); setF2(null); }
  function pickFlavor(f: string) {
    if (!mam) { setF1(f); return; }
    if (f1 === f) { setF1(f2); setF2(null); } else if (f2 === f) { setF2(null); } else if (!f1) setF1(f); else if (!f2) setF2(f); else setF2(f);
  }
  const flavorOk = mam ? !!(f1 && f2) : !!f1;
  const buildOk = !!size && flavorOk && !(miniPizzaMode && miniPizzaEsgotada);
  const flavorSections = miniPizzaMode
    ? [{ title: "Sabores da mini-pizza", flavors: miniPizzaFlavors }]
    : [{ title: "Salgadas", flavors: menu.saltyFlavors || [] }, { title: "Doces", flavors: menu.sweetFlavors || [] }];
  const selectedSizeLabel = miniPizzaMode && miniPizzaItem ? miniPizzaItem.name : size ? ((menu.sizes || []).find((s) => s.code === size)?.label || size) : "";
  const buildFootHint = !size ? "Escolha um tamanho para continuar" : !flavorOk ? (mam ? "Escolha 2 sabores" : "Escolha 1 sabor") : miniPizzaMode ? "Mini-pizza pronta para a sacola" : "Agora escolha a borda";
  const buildActionLabel = miniPizzaMode ? "Adicionar mini-pizza" : "Confirmar pizza";
  function addPizzaWithBorder(chosenBorder: string | null, chosenBorderPrice: number) {
    setBorder(chosenBorder); setBorderPrice(chosenBorderPrice);
    const flavor = mam ? `${f1} / ${f2}` : f1;
    const keys = [f1, mam ? f2 : null, chosenBorder].filter(Boolean) as string[];
    const newItem: CartItem = { emoji: "🍕", kind: "pizza", name: `Pizza ${size}${mam ? " (meio a meio)" : ""}`, detail: `${flavor}${chosenBorder ? ` · borda ${chosenBorder}` : ""}`, price: sizePrice + chosenBorderPrice, qty: 1, keys };
    const newCart = [...cart, newItem];
    setCart(newCart);
    if (!plan.openEnded && plan.current < plan.total) { setPlan({ ...plan, current: plan.current + 1 }); showToast(`Pizza pronta! 🍕`); resetBuild(); go("sc-build"); }
    else if (plan.openEnded) { showToast("Pizza adicionada! 🍕"); go("sc-another"); }
    else { showToast("Tudo pronto! 🍕"); go("sc-cart"); }
  }
  function addMiniPizza() {
    if (!miniPizzaItem || !f1) return;
    const detail = `Sabor: ${f1}`;
    const ex = cart.find((c) => c.kind === "simple" && isMiniPizzaName(c.name) && c.detail === detail);
    if (ex) setCart(cart.map((c) => (c === ex ? { ...c, qty: c.qty + 1 } : c)));
    else setCart([...cart, { emoji: "🍕", kind: "simple", name: miniPizzaItem.name, detail, price: miniPizzaItem.price, qty: 1, keys: [miniPizzaItem.name, f1] }]);
    if (!plan.openEnded && plan.current < plan.total) { setPlan({ ...plan, current: plan.current + 1 }); showToast("Mini-pizza adicionada!"); resetBuild(); go("sc-build"); }
    else if (plan.openEnded) { showToast("Mini-pizza adicionada!"); go("sc-another"); }
    else { showToast("Tudo pronto!"); go("sc-cart"); }
  }
  function continueBuild() { if (!buildOk) return; if (miniPizzaMode) addMiniPizza(); else go("sc-border"); }
  function addAnother() { setPlan({ total: 0, current: pizzasNoCarrinho() + 1, openEnded: true }); resetBuild(); go("sc-build"); }
  function goCat(cat: "lanche" | "macarronada" | "bebida" | "suco") { setListCat(cat); go("sc-list"); }
  function isMacarronada(it: { name: string; sizes?: { code: string; price: number }[] }) {
    return it.name.toLowerCase().includes("macarronada") && Array.isArray(it.sizes) && it.sizes.length > 0;
  }
  function simplePriceLabel(it: { price: number; sizes?: { code: string; price: number }[] }) {
    if (Array.isArray(it.sizes) && it.sizes.length > 0) return `A partir de ${money(Math.min(...it.sizes.map((s) => s.price)))}`;
    return money(it.price);
  }
  function addSimple(it: { name: string; price: number; sizes?: { code: string; price: number }[] }, emoji: string) {
    if (isMacarronada(it)) { setMacarronadaPendente(it); go("sc-macarronada-size"); return; }
    if (listCat === "suco") { setSucoPendente(it); go("sc-suco-leite"); return; }
    const ex = cart.find((c) => c.kind === "simple" && c.name === it.name);
    if (ex) { setCart(cart.map((c) => (c === ex ? { ...c, qty: c.qty + 1 } : c))); }
    else { setCart([...cart, { emoji, kind: "simple", name: it.name, detail: "", price: it.price, qty: 1, keys: [it.name] }]); }
    showToast(`${it.name} adicionado!`);
  }
  function addSucoLeite(comLeite: boolean) {
    if (!sucoPendente) return;
    const detail = comLeite ? "Com leite" : "Sem leite";
    const price = sucoPendente.price + (comLeite ? 1 : 0);
    const ex = cart.find((c) => c.kind === "simple" && c.name === sucoPendente.name && c.detail === detail);
    if (ex) setCart(cart.map((c) => (c === ex ? { ...c, qty: c.qty + 1 } : c)));
    else setCart([...cart, { emoji: "S", kind: "simple", name: sucoPendente.name, detail, price, qty: 1, keys: [sucoPendente.name] }]);
    showToast(`${sucoPendente.name} ${detail.toLowerCase()} adicionado!`);
    setSucoPendente(null);
    go("sc-cart");
  }
  function addMacarronadaSize(code: string) {
    if (!macarronadaPendente) return;
    const sizeOption = macarronadaPendente.sizes?.find((s) => s.code === code);
    if (!sizeOption) return;
    const detail = `Tamanho ${sizeOption.code}`;
    const ex = cart.find((c) => c.kind === "simple" && c.name === macarronadaPendente.name && c.detail === detail);
    if (ex) setCart(cart.map((c) => (c === ex ? { ...c, qty: c.qty + 1 } : c)));
    else setCart([...cart, { emoji: "🍽️", kind: "simple", name: macarronadaPendente.name, detail, price: sizeOption.price, qty: 1, keys: [macarronadaPendente.name] }]);
    showToast(`${macarronadaPendente.name} ${sizeOption.code} adicionada!`);
    setMacarronadaPendente(null);
    go("sc-cart");
  }
  const cartTotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const cartCount = cart.reduce((s, i) => s + i.qty, 0);
  function chQty(idx: number, d: number) { setCart(cart.map((c, i) => (i === idx ? { ...c, qty: Math.max(1, c.qty + d) } : c))); }
  function rmItem(idx: number) { const nc = cart.filter((_, i) => i !== idx); setCart(nc); if (nc.length === 0) go("sc-start"); }
  const fee = delType === "delivery" && bairroIdx !== "" ? ((menu.neighborhoods || [])[+bairroIdx]?.fee ?? 0) : 0;
  const finalTotal = cartTotal + fee;
  const ruaOk = rua.trim().length > 0;
  const numeroOk = numero.trim().length > 0;
  const delOk = delType === "retirada" || delType === "dine_in" || (delType === "delivery" && bairroIdx !== "" && ruaOk && numeroOk);
  const enderecoErroAtivo = delType === "delivery" && !!erroEntrega;
  const bairroErro = enderecoErroAtivo && bairroIdx === "";
  const ruaErro = enderecoErroAtivo && !ruaOk;
  const numeroErro = enderecoErroAtivo && !numeroOk;
  const enderecoErroStyle = { borderColor: "#ef4444", background: "rgba(239,68,68,.08)", boxShadow: "0 0 0 1px rgba(239,68,68,.18)" };
  const bairroSelectStyle = {
    ...(bairroErro ? enderecoErroStyle : {}),
    background: bairroErro ? "rgba(239,68,68,.08)" : "var(--surface)",
    color: "var(--text)",
  };
  const bairroOptionStyle = { background: "#fff", color: "#2a1d16" };
  const payOk = !!nome.trim() && telefoneValido(telefone) && !!payment;

  const esgotadosKey = esgotados.join("|");
  const cartEsgotado = cart.some((c) => cartItemEsgotado(c.keys, esgotados));

  // Reage ao cardápio atualizado pelo polling: se o sabor/borda que o cliente
  // está montando ficou esgotado, limpa só essa seleção (buildOk volta a ser
  // falso e ele não consegue continuar). Não mexe no carrinho.
  useEffect(() => {
    if (f1 && esgotados.includes(f1)) {
      setF1(f2 && !esgotados.includes(f2) ? f2 : null);
      setF2(null);
      showToast("Um sabor que você escolheu ficou esgotado.");
    } else if (f2 && esgotados.includes(f2)) {
      setF2(null);
      showToast("Um sabor que você escolheu ficou esgotado.");
    }
    if (border && esgotados.includes(border)) {
      setBorder(null);
      setBorderPrice(0);
      showToast("A borda que você escolheu ficou esgotada.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esgotadosKey]);

  function getEnderecoErro() {
    const faltando = [bairroIdx === "" ? "bairro" : "", !ruaOk ? "rua" : "", !numeroOk ? "numero" : ""].filter(Boolean);
    if (faltando.length === 0) return "";
    if (faltando.length === 1) {
      if (faltando[0] === "bairro") return "Selecione o bairro";
      if (faltando[0] === "rua") return "Preencha a rua";
      return "Preencha o n?mero";
    }
    const lista = faltando.length === 2 ? faltando.join(" e ") : faltando.slice(0, -1).join(", ") + " e " + faltando[faltando.length - 1];
    return "Falta preencher: " + lista;
  }

  function continueToPayment() {
    if (!delOk) {
      setErroEntrega(getEnderecoErro());
      return;
    }
    setErroEntrega("");
    go("sc-pay");
  }

  function paymentLabel(value: string) { return value === "Cartao" ? "Cartão" : value; }
  function paymentIcon(value: string) { return ({ Pix: "⚡", Dinheiro: "$", Cartao: "▣" } as Record<string, string>)[value] || "$"; }
  function paymentHint(value: string) {
    return ({ Pix: "Confirmacao manual pela pizzaria.", Dinheiro: "Configure o troco.", Cartao: "Pagamento na maquina." } as Record<string, string>)[value] || "Forma de pagamento";
  }
  function paymentSummary(value: string) {
    if (value !== payment) return paymentHint(value);
    if (value === "Dinheiro") {
      if (trocoOpcao === "nao") return "Sem troco";
      if (trocoOpcao === "sim" && troco.trim()) return `Troco para ${troco}`;
      return "Troco pendente";
    }
    return "Selecionado";
  }
  function openPaymentConfig(value: string) {
    setErroPagamento("");
    if (value !== "Dinheiro") setErroTroco("");
    setPaymentModal(value);
  }
  function confirmPaymentConfig() {
    if (!paymentModal) return;
    if (paymentModal === "Dinheiro") {
      if (!trocoOpcao) { setErroTroco("Escolha se você precisa de troco."); return; }
      if (trocoOpcao === "sim" && !troco.trim()) { setErroTroco("Informe para quanto precisa de troco."); return; }
      if (trocoOpcao === "sim") {
        const trocoNum = parseFloat(troco.replace(",", ".").replace(/[^\d.]/g, ""));
        if (isNaN(trocoNum) || trocoNum <= cartTotal + fee) { setErroTroco("O valor do troco precisa ser maior que o total do pedido."); return; }
      }
    }
    setPayment(paymentModal);
    setErroPagamento("");
    if (paymentModal !== "Dinheiro") { setTroco(""); setTrocoOpcao(null); setErroTroco(""); }
    setPaymentModal(null);
  }

  async function finish() {
    if (sending) return;
    if (cartEsgotado) { showToast("Um item do seu pedido ficou esgotado. Remova para continuar."); return; }
    if (delType === "delivery" && !delOk) { setErroEntrega(getEnderecoErro()); go("sc-delivery"); return; }
    let hasError = false;
    if (!nome.trim()) { setErroNome("Me diz seu nome pra gente identificar o pedido."); setEditandoIdentidade(true); nomeRef.current?.focus(); hasError = true; }
    else { setErroNome(""); }
    if (!telefoneValido(telefone)) { setErroTelefone("Coloca um WhatsApp válido pra pizzaria falar com você se precisar."); setEditandoIdentidade(true); if (!hasError) telefoneRef.current?.focus(); hasError = true; }
    else { setErroTelefone(""); }
    if (!payment) { setErroPagamento("pagamento"); if (!hasError) pagamentoRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); hasError = true; }
    else { setErroPagamento(""); }
    if (payment === "Dinheiro") {
      if (!trocoOpcao) {
        setErroTroco("Escolha se você precisa de troco.");
        if (!hasError) pagamentoRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        hasError = true;
      } else if (trocoOpcao === "sim" && !troco.trim()) {
        setErroTroco("Informe para quanto precisa de troco.");
        if (!hasError) pagamentoRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        hasError = true;
      } else if (trocoOpcao === "sim") {
        const trocoNum = parseFloat(troco.replace(",", ".").replace(/[^\d.]/g, ""));
        if (isNaN(trocoNum) || trocoNum <= cartTotal + fee) { setErroTroco("O valor do troco precisa ser maior que o total do pedido."); if (!hasError) pagamentoRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); hasError = true; }
        else { setErroTroco(""); }
      } else { setErroTroco(""); }
    } else { setErroTroco(""); }
    if (hasError) return;
    setSending(true);
    const payload = { cliente: nome.trim(), telefone: telefone.trim(), itens: cart.map((c) => ({ kind: c.kind, name: c.name, detail: c.detail, price: c.price, qty: c.qty, ...(c.promoId ? { promoId: c.promoId } : {}) })), tipoEntrega: delType, bairro: delType === "delivery" ? menu.neighborhoods[+bairroIdx].name : undefined, rua: delType === "delivery" ? rua : undefined, numero: delType === "delivery" && numero.trim() ? numero.trim() : undefined, referencia: delType === "delivery" && referencia.trim() ? referencia.trim() : undefined, observacao: observacao.trim() || undefined, taxaEntrega: fee, pagamento: payment, troco: payment === "Dinheiro" ? (trocoOpcao === "nao" ? "Sem troco" : troco.trim()) : undefined };
    try {
      const r = await fetch("/api/pedido-app", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await r.json();
      if (data.ok) { try { localStorage.setItem("cf_nome", nome.trim()); localStorage.setItem("cf_tel", telefone.trim()); } catch {} try { sessionStorage.removeItem("cf_draft"); } catch {} try { const resumo = { id: String(data.pedidoId), numero: typeof data.numero === "number" ? data.numero : undefined, ts: Date.now() }; localStorage.setItem("cf_ultimo_pedido", JSON.stringify(resumo)); setPedidoRecente(resumo); } catch {} setStatusPedidoConfirmado("novo"); setPedidoConfirmado({ id: data.pedidoId, numero: data.numero, total: data.total, ...(data.pix?.qrCode ? { pix: data.pix } : {}) }); go("sc-done"); } else { showToast("Erro ao enviar. Tente de novo."); }
    } catch { showToast("Sem conexão. Tente de novo."); } finally { setSending(false); }
  }
  function resetAll() { setCart([]); resetBuild(); setDelType(null); setBairroIdx(""); setRua(""); setNumero(""); setReferencia(""); setPayment(null); setTroco(""); setTrocoOpcao(null); setPaymentModal(null); setObservacao(""); setErroNome(""); setErroTelefone(""); setErroPagamento(""); setErroEntrega(""); setErroTroco(""); setPedidoConfirmado(null); setStatusPedidoConfirmado("novo"); setRestoredDraft(false); setEditandoIdentidade(false); try { sessionStorage.removeItem("cf_draft"); } catch {} go("sc-start"); }

  const stepMap: Record<string, number> = { "sc-start": 0, "sc-qty": 0, "sc-build": 0, "sc-border": 0, "sc-list": 0, "sc-suco-leite": 0, "sc-macarronada-size": 0, "sc-promo": 0, "sc-another": 1, "sc-cart": 1, "sc-delivery": 2, "sc-pay": 3, "sc-done": 3 };
  const stepIdx = stepMap[screen] ?? 0;
  const STEPS = ["Itens", "Sacola", "Entrega", "Pagar"];
  const showStrongCartCta = cartCount > 0 && ["sc-list", "sc-suco-leite", "sc-macarronada-size", "sc-promo"].includes(screen);
  const feitas = pizzasNoCarrinho();
  let ctxBadge = "", ctxTxt = "", ctxDots: { cls: string }[] = [];
  if (plan.openEnded) { ctxBadge = `Pizza ${feitas + 1}`; ctxTxt = feitas === 0 ? "Sua 1ª pizza" : `${feitas} já no carrinho`; }
  else if (plan.total > 0) { ctxBadge = `Pizza ${plan.current} de ${plan.total}`; ctxTxt = `Montando a pizza ${plan.current}`; for (let i = 1; i <= plan.total; i++) ctxDots.push({ cls: i < plan.current ? "done" : i === plan.current ? "cur" : "" }); }

  const PizzaCtx = () => (ctxBadge ? (
    <div className="pizza-ctx"><span className="pc-badge">{ctxBadge}</span><span className="pc-txt" dangerouslySetInnerHTML={{ __html: ctxTxt }} />{ctxDots.length > 0 && <span className="pizza-dots">{ctxDots.map((d, i) => <span key={i} className={`pd ${d.cls}`} />)}</span>}</div>
  ) : null);
  const TopBack = ({ onClick, title }: { onClick: () => void; title?: string }) => (
    <div className="top-back">
      <button type="button" onClick={onClick} aria-label="Voltar">←</button>
      {title && <span className="top-back-title">{title}</span>}
    </div>
  );

  return (
    <>
      <style>{CSS}</style>
      <div className={`wrap ${screen === "sc-start" ? "wrap-start" : ""}`}>
        {screen !== "sc-start" && (
          <div className="steps">
            {STEPS.map((s, i) => (
              <span key={s} style={{ display: "contents" }}>
                <div className={`step-chip ${i === stepIdx ? "active" : i < stepIdx ? "done" : ""}`}><span className="num">{i < stepIdx ? "✓" : i + 1}</span>{s}</div>
                {i < STEPS.length - 1 && <div className={`step-line ${i < stepIdx ? "done" : ""}`} />}
              </span>
            ))}
          </div>
        )}
        {/* Informações da pizzaria: só na tela inicial e de forma discreta.
            Nas etapas internas o topo é apenas voltar + nome da etapa. */}
        {screen === "sc-start" && (
          <header className="header-min">
            <div className="head-row">
              <div className="logo"><div className="logo-mark">🍕</div><div><h1>CHEFE DA PIZZA</h1><p>Alto Alegre do MA · <span style={{ color: "var(--green)", fontWeight: 600 }}>● Aberto agora</span> · 40 a 60 min</p></div></div>
              <button className="theme-btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Trocar tema">{theme === "dark" ? "🌙" : "☀️"}</button>
            </div>
          </header>
        )}
        <main>
          {screen === "sc-start" && (
            <section className="screen active home-screen">
              {pedidoRecente && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--brand-soft)", border: "1px solid var(--brand)", borderRadius: 14, padding: "10px 12px", marginBottom: 14 }}>
                  <a href={`/rastrear/${pedidoRecente.id}`} style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
                    <span style={{ fontSize: 20, flexShrink: 0 }}>🛵</span>
                    <span style={{ flex: 1 }}>
                      <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Acompanhar pedido{pedidoRecente.numero ? ` #${pedidoRecente.numero}` : ""}</span>
                      <span style={{ display: "block", fontSize: 12.5, color: "var(--text-sub)", marginTop: 2 }}>Seu último pedido está em andamento. Toque para ver o status.</span>
                    </span>
                  </a>
                  <button onClick={dispensarPedidoRecente} aria-label="Fechar acompanhamento" style={{ background: "none", border: "none", color: "var(--text-faint)", fontSize: 18, cursor: "pointer", padding: "0 2px", lineHeight: 1 }}>×</button>
                </div>
              )}
              {promos.length > 0 && (
                <div
                  className="promo-scroll"
                  ref={promoScrollRef}
                  onPointerDown={() => { promoUserInteractRef.current = true; }}
                >
                  {promos.map((p) => (
                    <div className="promo-card" key={p.id} style={promos.length === 1 ? { flex: "0 0 100%" } : undefined}>
                      <div className="promo-label">{p.badge || "PROMO DE HOJE"}</div>
                      <h2>{p.title}</h2>
                      <p>{p.description}</p>
                      <button className="promo-btn" onClick={() => abrirPromocao(p)}>{p.buttonText || "Pedir essa promoção →"}</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="home-copy">
                <h2>Ou monte seu pedido</h2>
                <p>Escolha uma categoria pra começar do seu jeito.</p>
              </div>
              <div className="home-grid">
                <button className="home-cat" onClick={goPizza}><span>🍕</span><strong>Pizzas</strong></button>
                <button className="home-cat" onClick={() => goCat("lanche")}><span>🍔</span><strong>Lanches</strong></button>
                <button className="home-cat" onClick={() => goCat("macarronada")}><span>🍝</span><strong>Macarronada</strong></button>
                <button className="home-cat" onClick={() => goCat("bebida")}><span>🥤</span><strong>Bebidas</strong></button>
                {(menu.sucos || []).length > 0 && (
                  <button className="home-cat" onClick={() => goCat("suco")}><span>🧃</span><strong>Sucos</strong></button>
                )}
              </div>
            </section>
          )}
          {screen === "sc-qty" && (
            <section className="screen active">
              <TopBack onClick={() => go("sc-start")} title="Quantidade" />
              <div className="screen-head"><div className="eyebrow">Pizza</div><h2>Quantas pizzas você quer?</h2><p>Você pode montar uma agora e adicionar mais depois.</p></div>
              <div className="qty-grid">
                <div className="qty-card" onClick={() => setPizzaQty(1)}>
                  <div className="qty-card-icon">🍕</div>
                  <div className="qty-card-body">
                    <div className="qty-card-title">1 pizza <span className="qty-badge">Mais escolhido</span></div>
                    <div className="qty-card-sub">Para um pedido simples</div>
                  </div>
                </div>
                <div className="qty-card" onClick={() => setPizzaQty(2)}>
                  <div className="qty-card-icon">🍕</div>
                  <div className="qty-card-body">
                    <div className="qty-card-title">2 pizzas</div>
                    <div className="qty-card-sub">Boa para dividir</div>
                  </div>
                </div>
                <div className="qty-card" onClick={() => setPizzaQty(3)}>
                  <div className="qty-card-icon">🍕</div>
                  <div className="qty-card-body">
                    <div className="qty-card-title">3 pizzas</div>
                    <div className="qty-card-sub">Para família ou amigos</div>
                  </div>
                </div>
                <div className="qty-card" onClick={() => setPizzaQty(0)}>
                  <div className="qty-card-icon">➕</div>
                  <div className="qty-card-body">
                    <div className="qty-card-title">Vou adicionando</div>
                    <div className="qty-card-sub">Monte uma por vez</div>
                  </div>
                </div>
              </div>
            </section>
          )}
          {screen === "sc-build" && (
            <section className="screen active sc-build-screen">
              <TopBack onClick={() => go("sc-qty")} title="Monte sua pizza" />
              <PizzaCtx />
              <div className="screen-head"><div className="eyebrow">Monte sua pizza</div><h2>Escolha o tamanho</h2><p>Toque em uma opcao para liberar os sabores.</p></div>
              <div className="choice-block size-choice">
                <div className="section-label">Tamanho</div>
                <div className={`choice-nudge ${size ? "ok" : ""}`}>{size ? `Selecionado: ${selectedSizeLabel}` : "Escolha uma opcao antes de avancar."}</div>
                <div className="grid2 size-grid">
                  {(menu.sizes || []).map((s) => (
                    <div key={s.code} className={`opt ${!miniPizzaMode && size === s.code ? "sel" : ""}`} onClick={() => pickSize(s.code)}>
                      <div className="opt-check" />
                      <div className="opt-emoji">🍕</div>
                      <div className="opt-body"><div className="opt-title">{s.label}</div><div className="opt-desc">{money(s.price)}</div></div>
                    </div>
                  ))}
                  {miniPizzaItem && (
                    <div className={`opt mini-size-opt ${miniPizzaMode ? "sel" : ""}`} onClick={pickMiniPizza} style={{ opacity: miniPizzaEsgotada ? 0.5 : 1, cursor: miniPizzaEsgotada ? "not-allowed" : "pointer" }}>
                      <div className="opt-check" />
                      <div className="opt-emoji">🍕</div>
                      <div className="opt-body"><div className="opt-title">Mini-pizza</div><div className="opt-desc" style={miniPizzaEsgotada ? { color: "#ef4444" } : undefined}>{miniPizzaEsgotada ? "Esgotado" : "Produto do cardapio"}</div></div>
                      <div className="opt-price">{miniPizzaEsgotada ? "" : money(miniPizzaItem.price)}</div>
                    </div>
                  )}
                </div>
              </div>
              <div className={`screen-head flavor-head ${!size ? "muted-head" : ""}`}><div className="eyebrow">Agora escolha o sabor</div><h2>{mam ? "Escolha 2 sabores" : "Escolha 1 sabor"}</h2><p>{miniPizzaMode ? "Mini-pizza vai com um sabor." : "Escolha 1 sabor ou ative meio a meio."}</p></div>
              {size ? (
                <>
                  {!miniPizzaMode && (
                    <div className="flavor-mode">
                      <button type="button" className={`flavor-mode-card ${!mam ? "sel" : ""}`} onClick={() => setFlavorMode(false)}>
                        <strong>1 sabor</strong><span>Toque em um sabor.</span>
                      </button>
                      <button type="button" className={`flavor-mode-card ${mam ? "sel" : ""}`} onClick={() => setFlavorMode(true)}>
                        <strong>Meio a meio</strong><span>Selecione 2 sabores.</span>
                      </button>
                    </div>
                  )}
                  {miniPizzaMode && <div className="mini-flow-note">Mini-pizza usa preco e produto existentes do cardapio.</div>}
                  {mam && <div className="half-hint show">{!f1 ? "Toque na 1a metade" : !f2 ? `1a: ${f1} - agora a 2a` : `${f1} / ${f2}`}</div>}
                  <div className="flavor-list">
                    {flavorSections.map((section) => (
                      <div key={section.title}>
                        <div className="section-label">{section.title}</div>
                        {section.flavors.map((f) => {
                          const esg = esgotados.includes(f)
                          return (
                            <div key={`${section.title}-${f}`} className={`opt flavor-opt ${f === f1 || f === f2 ? "sel" : ""} ${esg ? "esg" : ""}`} onClick={() => !esg && pickFlavor(f)} style={{ opacity: esg ? 0.5 : 1, cursor: esg ? "not-allowed" : "pointer" }}>
                              <div className="opt-emoji">🍕</div><div className="opt-body"><div className="opt-title">{f}</div>{esg && <div className="opt-desc" style={{ color: "#ef4444" }}>Esgotado</div>}</div><div className="opt-check" />
                            </div>
                          )
                        })}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="locked-note">Escolha o tamanho acima para continuar.</div>
              )}
              <div className="build-foot"><div className="build-foot-hint">{buildFootHint}</div><button className="btn" disabled={!buildOk} onClick={continueBuild}>{buildActionLabel}</button></div>
            </section>
          )}
          {screen === "sc-border" && (
            <section className="screen active">
              <TopBack onClick={() => go("sc-build")} title="Escolha a borda" />
              <PizzaCtx />
              <div className="screen-head"><div className="eyebrow">Quase pronta</div><h2>Escolha a borda</h2><p>Toque em uma opcao para adicionar direto ao pedido.</p></div>
              <div className="opt" onClick={() => addPizzaWithBorder(null, 0)}><div className="opt-emoji">⭕</div><div className="opt-body"><div className="opt-title">Sem borda</div></div><div className="opt-check" /></div>
              {(menu.borders || []).map((b, i) => { const p = bigBorder(size!) ? b.priceLarge : b.priceSmall; const esg = esgotados.includes(b.label); return (<div key={i} className={`opt ${border === b.label ? "sel" : ""}`} onClick={() => !esg && addPizzaWithBorder(b.label, p)} style={{ opacity: esg ? 0.5 : 1, cursor: esg ? "not-allowed" : "pointer" }}><div className="opt-emoji">🧀</div><div className="opt-body"><div className="opt-title">{b.label}</div>{esg && <div className="opt-desc" style={{ color: "#ef4444" }}>Esgotado</div>}</div><div className="opt-price">{esg ? "" : `+${money(p)}`}</div><div className="opt-check" /></div>); })}
            </section>
          )}
          {screen === "sc-promo" && promoSel && (
            <section className="screen active">
              <TopBack onClick={() => { setPromoSel(null); go("sc-start"); }} title="Promoção" />
              <div className="screen-head"><div className="eyebrow">{promoSel.badge || "PROMOÇÃO"}</div><h2>{promoSel.title}</h2><p>{promoSel.description}</p></div>
              <div style={{ background: "var(--card)", borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>O que vem na promoção</div>
                {promoSel.mainItems.map((m, i) => (
                  <div key={`m${i}`} style={{ fontSize: 14, color: "var(--fg)", fontWeight: 600, marginBottom: 4 }}>{m.quantity > 1 ? `${m.quantity}x ` : ""}{m.productName}</div>
                ))}
                {promoSel.freeItems.map((f, i) => (
                  <div key={`f${i}`} style={{ fontSize: 14, color: "#62a256", fontWeight: 700, marginBottom: 4 }}>+ {f.quantity > 1 ? `${f.quantity}x ` : ""}{f.productName} grátis (R$ 0,00)</div>
                ))}
                {promoSel.includedText && <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>{promoSel.includedText}</div>}
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16, fontWeight: 800, paddingTop: 10, marginTop: 8, borderTop: "1px solid var(--border)" }}>
                  <span>Preço promocional</span><span style={{ color: "#ff6b00" }}>{typeof promoSel.promotionalPrice === "number" ? money(promoSel.promotionalPrice) : "—"}</span>
                </div>
              </div>
              {promoPrecisaSabor(promoSel) && (
                <>
                  <div className="section-label">Escolha o sabor da pizza</div>
                  {[...(menu.saltyFlavors || []), ...(menu.sweetFlavors || [])].map((f) => {
                    const esg = esgotados.includes(f);
                    return (
                      <div key={f} className={`opt ${promoSabor === f ? "sel" : ""}`} onClick={() => !esg && setPromoSabor(f)} style={{ opacity: esg ? 0.5 : 1, cursor: esg ? "not-allowed" : "pointer" }}>
                        <div className="opt-emoji">🍕</div><div className="opt-body"><div className="opt-title">{f}</div>{esg && <div className="opt-desc" style={{ color: "#ef4444" }}>Esgotado</div>}</div><div className="opt-check" />
                      </div>
                    );
                  })}
                </>
              )}
              <button className="btn" style={{ marginTop: 16 }} disabled={promoPrecisaSabor(promoSel) && !promoSabor} onClick={adicionarPromocao}>Adicionar promoção ao carrinho</button>
            </section>
          )}
          {screen === "sc-another" && (
            <section className="screen active">
              <TopBack onClick={() => go("sc-cart")} title="Adicionar mais?" />
              <div className="screen-head"><div className="eyebrow">Pizza adicionada ✓</div><h2>Mais uma pizza?</h2><p>{pizzasNoCarrinho()} pizza{pizzasNoCarrinho() > 1 ? "s" : ""} no pedido</p></div>
              <div className="opt" onClick={addAnother}><div className="opt-emoji">🍕</div><div className="opt-body"><div className="opt-title">Montar outra pizza</div></div></div>
              <div className="opt" onClick={() => go("sc-start")}><div className="opt-emoji">🥤</div><div className="opt-body"><div className="opt-title">Adicionar bebida ou lanche</div></div></div>
              <div className="opt" onClick={() => go("sc-cart")}><div className="opt-emoji">✅</div><div className="opt-body"><div className="opt-title">Pronto, ver meu pedido</div></div></div>
            </section>
          )}
          {screen === "sc-list" && (
            <section className="screen active">
              <TopBack onClick={() => go("sc-start")} title={({ lanche: "Lanches", macarronada: "Macarronada", bebida: "Bebidas", suco: "Sucos" } as Record<string, string>)[listCat] || "Escolha o produto"} />
              {(() => {
                const lanches = menu.lanches || [];
                const cfg = { lanche: { eb: "Lanches & Porções", t: "Escolha seu lanche", data: lanches.filter((it) => !isMacarronada(it)), emoji: "🍽️" }, macarronada: { eb: "Macarronada", t: "Escolha sua macarronada", data: lanches.filter(isMacarronada), emoji: "🍝" }, bebida: { eb: "Bebidas", t: "Bebidas geladas", data: menu.bebidas || [], emoji: "🥤" }, suco: { eb: "Sucos naturais", t: "Sucos da casa", data: menu.sucos || [], emoji: "🧃" } }[listCat];
                return (<><div className="screen-head"><div className="eyebrow">{cfg.eb}</div><h2>{cfg.t}</h2><p>Toque para adicionar.</p></div>{cfg.data.map((it, i) => { const esg = esgotados.includes(it.name); return (<div key={i} className="opt" onClick={() => !esg && addSimple(it, cfg.emoji)} style={{ opacity: esg ? 0.5 : 1, cursor: esg ? "not-allowed" : "pointer" }}><div className="opt-emoji">{cfg.emoji}</div><div className="opt-body"><div className="opt-title">{it.name}</div>{esg && <div className="opt-desc" style={{ color: "#ef4444" }}>Esgotado</div>}</div><div className="opt-price">{simplePriceLabel(it)}</div></div>); })}</>);
              })()}
            </section>
          )}
          {screen === "sc-suco-leite" && sucoPendente && (
            <section className="screen active">
              <TopBack onClick={() => { setSucoPendente(null); go("sc-list"); }} title="Como prefere o suco?" />
              <div className="screen-head"><div className="eyebrow">Suco natural</div><h2>Com leite?</h2><p>{sucoPendente.name}</p></div>
              <div className="opt" onClick={() => addSucoLeite(false)}><div className="opt-emoji">S</div><div className="opt-body"><div className="opt-title">Sem leite</div></div><div className="opt-price">{money(sucoPendente.price)}</div></div>
              <div className="opt" onClick={() => addSucoLeite(true)}><div className="opt-emoji">+1</div><div className="opt-body"><div className="opt-title">Com leite</div><div className="opt-desc">Adicional de R$ 1,00</div></div><div className="opt-price">{money(sucoPendente.price + 1)}</div></div>
            </section>
          )}          {screen === "sc-macarronada-size" && macarronadaPendente && (
            <section className="screen active">
              <TopBack onClick={() => { setMacarronadaPendente(null); go("sc-list"); }} title="Escolha o tamanho" />
              <div className="screen-head"><div className="eyebrow">Macarronada</div><h2>Escolha o tamanho</h2><p>{macarronadaPendente.name}</p></div>
              {(macarronadaPendente.sizes || []).map((s) => (
                <div key={s.code} className="opt" onClick={() => addMacarronadaSize(s.code)}><div className="opt-emoji">🍽️</div><div className="opt-body"><div className="opt-title">Tamanho {s.code}</div></div><div className="opt-price">{money(s.price)}</div></div>
              ))}
            </section>
          )}
          {screen === "sc-cart" && (
            <section className="screen active cart-screen">
              <TopBack onClick={backFromCart} title="Sacola" />
              {restoredDraft && (
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10, background: "var(--brand-soft)", border: "1px solid var(--brand)", borderRadius: 14, padding: "12px 14px", marginBottom: 14 }}>
                  <span style={{ fontSize: 20, flexShrink: 0 }}>🍕</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>Seu pedido continua aqui</div>
                    <div style={{ fontSize: 13, color: "var(--text-sub)", marginTop: 2 }}>Restauramos o que você já tinha escolhido.</div>
                  </div>
                  <button onClick={() => setRestoredDraft(false)} style={{ background: "none", border: "none", color: "var(--text-faint)", fontSize: 18, cursor: "pointer", padding: "0 2px", lineHeight: 1 }}>×</button>
                </div>
              )}
              <div className="screen-head"><div className="eyebrow">Sua sacola</div><h2>Confira os itens</h2><p>Tudo certo? Então bora finalizar.</p></div>
              {cart.length === 0 ? (<div className="empty"><div className="big">🛒</div><div>Seu pedido está vazio.</div></div>) : (
                <>{(() => { let pn = 0; return cart.map((it, i) => { let tag = null; if (it.kind === "pizza") { pn++; tag = <span className="ci-tag">Pizza {pn}</span>; } const nm = it.kind === "pizza" ? it.name.replace(/^Pizza /, "") : it.name; const itemEsg = cartItemEsgotado(it.keys, esgotados); return (<div key={i} className="cart-item"><div className="ci-emoji">{it.emoji}</div><div className="ci-body"><div className="ci-name">{tag}{nm}{it.qty > 1 ? ` ×${it.qty}` : ""}{itemEsg && <span style={{ color: "#ef4444", fontWeight: 800, marginLeft: 6 }}>· Esgotado</span>}</div>{it.detail && <div className="ci-detail">{it.detail}</div>}<div className="ci-price">{money(it.price * it.qty)}</div>{it.kind === "simple" && (<div className="qty-pill"><button onClick={() => chQty(i, -1)}>−</button><span>{it.qty}</span><button onClick={() => chQty(i, 1)}>+</button></div>)}</div><button className="ci-remove" onClick={() => rmItem(i)}>✕</button></div>); }); })()}<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 4px 4px", fontWeight: 700, fontSize: 19 }}><span>Subtotal</span><span>{money(cartTotal)}</span></div></>
              )}
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 4 }} onClick={() => go("sc-start")}>+ Adicionar mais</button>
              {cartEsgotado && <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, background: "rgba(239,68,68,.1)", color: "#ef4444", fontSize: 13, fontWeight: 700 }}>Um item do seu pedido ficou esgotado. Remova para continuar.</div>}
            </section>
          )}
          {screen === "sc-delivery" && (
            <section className="screen active delivery-screen">
              <TopBack onClick={() => go("sc-cart")} title="Entrega" />
              <div className="screen-head"><div className="eyebrow">Entrega</div><h2>Como prefere receber?</h2></div>
              <div className={`opt ${delType === "delivery" ? "sel" : ""}`} onClick={() => { setDelType("delivery"); if (erroEntrega) setErroEntrega(""); }}><div className="opt-emoji">🛵</div><div className="opt-body"><div className="opt-title">Entrega (delivery)</div><div className="opt-desc">Levamos até você</div></div><div className="opt-check" /></div>
              <div className={`opt ${delType === "retirada" ? "sel" : ""}`} onClick={() => { setDelType("retirada"); setBairroIdx(""); setErroEntrega(""); }}><div className="opt-emoji">🏪</div><div className="opt-body"><div className="opt-title">Buscar na loja</div><div className="opt-desc">Sem taxa de entrega</div></div><div className="opt-check" /></div>
              <div className={`opt ${delType === "dine_in" ? "sel" : ""}`} onClick={() => { setDelType("dine_in"); setBairroIdx(""); setErroEntrega(""); }}><div className="opt-emoji">🍽️</div><div className="opt-body"><div className="opt-title">Consumo no local</div><div className="opt-desc">Comer aqui na pizzaria</div></div><div className="opt-check" /></div>
              {delType === "delivery" && (
                <div>
                  <div className="section-label">Endereço</div>
                  {erroEntrega && <div style={{ color: "#ef4444", fontSize: 12, fontWeight: 700, margin: "-4px 0 10px" }}>{erroEntrega}</div>}
                  <div className="field">
                    <label>Bairro</label>
                    <select value={bairroIdx} onChange={(e) => { setBairroIdx(e.target.value); if (erroEntrega) setErroEntrega(""); }} style={bairroSelectStyle}>
                      <option value="" style={bairroOptionStyle}>Selecione o bairro...</option>
                      {(menu.neighborhoods || []).map((b, i) => <option key={i} value={i} style={bairroOptionStyle}>{b.name} - {money(b.fee)}</option>)}
                    </select>
                    {bairroErro && <div style={{ color: "#ef4444", fontSize: 12, marginTop: 4 }}>Selecione o bairro</div>}
                  </div>
                  <div className="field">
                    <label>Rua</label>
                    <input value={rua} onChange={(e) => { setRua(e.target.value); if (erroEntrega) setErroEntrega(""); }} placeholder="Rua das Flores" style={ruaErro ? enderecoErroStyle : undefined} />
                    {ruaErro && <div style={{ color: "#ef4444", fontSize: 12, marginTop: 4 }}>Preencha a rua</div>}
                  </div>
                  <div className="field">
                    <label>Número</label>
                    <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                      <input value={numero} onChange={(e) => { setNumero(e.target.value); if (erroEntrega) setErroEntrega(""); }} inputMode="text" placeholder="123" style={numeroErro ? enderecoErroStyle : undefined} />
                      <button type="button" onClick={() => { setNumero("S/N"); if (erroEntrega) setErroEntrega(""); }} style={{ flex: "0 0 auto", border: "1px solid var(--line-strong)", borderRadius: 13, background: numero.trim().toUpperCase() === "S/N" ? "var(--brand-soft)" : "var(--surface2)", color: numero.trim().toUpperCase() === "S/N" ? "var(--brand)" : "var(--text)", fontSize: 12, fontWeight: 700, padding: "0 12px" }}>Sem número</button>
                    </div>
                    {numeroErro && <div style={{ color: "#ef4444", fontSize: 12, marginTop: 4 }}>Preencha o n?mero</div>}
                  </div>
                  <div className="field"><label>Referencia (opcional)</label><input value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Perto do mercado" /></div>
                </div>
              )}
              <div className="checkout-summary">{cartCount} {cartCount === 1 ? "item" : "itens"} · {money(finalTotal)}</div>
            </section>
          )}
          {screen === "sc-pay" && (
            <section className="screen active pay-screen">
              <TopBack onClick={() => go("sc-delivery")} title="Pagamento" />
              <div className="screen-head pay-head"><div className="eyebrow">Último passo</div><h2>Escolha o pagamento</h2><p>Depois confira seus dados e finalize.</p></div>

              <details className="order-summary-compact">
                <summary><span>{cartCount} {cartCount === 1 ? "item" : "itens"}</span><strong>{money(finalTotal)}</strong></summary>
                <div className="summary-lines">
                  {cart.map((c, i) => (
                    <div key={i} className="summary-line">
                      <span>{c.qty > 1 ? `${c.qty}x ` : ""}{c.name}{c.detail ? ` - ${c.detail}` : ""}</span>
                      <strong>{money(c.price * c.qty)}</strong>
                    </div>
                  ))}
                  {fee > 0 && <div className="summary-line"><span>Taxa de entrega</span><strong>{money(fee)}</strong></div>}
                  <button type="button" className="summary-edit" onClick={() => go("sc-cart")}>Editar carrinho</button>
                </div>
              </details>

              <div ref={pagamentoRef} className="payment-choice">
                <div className="section-label" style={{ marginTop: 0 }}>Forma de pagamento</div>
                <div className="payment-grid">
                  {(menu.payments || []).map((p) => (
                    <button key={p} type="button" className={`payment-card ${payment === p ? "sel" : ""}`} onClick={() => openPaymentConfig(p)}>
                      <span className="payment-icon">{paymentIcon(p)}</span>
                      <span className="payment-card-text"><strong>{paymentLabel(p)}</strong><small>{paymentSummary(p)}</small></span>
                      <span className="payment-edit" aria-hidden="true">✎</span>
                    </button>
                  ))}
                </div>
                {erroPagamento && <div className="pay-error">Falta escolher como voce vai pagar.</div>}
              </div>

              {/* Bloco: Identificação */}
              {!editandoIdentidade && nome.trim() && telefoneValido(telefone) ? (
                <div style={{ background: "var(--card)", borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
                  <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Pedido identificado</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "var(--fg)" }}>{nome.trim()}</div>
                  <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>{telefone}</div>
                  <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 8, lineHeight: 1.5 }}>Vamos usar esses dados nesse pedido. Se estiver tudo certo, é só escolher o pagamento.</div>
                  <button
                    style={{ marginTop: 8, background: "none", border: "none", color: "#ff6b00", fontSize: 13, cursor: "pointer", padding: 0, textDecoration: "underline" }}
                    onClick={() => setEditandoIdentidade(true)}
                  >Alterar dados</button>
                </div>
              ) : (
                <div style={{ marginBottom: 16 }}>
                  <div className="section-label">Pra quem é o pedido?</div>
                  <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12, marginTop: -4 }}>Rapidinho: é só pra gente identificar seu pedido e falar com você se precisar.</p>
                  <div className="field">
                    <label>Seu nome</label>
                    <input ref={nomeRef} value={nome} onChange={(e) => { setNome(e.target.value); if (erroNome) setErroNome(""); }} placeholder="Como te chamamos?" />
                    {erroNome && <div style={{ color: "#ef4444", fontSize: 12, marginTop: 4 }}>{erroNome}</div>}
                  </div>
                  <div className="field">
                    <label>WhatsApp</label>
                    <input ref={telefoneRef} value={telefone} onChange={(e) => { const f = formatTel(e.target.value); setTelefone(f); if (erroTelefone) setErroTelefone(""); }} inputMode="tel" placeholder="(99) 9 9999-9999" />
                    {erroTelefone && <div style={{ color: "#ef4444", fontSize: 12, marginTop: 4 }}>{erroTelefone}</div>}
                  </div>
                </div>
              )}
              {/* Bloco: Observação */}
              <div style={{ marginTop: 16, marginBottom: 4 }}>
                <div className="section-label">Algum detalhe no pedido?</div>
                <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10, marginTop: -4 }}>Se quiser, deixa um recado pra cozinha. Se não tiver nada, pode seguir direto.</p>
                <div className="field" style={{ marginBottom: 0 }}><input value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Ex: sem cebola, sem azeitona, tirar milho, pouco orégano…" /></div>
              </div>
              {cartEsgotado && <div style={{ marginTop: 8, padding: "10px 12px", borderRadius: 10, background: "rgba(239,68,68,.1)", color: "#ef4444", fontSize: 13, fontWeight: 700 }}>Um item do seu pedido ficou esgotado. Remova para continuar.</div>}
            </section>
          )}
          {screen === "sc-done" && (
            <section className="screen active">
              <div className="success">
                <div className="check">✓</div>
                <h2>Pedido recebido!</h2>
                <p>Valeu, {nome.split(" ")[0]}! A pizzaria já recebeu seu pedido e vai começar a preparar em breve.</p>
                {pedidoConfirmado && (
                  <>
                    <p style={{ fontWeight: 700, fontSize: 18, margin: "12px 0 4px" }}>Pedido #{pedidoConfirmado.numero}</p>
                    <p style={{ color: "#ff6b00", fontSize: 15, fontWeight: 800, margin: "0 0 8px" }}>{STATUS_PEDIDO_LABEL[statusPedidoConfirmado]}</p>
                    <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 16 }}>Total: {money(pedidoConfirmado.total)}</p>
                    {pedidoConfirmado.pix?.qrCode && (
                      <div style={{ textAlign: "left", background: "var(--card)", borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
                        <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Pix copia e cola</div>
                        {typeof pedidoConfirmado.pix.valorEsperado === "number" && <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>Valor do Pix: {money(pedidoConfirmado.pix.valorEsperado)}</div>}
                        <textarea readOnly value={pedidoConfirmado.pix.qrCode} style={{ width: "100%", minHeight: 92, border: "1px solid var(--line)", borderRadius: 10, background: "var(--surface2)", color: "var(--fg)", padding: 10, resize: "vertical", fontSize: 12, lineHeight: 1.4 }} />
                        <button className="btn btn-sm" style={{ width: "100%", marginTop: 10 }} onClick={async () => showToast((await copiarTexto(pedidoConfirmado.pix?.qrCode || "")) ? "Código Pix copiado!" : "Não consegui copiar. Toque no texto acima e copie manualmente.")}>📋 Copiar código Pix</button>
                        {pedidoConfirmado.pix.ticketUrl && <a href={pedidoConfirmado.pix.ticketUrl} target="_blank" rel="noreferrer" style={{ display: "block", marginTop: 8, color: "#ff6b00", fontSize: 13, fontWeight: 800 }}>Abrir pagamento</a>}
                      </div>
                    )}
                    {payment === "Pix" && !pedidoConfirmado.pix?.qrCode && statusPedidoConfirmado === "novo" && (
                      <div style={{ textAlign: "left", background: "var(--card)", borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
                        <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>⏳ Aguardando confirmação do Pix</div>
                        <p style={{ fontSize: 13, color: "var(--fg)", margin: 0, lineHeight: 1.5 }}>Seu pedido foi recebido. A pizzaria confirma o pagamento antes de começar o preparo.</p>
                        <p style={{ fontSize: 13, color: "var(--muted)", margin: "8px 0 0", lineHeight: 1.5 }}>Se você já fez o Pix, envie o comprovante pelo WhatsApp da pizzaria.</p>
                      </div>
                    )}
                    <a href={`/rastrear/${pedidoConfirmado.id}`} className="btn" style={{ display: "block", marginBottom: 10, textAlign: "center", textDecoration: "none" }}>Acompanhar pedido</a>
                  </>
                )}
                <button className="btn btn-ghost" style={{ marginTop: pedidoConfirmado ? 0 : 22 }} onClick={resetAll}>Fazer novo pedido</button>
              </div>
            </section>
          )}
        </main>
      </div>
      {cartCount > 0 && screen === "sc-cart" && (
        <div className="delivery-cta-bar">
          <div className="delivery-cta-inner cart-cta-inner">
            <div className="delivery-cta-info">
              <div className="delivery-cta-label">Subtotal</div>
              <div className="delivery-cta-total">{money(cartTotal)}</div>
            </div>
            <button className="delivery-cta-cart" onClick={() => go("sc-start")}>Adicionar</button>
            <button className="btn delivery-cta-btn" disabled={cartEsgotado} onClick={() => !cartEsgotado && go("sc-delivery")}>Ir para entrega</button>
          </div>
        </div>
      )}
      {cartCount > 0 && screen === "sc-delivery" && (
        <div className="delivery-cta-bar">
          <div className="delivery-cta-inner">
            <div className="delivery-cta-info">
              <div className="delivery-cta-label">Total</div>
              <div className="delivery-cta-total">{money(finalTotal)}</div>
            </div>
            <button className="delivery-cta-cart" onClick={() => go("sc-cart")}>Sacola</button>
            <button className="btn delivery-cta-btn" disabled={!delType} onClick={continueToPayment}>Continuar para pagamento</button>
          </div>
        </div>
      )}
      {cartCount > 0 && screen === "sc-pay" && (
        <div className="delivery-cta-bar">
          <div className="delivery-cta-inner pay-cta-inner">
            <div className="delivery-cta-info">
              <div className="delivery-cta-label">Total</div>
              <div className="delivery-cta-total">{money(finalTotal)}</div>
            </div>
            <button className="btn delivery-cta-btn" disabled={sending || cartEsgotado} onClick={finish}>{sending ? "Enviando…" : "Finalizar pedido"}</button>
          </div>
        </div>
      )}
      {showStrongCartCta && (
        <div className="delivery-cta-bar">
          <div className="delivery-cta-inner pay-cta-inner">
            <div className="delivery-cta-info">
              <div className="delivery-cta-label">Sacola</div>
              <div className="delivery-cta-total">{cartCount} {cartCount === 1 ? "item" : "itens"} · {money(finalTotal)}</div>
            </div>
            <button className="btn delivery-cta-btn" onClick={() => go("sc-cart")}>Revisar pedido</button>
          </div>
        </div>
      )}
      {cartCount > 0 && !showStrongCartCta && screen !== "sc-done" && screen !== "sc-cart" && screen !== "sc-delivery" && screen !== "sc-pay" && (<div className="cartbar show"><div className="cartbar-inner"><div className="cartbar-info"><div className="cartbar-count">Sacola</div><div className="cartbar-total">{cartCount} {cartCount === 1 ? "item" : "itens"} · {money(finalTotal)}</div></div><button className="cartbar-link" onClick={() => go("sc-cart")}>Editar</button></div></div>)}
      {paymentModal && (
        <div className="payment-modal-backdrop" role="presentation" onClick={() => setPaymentModal(null)}>
          <div className="payment-modal" role="dialog" aria-modal="true" aria-labelledby="payment-modal-title" onClick={(e) => e.stopPropagation()}>
            <div className="payment-modal-head">
              <div>
                <div className="payment-modal-kicker">Pagamento</div>
                <h3 id="payment-modal-title">{paymentLabel(paymentModal)}</h3>
              </div>
              <button type="button" className="payment-modal-close" aria-label="Fechar" onClick={() => setPaymentModal(null)}>×</button>
            </div>
            {paymentModal === "Pix" && (
              <div className="payment-modal-body">
                <p>A pizzaria confirma o Pix antes de preparar.</p>
                <p>Depois de finalizar, as instrucoes aparecem no pedido.</p>
              </div>
            )}
            {paymentModal === "Cartao" && (
              <div className="payment-modal-body">
                <p>Pagamento na maquina da pizzaria.</p>
                <p>Vale para entrega, retirada ou consumo no local.</p>
              </div>
            )}
            {paymentModal !== "Pix" && paymentModal !== "Cartao" && paymentModal !== "Dinheiro" && (
              <div className="payment-modal-body"><p>{paymentHint(paymentModal)}</p></div>
            )}
            {paymentModal === "Dinheiro" && (
              <div className="payment-modal-body">
                <div className="money-choice-title">Precisa de troco?</div>
                <div className="money-choice-row">
                  <button type="button" className={`btn ${trocoOpcao === "nao" ? "" : "btn-ghost"}`} onClick={() => { setTrocoOpcao("nao"); setTroco(""); setErroTroco(""); }}>Nao preciso</button>
                  <button type="button" className={`btn ${trocoOpcao === "sim" ? "" : "btn-ghost"}`} onClick={() => { setTrocoOpcao("sim"); setErroTroco(""); }}>Preciso</button>
                </div>
                {trocoOpcao === "sim" && (
                  <div className="field money-field">
                    <label>Troco para quanto?</label>
                    <input value={troco} onChange={(e) => { setTroco(e.target.value); if (erroTroco) setErroTroco(""); }} inputMode="numeric" placeholder={`Ex: ${Math.ceil((cartTotal + fee) / 10) * 10}`} />
                  </div>
                )}
                {erroTroco && <div className="pay-error">{erroTroco}</div>}
              </div>
            )}
            <div className="payment-modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setPaymentModal(null)}>Cancelar</button>
              <button type="button" className="btn" onClick={confirmPaymentConfig}>Confirmar</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="toast show">{toast}</div>}
    </>
  )
}

// ==================== ROOT ====================

export default function CardapioPage() {
  const { menu, erro, retry } = useLiveMenu();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
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
      <button onClick={retry} style={{ border: "1px solid #333", background: "transparent", color: "#f5f2ee", padding: "10px 20px", borderRadius: 10, cursor: "pointer", fontSize: 14 }}>Tentar de novo</button>
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
:root{--font-ui:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
:root[data-theme="dark"]{--bg:#171210;--surface:#221b18;--surface2:#2c2320;--text:#f0e9e1;--text-sub:#a89a8b;--text-faint:#6f655c;--brand:#f0512f;--brand-press:#d2421f;--brand-soft:rgba(240,81,47,.13);--gold:#edb24a;--green:#62a256;--green-soft:rgba(98,162,86,.16);--line:rgba(246,239,231,.08);--line-strong:rgba(246,239,231,.16);--shadow-sm:0 1px 8px rgba(0,0,0,.22);}
:root[data-theme="light"]{--bg:#f7f2ea;--surface:#fff;--surface2:#fbf6ee;--text:#2a1d16;--text-sub:#8a7a6c;--text-faint:#b3a596;--brand:#e8472b;--brand-press:#c2371f;--brand-soft:rgba(232,71,43,.09);--gold:#c98a17;--green:#4f8a43;--green-soft:rgba(79,138,67,.12);--line:rgba(42,29,22,.08);--line-strong:rgba(42,29,22,.14);--shadow-sm:0 1px 8px rgba(120,80,40,.07);}
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{font-family:var(--font-ui);background:var(--bg);color:var(--text);line-height:1.5;overflow-x:hidden;padding-bottom:112px;transition:background .35s,color .35s;font-size:16px;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
.wrap{width:min(100%,540px);max-width:540px;margin:0 auto;min-height:100vh;position:relative;font-family:var(--font-ui);padding-top:46px}
.wrap-start{padding-top:0;background:#0b0807}
.wrap h1,.wrap h2,.wrap h3,.wrap button,.wrap input,.wrap select,.wrap textarea{font-family:var(--font-ui)}
header{width:100%;background:var(--surface);padding:18px 20px;border-bottom:1px solid var(--line);transition:background .35s}
.head-row{display:flex;align-items:center;justify-content:space-between;gap:12px}
.logo{display:flex;align-items:center;gap:12px}
.logo-mark{width:42px;height:42px;border-radius:13px;background:var(--brand);display:flex;align-items:center;justify-content:center;font-size:22px;box-shadow:0 2px 10px var(--brand-soft)}
.logo h1{font-family:var(--font-ui);font-weight:600;font-size:19px;letter-spacing:0;line-height:1.1}
.logo p{font-size:12.5px;color:var(--text-sub);margin-top:3px;font-weight:400}
.theme-btn{width:40px;height:40px;border-radius:12px;border:1px solid var(--line-strong);background:var(--surface2);color:var(--text);font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:.2s}
.theme-btn:active{transform:scale(.92)}
.status-row{display:flex;align-items:center;gap:10px;margin-top:14px}
.status{display:inline-flex;align-items:center;gap:7px;background:var(--green-soft);color:var(--green);padding:6px 13px;border-radius:20px;font-size:12.5px;font-weight:500}
.eta{color:var(--text-sub);font-size:12.5px;font-weight:600}
.status .dot{width:7px;height:7px;border-radius:50%;background:var(--green);animation:pulse 2s infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 var(--green-soft)}70%{box-shadow:0 0 0 7px transparent}100%{box-shadow:0 0 0 0 transparent}}
.steps{position:fixed;top:0;left:50%;transform:translateX(-50%);width:100%;max-width:540px;z-index:50;display:flex;gap:8px;padding:12px 20px;align-items:center;background:var(--bg);border-bottom:1px solid var(--line);box-shadow:0 1px 8px rgba(0,0,0,.16);transition:background .35s}
.step-chip{display:flex;align-items:center;gap:7px;font-size:12.5px;font-weight:500;color:var(--text-faint);letter-spacing:0}
.step-chip .num{width:22px;height:22px;border-radius:50%;border:1.5px solid var(--line-strong);display:flex;align-items:center;justify-content:center;font-size:11px;transition:.25s}
.step-chip.active{color:var(--text);font-weight:600}
.step-chip.active .num{background:var(--brand);border-color:var(--brand);color:#fff}
.step-chip.done{color:var(--green)}
.step-chip.done .num{background:var(--green);border-color:var(--green);color:#fff}
.step-line{flex:1;height:1.5px;background:var(--line);border-radius:2px}
.step-line.done{background:var(--green)}
main{width:100%;padding:6px 20px 20px}
.wrap-start main{padding:18px 20px 112px}
.screen{width:100%}
.screen.active{display:block;animation:slide .4s cubic-bezier(.2,.8,.2,1)}
@keyframes slide{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:none}}
.top-back{display:flex;align-items:center;gap:12px;margin:4px 0 12px}
.top-back button{width:38px;height:38px;display:flex;align-items:center;justify-content:center;padding:0;border:1px solid var(--line-strong);background:var(--surface2);color:var(--text-sub);font-family:var(--font-ui);font-size:17px;font-weight:700;border-radius:999px;box-shadow:var(--shadow-sm);flex-shrink:0}
.top-back-title{font-size:16.5px;font-weight:800;color:var(--text);letter-spacing:-.2px}
.header-min{padding:12px 20px}
.header-min .logo-mark{width:34px;height:34px;border-radius:10px;font-size:18px}
.header-min .logo h1{font-size:15.5px}
.header-min .logo p{font-size:12px;margin-top:2px}
.screen-head{margin:18px 0 20px}
.top-back + .screen-head{margin-top:8px}
.eyebrow{font-size:11px;font-weight:600;color:var(--brand);text-transform:uppercase;letter-spacing:1.4px}
.screen-head h2{font-family:var(--font-ui);font-weight:600;font-size:23px;letter-spacing:-.4px;margin-top:7px;line-height:1.2}
.screen-head p{font-size:14.5px;color:var(--text-sub);margin-top:7px;font-weight:400;line-height:1.5}
.pizza-ctx{display:flex;align-items:center;gap:11px;background:var(--brand-soft);border-radius:14px;padding:12px 15px;margin:16px 0 2px}
.pc-badge{background:var(--brand);color:#fff;font-weight:600;font-size:12px;padding:5px 11px;border-radius:20px;white-space:nowrap}
.pc-txt{font-size:13px;color:var(--text-sub);flex:1}
.pc-txt strong{color:var(--text);font-weight:600}
.pizza-dots{display:flex;gap:5px}
.pd{width:7px;height:7px;border-radius:50%;background:var(--line-strong)}
.pd.done{background:var(--green)}.pd.cur{background:var(--brand);transform:scale(1.3)}
.opt{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:17px;margin-bottom:10px;cursor:pointer;display:flex;align-items:center;gap:14px;transition:transform .14s,border-color .14s,background .14s;box-shadow:var(--shadow-sm)}
.opt:active{transform:scale(.98)}
.opt.sel{border-color:var(--brand);background:var(--brand-soft)}
.opt-emoji{font-size:27px;flex:0 0 auto;width:33px;text-align:center}
.opt-body{flex:1;min-width:0}
.opt-title{font-weight:600;font-size:15.5px;letter-spacing:-.1px}
.opt-desc{font-size:13px;color:var(--text-sub);margin-top:3px;line-height:1.4;font-weight:400}
.opt-price{font-weight:600;font-size:14.5px;color:var(--gold);white-space:nowrap}
.opt-check{width:23px;height:23px;border-radius:50%;border:2px solid var(--line-strong);flex:0 0 auto;display:flex;align-items:center;justify-content:center;font-size:13px;color:#fff;transition:.16s}
.opt.sel .opt-check{background:var(--brand);border-color:var(--brand)}
.opt.sel .opt-check::after{content:"✓"}
.home-screen{padding-bottom:8px}
.promo-scroll{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:none;margin:0 -20px;padding:0 20px 4px}
.promo-scroll::-webkit-scrollbar{display:none}
.promo-card{flex:0 0 86%;scroll-snap-align:start;background:linear-gradient(145deg,rgba(72,36,20,.78),rgba(24,15,12,.98) 58%,rgba(14,11,10,1));border:1px solid rgba(240,81,47,.28);border-radius:22px;padding:20px;box-shadow:0 18px 50px rgba(0,0,0,.34),inset 0 1px 0 rgba(255,255,255,.04)}
.promo-label{color:#f59b67;font-size:10.5px;font-weight:800;letter-spacing:1.4px;margin-bottom:10px}
.promo-card h2{color:#fff4ec;font-size:25px;font-weight:850;line-height:1.08;letter-spacing:0;margin-bottom:8px}
.promo-card p{color:#b9aaa0;font-size:14px;line-height:1.45;margin-bottom:18px}
.promo-btn{width:100%;border:0;border-radius:15px;background:#f05a28;color:#fff;padding:15px 16px;font-size:15px;font-weight:800;box-shadow:0 12px 26px rgba(240,90,40,.2)}
@media (min-width:640px){.promo-card{flex-basis:340px}}
.home-copy{margin:24px 0 14px}
.home-copy h2{color:#f7efe7;font-size:22px;font-weight:850;letter-spacing:0;line-height:1.15}
.home-copy p{color:#9d8f85;font-size:14px;margin-top:6px}
.home-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.home-cat{min-height:118px;text-align:left;background:#15110f;border:1px solid rgba(255,255,255,.08);border-radius:20px;padding:16px;display:flex;flex-direction:column;justify-content:space-between;color:#f4ece5;box-shadow:0 10px 28px rgba(0,0,0,.22)}
.home-cat:active{transform:scale(.98);border-color:rgba(240,81,47,.5)}
.home-cat span{font-size:27px}
.home-cat strong{font-size:15.5px;font-weight:800;letter-spacing:0}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:11px}
.grid2 .opt{flex-direction:column;align-items:flex-start;gap:7px;padding:17px;position:relative}
.grid2 .opt-check{position:absolute;top:13px;right:13px;width:20px;height:20px}
.grid2 .opt-emoji{width:auto}
.section-label{font-size:11px;font-weight:600;color:var(--text-sub);text-transform:uppercase;letter-spacing:1px;margin:22px 0 10px;display:flex;align-items:center;gap:7px}
.size-choice{padding-top:8px}
.choice-nudge{margin:0 0 12px;padding:10px 12px;border-radius:12px;background:var(--surface2);border:1px solid var(--line);color:var(--text-sub);font-size:13px;font-weight:700}
.choice-nudge.ok{color:var(--green);background:var(--green-soft);border-color:rgba(98,162,86,.26)}
.mini-size-opt{min-height:136px}
.muted-head{opacity:.68}
.locked-note{border:1px dashed var(--line-strong);border-radius:15px;padding:18px 14px;color:var(--text-sub);font-size:13.5px;text-align:center;background:rgba(255,255,255,.02)}
.mam{display:flex;align-items:center;justify-content:space-between;background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:16px 18px;margin-bottom:14px;cursor:pointer;box-shadow:var(--shadow-sm)}
.mam.on{border-color:var(--brand);background:var(--brand-soft)}
.mam-txt strong{font-weight:600;font-size:15.5px;letter-spacing:-.1px}
.mam-txt p{font-size:13px;color:var(--text-sub);margin-top:2px;font-weight:400}
.choice-block{background:rgba(255,255,255,.025);border:1px solid var(--line);border-radius:18px;padding:2px 10px 12px;margin-bottom:22px}
.flavor-head{margin-top:6px;margin-bottom:14px}
.flavor-mode{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}
.flavor-mode-card{text-align:left;background:var(--surface);border:1px solid var(--line);border-radius:15px;padding:14px;color:var(--text);box-shadow:var(--shadow-sm)}
.flavor-mode-card.sel{border-color:var(--brand);background:var(--brand-soft)}
.flavor-mode-card strong{display:block;font-size:14.5px;font-weight:800}
.flavor-mode-card span{display:block;font-size:12.5px;color:var(--text-sub);margin-top:3px;line-height:1.35}
.mini-flow-note{margin:-2px 0 12px;padding:11px 12px;border-radius:13px;background:var(--brand-soft);color:var(--text-sub);font-size:13px;font-weight:700}
.flavor-list{max-height:470px;overflow-y:auto;padding-right:2px;padding-bottom:86px;scrollbar-width:thin}
.flavor-opt{padding:14px 16px;margin-bottom:8px}
.switch{width:48px;height:28px;border-radius:20px;background:var(--line-strong);position:relative;flex:0 0 auto;transition:.22s}
.switch::after{content:"";position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;transition:.22s;box-shadow:0 1px 3px rgba(0,0,0,.3)}
.mam.on .switch{background:var(--brand)}
.mam.on .switch::after{left:23px}
.half-hint{font-size:13.5px;color:var(--gold);margin:-4px 0 12px;font-weight:500;padding-left:2px}
.btn{width:100%;background:var(--brand);color:#fff;border:none;border-radius:14px;padding:16px;font-family:var(--font-ui);font-size:15.5px;font-weight:600;cursor:pointer;transition:transform .14s,background .14s;box-shadow:0 3px 12px var(--brand-soft);letter-spacing:.1px}
.btn:active{transform:scale(.98);background:var(--brand-press)}
.btn:disabled{opacity:.35;box-shadow:none;cursor:not-allowed}
.btn-ghost{background:transparent;border:1px solid var(--line-strong);color:var(--text);box-shadow:none}
.btn-row{display:flex;gap:11px;margin-top:16px}
.btn-row .btn{margin:0}
.btn-sm{padding:14px;font-size:15px}
.btn-back{flex:0 0 auto;width:54px;padding:14px 0}
.cart-item{background:var(--surface);border:1px solid var(--line);border-radius:15px;padding:15px 16px;margin-bottom:10px;display:flex;gap:12px;align-items:flex-start;box-shadow:var(--shadow-sm)}
.ci-emoji{font-size:23px}
.ci-body{flex:1;min-width:0}
.ci-tag{background:var(--brand-soft);color:var(--brand);font-size:11px;font-weight:600;padding:2px 9px;border-radius:20px;margin-right:7px}
.ci-name{font-weight:600;font-size:14.5px;letter-spacing:-.1px}
.ci-detail{font-size:13px;color:var(--text-sub);margin-top:3px;line-height:1.4}
.ci-price{font-weight:600;color:var(--gold);font-size:14.5px;margin-top:6px}
.ci-remove{background:none;border:none;color:var(--text-faint);font-size:18px;cursor:pointer;padding:2px 4px;line-height:1}
.qty-pill{display:inline-flex;align-items:center;gap:14px;background:var(--surface2);border:1px solid var(--line);border-radius:30px;padding:5px 7px;margin-top:9px}
.qty-pill button{width:30px;height:30px;border-radius:50%;border:none;background:var(--brand);color:#fff;font-size:18px;cursor:pointer;font-weight:600}
.qty-pill span{font-weight:600;min-width:20px;text-align:center}
.field{margin-bottom:14px}
.field label{display:block;font-size:13px;font-weight:600;margin-bottom:7px;letter-spacing:0}
.field input,.field select{width:100%;background:var(--surface);border:1px solid var(--line-strong);border-radius:13px;padding:14px;color:var(--text);font-family:var(--font-ui);font-size:15.5px;transition:.16s;font-weight:400}
.field input:focus,.field select:focus{outline:none;border-color:var(--brand)}
.delivery-screen{padding-bottom:132px}
.delivery-cta-bar{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:540px;z-index:55;background:linear-gradient(to top,var(--bg) 78%,transparent);padding:18px 20px calc(env(safe-area-inset-bottom) + 14px);pointer-events:none}
.delivery-cta-inner{display:grid;grid-template-columns:auto auto minmax(0,1fr);align-items:center;gap:10px;background:var(--surface);border:1px solid var(--line-strong);border-radius:18px;padding:10px;box-shadow:0 -10px 34px rgba(0,0,0,.28);pointer-events:auto}
.delivery-cta-info{min-width:74px;padding-left:4px}
.delivery-cta-label{font-size:11px;color:var(--text-sub);font-weight:600;text-transform:uppercase;letter-spacing:.7px}
.delivery-cta-total{font-size:16px;font-weight:800;color:var(--text);line-height:1.15;white-space:nowrap}
.delivery-cta-cart{border:1px solid var(--line-strong);background:transparent;color:var(--text-sub);border-radius:999px;padding:10px 12px;font-size:12.5px;font-weight:700}
.delivery-cta-btn{margin:0;padding:14px 12px;border-radius:13px;min-width:0;white-space:normal;line-height:1.15}
.pay-screen{padding-bottom:132px}
.pay-cta-inner{grid-template-columns:auto minmax(0,1fr)}
.cart-screen{padding-bottom:132px}
.cart-cta-inner{grid-template-columns:auto auto minmax(0,1fr)}
.pay-head{margin-bottom:12px}
.order-summary-compact{background:var(--surface);border:1px solid var(--line);border-radius:15px;margin:0 0 16px;box-shadow:var(--shadow-sm);overflow:hidden}
.order-summary-compact summary{list-style:none;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;cursor:pointer;color:var(--text-sub);font-size:13px;font-weight:700}
.order-summary-compact summary::-webkit-details-marker{display:none}
.order-summary-compact summary strong{font-size:16px;color:var(--brand)}
.summary-lines{border-top:1px solid var(--line);padding:10px 14px 12px}
.summary-line{display:flex;justify-content:space-between;gap:12px;color:var(--text-sub);font-size:12.5px;line-height:1.35;padding:4px 0}
.summary-line span{min-width:0}
.summary-line strong{white-space:nowrap;color:var(--text);font-weight:700}
.summary-edit{margin-top:8px;background:transparent;border:1px solid var(--line-strong);border-radius:999px;color:var(--text-sub);font-size:12.5px;font-weight:800;padding:8px 12px}
.payment-choice{margin:0 0 16px}
.payment-grid{display:grid;gap:10px}
.payment-card{width:100%;display:flex;align-items:center;gap:12px;text-align:left;background:var(--surface);border:1px solid var(--line);border-radius:16px;color:var(--text);padding:15px;box-shadow:var(--shadow-sm)}
.payment-card.sel{border-color:var(--brand);background:var(--brand-soft)}
.payment-icon{width:34px;height:34px;border-radius:12px;background:var(--surface2);display:flex;align-items:center;justify-content:center;color:var(--brand);font-size:18px;font-weight:900;flex:0 0 auto}
.payment-card-text{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.payment-card-text strong{font-size:15px;font-weight:850;color:var(--text)}
.payment-card-text small{font-size:12.5px;color:var(--text-sub);line-height:1.35}
.payment-edit{width:30px;height:30px;border-radius:999px;border:1px solid var(--line-strong);display:flex;align-items:center;justify-content:center;color:var(--text-sub);font-size:14px;flex:0 0 auto}
.pay-error{color:#ef4444;font-size:12px;font-weight:700;margin-top:8px}
.payment-modal-backdrop{position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center;padding:20px}
.payment-modal{width:100%;max-width:500px;background:var(--surface);border:1px solid var(--line-strong);border-radius:20px;padding:16px;box-shadow:0 -14px 45px rgba(0,0,0,.35);animation:sheet .22s ease-out}
.payment-modal-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px}
.payment-modal-kicker{font-size:11px;color:var(--brand);text-transform:uppercase;letter-spacing:1px;font-weight:800}
.payment-modal h3{font-size:21px;line-height:1.15;margin-top:3px}
.payment-modal-close{width:36px;height:36px;border-radius:999px;background:var(--surface2);border:1px solid var(--line-strong);color:var(--text-sub);font-size:22px;line-height:1}
.payment-modal-body{color:var(--text-sub);font-size:14px;line-height:1.45}
.payment-modal-body p + p{margin-top:7px}
.money-choice-title{font-size:13px;font-weight:800;color:var(--text);margin-bottom:10px}
.money-choice-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px}
.money-choice-row .btn{padding:12px 8px;font-size:13px}
.money-field{margin:0}
.payment-modal-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px}
.payment-modal-actions .btn{padding:13px 10px}
@keyframes sheet{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
.cartbar{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:540px;z-index:50;background:transparent;padding:0 20px calc(env(safe-area-inset-bottom) + 14px);pointer-events:none}
.cartbar-inner{margin:0 auto;display:flex;align-items:center;gap:14px;background:#15110f;border:1px solid rgba(255,255,255,.1);border-radius:20px;padding:12px 12px 12px 16px;box-shadow:0 -10px 34px rgba(0,0,0,.35);pointer-events:auto}
.cartbar-info{flex:1}
.cartbar-count{font-size:12.5px;color:var(--text-sub);font-weight:500}
.cartbar-total{font-family:var(--font-ui);font-weight:700;font-size:15px;line-height:1.2;letter-spacing:0}
.cartbar-link{border:1px solid var(--line-strong);background:transparent;color:var(--text-sub);border-radius:999px;padding:9px 13px;font-size:12.5px;font-weight:700}
.checkout-summary{margin:14px 0 10px;color:var(--text-sub);font-size:13px;font-weight:700;text-align:center}
.empty{text-align:center;padding:54px 20px;color:var(--text-sub)}
.empty .big{font-size:56px;margin-bottom:14px;opacity:.4}
.success{text-align:center;padding:34px 8px}
.success .check{width:80px;height:80px;border-radius:50%;background:var(--green);margin:0 auto 20px;display:flex;align-items:center;justify-content:center;font-size:42px;color:#fff;animation:pop .55s cubic-bezier(.2,1.4,.4,1)}
@keyframes pop{from{transform:scale(0)}to{transform:scale(1)}}
.success h2{font-family:var(--font-ui);font-weight:600;font-size:24px;margin-bottom:9px;letter-spacing:-.4px}
.success p{color:var(--text-sub);font-size:15px;margin-bottom:5px}
.toast{position:fixed;bottom:116px;left:50%;transform:translateX(-50%);background:var(--green);color:#fff;padding:12px 22px;border-radius:30px;font-size:13.5px;font-weight:500;z-index:60;white-space:nowrap}
.qty-grid{display:flex;flex-direction:column;gap:10px}
@media(min-width:480px){.qty-grid{display:grid;grid-template-columns:1fr 1fr;gap:11px}}
.qty-card{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:16px 18px;cursor:pointer;display:flex;align-items:center;gap:14px;transition:transform .14s,border-color .14s,background .14s;box-shadow:var(--shadow-sm)}
.qty-card:active{transform:scale(.98);border-color:var(--brand);background:var(--brand-soft)}
.qty-card-icon{font-size:24px;flex:0 0 auto;width:36px;text-align:center}
.qty-card-body{flex:1;min-width:0}
.qty-card-title{font-weight:600;font-size:15.5px;letter-spacing:-.1px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.qty-card-sub{font-size:13px;color:var(--text-sub);margin-top:3px;font-weight:400}
.qty-badge{font-size:10px;font-weight:700;color:var(--brand);background:var(--brand-soft);padding:2px 8px;border-radius:20px;white-space:nowrap;letter-spacing:.2px}
.sc-build-screen{padding-top:10px;padding-bottom:96px}
.build-back{position:relative;z-index:1;margin:-2px 0 14px;padding:0}
.build-back-btn{background:var(--surface2);border:1px solid var(--line-strong);color:var(--text-sub);font-family:var(--font-ui);font-size:13px;font-weight:600;padding:7px 14px;border-radius:30px;cursor:pointer;box-shadow:var(--shadow-sm);transition:transform .14s}
.build-back-btn:active{transform:scale(.96)}
.build-foot{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:540px;z-index:55;background:var(--surface);border-top:1px solid var(--line);box-shadow:0 -4px 18px rgba(0,0,0,.18);padding:12px 20px calc(env(safe-area-inset-bottom) + 14px)}
.build-foot-hint{font-size:12.5px;color:var(--text-sub);font-weight:700;text-align:center;margin-bottom:8px}
.build-foot .btn{margin:0}
`;
