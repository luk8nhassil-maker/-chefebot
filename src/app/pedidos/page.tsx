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
  pagamento?: string
  troco?: string
  pixConfirmado?: boolean
  tipoEntrega?: string
  horarioInicio?: string
}

const NEXT_STATUS: Record<Status, Status | null> = {
  novo: "em_preparo",
  em_preparo: "saiu_entrega",
  saiu_entrega: "entregue",
  entregue: null,
  cancelado: null,
}

const ACTION_LABEL: Record<Status, string> = {
  novo: "Começar a fazer",
  em_preparo: "Saiu para entrega",
  saiu_entrega: "Confirmar entrega",
  entregue: "",
  cancelado: "",
}

const BADGE_CFG: Record<Status, { bg: string; fg: string; label: string; cardBorder: string; stepBg: string; stepFg: string; stepBorder: string; stepCountFg: string; ctaBg: string; ctaFg: string }> = {
  novo:         { bg: "#ff6b00",               fg: "#060606", label: "Novo",      cardBorder: "1.5px solid rgba(255,107,0,.75)",  stepBg: "#ff6b00",              stepFg: "#060606", stepBorder: "#ff6b00",              stepCountFg: "#060606", ctaBg: "#ff6b00",    ctaFg: "#060606" },
  em_preparo:   { bg: "rgba(250,204,21,.18)",   fg: "#facc15", label: "Fazendo",   cardBorder: "1.5px solid rgba(250,204,21,.4)", stepBg: "rgba(250,204,21,.15)", stepFg: "#facc15", stepBorder: "rgba(250,204,21,.5)",   stepCountFg: "#facc15", ctaBg: "#facc15",    ctaFg: "#060606" },
  saiu_entrega: { bg: "rgba(96,165,250,.18)",   fg: "#60a5fa", label: "Na rua",    cardBorder: "1.5px solid rgba(96,165,250,.4)", stepBg: "rgba(96,165,250,.15)", stepFg: "#60a5fa", stepBorder: "rgba(96,165,250,.5)",   stepCountFg: "#60a5fa", ctaBg: "#60a5fa",    ctaFg: "#060606" },
  entregue:     { bg: "rgba(34,197,94,.18)",    fg: "#22c55e", label: "Entregue",  cardBorder: "1px solid #1f1d1a",               stepBg: "rgba(34,197,94,.15)",  stepFg: "#22c55e", stepBorder: "rgba(34,197,94,.5)",    stepCountFg: "#22c55e", ctaBg: "#22c55e",    ctaFg: "#060606" },
  cancelado:    { bg: "rgba(239,68,68,.18)",    fg: "#ef4444", label: "Cancelado", cardBorder: "1.5px solid rgba(239,68,68,.4)",  stepBg: "rgba(239,68,68,.15)",  stepFg: "#ef4444", stepBorder: "rgba(239,68,68,.5)",    stepCountFg: "#ef4444", ctaBg: "#ef4444",    ctaFg: "#fff" },
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
        return JSON.parse(decoded)
      }
    }
  } catch {}
  return null
}

function tempoDesde(horario: string, horarioInicio?: string, now?: number): number {
  try {
    const base = horarioInicio || horario
    const [h, m] = base.split(":").map(Number)
    const agora = now ? new Date(now) : new Date()
    const t = new Date(agora); t.setHours(h, m, 0, 0)
    return Math.max(0, Math.floor((agora.getTime() - t.getTime()) / 60000))
  } catch { return 0 }
}

function timerDash(mins: number, meta: number = 40): { dash: number; color: string } {
  const CIRC = 163.4
  const progress = Math.min(mins / meta, 1)
  const color = progress < 0.5 ? "#22c55e" : progress < 0.85 ? "#facc15" : "#ef4444"
  return { dash: CIRC * (1 - progress), color }
}

