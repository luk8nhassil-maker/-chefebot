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
const STATUS_COR: Record<Status, { bg: string; text: string; border: string }> = {
  novo: { bg: "#fff8e6", text: "#b45309", border: "#fcd34d" },
  em_preparo: { bg: "#fff3e6", text: "#c2410c", border: "#fb923c" },
  saiu_entrega: { bg: "#eff6ff", text: "#1d4ed8", border: "#93c5fd" },
  entregue: { bg: "#f0fdf4", text: "#15803d", border: "#86efac" },
  cancelado: { bg: "#fef2f2", text: "#dc2626", border: "#fca5a5" },
}
const PROXIMO_STATUS: Record<Status, Status | null> = {
  novo: "em_preparo",
  em_preparo: "saiu_entrega",
  saiu_entrega: "entregue",
  entregue: null,
  cancelado: null,
}
const PROXIMO_LABEL: Record<Status, string> = {
  novo: "🔥 Começar a preparar",
  em_preparo: "🛵 Saiu para entregar",
  saiu_entrega: "✅ Confirmar entrega",
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
    if (diffMin < 60) return `há ${diffMin} min`
    const horas = Math.floor(diffMin / 60)
    const mins = diffMin % 60
    return mins > 0 ? `há ${horas}h ${mins}min` : `há ${horas}h`
  } catch {
    return ""
  }
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
export default function PedidosPage() {
  const router = useRouter()
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [filtro, setFiltro] = useState<Status | "todos">("todos")
  const [loading, setLoading] = useState(true)
  const [userName, setUserName] = useState("")
  const [isAdmin, setIsAdmin] = useState(false)
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState("")
  const [erro, setErro] = useState("")
  const [atualizando, setAtualizando] = useState<string | null>(null)
  const [notificacao, setNotificacao] = useState("")
  const [botAtivo, setBotAtivo] = useState(true)
  const [salvandoBot, setSalvandoBot] = useState(false)
  const [manuais, setManuais] = useState<Record<string, boolean>>({})
  const [resolvendo, setResolvendo] = useState<Record<string, boolean>>({})
  const [agora, setAgora] = useState(new Date())
  const prevIdsRef = useRef<string[]>([])
  const piscarRef = useRef<NodeJS.Timeout | null>(null)
  const tituloOriginalRef = useRef(typeof document !== "undefined" ? document.title : "Cozinha")

  useEffect(() => {
    const user = getUserInfo()
    if (user) { setUserName(user.name); setIsAdmin(user.role === "admin" || user.role === "dev") }
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
      if (res.ok) { setBotAtivo(novoStatus); setNotificacao(novoStatus ? "🤖 Robô atendendo!" : "⏸️ Robô em pausa!"); setTimeout(() => setNotificacao(""), 3000) }
    } catch {}
    setSalvandoBot(false)
  }
  const assumirConversa = async (phone: string) => {
    try {
      await fetch("/api/bot-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, ativo: false }) })
      setManuais(prev => ({ ...prev, [phone]: true }))
      setNotificacao("📱 Abrindo WhatsApp..."); setTimeout(() => setNotificacao(""), 3000)
      pararPiscar()
      window.open("https://wa.me/" + phone, "_blank")
    } catch {}
  }
  const devolverAoBot = async (phone: string) => {
    try {
      await fetch("/api/bot-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, ativo: true }) })
      setManuais(prev => ({ ...prev, [phone]: false }))
      setNotificacao("🤖 Robô retomou a conversa"); setTimeout(() => setNotificacao(""), 3000)
    } catch {}
  }
  const marcarResolvido = async (phone: string, pedidoId: string) => {
    try {
      await fetch("/api/resolver", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone }) })
      setResolvendo(prev => ({ ...prev, [phone]: true }))
      setManuais(prev => ({ ...prev, [phone]: false }))
      setPedidos(prev => prev.map(p => p.id === pedidoId ? { ...p, escalonado: false, status: "entregue" } : p))
      pararPiscar()
      setNotificacao("✅ Resolvido! Cliente foi notificado."); setTimeout(() => setNotificacao(""), 4000)
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
              if (temEscalonado) { setNotificacao("🚨 URGENTE! Cliente precisa de você!"); iniciarPiscar() }
              else if (temCancelamento) { setNotificacao("⚠️ Cancelamento solicitado!"); setTimeout(() => setNotificacao(""), 5000) }
              else { setNotificacao(`🍕 ${chegaram.length} novo${chegaram.length > 1 ? "s" : ""} pedido${chegaram.length > 1 ? "s" : ""}!`); setTimeout(() => setNotificacao(""), 4000) }
            }
          }
          prevIdsRef.current = novosIds
          setPedidos(data)
          setLoading(false)
          setErro("")
          setUltimaAtualizacao(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }))
          const temEscalado = data.some((p: Pedido) => p.escalonado && p.status === "novo")
          if (!temEscalado) pararPiscar()
        }
      })
      .catch(() => setErro("Erro ao carregar. Tentando novamente..."))
  }
  const avancarStatus = async (id: string, novoStatus: Status) => {
    setAtualizando(id)
    const res = await fetch("/api/orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status: novoStatus }) })
    if (res.ok) {
      setPedidos(prev => prev.map(p => p.id === id ? { ...p, status: novoStatus } : p))
      setUltimaAtualizacao(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }))
    }
    setAtualizando(null)
  }
  const confirmarCancelamento = async (id: string) => {
    setAtualizando(id)
    const res = await fetch("/api/orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status: "cancelado" }) })
    if (res.ok) {
      setPedidos(prev => prev.map(p => p.id === id ? { ...p, status: "cancelado", cancelamentoSolicitado: false } : p))
      setNotificacao("Pedido cancelado!"); setTimeout(() => setNotificacao(""), 4000)
    }
    setAtualizando(null)
  }
  const contagem = (s: Status | "todos") => s === "todos" ? pedidos.filter(p => !p.escalonado).length : pedidos.filter(p => p.status === s && !p.escalonado).length
  const pedidosFiltrados = (filtro === "todos" ? pedidos : pedidos.filter(p => p.status === filtro)).sort((a, b) => {
    if (a.escalonado && !b.escalonado) return -1
    if (!a.escalonado && b.escalonado) return 1
    if (a.cancelamentoSolicitado && !b.cancelamentoSolicitado) return -1
    return 0
  })
  const ativos = pedidos.filter(p => !["entregue", "cancelado"].includes(p.status) && !p.escalonado).length
  const escalonados = pedidos.filter(p => p.escalonado && p.status === "novo").length
  const cancelamentos = pedidos.filter(p => p.cancelamentoSolicitado && p.status !== "cancelado").length

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#111", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: "#fff" }}>Carregando...</p>
    </div>
  )
  return (
    <div style={{ minHeight: "100vh", background: "#f8f8f8", paddingBottom: 32 }}>
      {notificacao && (
        <div style={{ position: "fixed", top: 16, left: 16, right: 16, zIndex: 9999, background: notificacao.includes("URGENTE") ? "#dc2626" : notificacao.includes("⚠️") ? "#ea580c" : "#16a34a", color: "#fff", padding: "14px 16px", borderRadius: 14, fontWeight: 700, fontSize: 15, textAlign: "center", boxShadow: "0 4px 20px rgba(0,0,0,0.2)" }}>
          {notificacao}
        </div>
      )}

      <div style={{ background: "#fff", borderBottom: "1px solid #eee", padding: "12px 16px", position: "sticky", top: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 22 }}>🍕</span>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 800, fontSize: 16, color: "#111" }}>Cozinha</span>
              {escalonados > 0 && <span style={{ background: "#dc2626", color: "#fff", fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 20 }}>{escalonados} URGENTE</span>}
              {cancelamentos > 0 && <span style={{ background: "#ea580c", color: "#fff", fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 20 }}>{cancelamentos} CANCEL.</span>}
            </div>
            <p style={{ fontSize: 11, color: "#999", margin: 0 }}>{ativos} ativo{ativos !== 1 ? "s" : ""} {ultimaAtualizacao && `· ${ultimaAtualizacao}`}</p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {isAdmin && (
            <button onClick={() => { window.location.href = "/admin" }} style={{ background: "rgba(255,215,0,0.15)", border: "1px solid rgba(255,215,0,0.5)", color: "#b45309", borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
              👑
            </button>
          )}
          <button onClick={() => fetch("/api/auth/logout", { method: "POST" }).then(() => router.push("/login"))} style={{ background: "#f5f5f5", border: "1px solid #eee", color: "#666", borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontSize: 12 }}>
            Sair
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 600, margin: "0 auto", padding: "12px 12px 0" }}>

        {erro && <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 12, padding: "10px 14px", marginBottom: 12, fontSize: 13, color: "#dc2626" }}>{erro}</div>}

        {escalonados > 0 && (
          <div style={{ background: "#fef2f2", border: "2px solid #dc2626", borderRadius: 14, padding: "14px 16px", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 24 }}>🚨</span>
              <div>
                <p style={{ fontWeight: 800, color: "#dc2626", margin: 0, fontSize: 14 }}>{escalonados} cliente{escalonados > 1 ? "s" : ""} precisando de você AGORA!</p>
                <p style={{ fontSize: 12, color: "#ef4444", margin: "2px 0 0" }}>Veja os cards vermelhos abaixo</p>
              </div>
            </div>
          </div>
        )}

        <div style={{ background: botAtivo ? "#f0fdf4" : "#fef2f2", border: `1px solid ${botAtivo ? "#86efac" : "#fca5a5"}`, borderRadius: 14, padding: "12px 16px", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <p style={{ fontWeight: 700, fontSize: 14, color: "#111", margin: 0 }}>{botAtivo ? "🤖 Robô atendendo" : "⏸️ Robô em pausa"}</p>
            <p style={{ fontSize: 12, color: "#666", margin: "2px 0 0" }}>{botAtivo ? "Nenhum cliente fica sem resposta" : "Você está no controle"}</p>
          </div>
          <button onClick={alternarBot} disabled={salvandoBot} style={{ position: "relative", width: 52, height: 30, borderRadius: 15, border: "none", cursor: salvandoBot ? "not-allowed" : "pointer", background: botAtivo ? "#16a34a" : "#ef4444", transition: "background 0.2s", flexShrink: 0 }}>
            <span style={{ position: "absolute", top: 3, left: botAtivo ? 25 : 3, width: 24, height: 24, borderRadius: "50%", background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.2)" }} />
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 14, overflowX: "auto", paddingBottom: 4 }}>
          {(["todos", "novo", "em_preparo", "saiu_entrega", "entregue", "cancelado"] as const).map(s => {
            const count = contagem(s)
            const labels: Record<string, string> = { todos: "Todos", novo: "Novos", em_preparo: "Preparo", saiu_entrega: "Entrega", entregue: "Entregues", cancelado: "Cancelados" }
            const ativo = filtro === s
            return (
              <button key={s} onClick={() => setFiltro(s)} style={{ flexShrink: 0, padding: "7px 14px", borderRadius: 20, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 13, background: ativo ? "#dc2626" : "#fff", color: ativo ? "#fff" : "#666", boxShadow: ativo ? "0 2px 8px rgba(220,38,38,0.3)" : "0 1px 3px rgba(0,0,0,0.08)", display: "flex", alignItems: "center", gap: 5 }}>
                {labels[s]}
                {count > 0 && <span style={{ background: ativo ? "#fff" : "#dc2626", color: ativo ? "#dc2626" : "#fff", fontSize: 11, fontWeight: 800, padding: "1px 6px", borderRadius: 10 }}>{count}</span>}
              </button>
            )
          })}
        </div>

        {pedidosFiltrados.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 0", color: "#bbb" }}>
            <p style={{ fontSize: 40, margin: "0 0 8px" }}>🍕</p>
            <p style={{ fontSize: 15, fontWeight: 600 }}>Tudo tranquilo por aqui. 🍕</p>
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
              return (
                <div key={pedido.id} style={{ background: isEscalonado ? "#fef2f2" : isCancelamento ? "#fff7ed" : "#fff", border: `2px solid ${isEscalonado ? "#dc2626" : isCancelamento ? "#ea580c" : cor.border}`, borderRadius: 16, overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                  <div style={{ padding: "14px 16px 10px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 800, fontSize: 16, color: "#111" }}>{pedido.cliente}</span>
                        {isEscalonado && <span style={{ background: "#dc2626", color: "#fff", fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 20 }}>🚨 URGENTE</span>}
                        {isCancelamento && !isEscalonado && <span style={{ background: "#ea580c", color: "#fff", fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 20 }}>⚠️ CANCELAMENTO</span>}
                      </div>
                      <p style={{ fontSize: 12, color: "#888", margin: "3px 0 0" }}>
                        {pedido.horario}
                        {tempo && <span style={{ color: pedido.status === "novo" ? "#dc2626" : "#aaa", fontWeight: pedido.status === "novo" ? 700 : 400 }}> · {tempo}</span>}
                        {" · "}{pedido.endereco}
                      </p>
                    </div>
                    <span style={{ background: isEscalonado ? "#dc2626" : cor.bg, color: isEscalonado ? "#fff" : cor.text, border: `1px solid ${isEscalonado ? "#dc2626" : cor.border}`, fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 20, whiteSpace: "nowrap", marginLeft: 8 }}>
                      {isEscalonado ? "Urgente" : STATUS_LABEL[pedido.status]}
                    </span>
                  </div>
                  <div style={{ padding: "0 16px 10px" }}>
                    <p style={{ fontSize: 13, color: "#444", margin: 0, lineHeight: 1.5 }}>{pedido.itens.join(" · ")}</p>
                    {pedido.observacao && (
                      <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, padding: "6px 10px", marginTop: 8 }}>
                        <p style={{ fontSize: 12, color: "#92400e", margin: 0 }}>✏️ {pedido.observacao}</p>
                      </div>
                    )}
                    <p style={{ fontSize: 18, fontWeight: 800, color: "#111", margin: "8px 0 0" }}>R$ {pedido.total.toFixed(2).replace(".", ",")}</p>
                  </div>
                  <div style={{ padding: "10px 16px 14px", borderTop: "1px solid #f0f0f0", display: "flex", flexDirection: "column", gap: 8 }}>
                    {isEscalonado && (
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => assumirConversa(pedido.telefone)} style={{ flex: 1, padding: "13px 0", background: "#dc2626", color: "#fff", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 800, cursor: "pointer" }}>
                          📱 Atender agora
                        </button>
                        <button onClick={() => marcarResolvido(pedido.telefone, pedido.id)} style={{ flex: 1, padding: "13px 0", background: "#16a34a", color: "#fff", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 800, cursor: "pointer" }}>
                          ✅ Resolvido
                        </button>
                      </div>
                    )}
                    {isCancelamento && !isEscalonado && (
                      <button onClick={() => confirmarCancelamento(pedido.id)} disabled={atualizando === pedido.id} style={{ width: "100%", padding: "13px 0", background: "#ea580c", color: "#fff", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 800, cursor: atualizando === pedido.id ? "not-allowed" : "pointer", opacity: atualizando === pedido.id ? 0.7 : 1 }}>
                        {atualizando === pedido.id ? "Cancelando..." : "⚠️ Confirmar cancelamento"}
                      </button>
                    )}
                    {!isEscalonado && proximoStatus && (
                      <button onClick={() => avancarStatus(pedido.id, proximoStatus)} disabled={atualizando === pedido.id} style={{ width: "100%", padding: "13px 0", background: "#dc2626", color: "#fff", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 800, cursor: atualizando === pedido.id ? "not-allowed" : "pointer", opacity: atualizando === pedido.id ? 0.7 : 1 }}>
                        {atualizando === pedido.id ? "Atualizando..." : PROXIMO_LABEL[pedido.status]}
                      </button>
                    )}
                    {!isEscalonado && (
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => window.open("https://wa.me/" + pedido.telefone, "_blank")} style={{ flex: 1, padding: "10px 0", background: "#f0fdf4", color: "#16a34a", border: "1px solid #86efac", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                          💬 Abrir conversa
                        </button>
                        {emManual ? (
                          <button onClick={() => devolverAoBot(pedido.telefone)} style={{ flex: 1, padding: "10px 0", background: "#eff6ff", color: "#1d4ed8", border: "1px solid #93c5fd", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                            🤖 Devolver ao bot
                          </button>
                        ) : (
                          <button onClick={() => assumirConversa(pedido.telefone)} style={{ flex: 1, padding: "10px 0", background: "#fef2f2", color: "#dc2626", border: "1px solid #fca5a5", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                            📱 Assumir conversa
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}