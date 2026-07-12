"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import PanelShell from "@/components/PanelShell";
import { useLiveMenu, cartItemEsgotado } from "./liveMenu";
import { CARDAPIO_ILLUSTRATIONS, CardapioIllustration } from "@/lib/cardapioVisuals";
import { montarLinkWhatsAppComprovante } from "@/lib/pixCliente";
import { useTheme } from "@/components/ThemeToggle";

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
        html, body { margin: 0; padding: 0; background: var(--background); }
        button { cursor: pointer; font-family: 'Archivo', sans-serif; border: none; }
        @keyframes cbToastIn { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:none} }
        @keyframes cbFadeIn { from{opacity:0} to{opacity:1} }
        @keyframes cbSheetUp { from{transform:translateY(100%)} to{transform:none} }
        .cbBusca::placeholder { color: var(--surface-elevated); }
        .cbBusca:focus { border-color: color-mix(in srgb, var(--primary) 60%, transparent) !important; outline: none; }
        .cbScroll { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; }
        .cbScroll::-webkit-scrollbar { display: none; }
        .cbItem:active { opacity: 0.8; }
        .cbBtn:active { opacity: 0.75; }
        .cb-header { background:var(--background); border-bottom:1px solid var(--surface); padding:calc(env(safe-area-inset-top) + 10px) 16px 10px; position:sticky; top:0; z-index:10; }
        .cb-main { }
        .cbCardGrid { display:flex; flex-direction:column; }
        .cbGridFull {}
        @media (min-width: 768px) {
          .cb-header { border-bottom:1px solid var(--surface); padding:24px 28px 20px; position:static; }
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
                border: `1px solid ${modoSel ? "var(--primary)" : "var(--border)"}`,
                borderRadius: 9,
                background: modoSel ? "var(--primary-soft)" : "transparent",
                color: modoSel ? "var(--text-primary)" : "var(--text-secondary)",
                fontSize: 12, fontWeight: 900,
              }}
            >{modoSel ? "Cancelar" : "Selecionar"}</button>
            <a
              href="/pedido"
              target="_blank"
              rel="noopener noreferrer"
              style={{ height: 32, padding: "0 11px", border: "1px solid var(--border)", borderRadius: 9, background: "transparent", color: "var(--text-secondary)", fontSize: 12, fontWeight: 700, display: "inline-flex", alignItems: "center", textDecoration: "none" }}
            >🌐 Link cliente</a>
            <button
              onClick={copiarLinkCliente}
              title="Copiar link do cliente"
              aria-label="Copiar link do cliente"
              style={{ height: 32, width: 32, padding: 0, border: "1px solid var(--border)", borderRadius: 9, background: "transparent", color: "var(--text-secondary)", fontSize: 13, fontWeight: 700 }}
            >📋</button>
            <button
              onClick={onSair}
              style={{ height: 32, padding: "0 11px", border: "1px solid var(--border)", borderRadius: 9, background: "transparent", color: "var(--text-secondary)", fontSize: 12, fontWeight: 700 }}
            >Sair</button>
          </div>

          <a href="/cardapio/promocoes" style={{ display: "block", textAlign: "center", padding: "9px 0", marginBottom: 10, border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)", color: "var(--text-primary)", fontSize: 12.5, fontWeight: 800, textDecoration: "none" }}>🏷️ Gerenciar promoções</a>

          {/* Linha 2: métricas compactas */}
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <div style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 10px", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--success)", flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 900, color: "var(--text-primary)" }}>{totalDisp}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".4px" }}>disponíveis</span>
            </div>
            <div style={{
              flex: 1,
              background: totalEsg > 0 ? "var(--danger-surface)" : "var(--surface)",
              border: `1px solid ${totalEsg > 0 ? "var(--danger-border)" : "var(--border)"}`,
              borderRadius: 10, padding: "8px 10px", display: "flex", alignItems: "center", gap: 8,
            }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: totalEsg > 0 ? "var(--danger)" : "var(--border-strong)", flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 900, color: totalEsg > 0 ? "var(--danger-text)" : "var(--text-muted)" }}>{totalEsg}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: totalEsg > 0 ? "var(--danger-text)" : "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".4px" }}>esgotados</span>
            </div>
            <div style={{ flex: 0, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 12px", display: "flex", alignItems: "center" }}>
              <span style={{ fontSize: 13, fontWeight: 900, color: "var(--text-primary)" }}>{totalProd}</span>
            </div>
          </div>

          {/* Aviso bot — só quando há esgotados */}
          {totalEsg > 0 && (
            <div style={{ background: "var(--danger-surface)", border: "1px solid var(--danger-border)", borderRadius: 9, padding: "7px 11px", marginBottom: 10, fontSize: 12, fontWeight: 700, color: "var(--danger-text)" }}>
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
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 11,
                padding: "0 38px 0 13px",
                color: "var(--text-primary)",
                fontSize: 14, fontWeight: 700,
                fontFamily: "'Archivo', sans-serif",
                transition: "border-color .15s",
              }}
            />
            {busca
              ? <button onClick={() => setBusca("")} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", color: "var(--text-muted)", fontSize: 19, lineHeight: 1, padding: "2px 5px" }}>×</button>
              : <svg style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="var(--text-muted)" strokeWidth="2.2"/><path d="M16.5 16.5l3.5 3.5" stroke="var(--text-muted)" strokeWidth="2.2" strokeLinecap="round"/></svg>
            }
          </div>

          {/* Linha 4: filtros status — ativo sempre em amarelo (marca), nunca
              texto amarelo: fundo suave + borda amarela + texto navy/claro. */}
          <div style={{ display: "flex", gap: 5, marginBottom: 7 }}>
            {(["todos", "disponivel", "esgotado"] as const).map(f => {
              const COUNT = { todos: totalProd, disponivel: totalDisp, esgotado: totalEsg }
              const LABEL = { todos: "Todos", disponivel: "Disponíveis", esgotado: "Esgotados" }
              const active = filtroStatus === f
              return (
                <button
                  key={f}
                  onClick={() => setFiltroStatus(f)}
                  style={{
                    flex: 1, height: 38,
                    border: `1px solid ${active ? "var(--primary)" : "var(--border)"}`,
                    borderRadius: 10,
                    background: active ? "var(--primary-soft)" : "transparent",
                    color: active ? "var(--text-primary)" : "var(--text-secondary)",
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

          {/* Linha 5: filtros categoria — mesmo padrão amarelo ativo / neutro inativo */}
          <div className="cbScroll">
            {CATS.map(cat => {
              const active = filtroCat === cat
              return (
                <button
                  key={cat}
                  onClick={() => setFiltroCat(cat)}
                  style={{
                    height: 29, padding: "0 11px",
                    border: `1px solid ${active ? "var(--primary)" : "var(--border)"}`,
                    borderRadius: 8,
                    background: active ? "var(--primary-soft)" : "var(--surface)",
                    color: active ? "var(--text-primary)" : "var(--text-secondary)",
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
          <div style={{ flexShrink: 0, background: "var(--background)", borderBottom: "1px solid var(--border)", padding: "9px 16px", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 800, color: "var(--foreground-secondary)" }}>{selecionados.size} selecionado{selecionados.size > 1 ? "s" : ""}</span>
            <button onClick={() => setConfirmLote("esgotado")} style={{ height: 34, padding: "0 12px", border: "1px solid var(--danger-border)", borderRadius: 9, background: "var(--danger-surface)", color: "var(--danger-text)", fontSize: 12, fontWeight: 900 }}>Esgotar</button>
            <button onClick={() => setConfirmLote("disponivel")} style={{ height: 34, padding: "0 12px", border: "1px solid var(--success-border)", borderRadius: 9, background: "var(--success-surface)", color: "var(--success-text)", fontSize: 12, fontWeight: 900 }}>Disponibilizar</button>
          </div>
        )}

        {/* ── LISTA ── */}
        <main
          className="cb-main cbCardGrid"
          style={{ padding: "8px 16px 28px", display: "flex", flexDirection: "column", gap: 6 }}
        >
          {/* Verificar reposição */}
          {produtosParaRevisar.length > 0 && (
            <div className="cbGridFull" style={{ background: "color-mix(in srgb, var(--primary) 4%, transparent)", border: "1px solid color-mix(in srgb, var(--primary) 20%, transparent)", borderRadius: 14, padding: "14px 16px", marginBottom: 4, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--primary)", flexShrink: 0 }} />
                <span style={{ fontSize: 10, fontWeight: 900, color: "var(--brand-text)", textTransform: "uppercase", letterSpacing: "1px" }}>Verificar reposição hoje</span>
              </div>
              {produtosParaRevisar.map(nome => (
                <div key={nome} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "var(--background)", borderRadius: 10, border: "1px solid var(--surface)" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: "var(--foreground-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nome}</div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "var(--foreground-muted)", marginTop: 2 }}>Esgotado desde {esgotadosMetadata[nome]?.desde}</div>
                  </div>
                  <button
                    onClick={() => toggleEsgotado(nome, false)}
                    style={{ height: 32, padding: "0 10px", border: "1px solid var(--success-border)", borderRadius: 8, background: "var(--success-surface)", color: "var(--success-text)", fontSize: 11, fontWeight: 900, flexShrink: 0 }}
                  >Voltou</button>
                  <button
                    onClick={() => revisarHoje(nome)}
                    style={{ height: 32, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 8, background: "transparent", color: "var(--foreground-secondary)", fontSize: 11, fontWeight: 900, flexShrink: 0 }}
                  >Continua esgotado</button>
                </div>
              ))}
            </div>
          )}

          {lista.length === 0 && (
            <div className="cbGridFull" style={{ background: "var(--surface)", border: "1px dashed var(--surface-secondary)", borderRadius: 14, padding: "40px 20px", textAlign: "center", marginTop: 6 }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>{busca ? "🔍" : filtroStatus === "esgotado" ? "✅" : "📦"}</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: "var(--foreground-secondary)" }}>
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
                  background: sel ? "color-mix(in srgb, var(--primary) 5%, transparent)" : esg ? "color-mix(in srgb, var(--danger) 3%, transparent)" : "var(--surface)",
                  border: `1px solid ${sel ? "color-mix(in srgb, var(--primary) 50%, transparent)" : esg ? "color-mix(in srgb, var(--danger) 20%, transparent)" : "var(--surface)"}`,
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
                    border: `2px solid ${sel ? "var(--primary)" : "var(--border-strong)"}`,
                    background: sel ? "var(--primary)" : "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0, fontSize: 14, color: "var(--primary-foreground)", fontWeight: 900,
                  }}>
                    {sel && "✓"}
                  </div>
                )}

                {/* Conteúdo do card */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Nome — sempre texto principal, nunca amarelo (o status já é indicado no pill abaixo) */}
                  <div style={{
                    fontSize: 15, fontWeight: 800,
                    color: "var(--text-primary)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    marginBottom: 6, lineHeight: 1.3,
                  }}>
                    {produto.nome}
                  </div>
                  {/* Metadados */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10, fontWeight: 800, color: "var(--text-muted)", background: "var(--surface-secondary)", padding: "3px 8px", borderRadius: 5, lineHeight: 1.5 }}>
                      {produto.categoria}
                    </span>
                    {produto.preco != null && produto.preco > 0 && (
                      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", lineHeight: 1.4 }}>
                        R$ {produto.preco.toFixed(2).replace(".", ",")}
                      </span>
                    )}
                    <span style={{ fontSize: 11, fontWeight: 800, color: esg ? "var(--danger-text)" : "var(--success-text)", lineHeight: 1.4 }}>
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
                      border: `1px solid ${esg ? "var(--success-border)" : "var(--danger-border)"}`,
                      borderRadius: 10,
                      background: esg ? "var(--success-surface)" : "var(--danger-surface)",
                      color: esg ? "var(--success-text)" : "var(--danger-text)",
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
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          padding: "12px 14px",
          display: "flex", alignItems: "center", gap: 10,
          animation: "cbToastIn .22s ease both",
          zIndex: 80,
          boxShadow: "0 8px 30px rgba(0,0,0,.7)",
          fontFamily: "'Archivo', sans-serif",
        }}>
          <p style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "var(--foreground-secondary)", margin: 0, lineHeight: 1.4 }}>{toast.msg}</p>
          {toast.nome && (
            <button
              onClick={desfazer}
              style={{ background: "color-mix(in srgb, var(--primary) 14%, transparent)", color: "var(--brand-text)", fontSize: 12, fontWeight: 900, padding: "8px 12px", borderRadius: 9, flexShrink: 0 }}
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
            background: "var(--background)",
            border: "1px solid var(--surface-secondary)", borderBottom: "none",
            borderRadius: "22px 22px 0 0",
            zIndex: 91,
            animation: "cbSheetUp .3s cubic-bezier(.2,.9,.3,1) both",
            padding: "18px 20px calc(env(safe-area-inset-bottom) + 28px)",
            display: "flex", flexDirection: "column", gap: 12,
          }}>
            <div style={{ width: 40, height: 4, borderRadius: 2, background: "var(--surface-elevated)", margin: "0 auto 6px" }} />
            <p style={{ margin: 0, fontSize: 17, fontWeight: 900, letterSpacing: "-0.3px" }}>
              {confirmLote === "esgotado"
                ? `Esgotar ${selecionados.size} produto${selecionados.size > 1 ? "s" : ""}?`
                : `Disponibilizar ${selecionados.size} produto${selecionados.size > 1 ? "s" : ""}?`}
            </p>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--foreground-secondary)", lineHeight: 1.5 }}>
              {confirmLote === "esgotado"
                ? "O bot vai parar de vender esses produtos imediatamente."
                : "O bot vai voltar a oferecer esses produtos."}
            </p>
            <button
              onClick={() => aplicarLote(confirmLote === "esgotado")}
              style={{ height: 52, borderRadius: 13, background: confirmLote === "esgotado" ? "var(--danger)" : "var(--success)", color: "var(--foreground)", fontSize: 15, fontWeight: 900 }}
            >
              {confirmLote === "esgotado" ? "Confirmar — marcar esgotados" : "Confirmar — disponibilizar"}
            </button>
            <button onClick={() => setConfirmLote(null)} style={{ height: 42, background: "transparent", color: "var(--foreground-muted)", fontSize: 13, fontWeight: 800 }}>Cancelar</button>
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
  provider: "mercadopago" | "manual";
  qrCode?: string;
  copiaECola?: string;
  chavePix?: string;
  beneficiario?: string;
  whatsappPizzaria?: string;
  ticketUrl?: string;
  valorEsperado?: number;
};

type PagamentoPixClienteStatus = "aguardando_pix" | "pago" | "em_revisao" | "conferencia_manual" | "nao_pix";

type PedidoStatusCliente = {
  status?: PedidoConfirmadoStatus;
  pixConfirmado?: boolean;
  pagamentoStatus?: PagamentoPixClienteStatus;
  titulo?: string;
  mensagem?: string;
  pix?: {
    status?: string;
    confirmadoPor?: string;
    evidencia?: { decisao?: string };
  };
};

type PedidoConfirmadoCliente = {
  id: string;
  numero: number;
  total: number;
  statusToken?: string;
  pix?: PixClientePedido;
};

const PIX_STATUS_LABEL: Record<PagamentoPixClienteStatus, string> = {
  aguardando_pix: "Aguardando Pix",
  pago: "Pagamento confirmado",
  em_revisao: "Comprovante em análise",
  conferencia_manual: "Conferência manual necessária",
  nao_pix: "Pedido recebido",
};

const PIX_STATUS_TEXT: Record<PagamentoPixClienteStatus, string> = {
  aguardando_pix: "Depois de pagar, envie o comprovante pelo WhatsApp. Assim que o sistema validar, seu pedido será confirmado automaticamente.",
  pago: "Seu pagamento foi confirmado e o pedido foi liberado para preparo.",
  em_revisao: "Recebemos o comprovante. A equipe vai conferir os detalhes antes de liberar o pedido.",
  conferencia_manual: "Recebemos o comprovante, mas a equipe precisa conferir esse pagamento manualmente.",
  nao_pix: "Acompanhe o andamento do pedido por aqui.",
};

const money = (v: number) => "R$ " + v.toFixed(2).replace(".", ",");
const bigBorder = (sz: string) => !(sz === "P" || sz === "M");
const itemSlug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const isMiniPizzaName = (value: string) => itemSlug(value) === "minipizza";

// Pagamento misto (Pix + Dinheiro): mesma string canônica já validada no
// backend/WhatsApp ("Pix (R$ X,XX) + Dinheiro (R$ Y,YY)"), ver src/lib/bot.ts
// (temPixNoPagamento/temDinheiroNoPagamento/valorPixEsperado/valorDinheiroEsperado).
const parseValorInput = (v: string): number => parseFloat(v.replace(",", ".").replace(/[^\d.]/g, ""));
function extrairHibrido(pagamento: string | null): { pix: number; dinheiro: number } | null {
  if (!pagamento) return null;
  const m = pagamento.match(/^Pix\s*\(R\$\s*([0-9.,]+)\)\s*\+\s*Dinheiro\s*\(R\$\s*([0-9.,]+)\)$/i);
  if (!m) return null;
  const pix = parseValorInput(m[1]);
  const dinheiro = parseValorInput(m[2]);
  if (isNaN(pix) || isNaN(dinheiro)) return null;
  return { pix, dinheiro };
}

// Sistema inicial de ícones do fluxo público, reaproveitável em qualquer tela
// (bottom nav, categorias, símbolos de ação). Sem biblioteca externa — só emoji.
const ICONS = {
  inicio: "🏠",
  sacola: "🛒",
  pedido: "🧾",
  pizza: "🍕",
  lanche: "🍔",
  macarronada: "🍝",
  bebidas: "🥤",
  sucos: "🧃",
  entrega: "🛵",
  retirada: "🏪",
  consumoLocal: "🍽️",
  pagamento: "💰",
  pix: "⚡",
  cartao: "💳",
  dinheiro: "💵",
  misto: "🔀",
  remover: "✕",
  adicionar: "➕",
  voltar: "←",
  check: "✓",
  alerta: "⚠️",
  vazio: "🛒",
  busca: "🔍",
  editar: "✎",
  relogio: "🕐",
  localizacao: "📍",
  pessoa: "👤",
  nota: "📝",
} as const;

// Banco de ilustrações leves (src/lib/cardapioVisuals.tsx) já aplicado em:
// sacola vazia (sc-cart), categoria sem itens (sc-list) e aguardando Pix
// (sc-done). "Pedido enviado" já usa o mesmo padrão nativamente (check grande
// + título + texto) e não foi tocado para preservar a copy já validada.
// Seguem só mapeados para uso futuro (evitar aumentar risco deste patch):
// pedido em preparo / saiu para entrega (STATUS_PEDIDO_LABEL), cardápio
// vazio e erro de carregamento — este último some no fallback isolado de
// `CardapioPage` (fora do <style>{CSS}</style> de PublicCardapio).

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
  // Tema compartilhado com o resto do site (localStorage['chefebot-theme']):
  // Light por padrão, Dark só por escolha explícita — nunca hardcoded aqui.
  const { theme, setTheme } = useTheme();
  const [screen, setScreen] = useState("sc-start");
  const [previousStepBeforeCart, setPreviousStepBeforeCart] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [sending, setSending] = useState(false);
  // Resgate de fidelidade (Etapa 5): reserva feita na Área do Cliente
  // (/cliente), repassada via sessionStorage. Só aplica o desconto se ainda
  // não expirou — o servidor sempre revalida de novo no POST /api/pedido-app,
  // isso aqui é só para refletir o mesmo valor na tela antes de enviar.
  const [resgatePontos, setResgatePontos] = useState<{ resgateId: string; valorDescontoMaximo: number; expiraEm: string } | null>(null);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("cf_resgate_pontos");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.resgateId && typeof parsed.valorDescontoMaximo === "number" && parsed.expiraEm && new Date(parsed.expiraEm).getTime() > Date.now()) {
        setResgatePontos(parsed);
      } else {
        sessionStorage.removeItem("cf_resgate_pontos");
      }
    } catch {}
  }, []);

  const [size, setSize] = useState<string | null>(null);
  const [sizePrice, setSizePrice] = useState(0);
  const [f1, setF1] = useState<string | null>(null);
  const [f2, setF2] = useState<string | null>(null);
  const [border, setBorder] = useState<string | null>(null);
  const [borderPrice, setBorderPrice] = useState(0);
  const [flavorModalOpen, setFlavorModalOpen] = useState(false);
  const [plan, setPlan] = useState<{ total: number; current: number; openEnded: boolean }>({ total: 0, current: 0, openEnded: false });
  const [listCat, setListCat] = useState<"lanche" | "macarronada" | "bebida" | "suco">("lanche");
  // Upsell contextual de bebida: rastreia o tipo do último item adicionado e
  // se o cliente já ignorou a sugestão nesta compra (reseta só em resetAll()).
  const [lastAddedKind, setLastAddedKind] = useState<"pizza" | "lanche" | "macarronada" | "bebida" | "suco" | null>(null);
  const [upsellBebidaIgnorado, setUpsellBebidaIgnorado] = useState(false);
  const [macarronadaPendente, setMacarronadaPendente] = useState<{ name: string; price: number; sizes?: { code: string; price: number }[] } | null>(null);
  const [sucoPendente, setSucoPendente] = useState<{ name: string; price: number } | null>(null);
  const [delType, setDelType] = useState<"delivery" | "retirada" | "dine_in" | null>(null);
  const [bairroIdx, setBairroIdx] = useState<string>("");
  const [rua, setRua] = useState("");
  const [nome, setNome] = useState("");
  const [payment, setPayment] = useState<string | null>(null);
  const [troco, setTroco] = useState("");
  const [telefone, setTelefone] = useState("");
  // Vínculo com o WhatsApp via token do link (?t=): o navegador só conhece o
  // token opaco e os 4 últimos dígitos — o phone completo fica no servidor.
  const [waToken, setWaToken] = useState<string | null>(null);
  const [waFinal, setWaFinal] = useState("");
  // Vínculo automático do token é a fonte principal enquanto ativo — só deixa
  // de valer se o cliente pedir explicitamente para usar outro WhatsApp.
  const [usarOutroWhatsapp, setUsarOutroWhatsapp] = useState(false);
  const vinculoWhatsappAtivo = !!waFinal && !usarOutroWhatsapp;
  const [numero, setNumero] = useState("");
  const [referencia, setReferencia] = useState("");
  const [observacao, setObservacao] = useState("");
  const [toast, setToast] = useState("");
  const [pedidoConfirmado, setPedidoConfirmado] = useState<PedidoConfirmadoCliente | null>(null);
  const [statusPedidoConfirmado, setStatusPedidoConfirmado] = useState<PedidoConfirmadoStatus>("novo");
  const [statusPixCliente, setStatusPixCliente] = useState<PagamentoPixClienteStatus>("aguardando_pix");
  const [erroNome, setErroNome] = useState("");
  const [erroTelefone, setErroTelefone] = useState("");
  const [erroPagamento, setErroPagamento] = useState("");
  const [erroEntrega, setErroEntrega] = useState("");
  const [erroTroco, setErroTroco] = useState("");
  const [trocoOpcao, setTrocoOpcao] = useState<"nao" | "sim" | null>(null);
  // Pagamento misto Pix + Dinheiro: rascunho dos dois campos do modal antes de
  // confirmar. Reaproveita troco/trocoOpcao acima para a parte em dinheiro.
  const [mistoPixInput, setMistoPixInput] = useState("");
  const [mistoDinheiroInput, setMistoDinheiroInput] = useState("");
  const [erroMisto, setErroMisto] = useState("");
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

  // Vínculo WhatsApp: valida o token do link (?t=) no servidor e guarda só na
  // sessão do navegador. Token inválido/expirado nunca quebra o fluxo — o
  // checkout volta a pedir o WhatsApp manualmente.
  useEffect(() => {
    async function ativarVinculo(token: string) {
      try {
        const r = await fetch(`/api/cardapio-whatsapp-session?t=${encodeURIComponent(token)}`, { cache: "no-store" });
        const data = await r.json();
        if (data?.ok && data.phoneFinal) {
          setWaToken(token); setWaFinal(String(data.phoneFinal));
          try { sessionStorage.setItem("cf_wa_token", token); sessionStorage.setItem("cf_wa_final", String(data.phoneFinal)); } catch {}
        } else {
          try { sessionStorage.removeItem("cf_wa_token"); sessionStorage.removeItem("cf_wa_final"); } catch {}
        }
      } catch {}
    }
    try {
      const params = new URLSearchParams(window.location.search);
      const t = params.get("t");
      if (t) {
        // Remove o token da URL (evita vazar em prints/compartilhamentos).
        params.delete("t");
        const qs = params.toString();
        window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
        ativarVinculo(t);
        return;
      }
      const salvo = sessionStorage.getItem("cf_wa_token");
      const salvoFinal = sessionStorage.getItem("cf_wa_final");
      if (salvo && salvoFinal) { setWaToken(salvo); setWaFinal(salvoFinal); }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      const n = localStorage.getItem("cf_nome"); const t = localStorage.getItem("cf_tel");
      if (n) setNome(n); if (t) setTelefone(t);
      // Cliente vinculado ao WhatsApp (token do link) não precisa ter telefone
      // salvo no navegador para já ver o pedido identificado — lê a mesma
      // sessionStorage que a validação do token grava (evita depender da ordem
      // dos efeitos de montagem, já que o state de vínculo pode não estar
      // atualizado neste mesmo ciclo de render).
      const temVinculoWa = !!sessionStorage.getItem("cf_wa_final");
      const telValido = !!t && t.replace(/\D/g, "").length >= 10;
      if (n && n.trim() && (telValido || temVinculoWa)) setEditandoIdentidade(false);
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
    const token = pedidoConfirmado?.statusToken;
    if (!pedidoId || !token) return;
    const pedidoIdSeguro = pedidoId;
    const tokenSeguro = token;
    let active = true;
    let tentativas = 0;
    let interval: ReturnType<typeof setInterval> | undefined;

    async function fetchStatusPedido() {
      tentativas += 1;
      try {
        const params = new URLSearchParams({ id: pedidoIdSeguro, token: tokenSeguro });
        const res = await fetch(`/api/pedido-app/status?${params.toString()}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as PedidoStatusCliente;
        if (active && data.status && data.status in STATUS_PEDIDO_LABEL) {
          setStatusPedidoConfirmado(data.status);
        }
        if (active && data.pagamentoStatus) {
          setStatusPixCliente(data.pagamentoStatus);
        }
        if (
          data.pagamentoStatus === "pago" ||
          data.status === "cancelado" ||
          data.status === "entregue" ||
          tentativas >= 240
        ) {
          active = false;
          if (interval) clearInterval(interval);
        }
      } catch {}
    }

    fetchStatusPedido();
    interval = setInterval(fetchStatusPedido, 5000);
    return () => {
      active = false;
      if (interval) clearInterval(interval);
    };
  }, [pedidoConfirmado?.id, pedidoConfirmado?.statusToken]);

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
  const safeCartReturnScreens = ["sc-start", "sc-build", "sc-border", "sc-list", "sc-suco-leite", "sc-macarronada-size", "sc-another", "sc-delivery", "sc-pay", "sc-promo"];
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

  function resetBuild() { setSize(null); setSizePrice(0); setF1(null); setF2(null); setBorder(null); setBorderPrice(0); setMiniPizzaMode(false); setFlavorModalOpen(false); }
  function goPizza() { setPlan({ total: 0, current: 1, openEnded: true }); resetBuild(); go("sc-build"); }
  function pizzasNoCarrinho() { return cart.filter((c) => c.kind === "pizza" || (c.kind === "simple" && isMiniPizzaName(c.name))).length; }
  function pickSize(code: string) { const s = (menu.sizes || []).find((x) => x.code === code); if (!s) return; setMiniPizzaMode(false); setSize(code); setSizePrice(s.price); setFlavorModalOpen(true); }
  function pickMiniPizza() { if (!miniPizzaItem || miniPizzaEsgotada) return; setMiniPizzaMode(true); setSize("MINI"); setSizePrice(miniPizzaItem.price); setF2(null); setFlavorModalOpen(true); }
  // Toque direto em até 2 sabores: o 1º sabor já forma uma pizza normal, o 2º
  // vira meio a meio automaticamente (sem etapa de escolher o "modo" antes).
  function pickFlavor(f: string) {
    if (f1 === f) { setF1(f2); setF2(null); return; }
    if (f2 === f) { setF2(null); return; }
    if (!f1) { setF1(f); return; }
    if (!f2) { setF2(f); return; }
    setF2(f);
  }
  const mam = !!(f1 && f2);
  const flavorOk = !!f1;
  const buildOk = !!size && flavorOk && !(miniPizzaMode && miniPizzaEsgotada);
  const flavorSections = miniPizzaMode
    ? [{ title: "Sabores da mini-pizza", flavors: miniPizzaFlavors }]
    : [{ title: "Salgadas", flavors: menu.saltyFlavors || [] }, { title: "Doces", flavors: menu.sweetFlavors || [] }];
  const selectedSizeLabel = miniPizzaMode && miniPizzaItem ? miniPizzaItem.name : size ? ((menu.sizes || []).find((s) => s.code === size)?.label || size) : "";
  const buildFootHint = !size
    ? "Escolha um tamanho para continuar"
    : miniPizzaMode
      ? (flavorOk ? "Mini-pizza pronta para a sacola" : "Escolha 1 sabor para a mini-pizza")
      : !f1
        ? "Escolha até 2 sabores"
        : !f2
          ? "Você pode escolher até 2 sabores"
          : "Sabores prontos — agora escolha a borda";
  const buildActionLabel = miniPizzaMode ? "Adicionar mini-pizza" : "Confirmar pizza";
  const flavorModalTitle = miniPizzaMode ? (miniPizzaItem?.name || "Mini-pizza") : `Pizza ${selectedSizeLabel}`;
  const flavorModalMessage = miniPizzaMode ? "Escolha o sabor da sua mini-pizza." : "Você pode escolher até 2 sabores.";
  const flavorModalHint = miniPizzaMode ? null : "Escolha 1 sabor para pizza inteira ou 2 sabores para meio a meio.";
  function addPizzaWithBorder(chosenBorder: string | null, chosenBorderPrice: number) {
    setBorder(chosenBorder); setBorderPrice(chosenBorderPrice);
    const flavor = mam ? `${f1} / ${f2}` : f1;
    const keys = [f1, mam ? f2 : null, chosenBorder].filter(Boolean) as string[];
    const newItem: CartItem = { emoji: "🍕", kind: "pizza", name: `Pizza ${size}${mam ? " (meio a meio)" : ""}`, detail: `${flavor}${chosenBorder ? ` · borda ${chosenBorder}` : ""}`, price: sizePrice + chosenBorderPrice, qty: 1, keys };
    const newCart = [...cart, newItem];
    setCart(newCart);
    setLastAddedKind("pizza");
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
    setLastAddedKind("pizza");
    if (!plan.openEnded && plan.current < plan.total) { setPlan({ ...plan, current: plan.current + 1 }); showToast("Mini-pizza adicionada!"); resetBuild(); go("sc-build"); }
    else if (plan.openEnded) { showToast("Mini-pizza adicionada!"); go("sc-another"); }
    else { showToast("Tudo pronto!"); go("sc-cart"); }
  }
  function continueBuild() { if (!buildOk) return; if (miniPizzaMode) addMiniPizza(); else go("sc-border"); }
  function confirmFromModal() { if (!buildOk) return; setFlavorModalOpen(false); continueBuild(); }
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
    setLastAddedKind(listCat === "bebida" ? "bebida" : "lanche");
    showToast(`${it.name} adicionado!`);
  }
  function addSucoLeite(comLeite: boolean) {
    if (!sucoPendente) return;
    const detail = comLeite ? "Com leite" : "Sem leite";
    const price = sucoPendente.price + (comLeite ? 1 : 0);
    const ex = cart.find((c) => c.kind === "simple" && c.name === sucoPendente.name && c.detail === detail);
    if (ex) setCart(cart.map((c) => (c === ex ? { ...c, qty: c.qty + 1 } : c)));
    else setCart([...cart, { emoji: "S", kind: "simple", name: sucoPendente.name, detail, price, qty: 1, keys: [sucoPendente.name] }]);
    setLastAddedKind("suco");
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
    setLastAddedKind("macarronada");
    showToast(`${macarronadaPendente.name} ${sizeOption.code} adicionada!`);
    setMacarronadaPendente(null);
    go("sc-another");
  }
  const cartTotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const cartCount = cart.reduce((s, i) => s + i.qty, 0);
  const cartTemBebidaOuSuco = cart.some((c) => [...(menu.bebidas || []), ...(menu.sucos || [])].some((m) => m.name === c.name));
  const showUpsellBebida = !upsellBebidaIgnorado && !cartTemBebidaOuSuco && ["pizza", "lanche", "macarronada"].includes(lastAddedKind || "");
  function sairDoPosItemSemBebida(destino: "sc-start" | "sc-cart") { if (showUpsellBebida) setUpsellBebidaIgnorado(true); go(destino); }
  function chQty(idx: number, d: number) { setCart(cart.map((c, i) => (i === idx ? { ...c, qty: Math.max(1, c.qty + d) } : c))); }
  function rmItem(idx: number) { const nc = cart.filter((_, i) => i !== idx); setCart(nc); if (nc.length === 0) go("sc-start"); }
  const fee = delType === "delivery" && bairroIdx !== "" ? ((menu.neighborhoods || [])[+bairroIdx]?.fee ?? 0) : 0;
  // Desconto de fidelidade nunca ultrapassa o valor-base da reserva nem o
  // subtotal — mesma regra aplicada no servidor (POST /api/pedido-app), que
  // é quem de fato calcula e cobra o valor final.
  const descontoResgate = resgatePontos ? Math.max(0, Math.min(resgatePontos.valorDescontoMaximo, cartTotal)) : 0;
  const finalTotal = Math.max(0, cartTotal - descontoResgate) + fee;
  // Pagamento misto confirmado: re-parseado do próprio `payment` (fonte única
  // de verdade), então some sozinho se o cliente trocar para outro método.
  const hibridoAtual = extrairHibrido(payment);
  const isHibrido = !!hibridoAtual;
  const hibridoSomaValida = !hibridoAtual || Math.abs(hibridoAtual.pix + hibridoAtual.dinheiro - finalTotal) <= 0.01;
  const hibridoTrocoValido = !hibridoAtual || hibridoAtual.dinheiro <= 0 || (
    trocoOpcao === "nao" || (trocoOpcao === "sim" && !isNaN(parseValorInput(troco)) && parseValorInput(troco) > hibridoAtual.dinheiro)
  );
  const hibridoBloqueado = isHibrido && (!hibridoSomaValida || !hibridoTrocoValido);
  const ruaOk = rua.trim().length > 0;
  const numeroOk = numero.trim().length > 0;
  const delOk = delType === "retirada" || delType === "dine_in" || (delType === "delivery" && bairroIdx !== "" && ruaOk && numeroOk);
  const enderecoErroAtivo = delType === "delivery" && !!erroEntrega;
  const bairroErro = enderecoErroAtivo && bairroIdx === "";
  const ruaErro = enderecoErroAtivo && !ruaOk;
  const numeroErro = enderecoErroAtivo && !numeroOk;
  const enderecoErroStyle = { borderColor: "var(--danger)", background: "color-mix(in srgb, var(--danger) 8%, transparent)", boxShadow: "0 0 0 1px color-mix(in srgb, var(--danger) 18%, transparent)" };
  const bairroSelectStyle = {
    ...(bairroErro ? enderecoErroStyle : {}),
    background: bairroErro ? "color-mix(in srgb, var(--danger) 8%, transparent)" : "var(--surface)",
    color: "var(--text)",
  };
  const bairroOptionStyle = { background: "var(--foreground)", color: "var(--surface-secondary)" };
  const payOk = !!nome.trim() && (telefoneValido(telefone) || vinculoWhatsappAtivo) && !!payment;

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

  function paymentLabel(value: string) { return value === "Cartao" ? "Cartão" : value === "Misto" ? "Pagamento misto" : value; }
  function paymentIcon(value: string) { return ({ Pix: ICONS.pix, Dinheiro: ICONS.dinheiro, Cartao: ICONS.cartao, Misto: ICONS.misto } as Record<string, string>)[value] || ICONS.pagamento; }
  function paymentHint(value: string) {
    return ({ Pix: "Confirmacao manual pela pizzaria.", Dinheiro: "Configure o troco.", Cartao: "Pagamento na maquina.", Misto: "Divida entre Pix e Dinheiro." } as Record<string, string>)[value] || "Forma de pagamento";
  }
  function paymentSummary(value: string) {
    if (value === "Misto") {
      if (!hibridoAtual) return paymentHint(value);
      const linhaTroco = trocoOpcao === "nao" ? "Sem troco" : trocoOpcao === "sim" && troco.trim() ? `Troco para ${troco}` : null;
      return (
        <>
          {`Pix ${money(hibridoAtual.pix)} + Dinheiro ${money(hibridoAtual.dinheiro)}`}
          {linhaTroco && <><br />{linhaTroco}</>}
        </>
      );
    }
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
    if (value !== "Dinheiro" && value !== "Misto") setErroTroco("");
    if (value === "Misto") {
      setErroMisto("");
      // Reabrir com os valores já confirmados (se houver) para o cliente ajustar.
      if (hibridoAtual) {
        setMistoPixInput(hibridoAtual.pix.toFixed(2).replace(".", ","));
        setMistoDinheiroInput(hibridoAtual.dinheiro.toFixed(2).replace(".", ","));
      } else {
        setMistoPixInput("");
        setMistoDinheiroInput("");
        setTrocoOpcao(null);
        setTroco("");
        setErroTroco("");
      }
    }
    setPaymentModal(value);
  }
  function confirmDinheiroSemTroco() {
    setPayment("Dinheiro");
    setTrocoOpcao("nao");
    setTroco("");
    setErroTroco("");
    setErroPagamento("");
    setPaymentModal(null);
  }
  function onChangeMistoPix(v: string) {
    setMistoPixInput(v);
    if (erroMisto) setErroMisto("");
    const num = parseValorInput(v);
    if (!isNaN(num) && num >= 0 && num <= finalTotal + 0.001) {
      setMistoDinheiroInput(Math.max(0, finalTotal - num).toFixed(2).replace(".", ","));
    }
  }
  function onChangeMistoDinheiro(v: string) {
    setMistoDinheiroInput(v);
    if (erroMisto) setErroMisto("");
    const num = parseValorInput(v);
    if (!isNaN(num) && num >= 0 && num <= finalTotal + 0.001) {
      setMistoPixInput(Math.max(0, finalTotal - num).toFixed(2).replace(".", ","));
    }
  }
  function confirmMistoPagamento() {
    const pixNum = parseValorInput(mistoPixInput);
    const dinheiroNum = parseValorInput(mistoDinheiroInput);
    if (isNaN(pixNum) || isNaN(dinheiroNum)) { setErroMisto("Informe os dois valores."); return; }
    if (pixNum < 0 || dinheiroNum < 0) { setErroMisto("Os valores não podem ser negativos."); return; }
    if (pixNum === 0 || dinheiroNum === 0) { setErroMisto("Informe um valor maior que zero no Pix e no Dinheiro. Se for só um método, escolha ele direto."); return; }
    const soma = pixNum + dinheiroNum;
    if (Math.abs(soma - finalTotal) > 0.01) { setErroMisto(`A soma (${money(soma)}) precisa ser igual ao total do pedido (${money(finalTotal)}).`); return; }
    if (!trocoOpcao) { setErroTroco("Escolha se você precisa de troco."); return; }
    if (trocoOpcao === "sim" && !troco.trim()) { setErroTroco("Informe para quanto precisa de troco."); return; }
    if (trocoOpcao === "sim") {
      const trocoNum = parseValorInput(troco);
      if (isNaN(trocoNum) || trocoNum <= dinheiroNum) { setErroTroco(`O troco é sobre a parte em dinheiro — informe um valor maior que ${money(dinheiroNum)}.`); return; }
    }
    setPayment(`Pix (${money(pixNum)}) + Dinheiro (${money(dinheiroNum)})`);
    setErroPagamento("");
    setErroMisto("");
    setPaymentModal(null);
  }
  function confirmPaymentConfig() {
    if (!paymentModal) return;
    if (paymentModal === "Misto") { confirmMistoPagamento(); return; }
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
    // Trocar para um método puro descarta qualquer rascunho de pagamento misto,
    // pra nunca deixar um payload híbrido antigo escapar no envio do pedido.
    setMistoPixInput("");
    setMistoDinheiroInput("");
    setErroMisto("");
    setPaymentModal(null);
  }

  async function finish() {
    if (sending) return;
    if (cartEsgotado) { showToast("Um item do seu pedido ficou esgotado. Remova para continuar."); return; }
    if (delType === "delivery" && !delOk) { setErroEntrega(getEnderecoErro()); go("sc-delivery"); return; }
    let hasError = false;
    if (!nome.trim()) { setErroNome("Me diz seu nome pra gente identificar o pedido."); setEditandoIdentidade(true); nomeRef.current?.focus(); hasError = true; }
    else { setErroNome(""); }
    if (!telefoneValido(telefone) && !vinculoWhatsappAtivo) { setErroTelefone("Coloca um WhatsApp válido pra pizzaria falar com você se precisar."); setEditandoIdentidade(true); if (!hasError) telefoneRef.current?.focus(); hasError = true; }
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
    } else if (isHibrido && hibridoAtual) {
      // Rechecagem defensiva: o carrinho pode ter mudado depois do modal confirmar o misto.
      if (!hibridoSomaValida) {
        setErroPagamento("A divisão do pagamento misto não bate mais com o total. Ajuste os valores.");
        if (!hasError) pagamentoRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        hasError = true;
      } else if (hibridoAtual.dinheiro > 0) {
        if (!trocoOpcao) {
          setErroTroco("Escolha se você precisa de troco.");
          if (!hasError) pagamentoRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
          hasError = true;
        } else if (trocoOpcao === "sim" && !troco.trim()) {
          setErroTroco("Informe para quanto precisa de troco.");
          if (!hasError) pagamentoRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
          hasError = true;
        } else if (trocoOpcao === "sim") {
          const trocoNum = parseValorInput(troco);
          if (isNaN(trocoNum) || trocoNum <= hibridoAtual.dinheiro) { setErroTroco(`O troco é sobre a parte em dinheiro — informe um valor maior que ${money(hibridoAtual.dinheiro)}.`); if (!hasError) pagamentoRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); hasError = true; }
          else { setErroTroco(""); }
        } else { setErroTroco(""); }
      } else { setErroTroco(""); }
    } else { setErroTroco(""); }
    if (hasError) return;
    setSending(true);
    const payload = { cliente: nome.trim(), telefone: telefone.trim() || undefined, whatsappToken: waToken || undefined, usarOutroWhatsapp: usarOutroWhatsapp || undefined, itens: cart.map((c) => ({ kind: c.kind, name: c.name, detail: c.detail, price: c.price, qty: c.qty, ...(c.promoId ? { promoId: c.promoId } : {}) })), tipoEntrega: delType, bairro: delType === "delivery" ? menu.neighborhoods[+bairroIdx].name : undefined, rua: delType === "delivery" ? rua : undefined, numero: delType === "delivery" && numero.trim() ? numero.trim() : undefined, referencia: delType === "delivery" && referencia.trim() ? referencia.trim() : undefined, observacao: observacao.trim() || undefined, taxaEntrega: fee, pagamento: payment, troco: (payment === "Dinheiro" || isHibrido) ? (trocoOpcao === "nao" ? "Sem troco" : troco.trim()) : undefined, resgateId: resgatePontos && new Date(resgatePontos.expiraEm).getTime() > Date.now() ? resgatePontos.resgateId : undefined };
    try {
      const r = await fetch("/api/pedido-app", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await r.json();
      if (data.ok) { try { localStorage.setItem("cf_nome", nome.trim()); if (telefone.trim()) localStorage.setItem("cf_tel", telefone.trim()); } catch {} try { sessionStorage.removeItem("cf_draft"); } catch {} try { sessionStorage.removeItem("cf_resgate_pontos"); } catch {} setResgatePontos(null); try { const resumo = { id: String(data.pedidoId), numero: typeof data.numero === "number" ? data.numero : undefined, ts: Date.now() }; localStorage.setItem("cf_ultimo_pedido", JSON.stringify(resumo)); setPedidoRecente(resumo); } catch {} setStatusPedidoConfirmado("novo"); setStatusPixCliente(payment?.toLowerCase().includes("pix") ? "aguardando_pix" : "nao_pix"); setPedidoConfirmado({ id: data.pedidoId, numero: data.numero, total: data.total, ...(typeof data.statusToken === "string" ? { statusToken: data.statusToken } : {}), ...(data.pix ? { pix: data.pix } : {}) }); go("sc-done"); } else { if (resgatePontos && typeof data.error === "string" && /resgate/i.test(data.error)) { try { sessionStorage.removeItem("cf_resgate_pontos"); } catch {} setResgatePontos(null); } showToast(typeof data.error === "string" ? data.error : "Erro ao enviar. Tente de novo."); }
    } catch { showToast("Sem conexão. Tente de novo."); } finally { setSending(false); }
  }
  function resetAll() { setCart([]); resetBuild(); setDelType(null); setBairroIdx(""); setRua(""); setNumero(""); setReferencia(""); setPayment(null); setTroco(""); setTrocoOpcao(null); setPaymentModal(null); setMistoPixInput(""); setMistoDinheiroInput(""); setErroMisto(""); setObservacao(""); setErroNome(""); setErroTelefone(""); setErroPagamento(""); setErroEntrega(""); setErroTroco(""); setPedidoConfirmado(null); setStatusPedidoConfirmado("novo"); setStatusPixCliente("aguardando_pix"); setRestoredDraft(false); setEditandoIdentidade(false); setLastAddedKind(null); setUpsellBebidaIgnorado(false); try { sessionStorage.removeItem("cf_draft"); } catch {} go("sc-start"); }

  const stepMap: Record<string, number> = { "sc-start": 0, "sc-build": 0, "sc-border": 0, "sc-list": 0, "sc-suco-leite": 0, "sc-macarronada-size": 0, "sc-promo": 0, "sc-another": 1, "sc-cart": 1, "sc-delivery": 2, "sc-pay": 3, "sc-done": 3 };
  const stepIdx = stepMap[screen] ?? 0;
  const STEPS = ["Itens", "Sacola", "Entrega", "Pagar"];
  const showStrongCartCta = cartCount > 0 && ["sc-list", "sc-suco-leite", "sc-macarronada-size", "sc-promo"].includes(screen);
  // Bottom nav só nas telas de navegação/exploração — some nas telas de
  // escolha/foco (tamanho, sabor, borda, com/sem leite, entrega, pagamento
  // etc.) pra não competir com o CTA principal daquela etapa.
  const showBottomNav = ["sc-start", "sc-list", "sc-cart", "sc-done"].includes(screen);
  // Aba "Pedido" só fica ativa com um pedido real (recém-enviado nesta sessão
  // ou lembrado do navegador nas últimas 3h) — nunca rastreamento fake.
  const pedidoAtivoId = pedidoConfirmado?.id || pedidoRecente?.id || null;
  const feitas = pizzasNoCarrinho();
  let ctxBadge = "", ctxTxt = "", ctxDots: { cls: string }[] = [];
  if (plan.openEnded) { ctxBadge = `Pizza ${feitas + 1}`; ctxTxt = feitas === 0 ? "Sua 1ª pizza" : `${feitas} já no carrinho`; }
  else if (plan.total > 0) { ctxBadge = `Pizza ${plan.current} de ${plan.total}`; ctxTxt = `Montando a pizza ${plan.current}`; for (let i = 1; i <= plan.total; i++) ctxDots.push({ cls: i < plan.current ? "done" : i === plan.current ? "cur" : "" }); }

  const PizzaCtx = () => (ctxBadge ? (
    <div className="pizza-ctx"><span className="pc-badge">{ctxBadge}</span><span className="pc-txt" dangerouslySetInnerHTML={{ __html: ctxTxt }} />{ctxDots.length > 0 && <span className="pizza-dots">{ctxDots.map((d, i) => <span key={i} className={`pd ${d.cls}`} />)}</span>}</div>
  ) : null);
  const TopBack = ({ onClick, title }: { onClick: () => void; title?: string }) => (
    <div className="top-back">
      <button type="button" onClick={onClick} aria-label="Voltar">{ICONS.voltar}</button>
      {title && <span className="top-back-title">{title}</span>}
    </div>
  );
  const pixPedido = pedidoConfirmado?.pix;
  const isPagamentoPix = (!!payment && payment.toLowerCase().includes("pix")) || !!pixPedido;
  const pixValor = typeof pixPedido?.valorEsperado === "number" ? pixPedido.valorEsperado : pedidoConfirmado?.total;
  const pixCodigoCopiaECola = pixPedido?.copiaECola || pixPedido?.qrCode || "";
  // Resumo da tela final (sc-done): reaproveita os mesmos estados/helpers já
  // usados na etapa de pagamento (payment, hibridoAtual, trocoOpcao/troco) —
  // nenhum recalculo novo, só apresentação. Só mostra troco quando a escolha
  // já foi confirmada (trocoOpcao setado); nunca inventa valor.
  const isDinheiroPuro = payment === "Dinheiro";
  const isCartaoPuro = payment === "Cartao";
  const trocoConfirmadoTexto = trocoOpcao === "nao" ? "Sem troco" : trocoOpcao === "sim" && troco.trim() ? `Troco para ${troco}` : null;
  const whatsappComprovanteUrl = pedidoConfirmado && pixPedido?.whatsappPizzaria
    ? montarLinkWhatsAppComprovante(pixPedido.whatsappPizzaria, {
      pedidoId: pedidoConfirmado.id,
      numero: pedidoConfirmado.numero,
      total: pedidoConfirmado.total,
    })
    : undefined;

  return (
    <>
      <style>{CSS}</style>
      <div className={`wrap ${screen === "sc-start" ? "wrap-start" : ""}`}>
        {screen !== "sc-start" && (
          <div className="steps">
            {STEPS.map((s, i) => (
              <span key={s} style={{ display: "contents" }}>
                <div className={`step-chip ${i === stepIdx ? "active" : i < stepIdx ? "done" : ""}`}><span className="num">{i < stepIdx ? ICONS.check : i + 1}</span>{s}</div>
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
              <a href="/cliente" style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--surface)", border: "1px solid var(--line-strong)", borderRadius: 14, padding: "10px 12px", marginBottom: 14, textDecoration: "none" }}>
                <span style={{ fontSize: 20, flexShrink: 0 }}>🎁</span>
                <span style={{ flex: 1 }}>
                  <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Entre com seu WhatsApp e acompanhe suas pizzas</span>
                  <span style={{ display: "block", fontSize: 12.5, color: "var(--text-sub)", marginTop: 2 }}>Rumo à sua recompensa — sem precisar entrar para pedir.</span>
                </span>
              </a>
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
                <button className="home-cat" onClick={goPizza}><span>{ICONS.pizza}</span><strong>Pizzas</strong></button>
                <button className="home-cat" onClick={() => goCat("lanche")}><span>{ICONS.lanche}</span><strong>Lanches</strong></button>
                <button className="home-cat" onClick={() => goCat("macarronada")}><span>{ICONS.macarronada}</span><strong>Macarronada</strong></button>
                <button className="home-cat" onClick={() => goCat("bebida")}><span>{ICONS.bebidas}</span><strong>Bebidas</strong></button>
                {(menu.sucos || []).length > 0 && (
                  <button className="home-cat" onClick={() => goCat("suco")}><span>{ICONS.sucos}</span><strong>Sucos</strong></button>
                )}
              </div>
            </section>
          )}
          {screen === "sc-build" && (
            <section className="screen active sc-build-screen">
              <TopBack onClick={() => go("sc-start")} title="Monte sua pizza" />
              <PizzaCtx />
              <div className="screen-head"><h2>Escolha o tamanho</h2><p>Toque em uma opcao para liberar os sabores.</p></div>
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
                      <div className="opt-body"><div className="opt-title">Mini-pizza</div><div className="opt-desc" style={miniPizzaEsgotada ? { color: "var(--danger)" } : undefined}>{miniPizzaEsgotada ? "Esgotado" : "Produto do cardapio"}</div></div>
                      <div className="opt-price">{miniPizzaEsgotada ? "" : money(miniPizzaItem.price)}</div>
                    </div>
                  )}
                </div>
              </div>
              <div className={`screen-head flavor-head ${!size ? "muted-head" : ""}`}><div className="eyebrow">Agora escolha o sabor</div><h2>Escolha até 2 sabores</h2><p>{miniPizzaMode ? "Mini-pizza vai com um sabor." : "Toque em 1 sabor, ou em 2 para meio a meio."}</p></div>
              {size ? (
                <>
                  {miniPizzaMode && <div className="mini-flow-note">Mini-pizza usa preco e produto existentes do cardapio.</div>}
                  {!miniPizzaMode && (
                    <div className="flavor-progress">
                      <div className="flavor-progress-dots">
                        <span className={`pd ${f1 ? "done" : "cur"}`} />
                        <span className={`pd ${f2 ? "done" : f1 ? "cur" : ""}`} />
                      </div>
                      <span className="flavor-progress-label">
                        {f2 ? `${f1} / ${f2}` : f1 ? `${f1} — toque em outro para meio a meio` : "Nenhum sabor escolhido ainda"}
                      </span>
                    </div>
                  )}
                  <div className="flavor-list">
                    {flavorSections.map((section) => (
                      <div key={section.title}>
                        <div className="section-label">{section.title}</div>
                        {section.flavors.map((f) => {
                          const esg = esgotados.includes(f)
                          return (
                            <div key={`${section.title}-${f}`} className={`opt flavor-opt ${f === f1 || f === f2 ? "sel" : ""} ${esg ? "esg" : ""}`} onClick={() => !esg && pickFlavor(f)} style={{ opacity: esg ? 0.5 : 1, cursor: esg ? "not-allowed" : "pointer" }}>
                              <div className="opt-emoji">🍕</div><div className="opt-body"><div className="opt-title">{f}</div>{esg && <div className="opt-desc" style={{ color: "var(--danger)" }}>Esgotado</div>}</div><div className="opt-check" />
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
              <TopBack onClick={() => go("sc-build")} title="Borda" />
              <PizzaCtx />
              <div className="screen-head"><h2>Escolha a borda</h2><p>Toque em uma opcao para adicionar direto ao pedido.</p></div>
              <div className="opt" onClick={() => addPizzaWithBorder(null, 0)}><div className="opt-emoji">⭕</div><div className="opt-body"><div className="opt-title">Sem borda</div></div><div className="opt-check" /></div>
              {(menu.borders || []).map((b, i) => { const p = bigBorder(size!) ? b.priceLarge : b.priceSmall; const esg = esgotados.includes(b.label); return (<div key={i} className={`opt ${border === b.label ? "sel" : ""}`} onClick={() => !esg && addPizzaWithBorder(b.label, p)} style={{ opacity: esg ? 0.5 : 1, cursor: esg ? "not-allowed" : "pointer" }}><div className="opt-emoji">🧀</div><div className="opt-body"><div className="opt-title">{b.label}</div>{esg && <div className="opt-desc" style={{ color: "var(--danger)" }}>Esgotado</div>}</div><div className="opt-price">{esg ? "" : `+${money(p)}`}</div><div className="opt-check" /></div>); })}
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
                  <div key={`f${i}`} style={{ fontSize: 14, color: "var(--success)", fontWeight: 700, marginBottom: 4 }}>+ {f.quantity > 1 ? `${f.quantity}x ` : ""}{f.productName} grátis (R$ 0,00)</div>
                ))}
                {promoSel.includedText && <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>{promoSel.includedText}</div>}
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16, fontWeight: 800, paddingTop: 10, marginTop: 8, borderTop: "1px solid var(--border)" }}>
                  <span>Preço promocional</span><span style={{ color: "var(--brand-text)" }}>{typeof promoSel.promotionalPrice === "number" ? money(promoSel.promotionalPrice) : "—"}</span>
                </div>
              </div>
              {promoPrecisaSabor(promoSel) && (
                <>
                  <div className="section-label">Escolha o sabor da pizza</div>
                  {[...(menu.saltyFlavors || []), ...(menu.sweetFlavors || [])].map((f) => {
                    const esg = esgotados.includes(f);
                    return (
                      <div key={f} className={`opt ${promoSabor === f ? "sel" : ""}`} onClick={() => !esg && setPromoSabor(f)} style={{ opacity: esg ? 0.5 : 1, cursor: esg ? "not-allowed" : "pointer" }}>
                        <div className="opt-emoji">🍕</div><div className="opt-body"><div className="opt-title">{f}</div>{esg && <div className="opt-desc" style={{ color: "var(--danger)" }}>Esgotado</div>}</div><div className="opt-check" />
                      </div>
                    );
                  })}
                </>
              )}
              <button className="btn" style={{ marginTop: 16 }} disabled={promoPrecisaSabor(promoSel) && !promoSabor} onClick={adicionarPromocao}>Adicionar promoção ao carrinho</button>
            </section>
          )}
          {screen === "sc-another" && (
            <section className="screen active another-screen">
              <TopBack onClick={() => sairDoPosItemSemBebida("sc-cart")} title="Pedido adicionado" />
              <div className="screen-head">
                <div className="eyebrow">Pedido adicionado ✓</div>
                <h2>{showUpsellBebida ? "Que tal uma bebida pra acompanhar?" : "O que você quer fazer agora?"}</h2>
              </div>
              {showUpsellBebida && (
                <div className="grid2">
                  <div className="opt" onClick={() => goCat("bebida")}><div className="opt-emoji">🥤</div><div className="opt-body"><div className="opt-title">Refrigerantes</div></div></div>
                  {(menu.sucos || []).length > 0 && (
                    <div className="opt" onClick={() => goCat("suco")}><div className="opt-emoji">🧃</div><div className="opt-body"><div className="opt-title">Sucos</div></div></div>
                  )}
                </div>
              )}
              <button className="btn btn-ghost btn-sm" onClick={() => sairDoPosItemSemBebida("sc-start")}>+ Adicionar outro produto</button>
            </section>
          )}
          {screen === "sc-list" && (
            <section className="screen active list-screen">
              <TopBack onClick={() => go("sc-start")} title={({ lanche: "Lanches", macarronada: "Macarronada", bebida: "Bebidas", suco: "Sucos" } as Record<string, string>)[listCat] || "Escolha o produto"} />
              {(() => {
                const lanches = menu.lanches || [];
                const cfg = { lanche: { eb: "Lanches & Porções", t: "Escolha seu lanche", data: lanches.filter((it) => !isMacarronada(it)), emoji: "🍽️" }, macarronada: { eb: "", t: "Escolha sua macarronada", data: lanches.filter(isMacarronada), emoji: ICONS.macarronada }, bebida: { eb: "", t: "Bebidas geladas", data: menu.bebidas || [], emoji: ICONS.bebidas }, suco: { eb: "Sucos naturais", t: "Sucos da casa", data: menu.sucos || [], emoji: ICONS.sucos } }[listCat];
                return (<><div className="screen-head">{cfg.eb && <div className="eyebrow">{cfg.eb}</div>}<h2>{cfg.t}</h2><p>Toque para adicionar.</p></div>{cfg.data.length === 0 ? <CardapioIllustration {...CARDAPIO_ILLUSTRATIONS.semResultado} /> : cfg.data.map((it, i) => { const esg = esgotados.includes(it.name); return (<div key={i} className="opt" onClick={() => !esg && addSimple(it, cfg.emoji)} style={{ opacity: esg ? 0.5 : 1, cursor: esg ? "not-allowed" : "pointer" }}><div className="opt-emoji">{cfg.emoji}</div><div className="opt-body"><div className="opt-title">{it.name}</div>{esg && <div className="opt-desc" style={{ color: "var(--danger)" }}>Esgotado</div>}</div><div className="opt-price">{simplePriceLabel(it)}</div></div>); })}</>);
              })()}
            </section>
          )}
          {screen === "sc-suco-leite" && sucoPendente && (
            <section className="screen active">
              <TopBack onClick={() => { setSucoPendente(null); go("sc-list"); }} title="Como prefere o suco?" />
              <div className="screen-head"><div className="eyebrow">Suco natural</div><h2>Com leite?</h2><p>{sucoPendente.name}</p></div>
              <div className="opt" onClick={() => addSucoLeite(false)}><div className="opt-emoji">S</div><div className="opt-body"><div className="opt-title">Sem leite</div></div></div>
              <div className="opt" onClick={() => addSucoLeite(true)}><div className="opt-emoji">+1</div><div className="opt-body"><div className="opt-title">Com leite</div></div><div className="opt-price">+{money(1)}</div></div>
            </section>
          )}          {screen === "sc-macarronada-size" && macarronadaPendente && (
            <section className="screen active">
              <TopBack onClick={() => { setMacarronadaPendente(null); go("sc-list"); }} title={macarronadaPendente.name} />
              <div className="screen-head"><h2>Escolha o tamanho</h2><p>{macarronadaPendente.name}</p></div>
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
              <div className="screen-head"><h2>Confira os itens</h2><p>Tudo certo? Então bora finalizar.</p></div>
              {cart.length === 0 ? (<CardapioIllustration {...CARDAPIO_ILLUSTRATIONS.sacolaVazia} />) : (
                <>{(() => { let pn = 0; return cart.map((it, i) => { let tag = null; if (it.kind === "pizza") { pn++; tag = <span className="ci-tag">Pizza {pn}</span>; } const nm = it.kind === "pizza" ? it.name.replace(/^Pizza /, "") : it.name; const itemEsg = cartItemEsgotado(it.keys, esgotados); return (<div key={i} className="cart-item"><div className="ci-emoji">{it.emoji}</div><div className="ci-body"><div className="ci-name">{tag}{nm}{it.qty > 1 ? ` ×${it.qty}` : ""}{itemEsg && <span style={{ color: "var(--danger-text)", fontWeight: 800, marginLeft: 6 }}>· Esgotado</span>}</div>{it.detail && <div className="ci-detail">{it.detail}</div>}<div className="ci-price">{money(it.price * it.qty)}</div>{it.kind === "simple" && (<div className="qty-pill"><button onClick={() => chQty(i, -1)}>−</button><span>{it.qty}</span><button onClick={() => chQty(i, 1)}>+</button></div>)}</div><button className="ci-remove" onClick={() => rmItem(i)}>{ICONS.remover}</button></div>); }); })()}<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 4px 4px", fontWeight: 700, fontSize: 19 }}><span>Subtotal</span><span>{money(cartTotal)}</span></div>{descontoResgate > 0 && (<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 4px 0", fontWeight: 700, fontSize: 14, color: "var(--success-text)" }}><span>Desconto fidelidade</span><span>−{money(descontoResgate)}</span></div>)}</>
              )}
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 4 }} onClick={() => go("sc-start")}>+ Adicionar mais</button>
              {cartEsgotado && <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, background: "color-mix(in srgb, var(--danger) 10%, transparent)", color: "var(--danger)", fontSize: 13, fontWeight: 700 }}>{ICONS.alerta} Um item do seu pedido ficou esgotado. Remova para continuar.</div>}
            </section>
          )}
          {screen === "sc-delivery" && (
            <section className="screen active delivery-screen">
              <TopBack onClick={() => go("sc-cart")} title="Entrega" />
              <div className="screen-head"><h2>Como prefere receber?</h2></div>
              <div className={`opt ${delType === "delivery" ? "sel" : ""}`} onClick={() => { setDelType("delivery"); if (erroEntrega) setErroEntrega(""); }}><div className="opt-emoji">{ICONS.entrega}</div><div className="opt-body"><div className="opt-title">Entrega (delivery)</div><div className="opt-desc">Levamos até você</div></div><div className="opt-check" /></div>
              <div className={`opt ${delType === "retirada" ? "sel" : ""}`} onClick={() => { setDelType("retirada"); setBairroIdx(""); setErroEntrega(""); }}><div className="opt-emoji">{ICONS.retirada}</div><div className="opt-body"><div className="opt-title">Buscar na loja</div><div className="opt-desc">Sem taxa de entrega</div></div><div className="opt-check" /></div>
              <div className={`opt ${delType === "dine_in" ? "sel" : ""}`} onClick={() => { setDelType("dine_in"); setBairroIdx(""); setErroEntrega(""); }}><div className="opt-emoji">{ICONS.consumoLocal}</div><div className="opt-body"><div className="opt-title">Consumo no local</div><div className="opt-desc">Comer aqui na pizzaria</div></div><div className="opt-check" /></div>
              {delType === "delivery" && (
                <div>
                  <div className="section-label">Endereço</div>
                  {erroEntrega && <div style={{ color: "var(--danger)", fontSize: 12, fontWeight: 700, margin: "-4px 0 10px" }}>{erroEntrega}</div>}
                  <div className="field">
                    <label>Bairro</label>
                    <select value={bairroIdx} onChange={(e) => { setBairroIdx(e.target.value); if (erroEntrega) setErroEntrega(""); }} style={bairroSelectStyle}>
                      <option value="" style={bairroOptionStyle}>Selecione o bairro...</option>
                      {(menu.neighborhoods || []).map((b, i) => <option key={i} value={i} style={bairroOptionStyle}>{b.name} - {money(b.fee)}</option>)}
                    </select>
                    {bairroErro && <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 4 }}>Selecione o bairro</div>}
                  </div>
                  <div className="field">
                    <label>Rua</label>
                    <input value={rua} onChange={(e) => { setRua(e.target.value); if (erroEntrega) setErroEntrega(""); }} placeholder="Rua das Flores" style={ruaErro ? enderecoErroStyle : undefined} />
                    {ruaErro && <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 4 }}>Preencha a rua</div>}
                  </div>
                  <div className="field">
                    <label>Número</label>
                    <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                      <input value={numero} onChange={(e) => { setNumero(e.target.value); if (erroEntrega) setErroEntrega(""); }} inputMode="text" placeholder="123" style={numeroErro ? enderecoErroStyle : undefined} />
                      <button type="button" onClick={() => { setNumero("S/N"); if (erroEntrega) setErroEntrega(""); }} style={{ flex: "0 0 auto", border: "1px solid var(--line-strong)", borderRadius: 13, background: numero.trim().toUpperCase() === "S/N" ? "var(--brand-soft)" : "var(--surface2)", color: numero.trim().toUpperCase() === "S/N" ? "var(--brand)" : "var(--text)", fontSize: 12, fontWeight: 700, padding: "0 12px" }}>Sem número</button>
                    </div>
                    {numeroErro && <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 4 }}>Preencha o n?mero</div>}
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

              <div ref={pagamentoRef} className="pay-section-card payment-choice">
                <div className="pay-section-title">Escolha o pagamento</div>
                <div className="payment-grid">
                  {[...(menu.payments || []), "Misto"].map((p) => (
                    <button key={p} type="button" className={`payment-card ${(p === "Misto" ? isHibrido : payment === p) ? "sel" : ""}`} onClick={() => openPaymentConfig(p)}>
                      <span className="payment-icon">{paymentIcon(p)}</span>
                      <span className="payment-card-text"><strong>{paymentLabel(p)}</strong><small>{paymentSummary(p)}</small></span>
                    </button>
                  ))}
                </div>
                {erroPagamento && <div className="pay-error">{erroPagamento === "pagamento" ? "Falta escolher como voce vai pagar." : erroPagamento}</div>}
                {!erroPagamento && hibridoBloqueado && (
                  <div className="pay-error">
                    {!hibridoSomaValida
                      ? `A divisão do pagamento misto não bate mais com o total (${money(finalTotal)}). Toque em "Pagamento misto" para ajustar.`
                      : "Falta confirmar o troco do pagamento misto. Toque em \"Pagamento misto\" para ajustar."}
                  </div>
                )}
              </div>

              {/* Bloco: Identificação */}
              {!editandoIdentidade && nome.trim() && (telefoneValido(telefone) || vinculoWhatsappAtivo) ? (
                <div className="pay-section-card">
                  <div className="pay-section-title">Pedido identificado</div>
                  <div className="identidade-row">
                    <div className="identidade-avatar" aria-hidden="true">{ICONS.pessoa}</div>
                    <div className="identidade-info">
                      <div className="identidade-nome">{nome.trim()}</div>
                      {vinculoWhatsappAtivo
                        ? <span className="wa-badge">✅ Vinculado ao WhatsApp · final {waFinal}</span>
                        : <span className="identidade-tel">{telefone}</span>}
                    </div>
                  </div>
                  <p className="identidade-explicacao">Vamos usar esses dados neste pedido.<br />Se estiver tudo certo, é só escolher o pagamento.</p>
                  <div className="pay-divider" />
                  <div className="pay-actions-row">
                    <button type="button" className="pay-action-link" onClick={() => setEditandoIdentidade(true)}>{vinculoWhatsappAtivo ? "Alterar nome" : "Alterar dados"}</button>
                    {vinculoWhatsappAtivo && (
                      <button
                        type="button"
                        className="pay-action-link muted"
                        onClick={() => { setUsarOutroWhatsapp(true); setEditandoIdentidade(true); }}
                      >Usar outro WhatsApp</button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="pay-section-card">
                  <div className="pay-section-title">Pra quem é o pedido?</div>
                  <p className="pay-section-help">Rapidinho: é só pra gente identificar seu pedido e falar com você se precisar.</p>
                  <div className="field">
                    <label>Seu nome</label>
                    <input ref={nomeRef} value={nome} onChange={(e) => { setNome(e.target.value); if (erroNome) setErroNome(""); }} placeholder="Como te chamamos?" />
                    {erroNome && <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 4 }}>{erroNome}</div>}
                  </div>
                  {vinculoWhatsappAtivo ? (
                    <div className="field">
                      <div className="wa-inline-note">
                        <span className="wa-badge">✅ Vinculado ao seu WhatsApp · final {waFinal}</span>
                        <button
                          type="button"
                          className="pay-action-link"
                          onClick={() => setUsarOutroWhatsapp(true)}
                        >Usar outro WhatsApp</button>
                      </div>
                    </div>
                  ) : (
                    <div className="field">
                      <label>WhatsApp</label>
                      <input ref={telefoneRef} value={telefone} onChange={(e) => { const f = formatTel(e.target.value); setTelefone(f); if (erroTelefone) setErroTelefone(""); }} inputMode="tel" placeholder="(99) 9 9999-9999" />
                      {waFinal && usarOutroWhatsapp && (
                        <button
                          type="button"
                          className="pay-action-link"
                          style={{ fontSize: 12, marginTop: 6 }}
                          onClick={() => { setUsarOutroWhatsapp(false); setTelefone(""); setErroTelefone(""); }}
                        >Voltar a usar o WhatsApp vinculado (final {waFinal})</button>
                      )}
                      {erroTelefone && <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 4 }}>{erroTelefone}</div>}
                    </div>
                  )}
                </div>
              )}
              {/* Bloco: Observação */}
              <div className="pay-section-card">
                <div className="pay-section-title">Observações do pedido</div>
                <div className="obs-help-row">
                  <span className="obs-icon" aria-hidden="true">{ICONS.nota}</span>
                  <p className="pay-section-help" style={{ margin: 0 }}>Se quiser, deixa um recado pra cozinha.<br />Se não tiver nada, pode seguir direto.</p>
                </div>
                <div className="field" style={{ marginBottom: 0 }}><input value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Ex: sem cebola, sem azeitona, tirar milho, pouco orégano…" /></div>
              </div>
              {cartEsgotado && <div style={{ marginTop: 8, padding: "10px 12px", borderRadius: 10, background: "color-mix(in srgb, var(--danger) 10%, transparent)", color: "var(--danger)", fontSize: 13, fontWeight: 700 }}>{ICONS.alerta} Um item do seu pedido ficou esgotado. Remova para continuar.</div>}
            </section>
          )}
          {screen === "sc-done" && (
            <section className="screen active done-screen">
              <div className="success">
                <div className="check">{ICONS.check}</div>
                <h2>Pedido recebido!</h2>
                <p>Valeu, {nome.split(" ")[0]}! A pizzaria já recebeu seu pedido e vai começar a preparar em breve.</p>
                {pedidoConfirmado && (
                  <>
                    <p style={{ fontWeight: 700, fontSize: 18, margin: "12px 0 4px" }}>Pedido #{pedidoConfirmado.numero}</p>
                    <p style={{ color: "var(--brand-text)", fontSize: 15, fontWeight: 800, margin: "0 0 8px" }}>{STATUS_PEDIDO_LABEL[statusPedidoConfirmado]}</p>
                    <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 16 }}>Total: {money(pedidoConfirmado.total)}</p>
                    <a href="/cliente" style={{ display: "block", background: "var(--surface)", border: "1px solid var(--line-strong)", borderRadius: 12, padding: "12px 14px", marginBottom: 16, textDecoration: "none", textAlign: "left" }}>
                      <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>🎁 Quer que essa compra conte para sua fidelidade?</span>
                      <span style={{ display: "block", fontSize: 12.5, color: "var(--text-sub)", marginTop: 2 }}>Entre com seu WhatsApp e acompanhe seu progresso.</span>
                    </a>
                    {isPagamentoPix && (
                      <div style={{ textAlign: "left", background: "var(--surface)", border: "1px solid var(--line-strong)", borderRadius: 10, padding: "14px", marginBottom: 16 }}>
                        <CardapioIllustration compact icon={statusPixCliente === "pago" ? ICONS.check : CARDAPIO_ILLUSTRATIONS.aguardandoPix.icon} title={statusPixCliente === "aguardando_pix" ? "Quase lá, falta o Pix" : PIX_STATUS_LABEL[statusPixCliente]} />
                        <div style={{ display: "inline-flex", marginTop: 12, marginBottom: 12, padding: "5px 10px", borderRadius: 999, background: statusPixCliente === "pago" ? "var(--green-soft)" : "var(--brand-soft)", color: statusPixCliente === "pago" ? "var(--green)" : "var(--brand)", fontSize: 12, fontWeight: 800 }}>
                          {PIX_STATUS_LABEL[statusPixCliente]}
                        </div>
                        {isHibrido && hibridoAtual ? (
                          <div style={{ display: "grid", gap: 4, fontSize: 14, color: "var(--text)", lineHeight: 1.5, marginBottom: 12 }}>
                            <p style={{ margin: 0 }}><strong>Pix:</strong> {money(hibridoAtual.pix)} — {PIX_STATUS_LABEL[statusPixCliente]}</p>
                            <p style={{ margin: 0 }}><strong>Dinheiro:</strong> {money(hibridoAtual.dinheiro)} na hora de receber o pedido</p>
                            {trocoConfirmadoTexto && <p style={{ margin: 0 }}><strong>Troco:</strong> {trocoConfirmadoTexto}</p>}
                          </div>
                        ) : (
                          statusPixCliente !== "pago" && (
                            <p style={{ margin: "0 0 12px", fontWeight: 700, fontSize: 14, color: "var(--text)" }}>
                              Agora falta fazer o Pix de {money(pixValor ?? pedidoConfirmado.total)}.
                            </p>
                          )
                        )}
                        <div style={{ display: "grid", gap: 8, fontSize: 14, color: "var(--text)", lineHeight: 1.45 }}>
                          <div><strong>Pedido:</strong> #{pedidoConfirmado.numero}</div>
                          <div><strong>Total:</strong> {money(pedidoConfirmado.total)}</div>
                          {pixPedido?.chavePix && <div style={{ wordBreak: "break-word" }}><strong>Chave Pix:</strong> {pixPedido.chavePix}</div>}
                          {pixPedido?.beneficiario && <div><strong>Beneficiário:</strong> {pixPedido.beneficiario}</div>}
                        </div>
                        <p style={{ color: "var(--text-sub)", fontSize: 13, lineHeight: 1.5, margin: "12px 0 0" }}>
                          {PIX_STATUS_TEXT[statusPixCliente]}
                        </p>
                        {statusPixCliente !== "pago" && (
                          <p style={{ color: "var(--text)", fontSize: 13, fontWeight: 700, lineHeight: 1.5, margin: "8px 0 0" }}>
                            Use o botão abaixo para enviar o comprovante pelo WhatsApp da pizzaria.
                          </p>
                        )}
                        <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
                          {pixPedido?.chavePix && (
                            <button className="btn btn-sm" onClick={async () => showToast((await copiarTexto(pixPedido.chavePix || "")) ? "Chave Pix copiada!" : "Não consegui copiar. Toque na chave e copie manualmente.")}>Copiar chave Pix</button>
                          )}
                          {pixCodigoCopiaECola && (
                            <button className="btn btn-sm btn-ghost" onClick={async () => showToast((await copiarTexto(pixCodigoCopiaECola)) ? "Pix copia e cola copiado!" : "Não consegui copiar. Toque no código e copie manualmente.")}>Copiar Pix copia e cola</button>
                          )}
                          {whatsappComprovanteUrl ? (
                            <a href={whatsappComprovanteUrl} target="_blank" rel="noreferrer" className="btn btn-sm" style={{ display: "block", textAlign: "center", textDecoration: "none", background: "var(--success)" }}>Enviar comprovante no WhatsApp</a>
                          ) : (
                            <div style={{ border: "1px dashed var(--line-strong)", borderRadius: 10, padding: "10px 12px", color: "var(--text-sub)", fontSize: 13, lineHeight: 1.45 }}>
                              Envie o comprovante pelo WhatsApp da pizzaria. Se o botão não aparecer, copie a chave Pix acima e chame a equipe pelo contato do cardápio.
                            </div>
                          )}
                          {pedidoConfirmado.pix?.ticketUrl && <a href={pedidoConfirmado.pix.ticketUrl} target="_blank" rel="noreferrer" style={{ display: "block", color: "var(--brand-text)", fontSize: 13, fontWeight: 800, textAlign: "center" }}>Abrir pagamento</a>}
                        </div>
                      </div>
                    )}
                    {!isPagamentoPix && isDinheiroPuro && (
                      <div style={{ textAlign: "left", background: "var(--surface)", border: "1px solid var(--line-strong)", borderRadius: 10, padding: "14px", marginBottom: 16, fontSize: 14, color: "var(--text)", lineHeight: 1.5 }}>
                        <p style={{ margin: trocoConfirmadoTexto ? "0 0 4px" : 0, fontWeight: 700 }}>Pagamento em dinheiro na hora de receber o pedido.</p>
                        {trocoConfirmadoTexto && <p style={{ margin: 0, color: "var(--text-sub)" }}>Troco: {trocoConfirmadoTexto}</p>}
                      </div>
                    )}
                    {!isPagamentoPix && isCartaoPuro && (
                      <div style={{ textAlign: "left", background: "var(--surface)", border: "1px solid var(--line-strong)", borderRadius: 10, padding: "14px", marginBottom: 16, fontSize: 14, color: "var(--text)", lineHeight: 1.5 }}>
                        <p style={{ margin: 0, fontWeight: 700 }}>Pagamento no cartão na hora de receber o pedido.</p>
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
        <div className={`delivery-cta-bar ${showBottomNav ? "stacked" : ""}`}>
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
            <button className="btn delivery-cta-btn" disabled={sending || cartEsgotado || hibridoBloqueado} onClick={finish}>{sending ? "Enviando…" : "Finalizar pedido"}</button>
          </div>
        </div>
      )}
      {showStrongCartCta && (
        <div className={`delivery-cta-bar ${showBottomNav ? "stacked" : ""}`}>
          <div className="delivery-cta-inner pay-cta-inner">
            <div className="delivery-cta-info">
              <div className="delivery-cta-label">Sacola</div>
              <div className="delivery-cta-total">{cartCount} {cartCount === 1 ? "item" : "itens"} · {money(finalTotal)}</div>
            </div>
            <button className="btn delivery-cta-btn" onClick={() => go("sc-cart")}>Revisar pedido</button>
          </div>
        </div>
      )}
      {screen === "sc-another" && cartCount > 0 && (
        <div className="delivery-cta-bar">
          <div className="delivery-cta-inner pay-cta-inner">
            <div className="delivery-cta-info">
              <div className="delivery-cta-label">Sacola</div>
              <div className="delivery-cta-total">{cartCount} {cartCount === 1 ? "item" : "itens"} · {money(finalTotal)}</div>
            </div>
            <button className="btn delivery-cta-btn" onClick={() => sairDoPosItemSemBebida("sc-cart")}>Ir para sacola</button>
          </div>
        </div>
      )}
      {cartCount > 0 && !showStrongCartCta && !showBottomNav && screen !== "sc-done" && screen !== "sc-cart" && screen !== "sc-delivery" && screen !== "sc-pay" && (<div className="cartbar show"><div className="cartbar-inner"><div className="cartbar-info"><div className="cartbar-count">Sacola</div><div className="cartbar-total">{cartCount} {cartCount === 1 ? "item" : "itens"} · {money(finalTotal)}</div></div><button className="cartbar-link" onClick={() => go("sc-cart")}>Editar</button></div></div>)}
      {showBottomNav && (
        <nav className="bottom-nav" aria-label="Navegação principal">
          <div className="bottom-nav-inner">
            <button type="button" className={`bnav-item ${screen === "sc-start" ? "active" : ""}`} onClick={() => go("sc-start")}>
              <span className="bnav-icon">{ICONS.inicio}</span>
              <span className="bnav-label">Início</span>
            </button>
            <button type="button" className={`bnav-item ${screen === "sc-cart" ? "active" : ""}`} onClick={() => go("sc-cart")}>
              <span className="bnav-icon-wrap">
                <span className="bnav-icon">{ICONS.sacola}</span>
                {cartCount > 0 && <span className="bnav-badge">{cartCount > 99 ? "99+" : cartCount}</span>}
              </span>
              <span className="bnav-label">Sacola</span>
            </button>
            {pedidoAtivoId ? (
              <a className={`bnav-item ${screen === "sc-done" ? "active" : ""}`} href={`/rastrear/${pedidoAtivoId}`}>
                <span className="bnav-icon">{ICONS.pedido}</span>
                <span className="bnav-label">Pedido</span>
              </a>
            ) : (
              <span className="bnav-item disabled" aria-disabled="true">
                <span className="bnav-icon">{ICONS.pedido}</span>
                <span className="bnav-label">Pedido</span>
              </span>
            )}
            <a className="bnav-item" href="/cliente">
              <span className="bnav-icon">{ICONS.pessoa}</span>
              <span className="bnav-label">Perfil</span>
            </a>
          </div>
        </nav>
      )}
      {paymentModal && (
        <div className="payment-modal-backdrop" role="presentation" onClick={() => setPaymentModal(null)}>
          <div className="payment-modal" role="dialog" aria-modal="true" aria-labelledby="payment-modal-title" onClick={(e) => e.stopPropagation()}>
            <div className="payment-modal-head">
              <div>
                {paymentModal === "Dinheiro" ? (
                  <>
                    <h3 id="payment-modal-title">Precisa de troco?</h3>
                    {trocoOpcao && (
                      <span className="money-status-badge">{trocoOpcao === "nao" ? "Sem troco" : "Precisa de troco"}</span>
                    )}
                  </>
                ) : paymentModal === "Misto" ? (
                  <>
                    <div className="payment-modal-kicker">Pagamento misto</div>
                    <h3 id="payment-modal-title">Pix + Dinheiro</h3>
                  </>
                ) : (
                  <>
                    <div className="payment-modal-kicker">Pagamento</div>
                    <h3 id="payment-modal-title">{paymentLabel(paymentModal)}</h3>
                  </>
                )}
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
            {paymentModal === "Misto" && (() => {
              const pixNumAtual = parseValorInput(mistoPixInput);
              const dinheiroNumAtual = parseValorInput(mistoDinheiroInput);
              const somaAtual = (isNaN(pixNumAtual) ? 0 : pixNumAtual) + (isNaN(dinheiroNumAtual) ? 0 : dinheiroNumAtual);
              const somaBate = !isNaN(pixNumAtual) && !isNaN(dinheiroNumAtual) && Math.abs(somaAtual - finalTotal) <= 0.01;
              const dinheiroAtivo = !isNaN(dinheiroNumAtual) && dinheiroNumAtual > 0;
              return (
                <div className="payment-modal-body">
                  <p>Total do pedido: <strong>{money(finalTotal)}</strong></p>
                  <div className="misto-fields">
                    <div className="field money-field">
                      <label>Valor no Pix</label>
                      <input value={mistoPixInput} onChange={(e) => onChangeMistoPix(e.target.value)} inputMode="numeric" placeholder="Ex: 50" />
                    </div>
                    <div className="field money-field">
                      <label>Valor no Dinheiro</label>
                      <input value={mistoDinheiroInput} onChange={(e) => onChangeMistoDinheiro(e.target.value)} inputMode="numeric" placeholder="Ex: 30" />
                    </div>
                  </div>
                  <p className={`misto-resumo ${somaBate ? "ok" : ""}`}>
                    {`Pix R$ ${isNaN(pixNumAtual) ? "0,00" : pixNumAtual.toFixed(2).replace(".", ",")} + Dinheiro R$ ${isNaN(dinheiroNumAtual) ? "0,00" : dinheiroNumAtual.toFixed(2).replace(".", ",")}`}
                    {!somaBate && ` (total: ${money(somaAtual)})`}
                  </p>
                  {erroMisto && <div className="pay-error">{erroMisto}</div>}
                  {dinheiroAtivo && (
                    <>
                      <div className="money-choice-row">
                        <button type="button" className={`btn ${trocoOpcao === "nao" ? "" : "btn-ghost"}`} onClick={() => { setTrocoOpcao("nao"); setTroco(""); setErroTroco(""); }}>Sem troco</button>
                        <button type="button" className={`btn ${trocoOpcao === "sim" ? "" : "btn-ghost"}`} onClick={() => { setTrocoOpcao("sim"); setErroTroco(""); }}>Troco para quanto?</button>
                      </div>
                      {trocoOpcao === "sim" && (
                        <div className="field money-field">
                          <label>Vai pagar a parte em dinheiro com quanto?</label>
                          <input value={troco} onChange={(e) => { setTroco(e.target.value); if (erroTroco) setErroTroco(""); }} inputMode="numeric" placeholder={`Ex: ${Math.ceil(dinheiroNumAtual / 10) * 10 || 50}`} />
                        </div>
                      )}
                      {erroTroco && <div className="pay-error">{erroTroco}</div>}
                    </>
                  )}
                </div>
              );
            })()}
            {paymentModal !== "Pix" && paymentModal !== "Cartao" && paymentModal !== "Dinheiro" && paymentModal !== "Misto" && (
              <div className="payment-modal-body"><p>{paymentHint(paymentModal)}</p></div>
            )}
            {paymentModal === "Dinheiro" && (
              <div className="payment-modal-body">
                <div className="money-choice-row">
                  <button type="button" className={`btn ${trocoOpcao === "nao" ? "" : "btn-ghost"}`} onClick={confirmDinheiroSemTroco}>Não preciso</button>
                  <button type="button" className={`btn ${trocoOpcao === "sim" ? "" : "btn-ghost"}`} onClick={() => { setTrocoOpcao("sim"); setErroTroco(""); }}>Preciso</button>
                </div>
                {trocoOpcao === "sim" && (
                  <div className="field money-field">
                    <label>Vai pagar com quanto?</label>
                    <input value={troco} onChange={(e) => { setTroco(e.target.value); if (erroTroco) setErroTroco(""); }} inputMode="numeric" placeholder={`Ex: ${Math.ceil((cartTotal + fee) / 10) * 10}`} />
                  </div>
                )}
                {erroTroco && <div className="pay-error">{erroTroco}</div>}
              </div>
            )}
            {(paymentModal !== "Dinheiro" || trocoOpcao === "sim") && (
              <div className={`payment-modal-actions ${paymentModal === "Dinheiro" ? "single" : ""}`}>
                {paymentModal !== "Dinheiro" && <button type="button" className="btn btn-ghost" onClick={() => setPaymentModal(null)}>Cancelar</button>}
                <button type="button" className="btn" onClick={confirmPaymentConfig}>Confirmar</button>
              </div>
            )}
          </div>
        </div>
      )}
      {screen === "sc-build" && flavorModalOpen && size && (
        <div className="flavor-modal-backdrop" role="presentation" onClick={() => setFlavorModalOpen(false)}>
          <div className="flavor-modal payment-modal" role="dialog" aria-modal="true" aria-labelledby="flavor-modal-title" onClick={(e) => e.stopPropagation()}>
            <div className="payment-modal-head">
              <div>
                <h3 id="flavor-modal-title">{flavorModalTitle}</h3>
                <p className="flavor-modal-msg">{flavorModalMessage}</p>
                {flavorModalHint && <p className="flavor-modal-hint">{flavorModalHint}</p>}
              </div>
              <button type="button" className="payment-modal-close" aria-label="Fechar" onClick={() => setFlavorModalOpen(false)}>×</button>
            </div>
            <div className="flavor-modal-body">
              {flavorSections.map((section) => (
                <div key={section.title}>
                  <div className="section-label">{section.title}</div>
                  {section.flavors.map((f) => {
                    const esg = esgotados.includes(f);
                    return (
                      <div key={`modal-${section.title}-${f}`} className={`opt flavor-opt ${f === f1 || f === f2 ? "sel" : ""} ${esg ? "esg" : ""}`} onClick={() => !esg && pickFlavor(f)} style={{ opacity: esg ? 0.5 : 1, cursor: esg ? "not-allowed" : "pointer" }}>
                        <div className="opt-emoji">🍕</div><div className="opt-body"><div className="opt-title">{f}</div>{esg && <div className="opt-desc" style={{ color: "var(--danger)" }}>Esgotado</div>}</div><div className="opt-check" />
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="payment-modal-actions single">
              <button type="button" className="btn" disabled={!buildOk} onClick={confirmFromModal}>{buildActionLabel}</button>
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
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, background: "var(--background)", color: "var(--foreground)", fontFamily: "system-ui", padding: 24 }}>
      <div style={{ fontSize: 40 }}>🍕</div>
      <p style={{ fontWeight: 700, fontSize: 16, margin: 0 }}>Não foi possível carregar o cardápio.</p>
      <button onClick={retry} style={{ border: "1px solid var(--surface-elevated)", background: "transparent", color: "var(--foreground)", padding: "10px 20px", borderRadius: 10, cursor: "pointer", fontSize: 14 }}>Tentar de novo</button>
    </div>
  );

  if (!menu) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--background)", color: "var(--foreground)", fontFamily: "system-ui" }}>
      <div style={{ textAlign: "center" }}><div style={{ fontSize: 36, marginBottom: 12 }}>🍕</div><p>Carregando cardápio…</p></div>
    </div>
  );

  if (isAdmin) return <AdminCardapio menu={menu} onSair={() => setIsAdmin(false)} />;
  return <PublicCardapio menu={menu} />;
}

const CSS = `
:root{--font-ui:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
:root[data-theme="dark"]{--bg:var(--background);--surface2:var(--surface-secondary);--text:var(--text-primary);--text-sub:var(--text-secondary);--text-faint:var(--text-muted);--brand:var(--primary);--brand-press:var(--primary-active);--brand-soft:var(--primary-soft);--brand-foreground:var(--on-primary);--gold:var(--brand-text);--green:var(--success);--green-soft:var(--success-surface);--green-foreground:var(--on-success);--line:rgba(var(--overlay-rgb), 0.08);--line-strong:rgba(var(--overlay-rgb), 0.16);}
:root[data-theme="light"]{--bg:var(--background);--surface2:var(--surface-secondary);--text:var(--text-primary);--text-sub:var(--text-secondary);--text-faint:var(--text-muted);--brand:var(--primary);--brand-press:var(--primary-active);--brand-soft:var(--primary-soft);--brand-foreground:var(--on-primary);--gold:var(--brand-text);--green:var(--success);--green-soft:var(--success-surface);--green-foreground:var(--on-success);--line:rgba(var(--overlay-rgb), 0.08);--line-strong:rgba(var(--overlay-rgb), 0.14);}
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{font-family:var(--font-ui);background:var(--bg);color:var(--text);line-height:1.5;overflow-x:hidden;padding-bottom:112px;transition:background .35s,color .35s;font-size:16px;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
.wrap{width:min(100%,540px);max-width:540px;margin:0 auto;min-height:100vh;position:relative;font-family:var(--font-ui);padding-top:46px}
.wrap-start{padding-top:0;background:var(--bg)}
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
.step-chip.active .num{background:var(--brand);border-color:var(--brand);color:var(--brand-foreground)}
.step-chip.done{color:var(--green)}
.step-chip.done .num{background:var(--green);border-color:var(--green);color:var(--green-foreground)}
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
.eyebrow{font-size:11px;font-weight:600;color:var(--gold);text-transform:uppercase;letter-spacing:1.4px}
.screen-head h2{font-family:var(--font-ui);font-weight:600;font-size:23px;letter-spacing:-.4px;margin-top:7px;line-height:1.2}
.screen-head p{font-size:14.5px;color:var(--text-sub);margin-top:7px;font-weight:400;line-height:1.5}
.pizza-ctx{display:flex;align-items:center;gap:11px;background:var(--brand-soft);border-radius:14px;padding:12px 15px;margin:16px 0 2px}
.pc-badge{background:var(--brand);color:var(--brand-foreground);font-weight:600;font-size:12px;padding:5px 11px;border-radius:20px;white-space:nowrap}
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
.opt-check{width:23px;height:23px;border-radius:50%;border:2px solid var(--line-strong);flex:0 0 auto;display:flex;align-items:center;justify-content:center;font-size:13px;color:var(--brand-foreground);transition:.16s}
.opt.sel .opt-check{background:var(--brand);border-color:var(--brand)}
.opt.sel .opt-check::after{content:"✓"}
.home-screen{padding-bottom:8px}
.promo-scroll{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:none;margin:0 -20px;padding:0 20px 4px}
.promo-scroll::-webkit-scrollbar{display:none}
/* Card de promoção é um "poster" sempre escuro (navy/graphite), independente
   do tema da página — por isso o texto usa valores fixos claros (não os
   tokens --text-* que invertem com o tema) para nunca perder contraste. */
.promo-card{flex:0 0 86%;scroll-snap-align:start;background:linear-gradient(145deg,rgba(44,47,56,.9),rgba(25,34,48,.98) 58%,#192230);border:1px solid color-mix(in srgb, var(--primary) 28%, transparent);border-radius:22px;padding:20px;box-shadow:0 18px 50px rgba(0,0,0,.34),inset 0 1px 0 rgba(255,255,255,.04)}
.promo-label{color:#ffda3d;font-size:10.5px;font-weight:800;letter-spacing:1.4px;margin-bottom:10px}
.promo-card h2{color:#f8fafc;font-size:25px;font-weight:850;line-height:1.08;letter-spacing:0;margin-bottom:8px}
.promo-card p{color:#d1d5db;font-size:14px;line-height:1.45;margin-bottom:18px}
.promo-btn{width:100%;border:0;border-radius:15px;background:var(--brand);color:var(--brand-foreground);padding:15px 16px;font-size:15px;font-weight:800;box-shadow:0 12px 26px color-mix(in srgb, var(--primary) 30%, transparent)}
@media (min-width:640px){.promo-card{flex-basis:340px}}
.home-copy{margin:24px 0 14px}
.home-copy h2{color:var(--text-primary);font-size:22px;font-weight:850;letter-spacing:0;line-height:1.15}
.home-copy p{color:var(--text-secondary);font-size:14px;margin-top:6px}
.home-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.home-cat{min-height:118px;text-align:left;background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:16px;display:flex;flex-direction:column;justify-content:space-between;color:var(--text-primary);box-shadow:var(--shadow-sm)}
.home-cat:active{transform:scale(.98);border-color:color-mix(in srgb, var(--primary) 50%, transparent)}
.home-cat span{font-size:27px}
.home-cat strong{font-size:15.5px;font-weight:800;letter-spacing:0}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:11px}
.grid2 .opt{flex-direction:column;align-items:flex-start;gap:7px;padding:17px;position:relative}
.grid2 .opt-check{position:absolute;top:13px;right:13px;width:20px;height:20px}
.grid2 .opt-emoji{width:auto}
.section-label{font-size:11px;font-weight:600;color:var(--text-sub);text-transform:uppercase;letter-spacing:1px;margin:22px 0 10px;display:flex;align-items:center;gap:7px}
.size-choice{padding-top:8px}
.choice-nudge{margin:0 0 12px;padding:10px 12px;border-radius:12px;background:var(--surface2);border:1px solid var(--line);color:var(--text-sub);font-size:13px;font-weight:700}
.choice-nudge.ok{color:var(--green);background:var(--green-soft);border-color:color-mix(in srgb, var(--success) 26%, transparent)}
.mini-size-opt{min-height:136px}
.muted-head{opacity:.68}
.locked-note{border:1px dashed var(--line-strong);border-radius:15px;padding:18px 14px;color:var(--text-sub);font-size:13.5px;text-align:center;background:rgba(var(--overlay-rgb), 0.02)}
.mam{display:flex;align-items:center;justify-content:space-between;background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:16px 18px;margin-bottom:14px;cursor:pointer;box-shadow:var(--shadow-sm)}
.mam.on{border-color:var(--brand);background:var(--brand-soft)}
.mam-txt strong{font-weight:600;font-size:15.5px;letter-spacing:-.1px}
.mam-txt p{font-size:13px;color:var(--text-sub);margin-top:2px;font-weight:400}
.choice-block{background:rgba(var(--overlay-rgb), 0.025);border:1px solid var(--line);border-radius:18px;padding:2px 10px 12px;margin-bottom:22px}
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
.switch::after{content:"";position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:var(--foreground);transition:.22s;box-shadow:0 1px 3px rgba(0,0,0,.3)}
.mam.on .switch{background:var(--brand)}
.mam.on .switch::after{left:23px}
.half-hint{font-size:13.5px;color:var(--gold);margin:-4px 0 12px;font-weight:500;padding-left:2px}
.flavor-progress{display:flex;align-items:center;gap:10px;margin:2px 0 14px;padding-left:2px}
.flavor-progress-dots{display:flex;gap:6px;flex:0 0 auto}
.flavor-progress-label{font-size:13px;color:var(--text-sub);font-weight:500}
.btn{width:100%;background:var(--brand);color:var(--brand-foreground);border:none;border-radius:14px;padding:16px;font-family:var(--font-ui);font-size:15.5px;font-weight:600;cursor:pointer;transition:transform .14s,background .14s;box-shadow:0 3px 12px var(--brand-soft);letter-spacing:.1px}
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
.ci-tag{background:var(--brand-soft);color:var(--gold);font-size:11px;font-weight:600;padding:2px 9px;border-radius:20px;margin-right:7px}
.ci-name{font-weight:600;font-size:14.5px;letter-spacing:-.1px}
.ci-detail{font-size:13px;color:var(--text-sub);margin-top:3px;line-height:1.4}
.ci-price{font-weight:600;color:var(--gold);font-size:14.5px;margin-top:6px}
.ci-remove{background:none;border:none;color:var(--text-faint);font-size:18px;cursor:pointer;padding:2px 4px;line-height:1}
.qty-pill{display:inline-flex;align-items:center;gap:14px;background:var(--surface2);border:1px solid var(--line);border-radius:30px;padding:5px 7px;margin-top:9px}
.qty-pill button{width:30px;height:30px;border-radius:50%;border:none;background:var(--brand);color:var(--brand-foreground);font-size:18px;cursor:pointer;font-weight:600}
.qty-pill span{font-weight:600;min-width:20px;text-align:center}
.field{margin-bottom:14px}
.field label{display:block;font-size:13px;font-weight:600;margin-bottom:7px;letter-spacing:0}
.field input,.field select{width:100%;background:var(--surface);border:1px solid var(--line-strong);border-radius:13px;padding:14px;color:var(--text);font-family:var(--font-ui);font-size:15.5px;transition:.16s;font-weight:400}
.field input:focus,.field select:focus{outline:none;border-color:var(--brand)}
.delivery-screen{padding-bottom:132px}
.delivery-cta-bar{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:540px;z-index:55;background:linear-gradient(to top,var(--bg) 78%,transparent);padding:18px 20px calc(env(safe-area-inset-bottom) + 14px);pointer-events:none}
.delivery-cta-inner{display:grid;grid-template-columns:auto auto minmax(0,1fr);align-items:center;gap:14px;background:var(--surface);border:1px solid var(--line-strong);border-radius:20px;padding:14px;box-shadow:0 -10px 34px rgba(0,0,0,.28);pointer-events:auto}
.delivery-cta-info{min-width:74px;padding-left:6px}
.delivery-cta-label{font-size:11px;color:var(--text-sub);font-weight:700;text-transform:uppercase;letter-spacing:.14em}
.delivery-cta-total{font-size:18px;font-weight:800;color:var(--text);line-height:1.2;white-space:nowrap;margin-top:2px;display:block}
.delivery-cta-cart{border:1px solid var(--line-strong);background:transparent;color:var(--text-sub);border-radius:999px;padding:10px 12px;font-size:12.5px;font-weight:700}
.delivery-cta-btn{margin:0;padding:14px 12px;border-radius:13px;min-width:0;white-space:normal;line-height:1.15}
.pay-screen{padding-bottom:132px}
.pay-cta-inner{grid-template-columns:auto minmax(0,1fr)}
.cart-screen{padding-bottom:194px}
.cart-cta-inner{grid-template-columns:auto auto minmax(0,1fr)}
.list-screen{padding-bottom:194px}
.done-screen{padding-bottom:96px}
.another-screen{padding-bottom:132px}
.pay-head{margin-bottom:12px}
.order-summary-compact{background:var(--surface);border:1px solid var(--line);border-radius:15px;margin:0 0 16px;box-shadow:var(--shadow-sm);overflow:hidden}
.order-summary-compact summary{list-style:none;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;cursor:pointer;color:var(--text-sub);font-size:13px;font-weight:700}
.order-summary-compact summary::-webkit-details-marker{display:none}
.order-summary-compact summary strong{font-size:16px;color:var(--gold)}
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
.pay-error{color:var(--danger);font-size:12px;font-weight:700;margin-top:8px}
/* Cards de seção da etapa de pagamento (pagamento / identificação / observações) —
   mesmo bloco visual, mais respiro entre eles do que o antigo layout colado. */
.pay-section-card{background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:18px 16px;margin-bottom:18px;box-shadow:var(--shadow-sm)}
.pay-section-card:last-of-type{margin-bottom:0}
.pay-section-title{font-size:11px;font-weight:700;color:var(--text-sub);text-transform:uppercase;letter-spacing:.16em;margin-bottom:14px;display:flex;align-items:center;gap:8px}
.pay-section-help{font-size:13px;color:var(--text-sub);line-height:1.5;margin:0 0 12px}
.pay-section-card .field:last-child{margin-bottom:0}
.pay-section-card .field input{background:var(--surface2)}
.identidade-row{display:flex;align-items:center;gap:12px;margin-bottom:12px}
.identidade-avatar{width:40px;height:40px;border-radius:50%;background:var(--surface2);border:1px solid var(--line-strong);display:flex;align-items:center;justify-content:center;font-size:18px;flex:0 0 auto}
.identidade-info{min-width:0}
.identidade-nome{font-size:16px;font-weight:800;color:var(--text)}
.identidade-tel{display:block;font-size:13px;color:var(--text-sub);margin-top:2px}
.wa-badge{display:inline-flex;align-items:center;gap:6px;margin-top:4px;padding:4px 10px;border-radius:999px;background:var(--green-soft);color:var(--green);font-size:12px;font-weight:700;line-height:1.4}
.identidade-explicacao{font-size:13px;color:var(--text-sub);line-height:1.5;margin:0 0 14px}
.pay-divider{height:1px;background:var(--line);margin:0 0 14px}
.pay-actions-row{display:flex;align-items:center;gap:20px;flex-wrap:wrap}
.pay-action-link{background:none;border:none;color:var(--gold);font-size:13px;font-weight:700;cursor:pointer;padding:11px 2px;margin:-11px -2px;text-decoration:underline;text-underline-offset:2px;min-height:44px;display:inline-flex;align-items:center}
.pay-action-link.muted{color:var(--text-sub)}
.obs-help-row{display:flex;align-items:flex-start;gap:10px;margin-bottom:14px}
.obs-icon{font-size:16px;line-height:1.5;flex:0 0 auto}
.wa-inline-note{display:flex;flex-direction:column;align-items:flex-start;gap:8px}
.payment-modal-backdrop{position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center;padding:20px}
.payment-modal{width:100%;max-width:500px;background:var(--surface);border:1px solid var(--line-strong);border-radius:20px;padding:16px;box-shadow:0 -14px 45px rgba(0,0,0,.35);animation:sheet .22s ease-out}
.payment-modal-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px}
.payment-modal-kicker{font-size:11px;color:var(--gold);text-transform:uppercase;letter-spacing:1px;font-weight:800}
.payment-modal h3{font-size:21px;line-height:1.15;margin-top:3px}
.payment-modal-close{width:36px;height:36px;border-radius:999px;background:var(--surface2);border:1px solid var(--line-strong);color:var(--text-sub);font-size:22px;line-height:1}
.payment-modal-body{color:var(--text-sub);font-size:14px;line-height:1.45}
.payment-modal-body p + p{margin-top:7px}
.money-status-badge{display:inline-block;margin-top:6px;padding:3px 10px;border-radius:999px;background:var(--brand-soft);color:var(--gold);font-size:11px;font-weight:700}
.money-choice-title{font-size:13px;font-weight:800;color:var(--text);margin-bottom:10px}
.money-choice-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px}
.money-choice-row .btn{padding:12px 8px;font-size:13px}
.money-field{margin:0}
.misto-fields{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0}
.misto-resumo{font-size:13px;font-weight:700;color:var(--text);background:var(--surface2);border:1px solid var(--line-strong);border-radius:12px;padding:10px 12px;margin:0 0 10px}
.misto-resumo.ok{color:var(--green);background:var(--green-soft);border-color:color-mix(in srgb, var(--success) 26%, transparent)}
.payment-modal-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px}
.payment-modal-actions.single{grid-template-columns:1fr}
.payment-modal-actions .btn{padding:13px 10px}
@keyframes sheet{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
.flavor-modal-backdrop{position:fixed;inset:0;z-index:85;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;justify-content:center;padding:16px}
.flavor-modal{max-height:82vh;display:flex;flex-direction:column;padding-bottom:14px}
.flavor-modal-body{overflow-y:auto;flex:1 1 auto;padding-right:2px;margin:2px 0 4px;scrollbar-width:thin}
.flavor-modal-body .opt{margin-bottom:8px}
.flavor-modal-msg{font-size:13.5px;font-weight:700;color:var(--text);margin-top:4px}
.flavor-modal-hint{font-size:12.5px;color:var(--text-sub);margin-top:3px;line-height:1.35}
.cartbar{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:540px;z-index:50;background:transparent;padding:0 20px calc(env(safe-area-inset-bottom) + 14px);pointer-events:none}
.cartbar-inner{margin:0 auto;display:flex;align-items:center;gap:14px;background:var(--surface-elevated);border:1px solid var(--line-strong);border-radius:20px;padding:12px 12px 12px 16px;box-shadow:0 -10px 34px rgba(0,0,0,.35);pointer-events:auto}
.cartbar-info{flex:1}
.cartbar-count{font-size:12.5px;color:var(--text-sub);font-weight:500}
.cartbar-total{font-family:var(--font-ui);font-weight:700;font-size:15px;line-height:1.2;letter-spacing:0}
.cartbar-link{border:1px solid var(--line-strong);background:transparent;color:var(--text-sub);border-radius:999px;padding:9px 13px;font-size:12.5px;font-weight:700}
.bottom-nav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:540px;z-index:54;background:var(--surface);border-top:1px solid var(--line);box-shadow:0 -6px 20px rgba(0,0,0,.16);padding:6px 8px calc(env(safe-area-inset-bottom) + 6px)}
.bottom-nav-inner{display:flex;align-items:stretch;justify-content:space-around;gap:4px;min-height:46px}
.bnav-item{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:4px 4px;border:none;background:none;color:var(--text-sub);font-family:var(--font-ui);font-size:11px;font-weight:600;border-radius:12px;cursor:pointer;text-decoration:none;transition:color .15s}
.bnav-item:active{transform:scale(.96)}
.bnav-icon{font-size:20px;line-height:1}
.bnav-icon-wrap{position:relative;display:inline-flex}
.bnav-item.active{color:var(--brand)}
.bnav-item.active .bnav-label{color:var(--text-primary);font-weight:800}
.bnav-item.disabled{opacity:.35;cursor:not-allowed}
.bnav-label{line-height:1.1}
.bnav-badge{position:absolute;top:-5px;right:-9px;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:var(--brand);color:var(--brand-foreground);font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;line-height:1;box-shadow:0 0 0 2px var(--surface)}
.delivery-cta-bar.stacked{bottom:58px}
.checkout-summary{margin:14px 0 10px;color:var(--text-sub);font-size:13px;font-weight:700;text-align:center}
.empty{text-align:center;padding:54px 20px;color:var(--text-sub)}
.empty .big{font-size:56px;margin-bottom:14px;opacity:.4}
.cardapio-illustration{text-align:center;padding:36px 20px}
.cardapio-illustration-icon{font-size:40px;margin-bottom:10px;line-height:1}
.cardapio-illustration-title{font-weight:700;font-size:15.5px;color:var(--text)}
.cardapio-illustration-text{font-size:13px;color:var(--text-sub);margin-top:4px;line-height:1.4}
.cardapio-illustration.compact{text-align:left;padding:0;display:flex;align-items:center;gap:10px}
.cardapio-illustration.compact .cardapio-illustration-icon{font-size:22px;margin-bottom:0}
.cardapio-illustration.compact .cardapio-illustration-title{font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-sub);font-weight:600}
.success{text-align:center;padding:34px 8px}
.success .check{width:80px;height:80px;border-radius:50%;background:var(--green);margin:0 auto 20px;display:flex;align-items:center;justify-content:center;font-size:42px;color:var(--green-foreground);animation:pop .55s cubic-bezier(.2,1.4,.4,1)}
@keyframes pop{from{transform:scale(0)}to{transform:scale(1)}}
.success h2{font-family:var(--font-ui);font-weight:600;font-size:24px;margin-bottom:9px;letter-spacing:-.4px}
.success p{color:var(--text-sub);font-size:15px;margin-bottom:5px}
.toast{position:fixed;bottom:168px;left:50%;transform:translateX(-50%);background:var(--green);color:var(--green-foreground);padding:12px 22px;border-radius:30px;font-size:13.5px;font-weight:500;z-index:60;white-space:nowrap}
.qty-grid{display:flex;flex-direction:column;gap:10px}
@media(min-width:480px){.qty-grid{display:grid;grid-template-columns:1fr 1fr;gap:11px}}
.qty-card{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:16px 18px;cursor:pointer;display:flex;align-items:center;gap:14px;transition:transform .14s,border-color .14s,background .14s;box-shadow:var(--shadow-sm)}
.qty-card:active{transform:scale(.98);border-color:var(--brand);background:var(--brand-soft)}
.qty-card-icon{font-size:24px;flex:0 0 auto;width:36px;text-align:center}
.qty-card-body{flex:1;min-width:0}
.qty-card-title{font-weight:600;font-size:15.5px;letter-spacing:-.1px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.qty-card-sub{font-size:13px;color:var(--text-sub);margin-top:3px;font-weight:400}
.qty-badge{font-size:10px;font-weight:700;color:var(--gold);background:var(--brand-soft);padding:2px 8px;border-radius:20px;white-space:nowrap;letter-spacing:.2px}
.sc-build-screen{padding-top:10px;padding-bottom:96px}
.build-back{position:relative;z-index:1;margin:-2px 0 14px;padding:0}
.build-back-btn{background:var(--surface2);border:1px solid var(--line-strong);color:var(--text-sub);font-family:var(--font-ui);font-size:13px;font-weight:600;padding:7px 14px;border-radius:30px;cursor:pointer;box-shadow:var(--shadow-sm);transition:transform .14s}
.build-back-btn:active{transform:scale(.96)}
.build-foot{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:540px;z-index:55;background:var(--surface);border-top:1px solid var(--line);box-shadow:0 -4px 18px rgba(0,0,0,.18);padding:12px 20px calc(env(safe-area-inset-bottom) + 14px)}
.build-foot-hint{font-size:12.5px;color:var(--text-sub);font-weight:700;text-align:center;margin-bottom:8px}
.build-foot .btn{margin:0}
`;