export default function PedidosPage() {
  const router = useRouter()
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [filtro, setFiltro] = useState<Status | "todos">("novo")
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [userName, setUserName] = useState("Kellyne")
  const [botAtivo, setBotAtivo] = useState(true)
  const [salvandoBot, setSalvandoBot] = useState(false)
  const [atualizando, setAtualizando] = useState<string | null>(null)
  const [manuais, setManuais] = useState<Record<string, boolean>>({})
  const [detailId, setDetailId] = useState<string | null>(null)
  const [cardUrgenciaFechado, setCardUrgenciaFechado] = useState(false)
  const [toast, setToast] = useState<{ text: string; expires: number; pedidoId: string; prevStatus: Status } | null>(null)
  const [now, setNow] = useState(Date.now())
  const [leavingId, setLeavingId] = useState<string | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  const [entregadores, setEntregadores] = useState<{id: string; nome: string; telefone: string; ativo: boolean}[]>([])
  const [modalEntrega, setModalEntrega] = useState<{pedidoId: string; proxStatus: Status} | null>(null)

  const prevIdsRef = useRef<string[]>([])
  const piscarRef = useRef<NodeJS.Timeout | null>(null)
  const somRepetidoRef = useRef<NodeJS.Timeout | null>(null)
  const tituloOriginalRef = useRef(typeof document !== "undefined" ? document.title : "Pedidos")
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null)
  const flashTimerRef = useRef<NodeJS.Timeout | null>(null)
  const leaveTimerRef = useRef<NodeJS.Timeout | null>(null)

  const tocarSom = () => {
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext
      const ctx = new Ctx()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.type = "sine"
      osc.frequency.setValueAtTime(880, ctx.currentTime)
      osc.frequency.setValueAtTime(1175, ctx.currentTime + 0.13)
      gain.gain.setValueAtTime(0.18, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55)
      osc.start(); osc.stop(ctx.currentTime + 0.55)
    } catch {}
    if (navigator.vibrate) navigator.vibrate([120, 60, 120])
  }

  const iniciarPiscar = () => {
    if (piscarRef.current) return
    let e = false
    piscarRef.current = setInterval(() => { e = !e; document.title = e ? "🚨 URGENTE!" : tituloOriginalRef.current }, 800)
  }
  const pararPiscar = () => {
    if (piscarRef.current) { clearInterval(piscarRef.current); piscarRef.current = null }
    document.title = tituloOriginalRef.current
  }
  const iniciarSomRepetido = () => {
    if (somRepetidoRef.current) return
    somRepetidoRef.current = setInterval(() => tocarSom(), 3000)
  }
  const pararSomRepetido = () => {
    if (somRepetidoRef.current) { clearInterval(somRepetidoRef.current); somRepetidoRef.current = null }
  }

  const carregarStatusBot = async () => {
    try { const r = await fetch("/api/bot-status"); if (r.ok) { const d = await r.json(); setBotAtivo(d.ativo) } } catch {}
  }

  const carregarPedidos = () => {
    fetch("/api/orders")
      .then(r => { if (r.status === 401) { fetch("/api/auth/logout", { method: "POST" }).finally(() => router.push("/login?callbackUrl=/pedidos")); return null } return r.json() })
      .then(data => {
        if (data) {
          const novosIds = data.map((p: Pedido) => p.id)
          const anteriores = prevIdsRef.current
          if (anteriores.length > 0) {
            const chegaram = data.filter((p: Pedido) => !anteriores.includes(p.id))
            if (chegaram.length > 0) {
              const temEsc = chegaram.some((p: Pedido) => p.escalonado)
              tocarSom()
              if (temEsc) { iniciarPiscar(); iniciarSomRepetido() }
            }
          }
          prevIdsRef.current = novosIds
          setPedidos(data)
          setLoading(false)
          if (!data.some((p: Pedido) => p.escalonado && p.status === "novo")) { pararPiscar(); pararSomRepetido() }
        }
      })
      .catch(() => setTimeout(carregarPedidos, 3000))
  }

  useEffect(() => {
    const user = getUserInfo()
    if (user) {
      setIsAdmin(user.role === "admin" || user.role === "dev")
      setUserName(user.name || "Kellyne")
    }
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission()
    carregarPedidos()
    carregarStatusBot()
    fetch("/api/entregadores").then(r => r.json()).then(d => setEntregadores(Array.isArray(d) ? d.filter((e: any) => e.ativo) : [])).catch(() => {})
    const intervalo = setInterval(carregarPedidos, 10000)
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      clearInterval(intervalo)
      clearInterval(tick)
      if (piscarRef.current) clearInterval(piscarRef.current)
      if (somRepetidoRef.current) clearInterval(somRepetidoRef.current)
      document.title = tituloOriginalRef.current
    }
  }, [router])

  const alternarBot = async () => {
    setSalvandoBot(true)
    try {
      const novo = !botAtivo
      const r = await fetch("/api/bot-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ativo: novo }) })
      if (r.ok) setBotAtivo(novo)
    } catch {}
    setSalvandoBot(false)
  }

  const assumirConversa = async (phone: string) => {
    try {
      await fetch("/api/assumir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone }) })
      setManuais(prev => ({ ...prev, [phone]: true }))
    } catch {}
  }

  const devolverAoBot = async (phone: string) => {
    try {
      await fetch("/api/devolver", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone }) })
      setManuais(prev => ({ ...prev, [phone]: false }))
    } catch {}
  }

  const marcarResolvido = async (phone: string, pedidoId: string) => {
    try {
      await fetch("/api/resolver", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone }) })
      setManuais(prev => ({ ...prev, [phone]: false }))
      setPedidos(prev => prev.map(p => p.id === pedidoId ? { ...p, escalonado: false, status: "entregue" } : p))
      pararPiscar()
    } catch {}
  }

  const avancarStatus = async (id: string, novoStatus: Status, entregador?: {id: string; nome: string; telefone: string}) => {
    const pedido = pedidos.find(p => p.id === id)
    if (!pedido) return
    const prevStatus = pedido.status

    // Animação de saída se o filtro é do status atual
    const F2S: Record<string, Status> = { novo: "novo", em_preparo: "em_preparo", saiu_entrega: "saiu_entrega", entregue: "entregue" }
    const willLeave = filtro !== "todos" && F2S[filtro] === prevStatus

    setAtualizando(id)
    const r = await fetch("/api/orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status: novoStatus, entregador }) })
    if (r.ok) {
      setPedidos(prev => prev.map(p => p.id === id ? { ...p, status: novoStatus } : p))

      if (willLeave) {
        setLeavingId(id)
        if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current)
        leaveTimerRef.current = setTimeout(() => setLeavingId(null), 350)
      } else {
        setFlashId(id)
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
        flashTimerRef.current = setTimeout(() => setFlashId(null), 750)
      }

      const firstName = pedido.cliente.split(" ")[0]
      const novoLabel = BADGE_CFG[novoStatus].label
      setToast({ text: `${firstName} → ${novoLabel}`, expires: Date.now() + 5000, pedidoId: id, prevStatus })
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
      toastTimerRef.current = setTimeout(() => setToast(null), 5000)
    }
    setModalEntrega(null)
    setAtualizando(null)
  }

  const desfazerToast = () => {
    if (!toast) return
    setPedidos(prev => prev.map(p => p.id === toast.pedidoId ? { ...p, status: toast.prevStatus } : p))
    fetch("/api/orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: toast.pedidoId, status: toast.prevStatus }) })
    setToast(null)
    setFlashId(null)
  }

  // Dados derivados
  const escalonados = pedidos.filter(p => p.escalonado && p.status === "novo")
  const emAberto = pedidos.filter(p => !["entregue", "cancelado"].includes(p.status)).length
  const totalHoje = pedidos.length

  const contagemPorStatus = (s: Status) => pedidos.filter(p => p.status === s).length

  const pedidosFiltrados = (filtro === "todos" ? pedidos : pedidos.filter(p => p.status === filtro))
    .sort((a, b) => {
      if (a.escalonado && !b.escalonado) return -1
      if (!a.escalonado && b.escalonado) return 1
      if (a.cancelamentoSolicitado && !b.cancelamentoSolicitado) return -1
      return 0
    })

  const detalhePedido = pedidos.find(p => p.id === detailId) || null

  const toastSegs = toast ? Math.max(0, Math.ceil((toast.expires - now) / 1000)) : 0
  const toastVisible = !!toast && toast.expires > now

  // Avaliação média (mock por ora)
  const avaliacaoMedia = "4,9"

  const steps = [
    { key: "novo" as Status,         stepLabel: "Novos",   count: contagemPorStatus("novo"),         ...BADGE_CFG["novo"] },
    { key: "em_preparo" as Status,   stepLabel: "Fazendo", count: contagemPorStatus("em_preparo"),   ...BADGE_CFG["em_preparo"] },
    { key: "saiu_entrega" as Status, stepLabel: "Na rua",  count: contagemPorStatus("saiu_entrega"), ...BADGE_CFG["saiu_entrega"] },
    { key: "entregue" as Status,     stepLabel: "Prontos", count: contagemPorStatus("entregue"),     ...BADGE_CFG["entregue"] },
  ]

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#060606", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>🍕</div>
        <p style={{ color: "#a39b8b", fontSize: 14, fontFamily: "'Archivo', sans-serif" }}>Carregando...</p>
      </div>
    </div>
  )

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800;900&display=swap');
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        html, body { margin: 0; padding: 0; background: #060606; }
        button { cursor: pointer; font-family: 'Archivo', sans-serif; }
        @keyframes cbPulse {
          0% { box-shadow: 0 0 0 0 rgba(34,197,94,.55); }
          70% { box-shadow: 0 0 0 7px rgba(34,197,94,0); }
          100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); }
        }
        @keyframes cbRedPulse {
          0% { box-shadow: 0 0 0 0 rgba(239,68,68,.5); }
          70% { box-shadow: 0 0 0 7px rgba(239,68,68,0); }
          100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); }
        }
        @keyframes cbUrgentGlow {
          0%, 100% { border-color: rgba(239,68,68,.45); }
          50% { border-color: rgba(239,68,68,.9); }
        }
        @keyframes cbNewGlow {
          0% { box-shadow: 0 0 0 0 rgba(255,107,0,.4); }
          70% { box-shadow: 0 0 0 10px rgba(255,107,0,0); }
          100% { box-shadow: 0 0 0 0 rgba(255,107,0,0); }
        }
        @keyframes cbCardIn {
          from { opacity: 0; transform: translateY(16px) scale(.97); }
          to { opacity: 1; transform: none; }
        }
        @keyframes cbCardOut {
          to { opacity: 0; transform: translateX(48px) scale(.96); }
        }
        @keyframes cbFlash {
          0% { transform: scale(1); }
          30% { transform: scale(1.012); box-shadow: 0 0 0 3px rgba(255,107,0,.55); }
          100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255,107,0,0); }
        }
        @keyframes cbToastIn {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: none; }
        }
        @keyframes cbSheetUp {
          from { transform: translateY(100%); }
          to { transform: none; }
        }
        @keyframes cbFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes cbCancelGlow {
          0%, 100% { border-color: rgba(239,68,68,.3); }
          50% { border-color: rgba(239,68,68,.7); }
        }
      `}</style>

      <div style={{ minHeight: "100vh", maxWidth: 375, margin: "0 auto", background: "#060606", color: "#f5f2ee", fontFamily: "'Archivo', sans-serif", display: "flex", flexDirection: "column", paddingBottom: 90 }}>

        {/* Header */}
        <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "18px 16px 12px" }}>
          <div style={{ position: "relative", width: 48, height: 48, flexShrink: 0 }}>
            <div style={{ width: 48, height: 48, borderRadius: "50%", background: "linear-gradient(135deg,#ff6b00,#ff9a3d)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 18, color: "#060606", letterSpacing: "-0.5px" }}>
              {userName.slice(0, 2).toUpperCase()}
            </div>
            <span style={{ position: "absolute", right: 0, bottom: 0, width: 13, height: 13, borderRadius: "50%", background: "#22c55e", border: "3px solid #060606", animation: "cbPulse 2s infinite" }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-0.6px", lineHeight: 1.1 }}>Oi, {userName.split(" ")[0]}</div>
            <div style={{ fontSize: 12, color: "#5a564d", fontWeight: 600, marginTop: 2 }}>Alto Alegre · ChefeBot</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {isAdmin && (
              <button onClick={() => router.push("/admin")} style={{ fontSize: 11, fontWeight: 800, color: "#a39b8b", background: "transparent", border: "1px solid #242220", padding: "6px 10px", borderRadius: 20 }}>Admin</button>
            )}
            <button onClick={() => fetch("/api/auth/logout", { method: "POST" }).then(() => router.push("/login"))} style={{ fontSize: 11, fontWeight: 800, color: "#5a564d", background: "transparent", border: "1px solid #1f1d1a", padding: "6px 10px", borderRadius: 20 }}>Sair</button>
          </div>
        </header>

        {/* Bot toggle */}
        <button onClick={alternarBot} disabled={salvandoBot} style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 16px", padding: "13px 14px", background: botAtivo ? "rgba(34,197,94,.06)" : "rgba(250,204,21,.06)", border: `1px solid ${botAtivo ? "rgba(34,197,94,.28)" : "rgba(250,204,21,.3)"}`, borderRadius: 14, color: "#f5f2ee", textAlign: "left" }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: botAtivo ? "#22c55e" : "#facc15", flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 900, letterSpacing: "-0.2px", color: "#f5f2ee" }}>{botAtivo ? "Bot atendendo" : "Bot pausado"}</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: botAtivo ? "#22c55e" : "#facc15", marginTop: 2 }}>{botAtivo ? "WhatsApp conectado" : "Você no comando"}</div>
          </div>
          <span style={{ fontSize: 12, fontWeight: 800, color: botAtivo ? "#22c55e" : "#facc15", background: "#060606", padding: "6px 12px", borderRadius: 10, flexShrink: 0 }}>{botAtivo ? "Pausar" : "Ativar"}</span>
        </button>

        {/* Métricas */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr 1fr", gap: 8, padding: "14px 16px 6px" }}>
          <div style={{ background: "#101010", border: "1px solid #1f1d1a", borderRadius: 16, padding: "14px 12px", display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 26, fontWeight: 900, letterSpacing: "-1px", lineHeight: 1, color: "#f5f2ee" }}>{totalHoje}</span>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: "#5a564d", textTransform: "uppercase", letterSpacing: ".5px" }}>Hoje</span>
          </div>
          <div style={{ background: "#1a0d00", border: "1.5px solid rgba(255,107,0,.5)", borderRadius: 16, padding: "14px 12px", display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 34, fontWeight: 900, letterSpacing: "-1.5px", lineHeight: 1, color: "#ff6b00" }}>{emAberto}</span>
            <span style={{ fontSize: 10.5, fontWeight: 800, color: "#ff6b00", textTransform: "uppercase", letterSpacing: ".5px", opacity: 0.7 }}>Em aberto</span>
          </div>
          <div style={{ background: "#101010", border: "1px solid #1f1d1a", borderRadius: 16, padding: "14px 12px", display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 26, fontWeight: 900, letterSpacing: "-1px", lineHeight: 1, color: "#facc15" }}>{avaliacaoMedia}</span>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: "#5a564d", textTransform: "uppercase", letterSpacing: ".5px" }}>★ Média</span>
          </div>
        </div>

        {/* Banner urgência */}
        {escalonados.length > 0 && !cardUrgenciaFechado && (
          <div style={{ margin: "8px 16px 0", padding: 16, borderRadius: 18, background: "rgba(239,68,68,.08)", border: "1.5px solid rgba(239,68,68,.45)", animation: "cbUrgentGlow 1.6s infinite", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#ef4444", animation: "cbRedPulse 1.6s infinite" }} />
              <span style={{ fontSize: 11, fontWeight: 900, color: "#ef4444", textTransform: "uppercase", letterSpacing: "1.2px" }}>Atendimento humano</span>
            </div>
            <div style={{ fontSize: 17, fontWeight: 900, letterSpacing: "-0.3px", lineHeight: 1.25 }}>
              {escalonados[0].cliente.split(" ")[0]} quer falar com você
            </div>
            <div style={{ fontSize: 13, color: "#c9c2b4", fontWeight: 600, lineHeight: 1.4 }}>O bot pausou a conversa e está esperando.</div>
            <button onClick={() => { assumirConversa(escalonados[0].telefone); setCardUrgenciaFechado(true) }} style={{ height: 52, border: "none", borderRadius: 14, background: "#ef4444", color: "#fff", fontSize: 16, fontWeight: 900, letterSpacing: "-0.2px" }}>
              Abrir conversa
            </button>
          </div>
        )}

        {/* Pipeline */}
        <div style={{ padding: "16px 16px 10px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, fontWeight: 900, letterSpacing: "1.2px", textTransform: "uppercase", color: "#a39b8b" }}>Fila de pedidos</span>
            <button onClick={() => setFiltro("todos")} style={{ border: `1px solid ${filtro === "todos" ? "#ff6b00" : "#242220"}`, background: filtro === "todos" ? "#ff6b00" : "transparent", color: filtro === "todos" ? "#060606" : "#c9c2b4", fontSize: 12, fontWeight: 900, padding: "7px 14px", borderRadius: 18 }}>
              Todos · {pedidos.length}
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {steps.map((s, i) => {
              const active = filtro === s.key
              return (
                <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 4, flex: 1 }}>
                  <button onClick={() => setFiltro(active ? "todos" : s.key)} style={{ flex: 1, minWidth: 0, border: `1px solid ${active ? s.stepBorder : "#242220"}`, background: active ? s.stepBg : "#101010", color: active ? s.stepFg : "#5a564d", borderRadius: 14, padding: "10px 4px 9px", display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                    <span style={{ fontSize: 20, fontWeight: 900, lineHeight: 1, color: active ? s.stepCountFg : "#444" }}>{s.count}</span>
                    <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".4px" }}>{s.stepLabel}</span>
                  </button>
                  {i < steps.length - 1 && <span style={{ color: "#2a2723", fontSize: 15, fontWeight: 900, flexShrink: 0, lineHeight: 1 }}>›</span>}
                </div>
              )
            })}
          </div>
        </div>

        {/* Lista de pedidos */}
        <main style={{ display: "flex", flexDirection: "column", gap: 14, padding: "4px 16px 20px" }}>
          {pedidosFiltrados.length === 0 && (
            <div style={{ background: "#101010", border: "1px dashed #2a2723", borderRadius: 20, padding: "36px 20px", textAlign: "center", display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 17, fontWeight: 900, color: "#c9c2b4" }}>Nada por aqui</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#a39b8b" }}>Nenhum pedido nesse estado agora.</span>
            </div>
          )}

          {pedidosFiltrados.map(pedido => {
            const minsDesde = tempoDesde(pedido.horario, undefined, now)
            const minsPrep = tempoDesde(pedido.horario, pedido.horarioInicio, now)
            const meta = 40
            const badge = BADGE_CFG[pedido.status]
            const nextStatus = NEXT_STATUS[pedido.status]
            const isDone = pedido.status === "entregue"
            const isCanceled = pedido.status === "cancelado"

            // Timer logic por status
            const isNovo = pedido.status === "novo"
            const timerMins = isNovo ? minsDesde : minsPrep
            const timerLabel = isNovo
              ? (minsDesde === 0 ? "agora" : `aguardando ${minsDesde}m`)
              : isDone ? "concluído"
              : minsPrep > meta ? `${minsPrep - meta}m atrasado`
              : `meta ${meta} min`
            const timerColor = isNovo
              ? (minsDesde < 3 ? "#22c55e" : minsDesde < 7 ? "#facc15" : "#ef4444")
              : isDone ? "#22c55e"
              : minsPrep < meta * 0.5 ? "#22c55e"
              : minsPrep < meta * 0.85 ? "#facc15"
              : "#ef4444"
            const { dash, color: ringColor } = { dash: isNovo ? 163.4 * (1 - Math.min(minsDesde / 15, 1)) : 163.4 * (1 - Math.min(minsPrep / meta, 1)), color: timerColor }
            const late = minsPrep > meta && !isDone && !isCanceled
            const firstName = pedido.cliente.split(" ")[0]

            let cardAnim = "cbCardIn .35s ease both"
            if (pedido.status === "novo" && !pedido.escalonado) cardAnim = "cbCardIn .35s ease both, cbNewGlow 2s ease infinite"
            if (pedido.escalonado) cardAnim = "cbCardIn .35s ease both"
            if (flashId === pedido.id) cardAnim = "cbFlash .7s ease"
            if (leavingId === pedido.id) cardAnim = "cbCardOut .3s ease both"

            let cardBorder = badge.cardBorder
            if (pedido.escalonado) cardBorder = "1.5px solid rgba(239,68,68,.6)"
            if (pedido.cancelamentoSolicitado) cardBorder = "1.5px solid rgba(239,68,68,.4)"

            const pagamento = pedido.pagamento || ""
            const payDot = pagamento.toLowerCase().includes("pix") ? "#22c55e" : pagamento.toLowerCase().includes("cart") ? "#60a5fa" : "#facc15"

            return (
              <article key={pedido.id} onClick={() => setDetailId(pedido.id)} style={{ background: "#101010", border: cardBorder, borderRadius: 22, padding: 18, display: "flex", flexDirection: "column", gap: 14, animation: cardAnim, cursor: "pointer" }}>

                {/* Topo: cliente + timer */}
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 7 }}>
                    <span style={{ alignSelf: "flex-start", background: badge.bg, color: badge.fg, fontSize: 11, fontWeight: 900, letterSpacing: "1.2px", padding: "5px 10px", borderRadius: 8, textTransform: "uppercase" }}>{badge.label}</span>
                    <h2 style={{ margin: 0, fontSize: 21, fontWeight: 900, letterSpacing: "-0.5px", lineHeight: 1.15 }}>{pedido.cliente}</h2>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#a39b8b", fontWeight: 600 }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#3a362f", flexShrink: 0 }} />
                      {pedido.endereco}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0 }}>
                    <div style={{ position: "relative", width: 62, height: 62 }}>
                      <svg width="62" height="62" viewBox="0 0 62 62" style={{ transform: "rotate(-90deg)", display: "block" }}>
                        <circle cx="31" cy="31" r="26" fill="none" stroke="#1f1d1a" strokeWidth="5" />
                        <circle cx="31" cy="31" r="26" fill="none" stroke={isDone ? "#22c55e" : ringColor} strokeWidth="5" strokeLinecap="round" strokeDasharray="163.4" strokeDashoffset={isDone ? 0 : dash} style={{ transition: "stroke-dashoffset 1s linear, stroke .4s" }} />
                      </svg>
                      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                        <span style={{ fontSize: isNovo ? 14 : 18, fontWeight: 900, lineHeight: 1, color: timerColor }}>{isNovo ? (minsDesde === 0 ? "0" : minsDesde) : timerMins}</span>
                        <span style={{ fontSize: 8.5, fontWeight: 800, color: "#a39b8b", letterSpacing: "1px" }}>MIN</span>
                      </div>
                    </div>
                    <span style={{ fontSize: 9.5, fontWeight: 800, color: timerColor, letterSpacing: ".2px", whiteSpace: "nowrap", textAlign: "center", maxWidth: 62 }}>
                      {timerLabel}
                    </span>
                  </div>
                </div>

                {/* Itens */}
                <div style={{ background: "#0b0b0b", borderRadius: 14, padding: "13px 14px", display: "flex", flexDirection: "column", gap: 9 }}>
                  {pedido.itens.map((item, i) => (
                    <div key={i} style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: 15.5, fontWeight: 700, letterSpacing: "-0.2px" }}>
                      <span style={{ color: "#ff6b00", fontWeight: 900, flexShrink: 0 }}>1×</span>
                      <span>{item}</span>
                    </div>
                  ))}
                  {pedido.observacao && (
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: "#facc15", background: "rgba(250,204,21,.08)", borderRadius: 8, padding: "7px 10px" }}>
                      Obs: {pedido.observacao}
                    </div>
                  )}
                </div>

                {/* Pagamento */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: "#c9c2b4" }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: payDot, flexShrink: 0 }} />
                  {pagamento || "Pagamento não informado"}
                  {pedido.pixConfirmado && <span style={{ fontSize: 11, color: "#22c55e", fontWeight: 800 }}>✓ confirmado</span>}
                </div>

                {/* Alerta cancelamento */}
                {pedido.cancelamentoSolicitado && (
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#ef4444", background: "rgba(239,68,68,.08)", borderRadius: 10, padding: "10px 12px", animation: "cbCancelGlow 1.5s infinite", border: "1px solid rgba(239,68,68,.3)" }}>
                    ⚠️ Cliente solicitou cancelamento
                  </div>
                )}

                {/* Ações */}
                {!isDone && !isCanceled && nextStatus && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }} onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => {
                        if (nextStatus === "saiu_entrega" && entregadores.length > 0 && pedido.tipoEntrega !== "pickup") {
                          setModalEntrega({ pedidoId: pedido.id, proxStatus: nextStatus })
                        } else {
                          avancarStatus(pedido.id, nextStatus)
                        }
                      }}
                      disabled={atualizando === pedido.id || (pedido.status === "novo" && pagamento === "Pix" && !pedido.pixConfirmado)}
                      style={{ height: 58, border: "none", borderRadius: 16, background: (pedido.status === "novo" && pagamento === "Pix" && !pedido.pixConfirmado) ? "#3a3530" : badge.ctaBg, color: (pedido.status === "novo" && pagamento === "Pix" && !pedido.pixConfirmado) ? "#6b6560" : badge.ctaFg, fontSize: 17, fontWeight: 900, letterSpacing: "-0.2px", opacity: atualizando === pedido.id ? 0.6 : 1, cursor: (pedido.status === "novo" && pagamento === "Pix" && !pedido.pixConfirmado) ? "not-allowed" : "pointer" }}
                    >
                      {atualizando === pedido.id ? "..." : (pedido.status === "novo" && pagamento === "Pix" && !pedido.pixConfirmado) ? "Aguardando Pix ⏳" : ACTION_LABEL[pedido.status]}
                    </button>
                    <button style={{ height: 46, border: "1px solid #2a2723", borderRadius: 14, background: "transparent", color: "#c9c2b4", fontSize: 14, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e" }} />
                      Falar com {firstName} no WhatsApp
                    </button>
                  </div>
                )}

                {isDone && (
                  <div style={{ height: 54, borderRadius: 16, background: "rgba(34,197,94,.1)", border: "1px solid rgba(34,197,94,.3)", color: "#22c55e", fontSize: 15, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    Entregue · tudo certo ✓
                  </div>
                )}

                {pedido.escalonado && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }} onClick={e => e.stopPropagation()}>
                    <button onClick={() => assumirConversa(pedido.telefone)} style={{ height: 50, border: "none", borderRadius: 14, background: "#ef4444", color: "#fff", fontSize: 15, fontWeight: 900 }}>
                      Assumir conversa
                    </button>
                    <button onClick={() => marcarResolvido(pedido.telefone, pedido.id)} style={{ height: 44, border: "1px solid #2a2723", borderRadius: 14, background: "transparent", color: "#4ade80", fontSize: 14, fontWeight: 800 }}>
                      ✓ Resolvido
                    </button>
                  </div>
                )}
              </article>
            )
          })}
        </main>

        {/* Toast desfazer */}
        {toastVisible && (
          <div style={{ position: "fixed", bottom: 96, left: 0, right: 0, margin: "0 auto", width: "calc(100% - 32px)", maxWidth: 343, background: "#1c1a16", border: "1px solid #33302a", borderRadius: 16, padding: "12px 12px 12px 16px", display: "flex", alignItems: "center", gap: 12, animation: "cbToastIn .25s ease both", zIndex: 50, boxShadow: "0 12px 32px rgba(0,0,0,.55)" }}>
            <span style={{ flex: 1, fontSize: 14, fontWeight: 800, letterSpacing: "-0.2px" }}>{toast?.text}</span>
            <button onClick={desfazerToast} style={{ border: "none", background: "rgba(255,107,0,.16)", color: "#ff6b00", fontWeight: 900, fontSize: 14, padding: "11px 14px", borderRadius: 11, flexShrink: 0 }}>
              Desfazer · {toastSegs}
            </button>
          </div>
        )}

        {/* Bottom sheet detalhe */}
        {detalhePedido && (
          <>
            <div onClick={() => setDetailId(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.62)", zIndex: 60, animation: "cbFadeIn .2s ease both" }} />
            <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, margin: "0 auto", maxWidth: 375, background: "#121110", border: "1px solid #242220", borderBottom: "none", borderRadius: "26px 26px 0 0", zIndex: 61, animation: "cbSheetUp .32s cubic-bezier(.2,.9,.3,1) both", padding: "10px 20px 26px", display: "flex", flexDirection: "column", gap: 14, maxHeight: "82vh", overflowY: "auto" }}>
              <div style={{ width: 44, height: 5, borderRadius: 3, background: "#2e2b26", margin: "2px auto 0", flexShrink: 0 }} />

              {(() => {
                const p = detalhePedido
                const mins = tempoDesde(p.horario, p.horarioInicio, now)
                const meta = 40
                const { dash, color: ringColor } = timerDash(mins, meta)
                const badge = BADGE_CFG[p.status]
                const isDone = p.status === "entregue"
                const nextStatus = NEXT_STATUS[p.status]
                const firstName = p.cliente.split(" ")[0]
                const pagamento = p.pagamento || ""
                const payDot = pagamento.toLowerCase().includes("pix") ? "#22c55e" : pagamento.toLowerCase().includes("cart") ? "#60a5fa" : "#facc15"

                return (
                  <>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 7 }}>
                        <span style={{ alignSelf: "flex-start", background: badge.bg, color: badge.fg, fontSize: 11, fontWeight: 900, letterSpacing: "1.2px", padding: "5px 10px", borderRadius: 8, textTransform: "uppercase" }}>{badge.label}</span>
                        <h2 style={{ margin: 0, fontSize: 24, fontWeight: 900, letterSpacing: "-0.6px", lineHeight: 1.1 }}>{p.cliente}</h2>
                        <span style={{ fontSize: 13, color: "#a39b8b", fontWeight: 600 }}>Recebido às {p.horario} · há {mins} min</span>
                      </div>
                      <div style={{ position: "relative", width: 62, height: 62, flexShrink: 0 }}>
                        <svg width="62" height="62" viewBox="0 0 62 62" style={{ transform: "rotate(-90deg)", display: "block" }}>
                          <circle cx="31" cy="31" r="26" fill="none" stroke="#1f1d1a" strokeWidth="5" />
                          <circle cx="31" cy="31" r="26" fill="none" stroke={isDone ? "#22c55e" : ringColor} strokeWidth="5" strokeLinecap="round" strokeDasharray="163.4" strokeDashoffset={isDone ? 0 : dash} style={{ transition: "stroke-dashoffset 1s linear, stroke .4s" }} />
                        </svg>
                        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                          <span style={{ fontSize: 18, fontWeight: 900, lineHeight: 1, color: isDone ? "#22c55e" : ringColor }}>{mins}</span>
                          <span style={{ fontSize: 8.5, fontWeight: 800, color: "#a39b8b", letterSpacing: "1px" }}>MIN</span>
                        </div>
                      </div>
                    </div>

                    <div style={{ background: "#0b0b0b", borderRadius: 14, padding: "13px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={{ fontSize: 10.5, fontWeight: 900, textTransform: "uppercase", letterSpacing: "1px", color: "#a39b8b" }}>Entregar em</span>
                      <span style={{ fontSize: 15, fontWeight: 800, lineHeight: 1.35 }}>{p.endereco}</span>
                    </div>

                    <div style={{ background: "#0b0b0b", borderRadius: 14, padding: "13px 14px", display: "flex", flexDirection: "column", gap: 9 }}>
                      <span style={{ fontSize: 10.5, fontWeight: 900, textTransform: "uppercase", letterSpacing: "1px", color: "#a39b8b" }}>Pedido</span>
                      {p.itens.map((item, i) => (
                        <div key={i} style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: 15.5, fontWeight: 700, letterSpacing: "-0.2px" }}>
                          <span style={{ color: "#ff6b00", fontWeight: 900, flexShrink: 0 }}>1×</span>
                          <span>{item}</span>
                        </div>
                      ))}
                      {p.observacao && (
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: "#facc15", background: "rgba(250,204,21,.08)", borderRadius: 8, padding: "7px 10px" }}>
                          Obs: {p.observacao}
                        </div>
                      )}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: "#c9c2b4" }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: payDot, flexShrink: 0 }} />
                      {pagamento || "Pagamento não informado"}
                    </div>

                    {!isDone && nextStatus && (
                      <button onClick={() => { avancarStatus(p.id, nextStatus); setDetailId(null) }} disabled={atualizando === p.id} style={{ height: 58, border: "none", borderRadius: 16, background: "#ff6b00", color: "#060606", fontSize: 17, fontWeight: 900, letterSpacing: "-0.2px", flexShrink: 0, opacity: atualizando === p.id ? 0.6 : 1 }}>
                        {ACTION_LABEL[p.status]}
                      </button>
                    )}
                    {isDone && (
                      <div style={{ height: 54, borderRadius: 16, background: "rgba(34,197,94,.1)", border: "1px solid rgba(34,197,94,.3)", color: "#22c55e", fontSize: 15, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        Entregue · tudo certo ✓
                      </div>
                    )}
                    <button style={{ height: 46, border: "1px solid #2a2723", borderRadius: 14, background: "transparent", color: "#c9c2b4", fontSize: 14, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, flexShrink: 0 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e" }} />
                      Falar com {firstName} no WhatsApp
                    </button>
                    <button onClick={() => setDetailId(null)} style={{ height: 44, border: "none", background: "transparent", color: "#a39b8b", fontSize: 14, fontWeight: 800, flexShrink: 0 }}>
                      Fechar
                    </button>
                  </>
                )
              })()}
            </div>
          </>
        )}

        {/* Modal seleção entregador */}
        {modalEntrega && (
          <>
            <div onClick={() => setModalEntrega(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.62)", zIndex: 60, animation: "cbFadeIn .2s ease both" }} />
            <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, margin: "0 auto", maxWidth: 375, background: "#121110", border: "1px solid #242220", borderBottom: "none", borderRadius: "26px 26px 0 0", zIndex: 61, animation: "cbSheetUp .32s cubic-bezier(.2,.9,.3,1) both", padding: "20px 20px 36px", display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ width: 44, height: 5, borderRadius: 3, background: "#2e2b26", margin: "0 auto 6px" }} />
              <p style={{ margin: 0, fontSize: 18, fontWeight: 900, letterSpacing: "-0.3px" }}>Selecionar entregador</p>
              {entregadores.filter(e => e.ativo).map(e => (
                <button key={e.id} onClick={() => avancarStatus(modalEntrega.pedidoId, modalEntrega.proxStatus, e)} style={{ height: 56, border: "1px solid #242220", borderRadius: 16, background: "#101010", color: "#f5f2ee", fontSize: 16, fontWeight: 800, textAlign: "left", padding: "0 16px" }}>
                  {e.nome}
                </button>
              ))}
              <button onClick={() => avancarStatus(modalEntrega.pedidoId, modalEntrega.proxStatus)} style={{ height: 48, border: "1px solid #2a2723", borderRadius: 14, background: "transparent", color: "#a39b8b", fontSize: 14, fontWeight: 800 }}>
                Sem entregador
              </button>
            </div>
          </>
        )}

        {/* Nav inferior */}
        <nav style={{ position: "fixed", bottom: 0, left: 0, right: 0, margin: "0 auto", maxWidth: 375, background: "rgba(8,8,8,.94)", backdropFilter: "blur(14px)", borderTop: "1px solid #1f1d1a", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", padding: "10px 8px 18px", zIndex: 40 }}>
          <button style={{ border: "none", background: "transparent", display: "flex", flexDirection: "column", alignItems: "center", gap: 5, padding: "6px 0" }}>
            <span style={{ position: "relative", display: "flex" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <rect x="4" y="3" width="16" height="18" rx="3" stroke="#ff6b00" strokeWidth="2.2" />
                <line x1="8" y1="9" x2="16" y2="9" stroke="#ff6b00" strokeWidth="2.2" strokeLinecap="round" />
                <line x1="8" y1="14" x2="13" y2="14" stroke="#ff6b00" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
              {emAberto > 0 && <span style={{ position: "absolute", top: -5, right: -9, minWidth: 17, height: 17, borderRadius: 9, background: "#ff6b00", color: "#060606", fontSize: 10.5, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>{emAberto}</span>}
            </span>
            <span style={{ fontSize: 11, fontWeight: 900, color: "#ff6b00" }}>Pedidos</span>
          </button>
          <button style={{ border: "none", background: "transparent", display: "flex", flexDirection: "column", alignItems: "center", gap: 5, padding: "6px 0" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="4" width="18" height="14" rx="5" stroke="#5a564d" strokeWidth="2.2" />
              <circle cx="8.5" cy="11" r="1.4" fill="#5a564d" />
              <circle cx="12" cy="11" r="1.4" fill="#5a564d" />
              <circle cx="15.5" cy="11" r="1.4" fill="#5a564d" />
            </svg>
            <span style={{ fontSize: 11, fontWeight: 800, color: "#5a564d" }}>Conversas</span>
          </button>
          <button style={{ border: "none", background: "transparent", display: "flex", flexDirection: "column", alignItems: "center", gap: 5, padding: "6px 0" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <rect x="4" y="4" width="7" height="7" rx="2" stroke="#5a564d" strokeWidth="2.2" />
              <rect x="13" y="4" width="7" height="7" rx="2" stroke="#5a564d" strokeWidth="2.2" />
              <rect x="4" y="13" width="7" height="7" rx="2" stroke="#5a564d" strokeWidth="2.2" />
              <rect x="13" y="13" width="7" height="7" rx="2" stroke="#5a564d" strokeWidth="2.2" />
            </svg>
            <span style={{ fontSize: 11, fontWeight: 800, color: "#5a564d" }}>Cardápio</span>
          </button>
        </nav>

      </div>
    </>
  )
}
