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
const STATUS_LABEL: Record<Status, string> = {
  novo: "Novo",
  em_preparo: "Preparando",
  saiu_entrega: "Na entrega",
  entregue: "Entregue",
  cancelado: "Cancelado",
}
const STATUS_COR: Record<Status, { bg: string; text: string; border: string; accent: string }> = {
  novo: { bg: "#1a1200", text: "#ffd700", border: "#3a2e00", accent: "#ffd700" },
  em_preparo: { bg: "#1a0d00", text: "#fb923c", border: "#3a1f00", accent: "#fb923c" },
  saiu_entrega: { bg: "#001a3a", text: "#60a5fa", border: "#003380", accent: "#60a5fa" },
  entregue: { bg: "#001a0d", text: "#4ade80", border: "#003319", accent: "#4ade80" },
  cancelado: { bg: "#1a0000", text: "#f87171", border: "#3a0000", accent: "#f87171" },
}
const PROXIMO_STATUS: Record<Status, Status | null> = {
  novo: "em_preparo",
  em_preparo: "saiu_entrega",
  saiu_entrega: "entregue",
  entregue: null,
  cancelado: null,
}
const PROXIMO_LABEL: Record<Status, string> = {
  novo: "🔥 Iniciar preparo",
  em_preparo: "🛵 Saiu para entrega",
  saiu_entrega: "✅ Entrega confirmada",
  entregue: "",
  cancelado: "",
}
function tempoDesde(horario: string): string {
  try {
    const [h, m] = horario.split(":").map(Number)
    const agora = new Date()
    const pedidoTime = new Date()
    pedidoTime.setHours(h, m, 0, 0)
    const diffMs = agora.getTime() - pedidoTime.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1) return "agora"
    if (diffMin < 60) return `${diffMin}min`
    const horas = Math.floor(diffMin / 60)
    const mins = diffMin % 60
    return mins > 0 ? `${horas}h${mins}m` : `${horas}h`
  } catch { return "" }
}
function tocarSom() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    const master = ctx.createGain()
    master.gain.setValueAtTime(0.7, ctx.currentTime)
    master.connect(ctx.destination)
    ;[0, 0.7, 1.4].forEach((startTime) => {
      const osc1 = ctx.createOscillator()
      const osc2 = ctx.createOscillator()
      const gain = ctx.createGain()
      osc1.connect(gain); osc2.connect(gain); gain.connect(master)
      osc1.type = "sine"; osc2.type = "sine"
      osc1.frequency.setValueAtTime(900, ctx.currentTime + startTime)
      osc2.frequency.setValueAtTime(1800, ctx.currentTime + startTime)
      gain.gain.setValueAtTime(0, ctx.currentTime + startTime)
      gain.gain.linearRampToValueAtTime(0.8, ctx.currentTime + startTime + 0.02)
      gain.gain.setValueAtTime(0.6, ctx.currentTime + startTime + 0.1)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startTime + 0.55)
      osc1.start(ctx.currentTime + startTime); osc1.stop(ctx.currentTime + startTime + 0.6)
      osc2.start(ctx.currentTime + startTime); osc2.stop(ctx.currentTime + startTime + 0.6)
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

type Toast = { id: number; message: string; type: 'success' | 'error' | 'warning' | 'info' }

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
  const [agora, setAgora] = useState(new Date())
  const prevIdsRef = useRef<string[]>([])
  const piscarRef = useRef<NodeJS.Timeout | null>(null)
  const tituloOriginalRef = useRef(typeof document !== "undefined" ? document.title : "Cozinha")
  const toastIdRef = useRef(0)

  const addToast = (message: string, type: Toast['type'] = 'success') => {
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
    const relogio = setInterval(() => setAgora(new Date()), 30000)
    return () => {
      clearInterval(intervalo)
      clearInterval(relogio)
      if (piscarRef.current) clearInterval(piscarRef.current)
      document.title = tituloOriginalRef.current
    }
  }, [router])

  const iniciarPiscar = () => {
    if (piscarRef.current) return
    let estado = false
    piscarRef.current = setInterval(() => {
      estado = !estado
      document.title = estado ? "🚨 URGENTE!" : tituloOriginalRef.current
    }, 800)
  }
  const pararPiscar = () => {
    if (piscarRef.current) { clearInterval(piscarRef.current); piscarRef.current = null }
    document.title = tituloOriginalRef.current
  }
  const carregarStatusBot = async () => {
    try {
      const res = await fetch("/api/bot-status")
      if (res.ok) { const data = await res.json(); setBotAtivo(data.ativo) }
    } catch {}
  }
  const alternarBot = async () => {
    setSalvandoBot(true)
    try {
      const novoStatus = !botAtivo
      const res = await fetch("/api/bot-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ativo: novoStatus }) })
      if (res.ok) { setBotAtivo(novoStatus); addToast(novoStatus ? "🤖 Robô atendendo!" : "⏸️ Robô em pausa!", novoStatus ? 'success' : 'warning') }
    } catch {}
    setSalvandoBot(false)
  }
  const assumirConversa = async (phone: string) => {
    try {
      await fetch("/api/bot-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, ativo: false }) })
      setManuais(prev => ({ ...prev, [phone]: true }))
      pararPiscar()
      window.open("https://wa.me/" + phone, "_blank")
    } catch {}
  }
  const devolverAoBot = async (phone: string) => {
    try {
      await fetch("/api/bot-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, ativo: true }) })
      setManuais(prev => ({ ...prev, [phone]: false }))
      addToast("🤖 Robô retomou a conversa", 'info')
    } catch {}
  }
  const marcarResolvido = async (phone: string, pedidoId: string) => {
    try {
      await fetch("/api/resolver", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone }) })
      setManuais(prev => ({ ...prev, [phone]: false }))
      setPedidos(prev => prev.map(p => p.id === pedidoId ? { ...p, escalonado: false, status: "entregue" } : p))
      pararPiscar()
      addToast("✅ Resolvido! Cliente foi notificado.", 'success')
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
              const temEscalonado = chegaram.some((p: Pedido) => p.escalonado)
              const temCancelamento = chegaram.some((p: Pedido) => p.cancelamentoSolicitado)
              if (temEscalonado) { addToast("🚨 URGENTE! Cliente precisa de você!", 'error'); iniciarPiscar() }
              else if (temCancelamento) { addToast("⚠️ Cancelamento solicitado!", 'warning') }
              else { addToast(`🍕 ${chegaram.length} novo${chegaram.length > 1 ? "s" : ""} pedido${chegaram.length > 1 ? "s" : ""}!`, 'success') }
            }
          }
          prevIdsRef.current = novosIds
          setPedidos(data)
          setLoading(false)
          setUltimaAtualizacao(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }))
          const temEscalado = data.some((p: Pedido) => p.escalonado && p.status === "novo")
          if (!temEscalado) pararPiscar()
        }
      })
      .catch(() => setTimeout(carregarPedidos, 3000))
  }
  const avancarStatus = async (id: string, novoStatus: Status) => {
    setAtualizando(id)
    const res = await fetch("/api/orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status: novoStatus }) })
    if (res.ok) {
      setPedidos(prev => prev.map(p => p.id === id ? { ...p, status: novoStatus } : p))
      addToast(`${STATUS_LABEL[novoStatus]}! ✅`, 'success')
    }
    setAtualizando(null)
  }
  const confirmarCancelamento = async (id: string) => {
    setAtualizando(id)
    const res = await fetch("/api/orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status: "cancelado" }) })
    if (res.ok) {
      setPedidos(prev => prev.map(p => p.id === id ? { ...p, status: "cancelado", cancelamentoSolicitado: false } : p))
      addToast("Pedido cancelado", 'warning')
    }
    setAtualizando(null)
  }

  const contagem = (s: Status | "todos") => s === "todos"
    ? pedidos.filter(p => !p.escalonado).length
    : pedidos.filter(p => p.status === s && !p.escalonado).length
  const pedidosFiltrados = (filtro === "todos" ? pedidos : pedidos.filter(p => p.status === filtro)).sort((a, b) => {
    if (a.escalonado && !b.escalonado) return -1
    if (!a.escalonado && b.escalonado) return 1
    if (a.cancelamentoSolicitado && !b.cancelamentoSolicitado) return -1
    return 0
  })
  const ativos = pedidos.filter(p => !["entregue", "cancelado"].includes(p.status) && !p.escalonado).length
  const escalonados = pedidos.filter(p => p.escalonado && p.status === "novo").length
  const eAtivo = (s: Status) => !["entregue", "cancelado"].includes(s)

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#080808", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🍕</div>
        <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 14 }}>Carregando...</p>
      </div>
    </div>
  )

  const toastColors: Record<Toast['type'], string> = {
    success: '#4ade80',
    error: '#f87171',
    warning: '#fb923c',
    info: '#60a5fa',
  }

  return (
    <div style={{ minHeight: "100vh", background: "#080808", paddingBottom: 80, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>

      {/* Toast notifications */}
      <div style={{ position: "fixed", bottom: 24, left: 16, right: 16, zIndex: 9999, display: "flex", flexDirection: "column", gap: 8, pointerEvents: "none" }}>
        {toasts.map(toast => (
          <div key={toast.id} style={{
            background: "rgba(20,20,20,0.96)",
            border: `1px solid ${toastColors[toast.type]}40`,
            borderLeft: `3px solid ${toastColors[toast.type]}`,
            borderRadius: 12,
            padding: "12px 16px",
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            backdropFilter: "blur(20px)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            animation: "slideUp 0.3s ease",
          }}>
            {toast.message}
          </div>
        ))}
      </div>

      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Header */}
      <div style={{ background: "#111", borderBottom: "1px solid #1a1a1a", padding: "14px 16px", position: "sticky", top: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 20 }}>🍕</span>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 800, fontSize: 15, color: "#fff" }}>Cozinha</span>
              {escalonados > 0 && <span style={{ background: "#f87171", color: "#fff", fontSize: 10, fontWeight: 800, padding: "2px 7px", borderRadius: 20 }}>{escalonados} URGENTE</span>}
            </div>
            <p style={{ fontSize: 11, color: "#444", margin: 0 }}>{ativos} ativo{ativos !== 1 ? "s" : ""}{ultimaAtualizacao && ` · ${ultimaAtualizacao}`}</p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {isAdmin && (
            <button onClick={() => window.location.href = "/admin"} style={{ background: "#1a1500", border: "1px solid #3a2e00", color: "#ffd700", borderRadius: 8, padding: "7px 10px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
              👑
            </button>
          )}
          <button onClick={() => fetch("/api/auth/logout", { method: "POST" }).then(() => router.push("/login"))} style={{ background: "#1a1a1a", border: "1px solid #2a2a2a", color: "#666", borderRadius: 8, padding: "7px 10px", cursor: "pointer", fontSize: 12 }}>
            Sair
          </button>
        </div>
      </div>

      <div style={{ padding: "12px 16px 0" }}>

        {/* Toggle robo */}
        <div style={{ background: "#111", border: "1px solid #1a1a1a", borderRadius: 14, padding: "12px 16px", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <p style={{ fontWeight: 700, fontSize: 13, color: "#fff", margin: 0 }}>{botAtivo ? "🤖 Robô atendendo" : "⏸️ Robô pausado"}</p>
            <p style={{ fontSize: 11, color: "#444", margin: "2px 0 0" }}>{botAtivo ? "Respondendo automaticamente" : "Você está no controle"}</p>
          </div>
          <button onClick={alternarBot} disabled={salvandoBot} style={{ position: "relative", width: 48, height: 28, borderRadius: 14, border: "none", cursor: "pointer", background: botAtivo ? "#16a34a" : "#333", transition: "background 0.2s", flexShrink: 0 }}>
            <span style={{ position: "absolute", top: 2, left: botAtivo ? 22 : 2, width: 24, height: 24, borderRadius: "50%", background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.3)" }} />
          </button>
        </div>

        {/* Alerta urgente */}
        {escalonados > 0 && (
          <div style={{ background: "#1a0000", border: "1px solid #f8717140", borderRadius: 14, padding: "12px 16px", marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 20 }}>🚨</span>
            <div>
              <p style={{ fontWeight: 800, color: "#f87171", margin: 0, fontSize: 13 }}>{escalonados} cliente{escalonados > 1 ? "s" : ""} precisando de você AGORA</p>
              <p style={{ fontSize: 11, color: "#f8717180", margin: "2px 0 0" }}>Veja os cards abaixo</p>
            </div>
          </div>
        )}

        {/* Filtros */}
        <div style={{ display: "flex", gap: 6, marginBottom: 14, overflowX: "auto", paddingBottom: 4 }}>
          {([
            { key: "novo", label: "🔥 Novos" },
            { key: "em_preparo", label: "👨‍🍳 Preparo" },
            { key: "saiu_entrega", label: "🛵 Entrega" },
            { key: "entregue", label: "✅ Entregues" },
            { key: "cancelado", label: "❌ Cancelados" },
            { key: "todos", label: "📋 Todos" },
          ] as { key: Status | "todos"; label: string }[]).map(({ key, label }) => {
            const count = contagem(key)
            const ativo = filtro === key
            return (
              <button key={key} onClick={() => setFiltro(key)} style={{ flexShrink: 0, padding: "7px 12px", borderRadius: 20, border: ativo ? "none" : "1px solid #1a1a1a", cursor: "pointer", fontWeight: 700, fontSize: 12, background: ativo ? "#fff" : "#111", color: ativo ? "#000" : "#555", display: "flex", alignItems: "center", gap: 4 }}>
                {label}
                {count > 0 && <span style={{ background: ativo ? "#000" : "#333", color: ativo ? "#fff" : "#aaa", fontSize: 10, fontWeight: 800, padding: "0px 5px", borderRadius: 10 }}>{count}</span>}
              </button>
            )
          })}
        </div>

        {/* Lista */}
        {pedidosFiltrados.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 0" }}>
            <p style={{ fontSize: 36, margin: "0 0 8px" }}>🍕</p>
            <p style={{ fontSize: 14, color: "#333", fontWeight: 600 }}>
              {filtro === "novo" ? "Nenhum pedido novo. Tudo em dia!" : "Nenhum pedido aqui."}
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {pedidosFiltrados.map(pedido => {
              const emManual = manuais[pedido.telefone] === true
              const isEscalonado = pedido.escalonado === true
              const isCancelamento = pedido.cancelamentoSolicitado === true
              const proximoStatus = PROXIMO_STATUS[pedido.status]
              const cor = STATUS_COR[pedido.status]
              const tempo = tempoDesde(pedido.horario)
              const ativo = eAtivo(pedido.status)
              return (
                <div key={pedido.id} style={{ background: "#111", border: `1px solid ${isEscalonado ? "#f8717130" : isCancelamento ? "#fb923c30" : "#1a1a1a"}`, borderRadius: 16, overflow: "hidden", opacity: ativo ? 1 : 0.5 }}>
                  {ativo && <div style={{ height: 3, background: cor.accent, width: "100%" }} />}
                  <div style={{ padding: "14px 16px 10px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 800, fontSize: 15, color: "#fff" }}>{pedido.cliente}</span>
                        {isEscalonado && <span style={{ background: "#f87171", color: "#fff", fontSize: 10, fontWeight: 800, padding: "2px 7px", borderRadius: 20 }}>🚨 URGENTE</span>}
                        {isCancelamento && !isEscalonado && <span style={{ background: "#fb923c", color: "#fff", fontSize: 10, fontWeight: 800, padding: "2px 7px", borderRadius: 20 }}>⚠️ CANCEL.</span>}
                      </div>
                      <p style={{ fontSize: 11, color: "#444", margin: "3px 0 0" }}>
                        {pedido.horario}
                        {tempo && <span style={{ color: pedido.status === "novo" ? "#f87171" : "#333", fontWeight: pedido.status === "novo" ? 700 : 400 }}> · {tempo}</span>}
                        {pedido.endereco && pedido.endereco !== "-" && <span> · {pedido.endereco}</span>}
                      </p>
                    </div>
                    <span style={{ background: cor.bg, color: cor.text, border: `1px solid ${cor.border}`, fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 20, whiteSpace: "nowrap", marginLeft: 8 }}>
                      {isEscalonado ? "Urgente" : STATUS_LABEL[pedido.status]}
                    </span>
                  </div>
                  <div style={{ padding: "0 16px 12px" }}>
                    <p style={{ fontSize: 13, color: ativo ? "#ccc" : "#555", margin: 0, lineHeight: 1.5, fontWeight: ativo ? 500 : 400 }}>{pedido.itens.join(" · ")}</p>
                    {pedido.observacao && (
                      <div style={{ background: "#1a1400", border: "1px solid #3a2e00", borderRadius: 8, padding: "6px 10px", marginTop: 8 }}>
                        <p style={{ fontSize: 12, color: "#fbbf24", margin: 0 }}>✏️ {pedido.observacao}</p>
                      </div>
                    )}
                    <p style={{ fontSize: 16, fontWeight: 800, color: ativo ? "#fff" : "#444", margin: "8px 0 0" }}>
                      R$ {pedido.total.toFixed(2).replace(".", ",")}
                    </p>
                  </div>
                  {(ativo || isEscalonado) && (
                    <div style={{ padding: "10px 16px 14px", borderTop: "1px solid #1a1a1a", display: "flex", flexDirection: "column", gap: 8 }}>
                      {isEscalonado && (
                        <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={() => assumirConversa(pedido.telefone)} style={{ flex: 1, padding: "13px 0", background: "#f87171", color: "#fff", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 800, cursor: "pointer" }}>
                            📱 Atender agora
                          </button>
                          <button onClick={() => marcarResolvido(pedido.telefone, pedido.id)} style={{ flex: 1, padding: "13px 0", background: "#16a34a", color: "#fff", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 800, cursor: "pointer" }}>
                            ✅ Resolvido
                          </button>
                        </div>
                      )}
                      {isCancelamento && !isEscalonado && (
                        <button onClick={() => confirmarCancelamento(pedido.id)} disabled={atualizando === pedido.id} style={{ width: "100%", padding: "13px 0", background: "#fb923c", color: "#fff", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 800, cursor: "pointer" }}>
                          {atualizando === pedido.id ? "Cancelando..." : "⚠️ Confirmar cancelamento"}
                        </button>
                      )}
                      {!isEscalonado && proximoStatus && (
                        <button onClick={() => avancarStatus(pedido.id, proximoStatus)} disabled={atualizando === pedido.id} style={{ width: "100%", padding: "14px 0", background: "#fff", color: "#000", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 800, cursor: "pointer" }}>
                          {atualizando === pedido.id ? "Atualizando..." : PROXIMO_LABEL[pedido.status]}
                        </button>
                      )}
                      {!isEscalonado && (
                        <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={() => window.open("https://wa.me/" + pedido.telefone, "_blank")} style={{ flex: 1, padding: "10px 0", background: "#111", color: "#4ade80", border: "1px solid #16a34a40", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                            💬 WhatsApp
                          </button>
                          {emManual ? (
                            <button onClick={() => devolverAoBot(pedido.telefone)} style={{ flex: 1, padding: "10px 0", background: "#111", color: "#60a5fa", border: "1px solid #1d4ed840", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                              🤖 Devolver bot
                            </button>
                          ) : (
                            <button onClick={() => assumirConversa(pedido.telefone)} style={{ flex: 1, padding: "10px 0", background: "#111", color: "#f87171", border: "1px solid #f8717140", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
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