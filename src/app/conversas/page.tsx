"use client"
import { useEffect, useState, useRef } from "react"
import { useRouter } from "next/navigation"

type Pedido = {
  id: string
  numero?: number
  cliente: string
  telefone: string
  status: string
  horario: string
  escalonado?: boolean
  horarioEscalonado?: number
  resolvidoConversas?: boolean
  itens: string[]
  pagamento?: string
  pixConfirmado?: boolean
  total?: number
}

function whatsappLink(telefone: string): string {
  let n = (telefone || "").replace(/\D/g, "")
  if (n && !n.startsWith("55")) n = "55" + n
  return `https://wa.me/${n}`
}

function getTimestampEspera(p: Pedido): number {
  return p.horarioEscalonado || parseInt(p.id) || Date.now()
}

function minEsperando(ts: number, now: number): number {
  return Math.max(0, Math.floor((now - ts) / 60000))
}

type Urgency = "normal" | "atencao" | "urgente" | "critico"

function getUrgency(min: number): Urgency {
  if (min >= 15) return "critico"
  if (min >= 8) return "urgente"
  if (min >= 4) return "atencao"
  return "normal"
}

const UC: Record<Urgency, string> = { normal: "#56b87e", atencao: "#e0893a", urgente: "#e05050", critico: "#c0373a" }
const UBG: Record<Urgency, string> = { normal: "rgba(86,184,126,.08)", atencao: "rgba(224,137,58,.08)", urgente: "rgba(224,80,80,.08)", critico: "rgba(192,55,58,.12)" }
const UBD: Record<Urgency, string> = { normal: "rgba(86,184,126,.2)", atencao: "rgba(224,137,58,.28)", urgente: "rgba(224,80,80,.35)", critico: "rgba(192,55,58,.45)" }

function labelEspera(min: number, u: Urgency): string {
  if (u === "critico") return `Crítico: esperando há ${min} min`
  if (u === "urgente") return `Urgente: esperando há ${min} min`
  if (min === 0) return "Acabou de chegar"
  return `Esperando há ${min} min`
}

function temPixPendente(p: Pedido): boolean {
  return !!(p.pagamento && p.pagamento.toLowerCase().includes("pix") && !p.pixConfirmado && (p.total || 0) > 0)
}

