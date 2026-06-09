"use client"
import { useEffect, useState, useRef } from "react"
import { useRouter } from "next/navigation"

type Status = "novo" | "em_preparo" | "saiu_entrega" | "entregue" | "cancelado"
type Pedido = {
  id: string
  cliente: string
  telefone: string
  itens: string[]
  total: number
  status: Status
  horario: string
  endereco: string
  escalonado?: boolean
  cancelamentoSolicitado?: boolean
  observacao?: string
}

const STATUS_CONFIG: Record<Status, { label: string; color: string; bg: string; border: string; btnBg: string; btnColor: string }> = {
  novo:         { label: "Novo",       color: "#fbbf24", bg: "#fbbf2412", border: "#fbbf2430", btnBg: "#fbbf24", btnColor: "#000" },
  em_preparo:   { label: "Preparo",    color: "#fb923c", bg: "#fb923c12", border: "#fb923c30", btnBg: "#fb923c", btnColor: "#000" },
  saiu_entrega: { label: "Na entrega", color: "#60a5fa", bg: "#60a5fa12", border: "#60a5fa30", btnBg: "#60a5fa", btnColor: "#000" },
  entregue:     { label: "Entregue",   color: "#4ade80", bg: "#00000000", border: "#ffffff08", btnBg: "#4ade80", btnColor: "#000" },
  cancelado:    { label: "Cancelado",  color: "#f87171", bg: "#00000000", border: "#ffffff08", btnBg: "#f87171", btnColor: "#fff" },
}

const PROXIMO_STATUS: Record<Status, Status | null> = {
  novo: "em_preparo", em_preparo: "saiu_entrega", saiu_entrega: "entregue", entregue: null, cancelado: null,
}

const PROXIMO_LABEL: Record<Status, string> = {
  novo: "🔥 Iniciar preparo",
  em_preparo: "🛵 Saiu para entrega",
  saiu_entrega: "✅ Confirmar entrega",
  entregue: "", cancelado: "",
}

function tempoDesde(horario: string): string {
  try {
    const [h, m] = horario.split(":").map(Number)
    const agora = new Date()
    const t = new Date(); t.setHours(h, m, 0, 0)
    const diff = Math.floor((agora.getTime() - t.getTime()) / 60000)
    if (diff < 1) return "agora"
    if (diff < 60) return `${diff}min`
    const hr = Math.floor(diff / 60), mn = diff % 60
    return mn > 0 ? `${hr}h${mn}m` : `${hr}h`
  } catch { return "" }
}

function tocarSom() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    const master = ctx.createGain(); master.gain.setValueAtTime(0.7, ctx.currentTime); master.connect(ctx.destination)
    ;[0, 0.7, 1.4].forEach(t => {
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain()
      o1.connect(g); o2.connect(g); g.connect(master)
      o1.type = "sine"; o2.type = "sine"
      o1.frequency.setValueAtTime(900, ctx.currentTime + t); o2.frequency.setValueAtTime(1800, ctx.currentTime + t)
      g.gain.setValueAtTime(0, ctx.currentTime + t)
      g.gain.linearRampToValueAtTime(0.8, ctx.currentTime + t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.55)
      o1.start(ctx.currentTime + t); o1.stop(ctx.currentTime + t + 0.6)
      o2.start(ctx.currentTime + t); o2.stop(ctx.currentTime + t + 0.6)
    })
  } catch {}
}

function getUserInfo(): { name: string; role: string } | null {
  if (typeof document === "undefined") return null
  try {
    const cookies = document.cookie.split(";")
    for (const c of cookies) {
      const trimmed = c.trim()
      if (trimmed.startsWith("auth-user=")) {
        const raw = trimmed.substring("auth-user=".length)
        let decoded = raw
        try { decoded = decodeURIComponent(raw) } catch {}
        if (decoded.startsWith("%7B")) try { decoded = decodeURIComponent(decoded) } catch {}
        return JSON.parse(decoded)
      }
    }
  } catch {}
  return null
}

type Toast = { id: number; message: string; type: "success" | "error" | "warning" | "info" }

