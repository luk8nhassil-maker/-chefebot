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
  itens: string[]
}

function whatsappLink(telefone: string): string {
  let numero = (telefone || "").replace(/\D/g, "")
  if (numero && !numero.startsWith("55")) numero = "55" + numero
  return `https://wa.me/${numero}`
}

function getTimestampEspera(p: Pedido): number {
  // horarioEscalonado é o mais preciso; fallback para o id (Date.now() quando criado)
  return p.horarioEscalonado || parseInt(p.id) || Date.now()
}

function minEsperando(ts: number, now: number): number {
  return Math.max(0, Math.floor((now - ts) / 60000))
}

type UrgencyLevel = "normal" | "atencao" | "urgente" | "critico"

function getUrgency(min: number): UrgencyLevel {
  if (min >= 15) return "critico"
  if (min >= 8) return "urgente"
  if (min >= 4) return "atencao"
  return "normal"
}

const URGENCY_COLOR: Record<UrgencyLevel, string> = {
  normal: "#56b87e",
  atencao: "#e0893a",
  urgente: "#e05050",
  critico: "#c0373a",
}

const URGENCY_BG: Record<UrgencyLevel, string> = {
  normal: "rgba(86,184,126,.08)",
  atencao: "rgba(224,137,58,.08)",
  urgente: "rgba(224,80,80,.08)",
  critico: "rgba(192,55,58,.12)",
}

const URGENCY_BORDER: Record<UrgencyLevel, string> = {
  normal: "rgba(86,184,126,.2)",
  atencao: "rgba(224,137,58,.28)",
  urgente: "rgba(224,80,80,.35)",
  critico: "rgba(192,55,58,.45)",
}

function labelEspera(min: number, urgency: UrgencyLevel): string {
  if (urgency === "critico") return `Crítico: esperando há ${min} min`
  if (urgency === "urgente") return `Urgente: esperando há ${min} min`
  if (urgency === "atencao") return `Esperando há ${min} min`
  return min === 0 ? "Acabou de chegar" : `Esperando há ${min} min`
}

