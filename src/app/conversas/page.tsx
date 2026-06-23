"use client"
import { useEffect, useState, useRef } from "react"
import { useRouter } from "next/navigation"
import PanelShell from "@/components/PanelShell"

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
const UBG: Record<Urgency, string> = { normal: "rgba(86,184,126,.07)", atencao: "rgba(224,137,58,.07)", urgente: "rgba(224,80,80,.07)", critico: "rgba(192,55,58,.1)" }
const UBD: Record<Urgency, string> = { normal: "rgba(86,184,126,.22)", atencao: "rgba(224,137,58,.3)", urgente: "rgba(224,80,80,.38)", critico: "rgba(192,55,58,.5)" }

function labelEspera(min: number, u: Urgency): string {
  if (u === "critico") return `Crítico · ${min} min`
  if (u === "urgente") return `Urgente · ${min} min`
  if (min === 0) return "Agora mesmo"
  return `${min} min esperando`
}

function temPixPendente(p: Pedido): boolean {
  return !!(p.pagamento && p.pagamento.toLowerCase().includes("pix") && !p.pixConfirmado && (p.total || 0) > 0)
}

function getInitials(name: string): string {
  const parts = name.trim().split(" ")
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return (parts[0][0] || "?").toUpperCase()
}

export default function ConversasPage() {
  const router = useRouter()
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(Date.now())
  const [confirmando, setConfirmando] = useState<Pedido | null>(null)
  const [finalizando, setFinalizando] = useState<string | null>(null)
  const [devolvendoBot, setDevolvendoBot] = useState<string | null>(null)
  const [toast, setToast] = useState("")
  const [busca, setBusca] = useState("")
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

  async function devolverParaBot(p: Pedido) {
    setDevolvendoBot(p.id)
    try {
      const r = await fetch('/api/devolver-para-bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefone: p.telefone }),
      })
      if (r.ok) {
        setPedidos(prev => prev.map(x => x.id === p.id ? { ...x, escalonado: false } : x))
        showToast('Conversa devolvida para o robô! 🤖')
      } else { showToast('Não foi possível devolver para o robô.') }
    } catch { showToast('Não foi possível devolver para o robô.') }
    setDevolvendoBot(null)
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
        showToast("Atendimento finalizado.")
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

  const filaBusca = busca.trim()
    ? fila.filter(p => p.cliente.toLowerCase().includes(busca.toLowerCase()) || p.telefone.includes(busca))
    : fila

  const atendBusca = busca.trim()
    ? emAtendimento.filter(p => p.cliente.toLowerCase().includes(busca.toLowerCase()) || p.telefone.includes(busca))
    : emAtendimento

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
        @keyframes cbFadeIn { from{opacity:0;transform:translateY(5px)} to{opacity:1;transform:none} }
        @keyframes cbSheetUp { from{transform:translateY(100%)} to{transform:none} }
        .cbCard { animation: cbFadeIn .22s ease both; }

        .cb-wa-btn {
          display:flex; align-items:center; justify-content:center; gap:6px;
          height:38px; padding:0 14px;
          background:#25d366; border-radius:10px;
          color:#fff; font-family:'Archivo',sans-serif;
          font-size:12px; font-weight:900; text-decoration:none; flex:1;
        }
        .cb-wa-btn:active { opacity:.85; }
        .cb-bot-btn {
          height:38px; padding:0 12px;
          background:rgba(100,140,255,.1); border:1px solid rgba(100,140,255,.28); border-radius:10px;
          color:#7a9fff; font-size:12px; font-weight:900;
        }
        .cb-bot-btn:active { opacity:.75; }
        .cb-fin-btn {
          height:38px; padding:0 12px;
          background:transparent; border:1px solid #242220; border-radius:10px;
          color:#56524b; font-size:12px; font-weight:800;
        }
        .cb-fin-btn:active { opacity:.75; }

        .cb-wa-sm {
          display:flex; align-items:center; justify-content:center; gap:5px;
          height:32px; padding:0 12px;
          border:1px solid rgba(37,211,102,.3); border-radius:9px;
          background:rgba(37,211,102,.07); color:#25d366;
          font-family:'Archivo',sans-serif; font-size:11px; font-weight:900; text-decoration:none;
        }
        .cb-wa-sm:active { opacity:.8; }
        .cb-fin-sm {
          height:32px; padding:0 10px;
          background:transparent; border:1px solid #222; border-radius:9px;
          color:#4a4640; font-size:11px; font-weight:800;
        }
        .cb-fin-sm:active { opacity:.75; }

        .cb-search::placeholder { color:#3a3730; }
        .cb-search:focus { border-color:#ff6b00 !important; outline:none; box-shadow:0 0 0 3px rgba(255,107,0,.1); }

        /* Mobile layout */
        .cb-header { background:#060606; border-bottom:1px solid #1a1816; padding:calc(env(safe-area-inset-top) + 14px) 16px 12px; position:sticky; top:0; z-index:10; }
        .cb-main { padding:12px 16px; }
        .cb-content { display:block; }

        /* Desktop layout */
        @media (min-width: 768px) {
          .cb-header { padding:24px 28px 20px; position:static; border-bottom:1px solid #1a1816; }
          .cb-main { padding:20px 28px; }
          .cb-content { display:grid; grid-template-columns:1fr 1fr; gap:24px; align-items:flex-start; }
          .cb-metrics { gap:10px !important; }
          .cb-metric-box { padding:12px 16px !important; }
          .cb-metric-num { font-size:26px !important; }
        }
        @media (min-width: 1024px) {
          .cb-content { grid-template-columns:5fr 4fr; }
        }
      `}</style>

      <PanelShell
        conversasCount={fila.length}
        conversasUrgent={fila.some(p => {
          const u = getUrgency(minEsperando(getTimestampEspera(p), now))
          return u === "urgente" || u === "critico"
        })}
      >

        {/* ── HEADER ── */}
        <header className="cb-header">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: "-0.4px", color: "#f5f2ee" }}>Conversas</div>
              <div style={{ fontSize: 11, color: "#5a564d", fontWeight: 700, marginTop: 1 }}>Atendimento humano</div>
            </div>
            {fila.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(224,80,80,.1)", border: "1px solid rgba(224,80,80,.3)", borderRadius: 20, padding: "5px 12px" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#e06060", animation: "cbPulse 1.6s infinite", flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 900, color: "#e06060" }}>{fila.length} aguardando</span>
              </div>
            )}
          </div>

          {/* Métricas */}
          <div className="cb-metrics" style={{ display: "flex", gap: 6, marginBottom: 14 }}>
            <div className="cb-metric-box" style={{ flex: 1, background: fila.length > 0 ? "rgba(224,80,80,.07)" : "#0d0d0d", border: `1px solid ${fila.length > 0 ? "rgba(224,80,80,.25)" : "#1e1c19"}`, borderRadius: 12, padding: "10px 12px" }}>
              <div className="cb-metric-num" style={{ fontSize: 24, fontWeight: 900, lineHeight: 1, color: fila.length > 0 ? "#e06060" : "#3a3730" }}>{fila.length}</div>
              <div style={{ fontSize: 10, fontWeight: 800, color: fila.length > 0 ? "rgba(224,80,80,.7)" : "#3a3730", textTransform: "uppercase", letterSpacing: ".4px", marginTop: 3 }}>Aguardando</div>
            </div>
            <div className="cb-metric-box" style={{ flex: 1, background: maxEsperaMin >= 8 ? "rgba(224,80,80,.07)" : "#0d0d0d", border: `1px solid ${maxEsperaMin >= 8 ? "rgba(224,80,80,.25)" : "#1e1c19"}`, borderRadius: 12, padding: "10px 12px" }}>
              <div className="cb-metric-num" style={{ fontSize: 24, fontWeight: 900, lineHeight: 1, color: maxEsperaMin >= 8 ? "#e06060" : fila.length > 0 ? "#d4c9ba" : "#3a3730" }}>{fila.length > 0 ? `${maxEsperaMin}m` : "—"}</div>
              <div style={{ fontSize: 10, fontWeight: 800, color: "#3a3730", textTransform: "uppercase", letterSpacing: ".4px", marginTop: 3 }}>Mais antigo</div>
            </div>
            <div className="cb-metric-box" style={{ flex: 1, background: "#0d0d0d", border: "1px solid #1e1c19", borderRadius: 12, padding: "10px 12px" }}>
              <div className="cb-metric-num" style={{ fontSize: 24, fontWeight: 900, lineHeight: 1, color: emAtendimento.length > 0 ? "#d4c9ba" : "#3a3730" }}>{emAtendimento.length}</div>
              <div style={{ fontSize: 10, fontWeight: 800, color: "#3a3730", textTransform: "uppercase", letterSpacing: ".4px", marginTop: 3 }}>Em andamento</div>
            </div>
          </div>

          {/* Busca */}
          <div style={{ position: "relative" }}>
            <svg style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} width="15" height="15" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="7" stroke="#3a3730" strokeWidth="2.2"/>
              <path d="M16.5 16.5l3.5 3.5" stroke="#3a3730" strokeWidth="2.2" strokeLinecap="round"/>
            </svg>
            <input
              className="cb-search"
              type="text"
              placeholder="Buscar por nome ou telefone…"
              value={busca}
              onChange={e => setBusca(e.target.value)}
              style={{ width: "100%", height: 40, background: "#0d0d0d", border: "1px solid #1e1c19", borderRadius: 10, padding: "0 36px 0 36px", color: "#f5f2ee", fontSize: 13, fontWeight: 600, fontFamily: "'Archivo',sans-serif", transition: "border-color .15s" }}
            />
            {busca && (
              <button onClick={() => setBusca("")} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#5a564d", fontSize: 18, lineHeight: 1, padding: 4 }}>×</button>
            )}
          </div>
        </header>

        {/* ── CONTEÚDO ── */}
        <main className="cb-main">
          <div className="cb-content">

            {/* ── COL 1: Fila de atendimento ── */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
                {fila.length > 0 && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#e06060", animation: "cbPulse 1.8s ease-in-out infinite", flexShrink: 0 }} />}
                <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.5px", textTransform: "uppercase", color: fila.length > 0 ? "#c9c2b4" : "#3a3730" }}>
                  Fila de atendimento
                </span>
                {fila.length > 0 && (
                  <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 900, color: "#e06060", background: "rgba(224,80,80,.12)", border: "1px solid rgba(224,80,80,.25)", padding: "2px 8px", borderRadius: 20 }}>
                    {fila.length}
                  </span>
                )}
              </div>

              {filaBusca.length === 0 && (
                <div style={{ background: "#0d0d0d", border: "1px dashed #252220", borderRadius: 14, padding: "28px 20px", textAlign: "center" }}>
                  {busca ? (
                    <>
                      <div style={{ fontSize: 22, marginBottom: 6 }}>🔍</div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: "#3a3730" }}>Nenhum resultado</div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 26, marginBottom: 6 }}>✅</div>
                      <div style={{ fontSize: 13, fontWeight: 900, color: "#3d8a54", marginBottom: 3 }}>Ninguém aguardando</div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#4a4640", lineHeight: 1.5 }}>Quando um cliente precisar de atendimento, aparecerá aqui.</div>
                    </>
                  )}
                </div>
              )}

              {filaBusca.map((p, idx) => {
                const ts = getTimestampEspera(p)
                const minWait = minEsperando(ts, now)
                const urgency = getUrgency(minWait)
                const isPrimeiro = idx === 0 && !busca
                const emFin = finalizando === p.id
                const emDevolvendo = devolvendoBot === p.id
                const initials = getInitials(p.cliente)

                return (
                  <div key={p.id} className="cbCard" style={{
                    background: isPrimeiro ? UBG[urgency] : "rgba(255,255,255,.015)",
                    border: `1.5px solid ${isPrimeiro ? UBD[urgency] : "#1e1c19"}`,
                    borderRadius: 14,
                    padding: "12px 14px",
                    marginBottom: 8,
                    animationDelay: `${idx * 0.04}s`,
                  }}>
                    {/* Topo: avatar + info + badge posição */}
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 11 }}>
                      {/* Avatar */}
                      <div style={{
                        width: 44, height: 44, borderRadius: "50%", flexShrink: 0,
                        background: `${UC[urgency]}22`,
                        border: `2px solid ${UC[urgency]}55`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 15, fontWeight: 900, color: UC[urgency], letterSpacing: "-0.5px",
                      }}>
                        {initials}
                      </div>

                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                          <span style={{ fontSize: 15, fontWeight: 900, color: "#f4f1ec", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {p.cliente.split(" ")[0]}
                          </span>
                          {p.numero != null && (
                            <span style={{ fontSize: 10, fontWeight: 800, color: "#4a4640", flexShrink: 0 }}>#{p.numero}</span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "#4a4640", marginBottom: 3 }}>{p.telefone}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 12, fontWeight: 900, color: UC[urgency] }}>{labelEspera(minWait, urgency)}</span>
                        </div>
                      </div>

                      {/* Badge posição */}
                      <div style={{ flexShrink: 0 }}>
                        {isPrimeiro ? (
                          <span style={{ fontSize: 10, fontWeight: 900, color: UC[urgency], background: `${UC[urgency]}18`, border: `1px solid ${UC[urgency]}40`, padding: "3px 9px", borderRadius: 20, whiteSpace: "nowrap" }}>
                            1º · Agora
                          </span>
                        ) : (
                          <span style={{ fontSize: 10, fontWeight: 800, color: "#4a4640", background: "#141210", border: "1px solid #222", padding: "3px 9px", borderRadius: 20, whiteSpace: "nowrap" }}>
                            {idx + 1}º na fila
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Última mensagem */}
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#3a3730", marginBottom: 11, paddingLeft: 56 }}>
                      Última mensagem às {p.horario}
                    </div>

                    {/* Ações */}
                    <div style={{ display: "flex", gap: 7 }}>
                      <a href={whatsappLink(p.telefone)} target="_blank" rel="noreferrer" className="cb-wa-btn">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                          <path d="M12 2C6.48 2 2 6.48 2 12c0 1.77.46 3.43 1.26 4.89L2 22l5.26-1.24A9.94 9.94 0 0 0 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2z" fill="#fff" opacity=".2"/>
                          <path d="M9.5 8.5c-.28 0-.5.04-.7.12C8.3 8.2 7 9.5 7 11c0 2.5 2.5 5 5 6.5 1.5.8 3.5.5 4.5-.5.2-.2.4-.5.5-.8.1-.3 0-.6-.2-.8l-1.8-1.3c-.2-.15-.5-.1-.7.05l-.8.8c-.15.15-.4.2-.6.1C12 14.8 11.2 14 10.6 13c-.1-.2-.05-.45.1-.6l.8-.8c.15-.2.2-.5.05-.7L10.3 9.1c-.2-.22-.5-.6-.8-.6z" fill="white"/>
                        </svg>
                        WhatsApp
                      </a>
                      <button className="cb-bot-btn" disabled={emDevolvendo} onClick={() => devolverParaBot(p)} style={{ opacity: emDevolvendo ? 0.4 : 1 }}>
                        {emDevolvendo ? "…" : "🤖 Robô"}
                      </button>
                      <button className="cb-fin-btn" disabled={emFin} onClick={() => setConfirmando(p)} style={{ opacity: emFin ? 0.4 : 1 }}>
                        {emFin ? "…" : "Finalizar"}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* ── COL 2: Em atendimento hoje ── */}
            <div style={{ marginTop: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.5px", textTransform: "uppercase", color: "#3a3730" }}>
                  Em atendimento hoje
                </span>
                {emAtendimento.length > 0 && (
                  <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 900, color: "#4a4640", background: "#141210", border: "1px solid #222", padding: "2px 8px", borderRadius: 20 }}>
                    {emAtendimento.length}
                  </span>
                )}
              </div>

              {atendBusca.length === 0 && (
                <div style={{ background: "#0d0d0d", border: "1px dashed #1e1c19", borderRadius: 12, padding: "18px", textAlign: "center" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#3a3730" }}>
                    {busca ? "Nenhum resultado" : "Nenhum atendimento aberto hoje"}
                  </div>
                </div>
              )}

              {atendBusca.map((p, idx) => {
                const emFin = finalizando === p.id
                const pixPendente = temPixPendente(p)
                const initials = getInitials(p.cliente)
                return (
                  <div key={p.id} className="cbCard" style={{
                    background: "#0c0c0c",
                    border: `1px solid ${pixPendente ? "rgba(255,170,0,.22)" : "#181614"}`,
                    borderRadius: 12,
                    padding: "10px 12px",
                    marginBottom: 7,
                    animationDelay: `${idx * 0.03}s`,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 9 }}>
                      {/* Avatar pequeno */}
                      <div style={{
                        width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
                        background: "rgba(90,86,77,.15)", border: "1px solid #272320",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 12, fontWeight: 900, color: "#6a6460",
                      }}>
                        {initials}
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                          <span style={{ fontSize: 14, fontWeight: 900, color: "#d4c9ba", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {p.cliente.split(" ")[0]}
                          </span>
                          {p.numero != null && (
                            <span style={{ background: "#161412", color: "#4a4640", fontSize: 9, fontWeight: 800, padding: "2px 5px", borderRadius: 5 }}>#{p.numero}</span>
                          )}
                          {pixPendente && (
                            <span style={{ background: "rgba(255,170,0,.12)", color: "#ffaa00", fontSize: 9, fontWeight: 900, padding: "2px 6px", borderRadius: 5, letterSpacing: ".3px", flexShrink: 0 }}>PIX⏳</span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: "#3a3730", fontWeight: 600 }}>{p.telefone} · {p.horario}</div>
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 7 }}>
                      <a href={whatsappLink(p.telefone)} target="_blank" rel="noreferrer" className="cb-wa-sm" style={{ flex: 1 }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                          <path d="M9.5 8.5c-.28 0-.5.04-.7.12C8.3 8.2 7 9.5 7 11c0 2.5 2.5 5 5 6.5 1.5.8 3.5.5 4.5-.5.2-.2.4-.5.5-.8.1-.3 0-.6-.2-.8l-1.8-1.3c-.2-.15-.5-.1-.7.05l-.8.8c-.15.15-.4.2-.6.1C12 14.8 11.2 14 10.6 13c-.1-.2-.05-.45.1-.6l.8-.8c.15-.2.2-.5.05-.7L10.3 9.1c-.2-.22-.5-.6-.8-.6z" fill="currentColor"/>
                        </svg>
                        WhatsApp
                      </a>
                      <button className="cb-fin-sm" disabled={emFin} onClick={() => setConfirmando(p)} style={{ opacity: emFin ? 0.4 : 1 }}>
                        {emFin ? "…" : "Finalizar"}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

          </div>
        </main>

      </PanelShell>

      {/* ── MODAL CONFIRMAÇÃO ── */}
      {confirmando && (
        <>
          <div onClick={() => setConfirmando(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 90 }} />
          <div style={{
            position: "fixed", bottom: 0, left: 0, right: 0, margin: "0 auto", maxWidth: 480,
            background: "#111009", border: "1px solid #242220", borderBottom: "none",
            borderRadius: "22px 22px 0 0", zIndex: 91,
            animation: "cbSheetUp .3s cubic-bezier(.2,.9,.3,1) both",
            padding: "18px 20px calc(env(safe-area-inset-bottom) + 28px)",
            display: "flex", flexDirection: "column", gap: 10,
          }}>
            <div style={{ width: 40, height: 4, borderRadius: 2, background: "#2e2b26", margin: "0 auto 6px" }} />

            {temPixPendente(confirmando) && (
              <div style={{ background: "rgba(255,170,0,.08)", border: "1px solid rgba(255,170,0,.25)", borderRadius: 10, padding: "10px 14px" }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: "#ffaa00", marginBottom: 3 }}>⚠ Pix pendente</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#8a8278", lineHeight: 1.5 }}>
                  Esse pedido aguarda confirmação de Pix. Finalizar removerá o atendimento da fila.
                </div>
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: "50%", background: "rgba(90,86,77,.15)", border: "1px solid #2a2723", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 900, color: "#6a6460", flexShrink: 0 }}>
                {getInitials(confirmando.cliente)}
              </div>
              <div>
                <div style={{ fontSize: 17, fontWeight: 900, letterSpacing: "-0.3px" }}>Finalizar atendimento?</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#6a6460" }}>{confirmando.cliente.split(" ")[0]}</div>
              </div>
            </div>

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