export default function ConversasPage() {
  const router = useRouter()
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(Date.now())
  const [confirmando, setConfirmando] = useState<Pedido | null>(null)
  const [finalizando, setFinalizando] = useState<string | null>(null)
  const [toast, setToast] = useState("")
  const toastTimer = useRef<any>(null)

  function carregar() {
    fetch("/api/orders")
      .then(r => { if (r.status === 401) { router.push("/login?callbackUrl=/conversas"); return null } return r.json() })
      .then(data => { if (data) { setPedidos(data); setLoading(false) } })
      .catch(() => setLoading(false))
  }

  useEffect(() => {
    carregar()
    const ivData = setInterval(carregar, 15000)
    const ivTime = setInterval(() => setNow(Date.now()), 30000)
    return () => { clearInterval(ivData); clearInterval(ivTime) }
  }, [router])

  function showToast(msg: string) {
    setToast(msg); clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(""), 3500)
  }

  async function finalizarAtendimento(p: Pedido) {
    setFinalizando(p.id); setConfirmando(null)
    try {
      const r = await fetch("/api/finalizar-atendimento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: p.id, telefone: p.telefone }),
      })
      if (r.ok) {
        setPedidos(prev => {
          const ePuro = p.itens?.[0] === "Cliente precisa de atendimento humano"
          if (ePuro) return prev.filter(x => x.id !== p.id)
          if (p.escalonado) return prev.map(x => x.id === p.id ? { ...x, escalonado: false } : x)
          return prev.map(x => x.id === p.id ? { ...x, resolvidoConversas: true } : x)
        })
        showToast("Atendimento finalizado. A conversa foi removida.")
      } else { showToast("Não foi possível finalizar o atendimento.") }
    } catch { showToast("Não foi possível finalizar o atendimento.") }
    setFinalizando(null)
  }

  const fila = pedidos
    .filter(p => p.escalonado && p.status === "novo")
    .sort((a, b) => getTimestampEspera(a) - getTimestampEspera(b))

  const emAtendimento = pedidos.filter(
    p => !["entregue", "cancelado"].includes(p.status)
      && !(p.escalonado && p.status === "novo")
      && !p.resolvidoConversas
  )

  const maxEsperaMin = fila.length > 0 ? minEsperando(getTimestampEspera(fila[0]), now) : 0

  if (loading) return (
    <div style={{ height: "100svh", background: "#060606", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Archivo', sans-serif" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>💬</div>
        <p style={{ color: "#5a564d", fontSize: 13, fontWeight: 700, margin: 0 }}>Carregando…</p>
      </div>
    </div>
  )

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800;900&display=swap');
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        html, body { margin: 0; padding: 0; background: #060606; }
        button { cursor: pointer; font-family: 'Archivo', sans-serif; border: none; }
        @keyframes cbPulse { 0%{opacity:1} 50%{opacity:.4} 100%{opacity:1} }
        @keyframes cbFadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }
        @keyframes cbSheetUp { from{transform:translateY(100%)} to{transform:none} }
        .cbCard { animation: cbFadeIn .25s ease both; }
        .cbWaLink { display:flex; align-items:center; justify-content:center; gap:7px; height:44px; background:#25d366; border-radius:11px; color:#fff; font-family:'Archivo',sans-serif; font-size:13px; font-weight:900; text-decoration:none; flex:1; }
        .cbWaLink:active { opacity:.85; }
        .cbWaLinkSm { display:flex; align-items:center; justify-content:center; gap:6px; height:34px; padding:0 12px; border:1px solid rgba(37,211,102,.3); border-radius:9px; background:rgba(37,211,102,.08); color:#25d366; font-family:'Archivo',sans-serif; font-size:11px; font-weight:900; text-decoration:none; flex-shrink:0; }
        .cbWaLinkSm:active { opacity:.8; }
        .cbFin { height:44px; padding:0 13px; background:transparent; border:1px solid #272320; border-radius:11px; color:#56524b; font-size:12px; font-weight:900; flex-shrink:0; }
        .cbFin:active { opacity:.75; }
        .cbFinSm { height:34px; padding:0 11px; background:transparent; border:1px solid #272320; border-radius:9px; color:#56524b; font-size:11px; font-weight:900; flex-shrink:0; }
        .cbFinSm:active { opacity:.75; }

        /* ── MOBILE: app-shell ── */
        .cb-shell { height:100svh; overflow:hidden; display:flex; flex-direction:column; max-width:390px; margin:0 auto; background:#060606; color:#f5f2ee; font-family:'Archivo',sans-serif; }
        .cb-header { flex-shrink:0; background:#060606; border-bottom:1px solid #1a1816; padding:calc(env(safe-area-inset-top) + 14px) 16px 12px; }
        .cb-main { flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch; padding:14px 16px 28px; }
        .cb-nav { flex-shrink:0; background:rgba(6,6,6,.96); backdrop-filter:blur(14px); border-top:1px solid #181614; display:grid; grid-template-columns:1fr 1fr 1fr; padding:10px 8px calc(env(safe-area-inset-bottom) + 16px); }
        .cb-content { display:block; }
        .cb-col-primary { }
        .cb-col-secondary { }
        .cb-top-nav { display:none; }

        /* ── DESKTOP: sidebar + 2-column ── */
        @media (min-width: 768px) {
          body { overflow:auto; }
          .cb-shell { height:auto; overflow:visible; max-width:1200px; flex-direction:row; align-items:flex-start; }
          .cb-top-nav { display:flex; flex-direction:column; gap:4px; width:200px; flex-shrink:0; position:sticky; top:24px; padding:24px 0 24px 0; }
          .cb-top-nav-brand { padding:0 20px 20px; border-bottom:1px solid #1a1816; margin-bottom:8px; }
          .cb-top-nav-btn { display:flex; align-items:center; gap:10px; padding:10px 20px; font-family:'Archivo',sans-serif; font-size:13px; font-weight:800; color:#4a4640; background:transparent; border:none; border-radius:10px; cursor:pointer; transition:background .15s; text-align:left; }
          .cb-top-nav-btn:hover { background:rgba(255,255,255,.04); }
          .cb-top-nav-btn.active { color:#ff6b00; background:rgba(255,107,0,.08); }
          .cb-right { flex:1; min-width:0; display:flex; flex-direction:column; border-left:1px solid #1a1816; min-height:100vh; }
          .cb-header { border-bottom:1px solid #1a1816; padding:24px 28px 20px; }
          .cb-main { padding:20px 28px; overflow-y:visible; flex:none; }
          .cb-nav { display:none; }
          .cb-content { display:grid; grid-template-columns:1fr 1fr; gap:24px; align-items:flex-start; }
          .cb-col-primary { }
          .cb-col-secondary { }
          .cb-metrics { gap:10px !important; }
          .cb-metric-box { padding:12px 16px !important; }
          .cb-metric-num { font-size:28px !important; }
        }
        @media (min-width: 1024px) {
          .cb-shell { max-width:1280px; }
          .cb-content { grid-template-columns:5fr 4fr; }
        }
      `}</style>

      <div className="cb-shell">

        {/* ── DESKTOP: sidebar nav ── */}
        <nav className="cb-top-nav">
          <div className="cb-top-nav-brand">
            <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: "-0.5px", color: "#f5f2ee" }}>ChefeBot</div>
            <div style={{ fontSize: 11, color: "#4a4640", fontWeight: 700, marginTop: 2 }}>Painel operacional</div>
          </div>
          <button className="cb-top-nav-btn" onClick={() => router.push("/pedidos")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="4" y="3" width="16" height="18" rx="3" stroke="currentColor" strokeWidth="2.2"/><line x1="8" y1="9" x2="16" y2="9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/><line x1="8" y1="14" x2="13" y2="14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/></svg>
            Pedidos
          </button>
          <button className="cb-top-nav-btn active">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="14" rx="5" stroke="currentColor" strokeWidth="2.2"/><circle cx="8.5" cy="11" r="1.3" fill="currentColor"/><circle cx="12" cy="11" r="1.3" fill="currentColor"/><circle cx="15.5" cy="11" r="1.3" fill="currentColor"/></svg>
            Conversas
            {fila.length > 0 && <span style={{ marginLeft: "auto", minWidth: 18, height: 18, borderRadius: 9, background: fila.some(p => getUrgency(minEsperando(getTimestampEspera(p), now)) === "urgente" || getUrgency(minEsperando(getTimestampEspera(p), now)) === "critico") ? "#e05050" : "#ff6b00", color: "#fff", fontSize: 10, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>{fila.length}</span>}
          </button>
          <button className="cb-top-nav-btn" onClick={() => router.push("/cardapio")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="2.2"/><rect x="13" y="4" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="2.2"/><rect x="4" y="13" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="2.2"/><rect x="13" y="13" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="2.2"/></svg>
            Cardápio
          </button>
        </nav>

        {/* ── CONTEÚDO PRINCIPAL ── */}
        <div className="cb-right" style={{ flex: 1, minWidth: 0 }}>

          {/* Header */}
          <header className="cb-header">
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: "-0.4px" }}>Conversas</div>
              <div style={{ fontSize: 11, color: "#5a564d", fontWeight: 700, marginTop: 2 }}>Atendimento humano</div>
            </div>
            <div className="cb-metrics" style={{ display: "flex", gap: 6 }}>
              <div className="cb-metric-box" style={{ flex: 1, background: fila.length > 0 ? "rgba(224,80,80,.07)" : "#0d0d0d", border: `1px solid ${fila.length > 0 ? "rgba(224,80,80,.25)" : "#1e1c19"}`, borderRadius: 11, padding: "9px 11px" }}>
                <div className="cb-metric-num" style={{ fontSize: 22, fontWeight: 900, lineHeight: 1, color: fila.length > 0 ? "#e06060" : "#3a3730" }}>{fila.length}</div>
                <div style={{ fontSize: 10, fontWeight: 800, color: fila.length > 0 ? "rgba(224,80,80,.7)" : "#3a3730", textTransform: "uppercase", letterSpacing: ".4px", marginTop: 3 }}>aguardando</div>
              </div>
              <div className="cb-metric-box" style={{ flex: 1, background: maxEsperaMin >= 8 ? "rgba(224,80,80,.07)" : "#0d0d0d", border: `1px solid ${maxEsperaMin >= 8 ? "rgba(224,80,80,.25)" : "#1e1c19"}`, borderRadius: 11, padding: "9px 11px" }}>
                <div className="cb-metric-num" style={{ fontSize: 22, fontWeight: 900, lineHeight: 1, color: maxEsperaMin >= 8 ? "#e06060" : fila.length > 0 ? "#d4c9ba" : "#3a3730" }}>{fila.length > 0 ? `${maxEsperaMin}m` : "—"}</div>
                <div style={{ fontSize: 10, fontWeight: 800, color: "#3a3730", textTransform: "uppercase", letterSpacing: ".4px", marginTop: 3 }}>mais antigo</div>
              </div>
              <div className="cb-metric-box" style={{ flex: 1, background: "#0d0d0d", border: "1px solid #1e1c19", borderRadius: 11, padding: "9px 11px" }}>
                <div className="cb-metric-num" style={{ fontSize: 22, fontWeight: 900, lineHeight: 1, color: emAtendimento.length > 0 ? "#d4c9ba" : "#3a3730" }}>{emAtendimento.length}</div>
                <div style={{ fontSize: 10, fontWeight: 800, color: "#3a3730", textTransform: "uppercase", letterSpacing: ".4px", marginTop: 3 }}>em andamento</div>
              </div>
            </div>
          </header>

          {/* Conteúdo (2 colunas no desktop) */}
          <main className="cb-main">
            <div className="cb-content">

              {/* ── COL 1: Fila ── */}
              <div className="cb-col-primary">
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  {fila.length > 0 && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#e06060", animation: "cbPulse 1.8s ease-in-out infinite", flexShrink: 0 }} />}
                  <span style={{ fontSize: 13, fontWeight: 900, color: fila.length > 0 ? "#f0ede8" : "#4a4640", letterSpacing: "-0.2px" }}>
                    {fila.length > 0 ? `${fila.length === 1 ? "1 precisa" : `${fila.length} precisam`} de atendimento agora` : "Fila de atendimento"}
                  </span>
                </div>

                {fila.length === 0 && (
                  <div style={{ background: "#0d0d0d", border: "1px dashed #252220", borderRadius: 16, padding: "30px 20px", textAlign: "center" }}>
                    <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
                    <div style={{ fontSize: 14, fontWeight: 900, color: "#3d8a54", marginBottom: 4 }}>Ninguém aguardando</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#4a4640", lineHeight: 1.5 }}>Quando um cliente precisar de atendimento, aparecerá aqui.</div>
                  </div>
                )}

                {fila.map((p, idx) => {
                  const ts = getTimestampEspera(p)
                  const minWait = minEsperando(ts, now)
                  const urgency = getUrgency(minWait)
                  const isPrimeiro = idx === 0
                  const emFin = finalizando === p.id

                  return (
                    <div key={p.id} className="cbCard" style={{ background: isPrimeiro ? UBG[urgency] : "rgba(255,255,255,.02)", border: `1.5px solid ${isPrimeiro ? UBD[urgency] : "#1e1c19"}`, borderRadius: 16, padding: 14, marginBottom: 10, animationDelay: `${idx * 0.05}s` }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
                        {isPrimeiro
                          ? <span style={{ fontSize: 10, fontWeight: 900, color: UC[urgency], background: `${UC[urgency]}18`, border: `1px solid ${UC[urgency]}40`, padding: "3px 9px", borderRadius: 20 }}>Responder primeiro</span>
                          : <span style={{ fontSize: 10, fontWeight: 800, color: "#4a4640", background: "#141210", border: "1px solid #2a2723", padding: "3px 9px", borderRadius: 20 }}>{idx + 1}º na fila</span>}
                        {p.numero != null && <span style={{ fontSize: 10, fontWeight: 800, color: "#5a564d", marginLeft: "auto" }}>#{p.numero}</span>}
                      </div>
                      <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: "-0.3px", marginBottom: 3, color: "#f4f1ec" }}>{p.cliente.split(" ")[0]}</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#5a564d", marginBottom: 6 }}>{p.telefone}</div>
                      <div style={{ fontSize: 13, fontWeight: 900, color: UC[urgency], marginBottom: 4 }}>{labelEspera(minWait, urgency)}</div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#4a4640", marginBottom: 13 }}>Última mensagem às {p.horario}</div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <a href={whatsappLink(p.telefone)} target="_blank" rel="noreferrer" className="cbWaLink">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 2C6.48 2 2 6.48 2 12c0 1.77.46 3.43 1.26 4.89L2 22l5.26-1.24A9.94 9.94 0 0 0 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2z" fill="#fff" opacity=".2"/><path d="M9.5 8.5c-.28 0-.5.04-.7.12C8.3 8.2 7 9.5 7 11c0 2.5 2.5 5 5 6.5 1.5.8 3.5.5 4.5-.5.2-.2.4-.5.5-.8.1-.3 0-.6-.2-.8l-1.8-1.3c-.2-.15-.5-.1-.7.05l-.8.8c-.15.15-.4.2-.6.1C12 14.8 11.2 14 10.6 13c-.1-.2-.05-.45.1-.6l.8-.8c.15-.2.2-.5.05-.7L10.3 9.1c-.2-.22-.5-.6-.8-.6z" fill="white"/></svg>
                          Abrir WhatsApp
                        </a>
                        <button className="cbFin" disabled={emFin} onClick={() => setConfirmando(p)} style={{ opacity: emFin ? 0.4 : 1 }}>
                          {emFin ? "…" : "Finalizar"}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* ── COL 2: Em atendimento hoje ── */}
              <div className="cb-col-secondary" style={{ marginTop: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "1px", textTransform: "uppercase", color: "#3a3730", marginBottom: 10 }}>
                  Em atendimento hoje
                </div>

                {emAtendimento.length === 0 && (
                  <div style={{ background: "#0d0d0d", border: "1px dashed #1e1c19", borderRadius: 14, padding: "20px", textAlign: "center" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#3a3730" }}>Nenhum atendimento aberto hoje</div>
                  </div>
                )}

                {emAtendimento.map(p => {
                  const emFin = finalizando === p.id
                  const pixPendente = temPixPendente(p)
                  return (
                    <div key={p.id} style={{ background: "#0c0c0c", border: `1px solid ${pixPendente ? "rgba(255,170,0,.2)" : "#181614"}`, borderRadius: 13, padding: "11px 13px", marginBottom: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 9 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                            {p.numero != null && <span style={{ background: "#161412", color: "#4a4640", fontSize: 10, fontWeight: 800, padding: "2px 6px", borderRadius: 6 }}>#{p.numero}</span>}
                            {pixPendente && <span style={{ background: "rgba(255,170,0,.12)", color: "#ffaa00", fontSize: 9, fontWeight: 900, padding: "2px 6px", borderRadius: 6, letterSpacing: ".3px" }}>PIX PENDENTE</span>}
                            <span style={{ fontSize: 14, fontWeight: 900, color: "#d4c9ba", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.cliente.split(" ")[0]}</span>
                          </div>
                          <div style={{ fontSize: 11, color: "#3a3730", fontWeight: 600 }}>{p.telefone} · {p.horario}</div>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 7 }}>
                        <a href={whatsappLink(p.telefone)} target="_blank" rel="noreferrer" className="cbWaLinkSm" style={{ flex: 1 }}>WhatsApp</a>
                        <button className="cbFinSm" disabled={emFin} onClick={() => setConfirmando(p)} style={{ opacity: emFin ? 0.4 : 1 }}>
                          {emFin ? "…" : "Finalizar"}
                        </button>
                      </div>
                    </div>
                  )
                })}

                <div style={{ height: 6 }} />
              </div>

            </div>
          </main>

          {/* ── NAV MOBILE (oculto no desktop via CSS) ── */}
          <nav className="cb-nav">
            <button onClick={() => router.push("/pedidos")} style={{ background: "transparent", display: "flex", flexDirection: "column", alignItems: "center", gap: 5, padding: "6px 0" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="4" y="3" width="16" height="18" rx="3" stroke="#3a3730" strokeWidth="2.2"/><line x1="8" y1="9" x2="16" y2="9" stroke="#3a3730" strokeWidth="2.2" strokeLinecap="round"/><line x1="8" y1="14" x2="13" y2="14" stroke="#3a3730" strokeWidth="2.2" strokeLinecap="round"/></svg>
              <span style={{ fontSize: 10, fontWeight: 800, color: "#3a3730" }}>Pedidos</span>
            </button>
            <button style={{ background: "transparent", display: "flex", flexDirection: "column", alignItems: "center", gap: 5, padding: "6px 0" }}>
              <span style={{ position: "relative", display: "flex" }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="14" rx="5" stroke="#ff6b00" strokeWidth="2.2"/><circle cx="8.5" cy="11" r="1.4" fill="#ff6b00"/><circle cx="12" cy="11" r="1.4" fill="#ff6b00"/><circle cx="15.5" cy="11" r="1.4" fill="#ff6b00"/></svg>
                {fila.length > 0 && <span style={{ position: "absolute", top: -5, right: -9, minWidth: 16, height: 16, borderRadius: 8, background: fila.some(p => getUrgency(minEsperando(getTimestampEspera(p), now)) === "urgente" || getUrgency(minEsperando(getTimestampEspera(p), now)) === "critico") ? "#e05050" : "#ff6b00", color: "#fff", fontSize: 10, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px" }}>{fila.length}</span>}
              </span>
              <span style={{ fontSize: 10, fontWeight: 900, color: "#ff6b00" }}>Conversas</span>
            </button>
            <button onClick={() => router.push("/cardapio")} style={{ background: "transparent", display: "flex", flexDirection: "column", alignItems: "center", gap: 5, padding: "6px 0" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="7" height="7" rx="2" stroke="#3a3730" strokeWidth="2.2"/><rect x="13" y="4" width="7" height="7" rx="2" stroke="#3a3730" strokeWidth="2.2"/><rect x="4" y="13" width="7" height="7" rx="2" stroke="#3a3730" strokeWidth="2.2"/><rect x="13" y="13" width="7" height="7" rx="2" stroke="#3a3730" strokeWidth="2.2"/></svg>
              <span style={{ fontSize: 10, fontWeight: 800, color: "#3a3730" }}>Cardápio</span>
            </button>
          </nav>
        </div>
      </div>

      {/* ── MODAL CONFIRMAÇÃO ── */}
      {confirmando && (
        <>
          <div onClick={() => setConfirmando(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 90 }} />
          <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, margin: "0 auto", maxWidth: 480, background: "#111009", border: "1px solid #242220", borderBottom: "none", borderRadius: "22px 22px 0 0", zIndex: 91, animation: "cbSheetUp .3s cubic-bezier(.2,.9,.3,1) both", padding: "18px 20px calc(env(safe-area-inset-bottom) + 28px)", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ width: 40, height: 4, borderRadius: 2, background: "#2e2b26", margin: "0 auto 6px" }} />

            {/* Aviso PIX se aplicável */}
            {temPixPendente(confirmando) && (
              <div style={{ background: "rgba(255,170,0,.08)", border: "1px solid rgba(255,170,0,.25)", borderRadius: 10, padding: "10px 14px" }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: "#ffaa00", marginBottom: 3 }}>⚠ Pix pendente</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#8a8278", lineHeight: 1.5 }}>
                  Esse pedido está aguardando confirmação de Pix. Finalizar removerá o atendimento da fila.
                </div>
              </div>
            )}

            <div style={{ fontSize: 17, fontWeight: 900, letterSpacing: "-0.3px" }}>Finalizar atendimento?</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#8a8278", lineHeight: 1.55 }}>
              Esse atendimento será removido da tela de conversas. Nenhuma mensagem será enviada ao cliente.
            </div>
            <button onClick={() => finalizarAtendimento(confirmando)} style={{ height: 52, borderRadius: 13, background: "#1e3d2a", border: "1px solid rgba(86,184,126,.3)", color: "#56b87e", fontSize: 15, fontWeight: 900, marginTop: 4 }}>
              Sim, finalizar
            </button>
            <button onClick={() => setConfirmando(null)} style={{ height: 42, background: "transparent", color: "#6a6460", fontSize: 13, fontWeight: 800 }}>
              Cancelar
            </button>
          </div>
        </>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", bottom: "calc(env(safe-area-inset-bottom) + 80px)", left: "50%", transform: "translateX(-50%)", background: "#1a1816", border: "1px solid #2a2723", borderRadius: 14, padding: "12px 18px", fontSize: 13, fontWeight: 700, color: "#b8b0a4", zIndex: 80, whiteSpace: "nowrap", maxWidth: "calc(100% - 32px)", fontFamily: "'Archivo', sans-serif" }}>
          {toast}
        </div>
      )}
    </>
  )
}