export default function PedidosPage() {
  const router = useRouter()
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [filtro, setFiltro] = useState<Status | "todos">("novo")
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState("")
  const [atualizando, setAtualizando] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [botAtivo, setBotAtivo] = useState(true)
  const [salvandoBot, setSalvandoBot] = useState(false)
  const [manuais, setManuais] = useState<Record<string, boolean>>({})
  const prevIdsRef = useRef<string[]>([])
  const piscarRef = useRef<NodeJS.Timeout | null>(null)
  const tituloOriginalRef = useRef(typeof document !== "undefined" ? document.title : "Cozinha")
  const toastIdRef = useRef(0)
  const filtrosRef = useRef<HTMLDivElement>(null)
  const botoesRef = useRef<(HTMLButtonElement | null)[]>([])

  const addToast = (message: string, type: Toast["type"] = "success") => {
    const id = ++toastIdRef.current
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500)
  }

  useEffect(() => {
    const user = getUserInfo()
    if (user) setIsAdmin(user.role === "admin" || user.role === "dev")
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission()
    carregarPedidos()
    carregarStatusBot()
    const intervalo = setInterval(carregarPedidos, 10000)
    const relogio = setInterval(() => {}, 30000)
    return () => { clearInterval(intervalo); clearInterval(relogio); if (piscarRef.current) clearInterval(piscarRef.current); document.title = tituloOriginalRef.current }
  }, [router])

  const iniciarPiscar = () => {
    if (piscarRef.current) return
    let e = false
    piscarRef.current = setInterval(() => { e = !e; document.title = e ? "🚨 URGENTE!" : tituloOriginalRef.current }, 800)
  }
  const pararPiscar = () => {
    if (piscarRef.current) { clearInterval(piscarRef.current); piscarRef.current = null }
    document.title = tituloOriginalRef.current
  }
  const carregarStatusBot = async () => {
    try { const r = await fetch("/api/bot-status"); if (r.ok) { const d = await r.json(); setBotAtivo(d.ativo) } } catch {}
  }
  const alternarBot = async () => {
    setSalvandoBot(true)
    try {
      const novo = !botAtivo
      const r = await fetch("/api/bot-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ativo: novo }) })
      if (r.ok) { setBotAtivo(novo); addToast(novo ? "🤖 Robô atendendo!" : "⏸️ Robô em pausa!", novo ? "success" : "warning") }
    } catch {}
    setSalvandoBot(false)
  }
  const assumirConversa = async (phone: string) => {
    try {
      await fetch("/api/bot-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, ativo: false }) })
      setManuais(prev => ({ ...prev, [phone]: true })); pararPiscar(); window.open("https://wa.me/" + phone, "_blank")
    } catch {}
  }
  const devolverAoBot = async (phone: string) => {
    try {
      await fetch("/api/bot-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, ativo: true }) })
      setManuais(prev => ({ ...prev, [phone]: false })); addToast("🤖 Bot retomou a conversa", "info")
    } catch {}
  }
  const marcarResolvido = async (phone: string, pedidoId: string) => {
    try {
      await fetch("/api/resolver", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone }) })
      setManuais(prev => ({ ...prev, [phone]: false }))
      setPedidos(prev => prev.map(p => p.id === pedidoId ? { ...p, escalonado: false, status: "entregue" } : p))
      pararPiscar(); addToast("✅ Resolvido! Cliente notificado.", "success")
    } catch {}
  }
  const carregarPedidos = () => {
    fetch("/api/orders")
      .then(r => { if (r.status === 401) { router.push("/login?callbackUrl=/pedidos"); return null } return r.json() })
      .then(data => {
        if (data) {
          const novosIds = data.map((p: Pedido) => p.id)
          const anteriores = prevIdsRef.current
          if (anteriores.length > 0) {
            const chegaram = data.filter((p: Pedido) => !anteriores.includes(p.id))
            if (chegaram.length > 0) {
              tocarSom()
              const temEsc = chegaram.some((p: Pedido) => p.escalonado)
              const temCanc = chegaram.some((p: Pedido) => p.cancelamentoSolicitado)
              if (temEsc) { addToast("🚨 URGENTE! Cliente precisa de você!", "error"); iniciarPiscar() }
              else if (temCanc) addToast("⚠️ Cancelamento solicitado!", "warning")
              else addToast(`🍕 ${chegaram.length} novo${chegaram.length > 1 ? "s" : ""} pedido${chegaram.length > 1 ? "s" : ""}!`, "success")
            }
          }
          prevIdsRef.current = novosIds; setPedidos(data); setLoading(false)
          setUltimaAtualizacao(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }))
          if (!data.some((p: Pedido) => p.escalonado && p.status === "novo")) pararPiscar()
        }
      })
      .catch(() => setTimeout(carregarPedidos, 3000))
  }
  const avancarStatus = async (id: string, novoStatus: Status) => {
    setAtualizando(id)
    const r = await fetch("/api/orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status: novoStatus }) })
    if (r.ok) { setPedidos(prev => prev.map(p => p.id === id ? { ...p, status: novoStatus } : p)); addToast(`${STATUS_CONFIG[novoStatus].label} ✅`, "success") }
    setAtualizando(null)
  }
  const confirmarCancelamento = async (id: string) => {
    setAtualizando(id)
    const r = await fetch("/api/orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status: "cancelado" }) })
    if (r.ok) { setPedidos(prev => prev.map(p => p.id === id ? { ...p, status: "cancelado", cancelamentoSolicitado: false } : p)); addToast("Pedido cancelado", "warning") }
    setAtualizando(null)
  }

  const contagem = (s: Status | "todos") => s === "todos" ? pedidos.filter(p => !p.escalonado).length : pedidos.filter(p => p.status === s && !p.escalonado).length
  const pedidosFiltrados = (filtro === "todos" ? pedidos : pedidos.filter(p => p.status === filtro)).sort((a, b) => {
    if (a.escalonado && !b.escalonado) return -1; if (!a.escalonado && b.escalonado) return 1
    if (a.cancelamentoSolicitado && !b.cancelamentoSolicitado) return -1; return 0
  })
  const ativos = pedidos.filter(p => !["entregue", "cancelado"].includes(p.status) && !p.escalonado).length
  const escalonados = pedidos.filter(p => p.escalonado && p.status === "novo").length
  const eAtivo = (s: Status) => !["entregue", "cancelado"].includes(s)

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#080808", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center" }}><div style={{ fontSize: 32, marginBottom: 12 }}>🍕</div><p style={{ color: "#333", fontSize: 14 }}>Carregando...</p></div>
    </div>
  )

  const toastColors: Record<Toast["type"], string> = { success: "#4ade80", error: "#f87171", warning: "#fb923c", info: "#60a5fa" }

  return (
    <div style={{ minHeight: "100vh", background: "#080808", paddingBottom: 80, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>

      <style>{`
        @keyframes slideUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.5; } }
      `}</style>

      {/* Toasts */}
      <div style={{ position: "fixed", bottom: 20, left: 16, right: 16, zIndex: 9999, display: "flex", flexDirection: "column-reverse", gap: 8, pointerEvents: "none" }}>
        {toasts.map(t => (
          <div key={t.id} style={{ background: "#141414", border: `1px solid ${toastColors[t.type]}30`, borderLeft: `3px solid ${toastColors[t.type]}`, borderRadius: 12, padding: "12px 16px", color: "#fff", fontSize: 13, fontWeight: 600, backdropFilter: "blur(20px)", boxShadow: "0 8px 32px rgba(0,0,0,0.5)", animation: "slideUp 0.25s ease" }}>
            {t.message}
          </div>
        ))}
      </div>

      {/* Header */}
      <div style={{ background: "#0d0d0d", borderBottom: "1px solid #161616", padding: "14px 16px", position: "sticky", top: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 20 }}>🍕</span>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 800, fontSize: 15, color: "#fff", letterSpacing: -0.3 }}>Cozinha</span>
              {escalonados > 0 && <span style={{ background: "#f87171", color: "#fff", fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 20, animation: "pulse 1s infinite" }}>🚨 {escalonados}</span>}
              {ativos > 0 && <span style={{ background: "#ffffff12", color: "#666", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20 }}>{ativos} ativo{ativos !== 1 ? "s" : ""}</span>}
            </div>
            <p style={{ fontSize: 10, color: "#333", margin: 0 }}>atualizado {ultimaAtualizacao}</p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={alternarBot} disabled={salvandoBot} style={{ position: "relative", width: 44, height: 26, borderRadius: 13, border: "none", cursor: "pointer", background: botAtivo ? "#16a34a" : "#222", transition: "background 0.2s", flexShrink: 0 }}>
            <span style={{ position: "absolute", top: 2, left: botAtivo ? 20 : 2, width: 22, height: 22, borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
          </button>
          {isAdmin && <button onClick={() => window.location.href = "/admin"} style={{ background: "#1a1500", border: "1px solid #2a2000", color: "#fbbf24", borderRadius: 8, padding: "6px 9px", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>👑</button>}
          <button onClick={() => fetch("/api/auth/logout", { method: "POST" }).then(() => router.push("/login"))} style={{ background: "#141414", border: "1px solid #1e1e1e", color: "#444", borderRadius: 8, padding: "6px 9px", cursor: "pointer", fontSize: 11 }}>Sair</button>
        </div>
      </div>

      <div style={{ padding: "10px 14px 0" }}>

        {/* Alerta urgente */}
        {escalonados > 0 && (
          <div style={{ background: "#1a0505", border: "1px solid #f8717130", borderRadius: 14, padding: "12px 14px", marginBottom: 10, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 22 }}>🚨</span>
            <div>
              <p style={{ fontWeight: 800, color: "#f87171", margin: 0, fontSize: 13 }}>{escalonados} cliente{escalonados > 1 ? "s" : ""} precisando de você AGORA</p>
              <p style={{ fontSize: 11, color: "#f8717160", margin: "2px 0 0" }}>Role até os cards vermelhos abaixo</p>
            </div>
          </div>
        )}

        {/* Filtros */}
        <div ref={filtrosRef} style={{ display: "flex", gap: 6, marginBottom: 12, overflowX: "auto", paddingBottom: 2, scrollBehavior: "smooth", msOverflowStyle: "none", scrollbarWidth: "none" }}>
          <style>{`div::-webkit-scrollbar { display: none; }`}</style>
          {([
            { key: "novo", label: "🔥 Novos", color: "#fbbf24" },
            { key: "em_preparo", label: "👨‍🍳 Preparo", color: "#fb923c" },
            { key: "saiu_entrega", label: "🛵 Entrega", color: "#60a5fa" },
            { key: "entregue", label: "✅ Entregues", color: "#4ade80" },
            { key: "cancelado", label: "❌ Cancel.", color: "#f87171" },
            { key: "todos", label: "Todos", color: "#888" },
          ] as { key: Status | "todos"; label: string; color: string }[]).map(({ key, label, color }, index) => {
            const count = contagem(key)
            const ativo = filtro === key
            return (
              <button key={key} ref={el => { botoesRef.current[index] = el }} onClick={() => {
                setFiltro(key)
                const btn = botoesRef.current[index]
                const container = filtrosRef.current
                if (btn && container) {
                  const btnLeft = btn.offsetLeft
                  const btnWidth = btn.offsetWidth
                  const containerWidth = container.offsetWidth
                  container.scrollTo({ left: btnLeft - (containerWidth / 2) + (btnWidth / 2), behavior: "smooth" })
                }
              }} style={{ flexShrink: 0, padding: "7px 14px", borderRadius: 20, border: ativo ? "none" : "1px solid #1a1a1a", cursor: "pointer", fontWeight: 700, fontSize: 12, background: ativo ? color : "#111", color: ativo ? "#000" : "#555", display: "flex", alignItems: "center", gap: 4, transition: "all 0.2s", transform: ativo ? "scale(1.05)" : "scale(1)" }}>
                {label}
                {count > 0 && <span style={{ background: ativo ? "rgba(0,0,0,0.2)" : "#222", color: ativo ? "#000" : "#666", fontSize: 10, fontWeight: 800, padding: "0 5px", borderRadius: 10 }}>{count}</span>}
              </button>
            )
          })}
          {/* Padding direito para mostrar metade do próximo botão */}
          <div style={{ flexShrink: 0, width: 40 }} />
        </div>

        {/* Cards */}
        {pedidosFiltrados.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 0" }}>
            <p style={{ fontSize: 36, margin: "0 0 10px" }}>🍕</p>
            <p style={{ fontSize: 14, color: "#2a2a2a", fontWeight: 700 }}>{filtro === "novo" ? "Nenhum pedido novo" : "Nada aqui ainda"}</p>
            <p style={{ fontSize: 12, color: "#1e1e1e", margin: "4px 0 0" }}>{filtro === "novo" ? "Tudo em dia por enquanto!" : ""}</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {pedidosFiltrados.map(pedido => {
              const emManual = manuais[pedido.telefone] === true
              const isEsc = pedido.escalonado === true
              const isCanc = pedido.cancelamentoSolicitado === true
              const proxStatus = PROXIMO_STATUS[pedido.status]
              const cfg = isEsc ? STATUS_CONFIG.cancelado : STATUS_CONFIG[pedido.status]
              const tempo = tempoDesde(pedido.horario)
              const ativo = eAtivo(pedido.status)
              const tempoUrgente = pedido.status === "novo"

              return (
                <div key={pedido.id} style={{ background: isEsc ? "#110505" : ativo ? "#0d0d0d" : "#090909", border: `1px solid ${isEsc ? "#f8717125" : isCanc ? "#fb923c25" : ativo ? cfg.border : "#111"}`, borderRadius: 16, overflow: "hidden", opacity: ativo ? 1 : 0.45, transition: "opacity 0.2s" }}>

                  {/* Linha de cor do status */}
                  {ativo && <div style={{ height: 3, background: isEsc ? "#f87171" : cfg.color, width: "100%" }} />}

                  {/* Corpo do card */}
                  <div style={{ padding: "14px 16px 12px" }}>

                    {/* Linha 1: Nome + Badge status */}
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 6 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 900, fontSize: 17, color: "#fff", letterSpacing: -0.5 }}>{pedido.cliente}</span>
                          {isEsc && <span style={{ background: "#f87171", color: "#fff", fontSize: 9, fontWeight: 800, padding: "2px 7px", borderRadius: 20, letterSpacing: 0.5 }}>🚨 URGENTE</span>}
                          {isCanc && !isEsc && <span style={{ background: "#fb923c", color: "#fff", fontSize: 9, fontWeight: 800, padding: "2px 7px", borderRadius: 20 }}>⚠️ CANCEL.</span>}
                        </div>
                        {/* Linha 2: horário + tempo + endereço */}
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 11, color: "#333", fontWeight: 500 }}>{pedido.horario}</span>
                          {tempo && (
                            <span style={{ fontSize: 11, fontWeight: 700, color: tempoUrgente ? "#f87171" : "#2a2a2a", background: tempoUrgente ? "#f8717115" : "transparent", padding: tempoUrgente ? "1px 6px" : "0", borderRadius: 10 }}>
                              {tempo}
                            </span>
                          )}
                          {pedido.endereco && pedido.endereco !== "-" && (
                            <span style={{ fontSize: 11, color: "#2a2a2a" }}>· {pedido.endereco.length > 25 ? pedido.endereco.substring(0, 25) + "..." : pedido.endereco}</span>
                          )}
                        </div>
                      </div>
                      {/* Badge status */}
                      <span style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`, fontSize: 11, fontWeight: 800, padding: "4px 10px", borderRadius: 20, whiteSpace: "nowrap", marginLeft: 8, letterSpacing: 0.2 }}>
                        {isEsc ? "Urgente" : cfg.label}
                      </span>
                    </div>

                    {/* Linha 3: Itens */}
                    <div style={{ marginBottom: 8 }}>
                      {pedido.itens.map((item, i) => (
                        <p key={i} style={{ fontSize: 14, color: ativo ? "#e0e0e0" : "#333", margin: "2px 0", fontWeight: ativo ? 600 : 400, lineHeight: 1.4 }}>
                          {item}
                        </p>
                      ))}
                    </div>

                    {/* Observação */}
                    {pedido.observacao && (
                      <div style={{ background: "#1a1400", border: "1px solid #fbbf2420", borderRadius: 8, padding: "6px 10px", marginBottom: 8, display: "flex", alignItems: "flex-start", gap: 6 }}>
                        <span style={{ fontSize: 12 }}>✏️</span>
                        <p style={{ fontSize: 12, color: "#fbbf24", margin: 0, fontWeight: 500 }}>{pedido.observacao}</p>
                      </div>
                    )}

                    {/* Valor */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <p style={{ fontSize: 18, fontWeight: 900, color: ativo ? "#fff" : "#333", margin: 0, letterSpacing: -0.5 }}>
                        R$ {pedido.total.toFixed(2).replace(".", ",")}
                      </p>
                      {ativo && (
                        <span style={{ fontSize: 11, color: "#333" }}>
                          {pedido.itens.length} item{pedido.itens.length !== 1 ? "ns" : ""}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Ações */}
                  {(ativo || isEsc) && (
                    <div style={{ padding: "0 12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>

                      {/* Urgente */}
                      {isEsc && (
                        <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={() => assumirConversa(pedido.telefone)} style={{ flex: 1, padding: "14px 0", background: "#f87171", color: "#fff", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 800, cursor: "pointer" }}>
                            📱 Atender agora
                          </button>
                          <button onClick={() => marcarResolvido(pedido.telefone, pedido.id)} style={{ flex: 1, padding: "14px 0", background: "#16a34a", color: "#fff", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 800, cursor: "pointer" }}>
                            ✅ Resolvido
                          </button>
                        </div>
                      )}

                      {/* Cancelamento */}
                      {isCanc && !isEsc && (
                        <button onClick={() => confirmarCancelamento(pedido.id)} disabled={atualizando === pedido.id} style={{ width: "100%", padding: "14px 0", background: "#fb923c", color: "#fff", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 800, cursor: "pointer" }}>
                          {atualizando === pedido.id ? "Cancelando..." : "⚠️ Confirmar cancelamento"}
                        </button>
                      )}

                      {/* Botão principal de avanço */}
                      {!isEsc && proxStatus && (
                        <button onClick={() => avancarStatus(pedido.id, proxStatus)} disabled={atualizando === pedido.id} style={{ width: "100%", padding: "15px 0", background: atualizando === pedido.id ? "#222" : cfg.color, color: atualizando === pedido.id ? "#555" : cfg.btnColor, border: "none", borderRadius: 12, fontSize: 15, fontWeight: 900, cursor: atualizando === pedido.id ? "not-allowed" : "pointer", letterSpacing: -0.2, transition: "all 0.15s" }}>
                          {atualizando === pedido.id ? "Atualizando..." : PROXIMO_LABEL[pedido.status]}
                        </button>
                      )}

                      {/* Ações secundárias */}
                      {!isEsc && (
                        <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={() => window.open("https://wa.me/" + pedido.telefone, "_blank")} style={{ flex: 1, padding: "11px 0", background: "#111", color: "#4ade80", border: "1px solid #16a34a25", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                            💬 WhatsApp
                          </button>
                          {emManual ? (
                            <button onClick={() => devolverAoBot(pedido.telefone)} style={{ flex: 1, padding: "11px 0", background: "#111", color: "#60a5fa", border: "1px solid #1d4ed825", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                              🤖 Devolver bot
                            </button>
                          ) : (
                            <button onClick={() => assumirConversa(pedido.telefone)} style={{ flex: 1, padding: "11px 0", background: "#111", color: "#888", border: "1px solid #1e1e1e", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                              📱 Assumir
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}