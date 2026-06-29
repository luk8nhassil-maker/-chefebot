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
              onClick={onSair}
              style={{ height: 32, padding: "0 11px", border: "1px solid #1f1d1a", borderRadius: 9, background: "transparent", color: "#4a4640", fontSize: 12, fontWeight: 700 }}
            >Sair</button>
          </div>

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
  kind: "pizza" | "simple";
  name: string;
  detail: string;
  price: number;
  qty: number;
  // Nomes de produtos (sabores/borda da pizza ou nome do item simples) usados
  // para detectar se o item ficou esgotado depois de adicionado ao carrinho.
  keys?: string[];
};

const money = (v: number) => "R$ " + v.toFixed(2).replace(".", ",");
const bigBorder = (sz: string) => !(sz === "P" || sz === "M");

export function PublicCardapio({ menu }: { menu: MenuType }) {
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
  const [pedidoConfirmado, setPedidoConfirmado] = useState<{ id: string; numero: number; total: number } | null>(null);
  const [erroNome, setErroNome] = useState("");
  const [erroTelefone, setErroTelefone] = useState("");
  const [erroPagamento, setErroPagamento] = useState("");
  const [erroEntrega, setErroEntrega] = useState("");
  const [erroTroco, setErroTroco] = useState("");
  const [trocoOpcao, setTrocoOpcao] = useState<"nao" | "sim" | null>(null);
  const [editandoIdentidade, setEditandoIdentidade] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [restoredDraft, setRestoredDraft] = useState(false);
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

  function showToast(m: string) { setToast(m); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(""), 1700); }
  function go(s: string) { setScreen(s); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function formatTel(v: string) {
    const d = v.replace(/\D/g, "").slice(0, 11);
    if (d.length <= 2) return d;
    if (d.length <= 6) return `(${d.slice(0,2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
    return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  }
  function telefoneValido(t: string) { return t.replace(/\D/g, "").length >= 10; }

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
    const keys = [f1, mam ? f2 : null, border].filter(Boolean) as string[];
    const newItem: CartItem = { emoji: "🍕", kind: "pizza", name: `Pizza ${size}${mam ? " (meio a meio)" : ""}`, detail: `${flavor}${border ? ` · borda ${border}` : ""}`, price: sizePrice + borderPrice, qty: 1, keys };
    const newCart = [...cart, newItem];
    setCart(newCart);
    if (!plan.openEnded && plan.current < plan.total) { setPlan({ ...plan, current: plan.current + 1 }); showToast(`Pizza pronta! 🍕`); resetBuild(); go("sc-build"); }
    else if (plan.openEnded) { showToast("Pizza adicionada! 🍕"); go("sc-another"); }
    else { showToast("Tudo pronto! 🍕"); go("sc-cart"); }
  }
  function addAnother() { setPlan({ total: 0, current: pizzasNoCarrinho() + 1, openEnded: true }); resetBuild(); go("sc-build"); }
  function goCat(cat: "lanche" | "bebida" | "suco") { setListCat(cat); go("sc-list"); }
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

  const esgotados = menu.esgotados || [];
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
    const payload = { cliente: nome.trim(), telefone: telefone.trim(), itens: cart.map((c) => ({ kind: c.kind, name: c.name, detail: c.detail, price: c.price, qty: c.qty })), tipoEntrega: delType, bairro: delType === "delivery" ? menu.neighborhoods[+bairroIdx].name : undefined, rua: delType === "delivery" ? rua : undefined, numero: delType === "delivery" && numero.trim() ? numero.trim() : undefined, referencia: delType === "delivery" && referencia.trim() ? referencia.trim() : undefined, observacao: observacao.trim() || undefined, taxaEntrega: fee, pagamento: payment, troco: payment === "Dinheiro" ? (trocoOpcao === "nao" ? "Sem troco" : troco.trim()) : undefined };
    try {
      const r = await fetch("/api/pedido-app", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await r.json();
      if (data.ok) { try { localStorage.setItem("cf_nome", nome.trim()); localStorage.setItem("cf_tel", telefone.trim()); } catch {} try { sessionStorage.removeItem("cf_draft"); } catch {} setPedidoConfirmado({ id: data.pedidoId, numero: data.numero, total: data.total }); go("sc-done"); } else { showToast("Erro ao enviar. Tente de novo."); }
    } catch { showToast("Sem conexão. Tente de novo."); } finally { setSending(false); }
  }
  function resetAll() { setCart([]); resetBuild(); setDelType(null); setBairroIdx(""); setRua(""); setNumero(""); setReferencia(""); setPayment(null); setTroco(""); setTrocoOpcao(null); setObservacao(""); setErroNome(""); setErroTelefone(""); setErroPagamento(""); setErroEntrega(""); setErroTroco(""); setPedidoConfirmado(null); setRestoredDraft(false); setEditandoIdentidade(false); try { sessionStorage.removeItem("cf_draft"); } catch {} go("sc-start"); }

  const stepMap: Record<string, number> = { "sc-start": 0, "sc-qty": 0, "sc-build": 0, "sc-border": 0, "sc-list": 0, "sc-suco-leite": 0, "sc-macarronada-size": 0, "sc-another": 1, "sc-cart": 1, "sc-delivery": 2, "sc-pay": 3, "sc-done": 3 };
  const stepIdx = stepMap[screen] ?? 0;
  const STEPS = ["Itens", "Sacola", "Entrega", "Pagar"];
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
        <div className="steps">
          {STEPS.map((s, i) => (
            <span key={s} style={{ display: "contents" }}>
              <div className={`step-chip ${i === stepIdx ? "active" : i < stepIdx ? "done" : ""}`}><span className="num">{i < stepIdx ? "✓" : i + 1}</span>{s}</div>
              {i < STEPS.length - 1 && <div className={`step-line ${i < stepIdx ? "done" : ""}`} />}
            </span>
          ))}
        </div>
        <header>
          <div className="head-row">
            <div className="logo"><div className="logo-mark">🍕</div><div><h1>Chefe da Pizza</h1><p>Alto Alegre do MA</p></div></div>
            <button className="theme-btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Trocar tema">{theme === "dark" ? "🌙" : "☀️"}</button>
          </div>
          <div className="status"><span className="dot" /> Aberto · entrega 40–60 min</div>
        </header>
        <main>
          {screen === "sc-start" && (
            <section className="screen active">
              <div className="screen-head"><div className="eyebrow">Bora montar</div><h2>O que vai ser hoje?</h2><p>Escolha por onde começar.</p></div>
              <div className="opt" onClick={goPizza}><div className="opt-emoji">🍕</div><div className="opt-body"><div className="opt-title">Pizza</div><div className="opt-desc">{(menu.saltyFlavors || []).filter(f => !esgotados.includes(f)).length} salgadas, {(menu.sweetFlavors || []).filter(f => !esgotados.includes(f)).length} doces · meio a meio</div></div></div>
              <div className="opt" onClick={() => goCat("lanche")}><div className="opt-emoji">🥪</div><div className="opt-body"><div className="opt-title">Lanches & Porções</div><div className="opt-desc">Calzone, X-burguer, batata…</div></div></div>
              <div className="opt" onClick={() => goCat("bebida")}><div className="opt-emoji">🥤</div><div className="opt-body"><div className="opt-title">Bebidas</div><div className="opt-desc">Refri, guaraná, água, cerveja</div></div></div>
              <div className="opt" onClick={() => goCat("suco")}><div className="opt-emoji">🧃</div><div className="opt-body"><div className="opt-title">Sucos naturais</div><div className="opt-desc">Cajá, caju, maracujá…</div></div></div>
            </section>
          )}
          {screen === "sc-qty" && (
            <section className="screen active">
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
              <div className="btn-row"><button className="btn btn-ghost btn-sm" style={{ color: "var(--text-faint)" }} onClick={() => go("sc-start")}>← Voltar</button></div>
            </section>
          )}
          {screen === "sc-build" && (
            <section className="screen active sc-build-screen">
              <div className="build-back"><button className="build-back-btn" onClick={() => go("sc-qty")}>← Voltar</button></div>
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
              <div className="build-foot"><button className="btn" disabled={!buildOk} onClick={() => go("sc-border")}>Confirmar pizza</button></div>
            </section>
          )}
          {screen === "sc-border" && (
            <section className="screen active">
              <PizzaCtx />
              <div className="screen-head"><div className="eyebrow">Quase pronta</div><h2>Borda recheada?</h2><p>Opcional.</p></div>
              <div className={`opt ${border === null ? "sel" : ""}`} onClick={() => pickBorder("")}><div className="opt-emoji">⭕</div><div className="opt-body"><div className="opt-title">Sem borda</div><div className="opt-desc">Tradicional</div></div><div className="opt-price">Grátis</div><div className="opt-check" /></div>
              {(menu.borders || []).map((b, i) => { const p = bigBorder(size!) ? b.priceLarge : b.priceSmall; const esg = esgotados.includes(b.label); return (<div key={i} className={`opt ${border === b.label ? "sel" : ""}`} onClick={() => !esg && pickBorder(String(i))} style={{ opacity: esg ? 0.5 : 1, cursor: esg ? "not-allowed" : "pointer" }}><div className="opt-emoji">🧀</div><div className="opt-body"><div className="opt-title">{b.label}</div>{esg && <div className="opt-desc" style={{ color: "#ef4444" }}>Esgotado</div>}</div><div className="opt-price">{esg ? "" : `+${money(p)}`}</div><div className="opt-check" /></div>); })}
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
                return (<><div className="screen-head"><div className="eyebrow">{cfg.eb}</div><h2>{cfg.t}</h2><p>Toque para adicionar.</p></div>{cfg.data.map((it, i) => { const esg = esgotados.includes(it.name); return (<div key={i} className="opt" onClick={() => !esg && addSimple(it, cfg.emoji)} style={{ opacity: esg ? 0.5 : 1, cursor: esg ? "not-allowed" : "pointer" }}><div className="opt-emoji">{cfg.emoji}</div><div className="opt-body"><div className="opt-title">{it.name}</div>{esg && <div className="opt-desc" style={{ color: "#ef4444" }}>Esgotado</div>}</div><div className="opt-price">{simplePriceLabel(it)}</div></div>); })}<div className="btn-row"><button className="btn btn-ghost btn-sm" onClick={() => go("sc-start")}>Voltar ao início</button></div></>);
              })()}
            </section>
          )}
          {screen === "sc-suco-leite" && sucoPendente && (
            <section className="screen active">
              <div className="screen-head"><div className="eyebrow">Suco natural</div><h2>Com leite?</h2><p>{sucoPendente.name}</p></div>
              <div className="opt" onClick={() => addSucoLeite(false)}><div className="opt-emoji">S</div><div className="opt-body"><div className="opt-title">Sem leite</div></div><div className="opt-price">{money(sucoPendente.price)}</div></div>
              <div className="opt" onClick={() => addSucoLeite(true)}><div className="opt-emoji">+1</div><div className="opt-body"><div className="opt-title">Com leite</div><div className="opt-desc">Adicional de R$ 1,00</div></div><div className="opt-price">{money(sucoPendente.price + 1)}</div></div>
              <div className="btn-row"><button className="btn btn-ghost btn-sm" onClick={() => { setSucoPendente(null); go("sc-list"); }}>Voltar</button></div>
            </section>
          )}          {screen === "sc-macarronada-size" && macarronadaPendente && (
            <section className="screen active">
              <div className="screen-head"><div className="eyebrow">Macarronada</div><h2>Escolha o tamanho</h2><p>{macarronadaPendente.name}</p></div>
              {(macarronadaPendente.sizes || []).map((s) => (
                <div key={s.code} className="opt" onClick={() => addMacarronadaSize(s.code)}><div className="opt-emoji">🍽️</div><div className="opt-body"><div className="opt-title">Tamanho {s.code}</div></div><div className="opt-price">{money(s.price)}</div></div>
              ))}
              <div className="btn-row"><button className="btn btn-ghost btn-sm" onClick={() => { setMacarronadaPendente(null); go("sc-list"); }}>Voltar</button></div>
            </section>
          )}
          {screen === "sc-cart" && (
            <section className="screen active">
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
              {cart.length > 0 && <button className="btn" style={{ marginTop: 11 }} disabled={cartEsgotado} onClick={() => !cartEsgotado && go("sc-delivery")}>Ir para entrega</button>}
            </section>
          )}
          {screen === "sc-delivery" && (
            <section className="screen active">
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

              <div className="btn-row"><button className="btn btn-ghost btn-back" onClick={() => go("sc-cart")}>{"<-"}</button><button className="btn btn-sm" disabled={!delType} onClick={() => { if (!delOk) { setErroEntrega(getEnderecoErro()); return; } setErroEntrega(""); go("sc-pay"); }}>Continuar</button></div>
            </section>
          )}
          {screen === "sc-pay" && (
            <section className="screen active">
              <div className="screen-head"><div className="eyebrow">Último passo</div><h2>Seu pedido está quase pronto 🍕</h2><p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>Confere rapidinho os dados e escolhe como vai pagar.</p></div>

              {/* Bloco: Resumo do pedido */}
              <div className="section-label">Meu pedido</div>
              <div style={{ background: "var(--card)", borderRadius: 10, padding: "10px 14px", marginBottom: 16 }}>
                {cart.map((c, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--muted)", paddingBottom: 4 }}>
                    <span>{c.qty > 1 ? `${c.qty}× ` : ""}{c.name}{c.detail ? ` · ${c.detail}` : ""}</span>
                    <span style={{ whiteSpace: "nowrap", paddingLeft: 8 }}>{money(c.price * c.qty)}</span>
                  </div>
                ))}
                {fee > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--muted)", paddingTop: 4, borderTop: "1px solid var(--border)" }}><span>Taxa de entrega</span><span>{money(fee)}</span></div>}
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 700, color: "var(--fg)", paddingTop: 8, marginTop: 4, borderTop: "1px solid var(--border)" }}>
                  <span>Total</span><span style={{ color: "#ff6b00" }}>{money(finalTotal)}</span>
                </div>
              </div>
              <button className="btn btn-ghost" style={{ fontSize: 13, padding: "8px 14px", marginBottom: 20, marginTop: -8 }} onClick={() => go("sc-cart")}>← Editar carrinho</button>

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

              {/* Bloco: Pagamento */}
              <div ref={pagamentoRef} className="section-label" style={{ marginTop: 0 }}>Como você prefere pagar?</div>
              <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10, marginTop: -4 }}>Escolhe a melhor forma pra você.</p>
              {(menu.payments || []).map((p) => {
                const emojis: Record<string, string> = { Pix: "⚡", Dinheiro: "💵", Cartao: "💳" };
                const hints: Record<string, string> = { Pix: "A pizzaria confirma o Pix antes de preparar.", Dinheiro: "Pague na entrega ou retirada.", Cartao: "Pague na máquina na entrega ou retirada." };
                return (
                  <div key={p} className={`opt ${payment === p ? "sel" : ""}`} onClick={() => { setPayment(p); setErroPagamento(""); setErroTroco(""); if (p !== "Dinheiro") { setTroco(""); setTrocoOpcao(null); } }}>
                    <div className="opt-emoji">{emojis[p] || "💰"}</div>
                    <div className="opt-body">
                      <div className="opt-title">{p === "Cartao" ? "Cartão" : p}</div>
                      {hints[p] && <div className="opt-desc">{hints[p]}</div>}
                    </div>
                    <div className="opt-check" />
                  </div>
                );
              })}
              {erroPagamento && <div style={{ color: "#ef4444", fontSize: 12, marginTop: 6, marginBottom: 4 }}>Falta só escolher como você vai pagar.</div>}
              {payment === "Dinheiro" && (
                <div style={{ marginTop: 8, padding: "12px 14px", background: "var(--card)", borderRadius: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg)", marginBottom: 8 }}>Precisa de troco?</div>
                  <div style={{ display: "flex", gap: 8, marginBottom: trocoOpcao === "sim" ? 12 : 0 }}>
                    <button className={`btn ${trocoOpcao === "nao" ? "" : "btn-ghost"}`} style={{ flex: 1, fontSize: 13, padding: "10px 0" }} onClick={() => { setTrocoOpcao("nao"); setTroco(""); setErroTroco(""); }}>Não preciso de troco</button>
                    <button className={`btn ${trocoOpcao === "sim" ? "" : "btn-ghost"}`} style={{ flex: 1, fontSize: 13, padding: "10px 0" }} onClick={() => { setTrocoOpcao("sim"); setErroTroco(""); }}>Preciso de troco</button>
                  </div>
                  {erroTroco && trocoOpcao !== "sim" && <div style={{ color: "#ef4444", fontSize: 12, marginTop: 4 }}>{erroTroco}</div>}
                  {trocoOpcao === "sim" && (
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label>Troco para quanto?</label>
                      <input value={troco} onChange={(e) => { setTroco(e.target.value); if (erroTroco) setErroTroco(""); }} inputMode="numeric" placeholder={`Ex: ${Math.ceil((cartTotal + fee) / 10) * 10}`} />
                      {erroTroco && <div style={{ color: "#ef4444", fontSize: 12, marginTop: 4 }}>{erroTroco}</div>}
                    </div>
                  )}
                </div>
              )}

              {/* Bloco: Observação */}
              <div style={{ marginTop: 16, marginBottom: 4 }}>
                <div className="section-label">Algum detalhe no pedido?</div>
                <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10, marginTop: -4 }}>Se quiser, deixa um recado pra cozinha. Se não tiver nada, pode seguir direto.</p>
                <div className="field" style={{ marginBottom: 0 }}><input value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Ex: sem cebola, sem azeitona, tirar milho, pouco orégano…" /></div>
              </div>

              {/* Bloco: Revisão */}
              {nome.trim() && telefoneValido(telefone) && payment && (
                <div style={{ marginTop: 16, padding: "12px 14px", borderRadius: 10, background: "rgba(255,107,0,.08)", fontSize: 13 }}>
                  <div style={{ fontWeight: 700, color: "var(--fg)", marginBottom: 8 }}>Tudo certo por aqui</div>
                  <div style={{ color: "var(--muted)", lineHeight: 1.8 }}>
                    <div>Pedido para: <strong style={{ color: "var(--fg)" }}>{nome.trim()}</strong></div>
                    <div>Pagamento: <strong style={{ color: "var(--fg)" }}>{payment === "Cartao" ? "Cartão" : payment}</strong></div>
                    <div>Total: <strong style={{ color: "#ff6b00" }}>{money(cartTotal + fee)}</strong></div>
                  </div>
                  <div style={{ marginTop: 10, fontSize: 12, color: "var(--muted)" }}>Agora é só confirmar que a pizzaria recebe na hora.</div>
                </div>
              )}

              {cartEsgotado && <div style={{ marginTop: 8, padding: "10px 12px", borderRadius: 10, background: "rgba(239,68,68,.1)", color: "#ef4444", fontSize: 13, fontWeight: 700 }}>Um item do seu pedido ficou esgotado. Remova para continuar.</div>}
              <div className="btn-row"><button className="btn btn-ghost btn-back" onClick={() => go("sc-delivery")}>←</button><button className="btn btn-sm" disabled={sending || cartEsgotado} onClick={finish}>{sending ? "Enviando…" : "Confirmar meu pedido"}</button></div>
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
                    <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 16 }}>Total: {money(pedidoConfirmado.total)}</p>
                    <a href={`/rastrear/${pedidoConfirmado.id}`} className="btn" style={{ display: "block", marginBottom: 10, textAlign: "center", textDecoration: "none" }}>Acompanhar pedido</a>
                  </>
                )}
                <button className="btn btn-ghost" style={{ marginTop: pedidoConfirmado ? 0 : 22 }} onClick={resetAll}>Fazer novo pedido</button>
              </div>
            </section>
          )}
        </main>
      </div>
      {cartCount > 0 && screen !== "sc-done" && (<div className="cartbar show"><div className="cartbar-inner"><div className="cartbar-info"><div className="cartbar-count">{cartCount} {cartCount === 1 ? "item" : "itens"}</div><div className="cartbar-total">{money(finalTotal)}</div></div><button className="btn" onClick={() => go("sc-cart")}>Ver pedido</button></div></div>)}
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
body{font-family:var(--font-ui);background:var(--bg);color:var(--text);line-height:1.5;overflow-x:hidden;padding-bottom:104px;transition:background .35s,color .35s;font-size:16px;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
.wrap{max-width:540px;margin:0 auto;min-height:100vh;position:relative;font-family:var(--font-ui);padding-top:46px}
.wrap h1,.wrap h2,.wrap h3,.wrap button,.wrap input,.wrap select,.wrap textarea{font-family:var(--font-ui)}
header{background:var(--surface);padding:18px 20px;border-bottom:1px solid var(--line);transition:background .35s}
.head-row{display:flex;align-items:center;justify-content:space-between;gap:12px}
.logo{display:flex;align-items:center;gap:12px}
.logo-mark{width:42px;height:42px;border-radius:13px;background:var(--brand);display:flex;align-items:center;justify-content:center;font-size:22px;box-shadow:0 2px 10px var(--brand-soft)}
.logo h1{font-family:var(--font-ui);font-weight:600;font-size:19px;letter-spacing:-.3px;line-height:1.1}
.logo p{font-size:12.5px;color:var(--text-sub);margin-top:3px;font-weight:400}
.theme-btn{width:40px;height:40px;border-radius:12px;border:1px solid var(--line-strong);background:var(--surface2);color:var(--text);font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:.2s}
.theme-btn:active{transform:scale(.92)}
.status{display:inline-flex;align-items:center;gap:7px;margin-top:14px;background:var(--green-soft);color:var(--green);padding:6px 13px;border-radius:20px;font-size:12.5px;font-weight:500}
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
main{padding:6px 20px 20px}
.screen.active{display:block;animation:slide .4s cubic-bezier(.2,.8,.2,1)}
@keyframes slide{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:none}}
.screen-head{margin:18px 0 20px}
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
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:11px}
.grid2 .opt{flex-direction:column;align-items:flex-start;gap:7px;padding:17px;position:relative}
.grid2 .opt-check{position:absolute;top:13px;right:13px;width:20px;height:20px}
.grid2 .opt-emoji{width:auto}
.section-label{font-size:11px;font-weight:600;color:var(--text-sub);text-transform:uppercase;letter-spacing:1px;margin:22px 0 10px;display:flex;align-items:center;gap:7px}
.mam{display:flex;align-items:center;justify-content:space-between;background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:16px 18px;margin-bottom:14px;cursor:pointer;box-shadow:var(--shadow-sm)}
.mam.on{border-color:var(--brand);background:var(--brand-soft)}
.mam-txt strong{font-weight:600;font-size:15.5px;letter-spacing:-.1px}
.mam-txt p{font-size:13px;color:var(--text-sub);margin-top:2px;font-weight:400}
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
.cartbar{position:fixed;bottom:0;left:0;right:0;z-index:50;background:var(--surface);border-top:1px solid var(--line);padding:14px 20px;box-shadow:0 -4px 18px rgba(0,0,0,.1)}
.cartbar-inner{max-width:540px;margin:0 auto;display:flex;align-items:center;gap:14px}
.cartbar-info{flex:1}
.cartbar-count{font-size:12.5px;color:var(--text-sub);font-weight:500}
.cartbar-total{font-family:var(--font-ui);font-weight:700;font-size:21px;line-height:1.1;letter-spacing:-.3px}
.cartbar .btn{margin:0;width:auto;padding:14px 24px}
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
.sc-build-screen{padding-top:34px;padding-bottom:96px}
.build-back{position:fixed;top:54px;left:50%;transform:translateX(-50%);width:100%;max-width:540px;padding:0 20px;z-index:45;pointer-events:none}
.build-back-btn{pointer-events:auto;background:var(--surface2);border:1px solid var(--line-strong);color:var(--text-sub);font-family:var(--font-ui);font-size:13px;font-weight:600;padding:7px 14px;border-radius:30px;cursor:pointer;box-shadow:var(--shadow-sm);transition:transform .14s}
.build-back-btn:active{transform:scale(.96)}
.build-foot{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:540px;z-index:55;background:var(--surface);border-top:1px solid var(--line);box-shadow:0 -4px 18px rgba(0,0,0,.18);padding:12px 20px calc(env(safe-area-inset-bottom) + 14px)}
.build-foot .btn{margin:0}
`;