export default function ConversasPage() {
  const router = useRouter()
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(Date.now())
  const ivRef = useRef<any>(null)

  function carregar() {
    fetch("/api/orders")
      .then(r => {
        if (r.status === 401) { router.push("/login?callbackUrl=/conversas"); return null }
        return r.json()
      })
      .then(data => { if (data) { setPedidos(data); setLoading(false) } })
      .catch(() => setLoading(false))
  }

  useEffect(() => {
    carregar()
    // Refresca dados a cada 15s
    const ivData = setInterval(carregar, 15000)
    // Atualiza "agora" a cada 30s para recalcular tempos de espera
    const ivTime = setInterval(() => setNow(Date.now()), 30000)
    return () => { clearInterval(ivData); clearInterval(ivTime) }
  }, [router])

  // Fila: escalonados ordenados do mais antigo para mais recente
  const fila = pedidos
    .filter(p => p.escalonado && p.status === "novo")
    .sort((a, b) => getTimestampEspera(a) - getTimestampEspera(b))

  // Em atendimento: todos os não-finalizados excluindo a fila
  const emAtendimento = pedidos.filter(
    p => !["entregue", "cancelado"].includes(p.status) && !(p.escalonado && p.status === "novo")
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
        html, body { margin: 0; padding: 0; background: #060606; overflow-x: hidden; }
        button { cursor: pointer; font-family: 'Archivo', sans-serif; border: none; }
        @keyframes cbPulse { 0%{opacity:1} 50%{opacity:.4} 100%{opacity:1} }
        @keyframes cbFadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }
        .cbCard { animation: cbFadeIn .25s ease both; }
        .cbWaLink { display:flex; align-items:center; justify-content:center; gap:8px; height:48px; background:#25d366; border-radius:13px; color:#fff; font-family:'Archivo',sans-serif; font-size:14px; font-weight:900; text-decoration:none; letter-spacing:-.1px; }
        .cbWaLink:active { opacity:.85; }
        .cbWaLinkSm { display:flex; align-items:center; justify-content:center; gap:6px; height:36px; padding:0 13px; border:1px solid rgba(37,211,102,.3); border-radius:10px; background:rgba(37,211,102,.08); color:#25d366; font-family:'Archivo',sans-serif; font-size:12px; font-weight:900; text-decoration:none; flex-shrink:0; }
        .cbWaLinkSm:active { opacity:.8; }
      `}</style>

      {/* APP SHELL */}
      <div style={{
        height: "100svh",
        maxWidth: 390,
        margin: "0 auto",
        background: "#060606",
        color: "#f5f2ee",
        fontFamily: "'Archivo', sans-serif",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}>

        {/* ── HEADER FIXO ── */}
        <header style={{
          flexShrink: 0,
          background: "#060606",
          borderBottom: "1px solid #1a1816",
          padding: "calc(env(safe-area-inset-top) + 14px) 16px 12px",
        }}>
          {/* Título */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: "-0.4px" }}>Conversas</div>
            <div style={{ fontSize: 11, color: "#5a564d", fontWeight: 700, marginTop: 2 }}>Atendimento humano</div>
          </div>

          {/* Resumo operacional */}
          <div style={{ display: "flex", gap: 6 }}>
            {/* Aguardando */}
            <div style={{
              flex: 1,
              background: fila.length > 0 ? "rgba(224,80,80,.07)" : "#0d0d0d",
              border: `1px solid ${fila.length > 0 ? "rgba(224,80,80,.25)" : "#1e1c19"}`,
              borderRadius: 11, padding: "9px 11px",
            }}>
              <div style={{ fontSize: 22, fontWeight: 900, lineHeight: 1, color: fila.length > 0 ? "#e06060" : "#3a3730" }}>
                {fila.length}
              </div>
              <div style={{ fontSize: 10, fontWeight: 800, color: fila.length > 0 ? "rgba(224,80,80,.7)" : "#3a3730", textTransform: "uppercase", letterSpacing: ".4px", marginTop: 3 }}>
                aguardando
              </div>
            </div>

            {/* Mais antigo */}
            <div style={{
              flex: 1,
              background: maxEsperaMin >= 8 ? "rgba(224,80,80,.07)" : "#0d0d0d",
              border: `1px solid ${maxEsperaMin >= 8 ? "rgba(224,80,80,.25)" : "#1e1c19"}`,
              borderRadius: 11, padding: "9px 11px",
            }}>
              <div style={{ fontSize: 22, fontWeight: 900, lineHeight: 1, color: maxEsperaMin >= 8 ? "#e06060" : fila.length > 0 ? "#d4c9ba" : "#3a3730" }}>
                {fila.length > 0 ? `${maxEsperaMin}m` : "—"}
              </div>
              <div style={{ fontSize: 10, fontWeight: 800, color: "#3a3730", textTransform: "uppercase", letterSpacing: ".4px", marginTop: 3 }}>
                mais antigo
              </div>
            </div>

            {/* Em atendimento */}
            <div style={{ flex: 1, background: "#0d0d0d", border: "1px solid #1e1c19", borderRadius: 11, padding: "9px 11px" }}>
              <div style={{ fontSize: 22, fontWeight: 900, lineHeight: 1, color: emAtendimento.length > 0 ? "#d4c9ba" : "#3a3730" }}>
                {emAtendimento.length}
              </div>
              <div style={{ fontSize: 10, fontWeight: 800, color: "#3a3730", textTransform: "uppercase", letterSpacing: ".4px", marginTop: 3 }}>
                em andamento
              </div>
            </div>
          </div>
        </header>

        {/* ── CONTEÚDO ROLÁVEL ── */}
        <main style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" as any, padding: "14px 16px 8px" }}>

          {/* === SEÇÃO FILA === */}
          <div style={{ marginBottom: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              {fila.length > 0 && (
                <span style={{
                  width: 7, height: 7, borderRadius: "50%",
                  background: "#e06060",
                  animation: "cbPulse 1.8s ease-in-out infinite",
                  flexShrink: 0,
                }} />
              )}
              <span style={{ fontSize: 13, fontWeight: 900, color: fila.length > 0 ? "#f0ede8" : "#4a4640", letterSpacing: "-0.2px" }}>
                {fila.length > 0
                  ? `${fila.length === 1 ? "1 precisa" : `${fila.length} precisam`} de atendimento agora`
                  : "Fila de atendimento"}
              </span>
            </div>

            {fila.length === 0 && (
              <div style={{ background: "#0d0d0d", border: "1px dashed #252220", borderRadius: 16, padding: "30px 20px", textAlign: "center" }}>
                <div style={{ fontSize: 30, marginBottom: 8 }}>✅</div>
                <div style={{ fontSize: 14, fontWeight: 900, color: "#3d8a54", marginBottom: 4 }}>Ninguém aguardando</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#4a4640", lineHeight: 1.5 }}>
                  Quando um cliente precisar de atendimento,{"\n"}aparecerá aqui.
                </div>
              </div>
            )}

            {fila.map((p, idx) => {
              const ts = getTimestampEspera(p)
              const minWait = minEsperando(ts, now)
              const urgency = getUrgency(minWait)
              const primeiroNome = p.cliente.split(" ")[0]
              const horarioStr = p.horario || new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
              const isPrimeiro = idx === 0

              return (
                <div
                  key={p.id}
                  className="cbCard"
                  style={{
                    background: isPrimeiro ? URGENCY_BG[urgency] : "rgba(255,255,255,.02)",
                    border: `1.5px solid ${isPrimeiro ? URGENCY_BORDER[urgency] : "#1e1c19"}`,
                    borderRadius: 16,
                    padding: "14px 14px 14px",
                    marginBottom: 10,
                    animationDelay: `${idx * 0.05}s`,
                  }}
                >
                  {/* Linha topo: badge prioridade + número pedido */}
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
                    {isPrimeiro && (
                      <span style={{
                        fontSize: 10, fontWeight: 900, color: URGENCY_COLOR[urgency],
                        background: `${URGENCY_COLOR[urgency]}18`,
                        border: `1px solid ${URGENCY_COLOR[urgency]}40`,
                        padding: "3px 9px", borderRadius: 20,
                        letterSpacing: ".2px",
                      }}>
                        Responder primeiro
                      </span>
                    )}
                    {!isPrimeiro && (
                      <span style={{ fontSize: 10, fontWeight: 800, color: "#4a4640", background: "#141210", border: "1px solid #2a2723", padding: "3px 9px", borderRadius: 20 }}>
                        {idx + 1}º na fila
                      </span>
                    )}
                    {p.numero != null && (
                      <span style={{ fontSize: 10, fontWeight: 800, color: "#5a564d", marginLeft: "auto" }}>#{p.numero}</span>
                    )}
                  </div>

                  {/* Nome */}
                  <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: "-0.3px", marginBottom: 4, color: "#f4f1ec" }}>
                    {primeiroNome}
                  </div>

                  {/* Telefone */}
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#5a564d", marginBottom: 6 }}>
                    {p.telefone}
                  </div>

                  {/* Tempo de espera */}
                  <div style={{
                    fontSize: 13, fontWeight: 900,
                    color: URGENCY_COLOR[urgency],
                    marginBottom: 4,
                  }}>
                    {labelEspera(minWait, urgency)}
                  </div>

                  {/* Horário da última mensagem */}
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#4a4640", marginBottom: 14 }}>
                    Última mensagem às {horarioStr}
                  </div>

                  {/* Botão WhatsApp */}
                  <a
                    href={whatsappLink(p.telefone)}
                    target="_blank"
                    rel="noreferrer"
                    className="cbWaLink"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path d="M20.5 3.5A12 12 0 0 0 3.5 20.5L2 22l1.5-1.5A12 12 0 1 0 20.5 3.5z" fill="#fff" opacity=".3"/>
                      <path d="M12 2C6.48 2 2 6.48 2 12c0 1.77.46 3.43 1.26 4.89L2 22l5.26-1.24A9.94 9.94 0 0 0 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2z" fill="#fff" opacity=".15"/>
                      <path d="M9.5 8.5c-.28 0-.5.04-.7.12C8.3 8.2 7 9.5 7 11c0 2.5 2.5 5 5 6.5 1.5.8 3.5.5 4.5-.5.2-.2.4-.5.5-.8.1-.3 0-.6-.2-.8l-1.8-1.3c-.2-.15-.5-.1-.7.05l-.8.8c-.15.15-.4.2-.6.1C12 14.8 11.2 14 10.6 13c-.1-.2-.05-.45.1-.6l.8-.8c.15-.2.2-.5.05-.7L10.3 9.1c-.2-.22-.5-.6-.8-.6z" fill="white"/>
                    </svg>
                    Abrir WhatsApp
                  </a>
                </div>
              )
            })}
          </div>

          {/* === SEÇÃO EM ATENDIMENTO === */}
          <div style={{ marginTop: fila.length > 0 ? 18 : 8 }}>
            <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "1.2px", textTransform: "uppercase", color: "#3a3730", marginBottom: 10 }}>
              Em atendimento hoje
            </div>

            {emAtendimento.length === 0 && (
              <div style={{ background: "#0d0d0d", border: "1px dashed #1e1c19", borderRadius: 14, padding: "20px", textAlign: "center" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#3a3730" }}>Nenhum atendimento aberto hoje</div>
              </div>
            )}

            {emAtendimento.map(p => (
              <div key={p.id} style={{ background: "#0c0c0c", border: "1px solid #181614", borderRadius: 13, padding: "11px 13px", marginBottom: 7, display: "flex", alignItems: "center", gap: 11 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                    {p.numero != null && (
                      <span style={{ background: "#161412", color: "#4a4640", fontSize: 10, fontWeight: 800, padding: "2px 6px", borderRadius: 6 }}>#{p.numero}</span>
                    )}
                    <span style={{ fontSize: 14, fontWeight: 900, color: "#d4c9ba", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.cliente.split(" ")[0]}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "#3a3730", fontWeight: 600 }}>{p.telefone} · {p.horario}</div>
                </div>
                <a
                  href={whatsappLink(p.telefone)}
                  target="_blank"
                  rel="noreferrer"
                  className="cbWaLinkSm"
                >
                  WhatsApp
                </a>
              </div>
            ))}

            {/* Espaço extra para o nav não tapar */}
            <div style={{ height: 6 }} />
          </div>
        </main>

        {/* ── NAV INFERIOR FIXO ── */}
        <nav style={{
          flexShrink: 0,
          background: "rgba(6,6,6,.96)",
          backdropFilter: "blur(14px)",
          borderTop: "1px solid #181614",
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          padding: "10px 8px calc(env(safe-area-inset-bottom) + 16px)",
        }}>
          <button onClick={() => router.push("/pedidos")} style={{ background: "transparent", display: "flex", flexDirection: "column", alignItems: "center", gap: 5, padding: "6px 0" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="4" y="3" width="16" height="18" rx="3" stroke="#3a3730" strokeWidth="2.2"/><line x1="8" y1="9" x2="16" y2="9" stroke="#3a3730" strokeWidth="2.2" strokeLinecap="round"/><line x1="8" y1="14" x2="13" y2="14" stroke="#3a3730" strokeWidth="2.2" strokeLinecap="round"/></svg>
            <span style={{ fontSize: 10, fontWeight: 800, color: "#3a3730" }}>Pedidos</span>
          </button>
          <button style={{ background: "transparent", display: "flex", flexDirection: "column", alignItems: "center", gap: 5, padding: "6px 0" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="14" rx="5" stroke="#ff6b00" strokeWidth="2.2"/><circle cx="8.5" cy="11" r="1.4" fill="#ff6b00"/><circle cx="12" cy="11" r="1.4" fill="#ff6b00"/><circle cx="15.5" cy="11" r="1.4" fill="#ff6b00"/></svg>
            <span style={{ fontSize: 10, fontWeight: 900, color: "#ff6b00" }}>Conversas</span>
          </button>
          <button onClick={() => router.push("/cardapio")} style={{ background: "transparent", display: "flex", flexDirection: "column", alignItems: "center", gap: 5, padding: "6px 0" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="7" height="7" rx="2" stroke="#3a3730" strokeWidth="2.2"/><rect x="13" y="4" width="7" height="7" rx="2" stroke="#3a3730" strokeWidth="2.2"/><rect x="4" y="13" width="7" height="7" rx="2" stroke="#3a3730" strokeWidth="2.2"/><rect x="13" y="13" width="7" height="7" rx="2" stroke="#3a3730" strokeWidth="2.2"/></svg>
            <span style={{ fontSize: 10, fontWeight: 800, color: "#3a3730" }}>Cardápio</span>
          </button>
        </nav>
      </div>
    </>
  )
}
