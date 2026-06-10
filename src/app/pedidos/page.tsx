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

let audioPavlov: HTMLAudioElement | null = null
let audioUrgente: HTMLAudioElement | null = null

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
  const [cardUrgenciaFechado, setCardUrgenciaFechado] = useState(false)
  const prevEscalonadosRef = useRef(0)
  const cardJaMostrouRef = useRef(false)
  const [somAtivado, setSomAtivado] = useState(false)
  const [resumoPedido, setResumoPedido] = useState<Pedido | null>(null)
  const [entregadores, setEntregadores] = useState<{id: string; nome: string; telefone: string; ativo: boolean}[]>([])
  const [modalEntrega, setModalEntrega] = useState<{pedidoId: string; proxStatus: Status} | null>(null)
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

  const ativarSom = () => {
    try {
      audioPavlov = new Audio("/pavlov.mp3")
      audioPavlov.play().catch(() => {})
      audioPavlov.pause()
      audioPavlov.currentTime = 0
      audioPavlov.volume = 1.0
      audioUrgente = new Audio("/urgente.mp3")
      audioUrgente.play().catch(() => {})
      audioUrgente.pause()
      audioUrgente.currentTime = 0
      audioUrgente.volume = 1.0
      setSomAtivado(true)
    } catch {}
  }

  const tocarSomLocal = (urgente = false) => {
    try {
      const audio = urgente ? audioUrgente : audioPavlov
      if (!audio) return
      audio.currentTime = 0
      audio.volume = 1.0
      audio.play().catch(() => {})
    } catch {}
  }

  useEffect(() => {
    const user = getUserInfo()
    if (user) setIsAdmin(user.role === "admin" || user.role === "dev")
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission()
    carregarPedidos()
    carregarStatusBot()
    fetch('/api/entregadores').then(r => r.json()).then(d => setEntregadores(Array.isArray(d) ? d.filter((e: any) => e.ativo) : [])).catch(() => {})
    const intervalo = setInterval(carregarPedidos, 10000)
    return () => { clearInterval(intervalo); if (piscarRef.current) clearInterval(piscarRef.current); document.title = tituloOriginalRef.current }
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
              const temEsc = chegaram.some((p: Pedido) => p.escalonado)
              const temCanc = chegaram.some((p: Pedido) => p.cancelamentoSolicitado)
              tocarSomLocal(temEsc)
              if (temEsc) { addToast("🚨 URGENTE! Cliente precisa de você!", "error"); iniciarPiscar() }
              else if (temCanc) addToast("⚠️ Cancelamento solicitado!", "warning")
              else addToast(`🍕 ${chegaram.length} novo${chegaram.length > 1 ? "s" : ""} pedido${chegaram.length > 1 ? "s" : ""}!`, "success")
            }
          }
          prevIdsRef.current = novosIds; setPedidos(data); setLoading(false)
          const novosEscalonados = data.filter((p: Pedido) => p.escalonado && p.status === 'novo').length
          if (novosEscalonados > 0 && (!cardJaMostrouRef.current || novosEscalonados > prevEscalonadosRef.current)) {
            setCardUrgenciaFechado(false)
            cardJaMostrouRef.current = true
          }
          if (novosEscalonados === 0) cardJaMostrouRef.current = false
          prevEscalonadosRef.current = novosEscalonados
          setUltimaAtualizacao(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }))
          if (!data.some((p: Pedido) => p.escalonado && p.status === "novo")) pararPiscar()
        }
      })
      .catch(() => setTimeout(carregarPedidos, 3000))
  }
  const avancarStatus = async (id: string, novoStatus: Status, entregador?: {id: string; nome: string; telefone: string}) => {
    setAtualizando(id)
    const r = await fetch("/api/orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status: novoStatus, entregador }) })
    if (r.ok) { setPedidos(prev => prev.map(p => p.id === id ? { ...p, status: novoStatus } : p)); addToast(`${STATUS_CONFIG[novoStatus].label} ✅`, "success") }
    setModalEntrega(null)
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
        @keyframes sheetUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
      `}</style>

      {/* Modal Entregador */}
      {modalEntrega && (
        <div onClick={() => setModalEntrega(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "flex-end" }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", background: "#111", borderRadius: "20px 20px 0 0", padding: "20px 20px 40px" }}>
            <div style={{ width: 40, height: 4, background: "#333", borderRadius: 2, margin: "0 auto 20px" }} />
            <p style={{ color: "#fff", fontSize: 17, fontWeight: 800, margin: "0 0 6px" }}>Quem vai entregar?</p>
            <p style={{ color: "#444", fontSize: 12, margin: "0 0 20px" }}>Selecione o entregador</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
              {entregadores.filter(e => e.ativo).map(e => (
                <button key={e.id} onClick={() => avancarStatus(modalEntrega.pedidoId, modalEntrega.proxStatus, e)} style={{ background: "#0d0d0d", border: "1px solid #1e1e1e", borderRadius: 14, padding: "16px", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 24 }}>🛵</span>
                  <div>
                    <p style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{e.nome}</p>
                    <p style={{ margin: 0, fontSize: 11, color: "#444" }}>{e.telefone}</p>
                  </div>
                </button>
              ))}
            </div>
            <button onClick={() => setModalEntrega(null)} style={{ width: "100%", background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 12, padding: "14px", color: "#666", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Bottom Sheet Resumo */}
      {resumoPedido && (
        <div onClick={() => setResumoPedido(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "flex-end" }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", background: "#111", borderRadius: "20px 20px 0 0", padding: "20px 20px 40px", animation: "sheetUp 0.25s ease", maxHeight: "80vh", overflowY: "auto" }}>
            <div style={{ width: 40, height: 4, background: "#333", borderRadius: 2, margin: "0 auto 20px" }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div>
                <p style={{ fontWeight: 900, fontSize: 20, color: "#fff", margin: 0, letterSpacing: -0.5 }}>{resumoPedido.cliente}</p>
                <p style={{ fontSize: 12, color: "#444", margin: "2px 0 0" }}>{resumoPedido.horario} · #{resumoPedido.id.slice(-4)}</p>
              </div>
              <button onClick={() => setResumoPedido(null)} style={{ background: "#1e1e1e", border: "none", color: "#666", borderRadius: 10, width: 36, height: 36, fontSize: 18, cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ background: "#0d0d0d", borderRadius: 14, padding: "14px 16px", marginBottom: 12 }}>
              <p style={{ fontSize: 11, color: "#444", fontWeight: 700, margin: "0 0 10px", letterSpacing: 0.5, textTransform: "uppercase" }}>Pedido</p>
              {resumoPedido.itens.map((item, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ color: "#fbbf24", fontSize: 12 }}>•</span>
                  <p style={{ fontSize: 14, color: "#e0e0e0", margin: 0, fontWeight: 600 }}>{item}</p>
                </div>
              ))}
              {resumoPedido.observacao && (
                <div style={{ marginTop: 10, background: "#1a1400", borderRadius: 8, padding: "8px 10px", display: "flex", gap: 6 }}>
                  <span style={{ fontSize: 12 }}>✏️</span>
                  <p style={{ fontSize: 12, color: "#fbbf24", margin: 0 }}>{resumoPedido.observacao}</p>
                </div>
              )}
            </div>
            <div style={{ background: "#0d0d0d", borderRadius: 14, padding: "14px 16px", marginBottom: 12 }}>
              <p style={{ fontSize: 11, color: "#444", fontWeight: 700, margin: "0 0 6px", letterSpacing: 0.5, textTransform: "uppercase" }}>Entrega</p>
              <p style={{ fontSize: 14, color: "#e0e0e0", margin: 0, fontWeight: 600 }}>📍 {resumoPedido.endereco || "—"}</p>
            </div>
            <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
              <div style={{ flex: 1, background: "#0d0d0d", borderRadius: 14, padding: "14px 16px" }}>
                <p style={{ fontSize: 11, color: "#444", fontWeight: 700, margin: "0 0 6px", letterSpacing: 0.5, textTransform: "uppercase" }}>Pagamento</p>
                <p style={{ fontSize: 14, color: "#e0e0e0", margin: 0, fontWeight: 700 }}>
                  {resumoPedido.pagamento === "Pix" ? "💛 Pix" : resumoPedido.pagamento === "Dinheiro" ? "💵 Dinheiro" : resumoPedido.pagamento === "Cartão" ? "💳 Cartão" : "—"}
                </p>
                {resumoPedido.troco && <p style={{ fontSize: 12, color: "#fbbf24", margin: "4px 0 0", fontWeight: 600 }}>{resumoPedido.troco}</p>}
                {resumoPedido.pixConfirmado && <p style={{ fontSize: 12, color: "#4ade80", margin: "4px 0 0", fontWeight: 700 }}>✅ Pix confirmado</p>}
              </div>
              <div style={{ flex: 1, background: "#0d0d0d", borderRadius: 14, padding: "14px 16px" }}>
                <p style={{ fontSize: 11, color: "#444", fontWeight: 700, margin: "0 0 6px", letterSpacing: 0.5, textTransform: "uppercase" }}>Total</p>
                <p style={{ fontSize: 18, color: "#4ade80", margin: 0, fontWeight: 900 }}>R$ {resumoPedido.total.toFixed(2).replace(".", ",")}</p>
              </div>
            </div>
            <button onClick={() => window.open("https://wa.me/" + resumoPedido.telefone, "_blank")} style={{ width: "100%", padding: "14px", background: "#0d1a0d", border: "1px solid #16a34a25", borderRadius: 14, color: "#4ade80", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
              💬 Abrir WhatsApp
            </button>
          </div>
        </div>
      )}

      {/* Card Urgência Gamer */}
      {escalonados > 0 && !cardUrgenciaFechado && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <style>{`
            @keyframes cardIn { from { transform: scale(0.8) translateY(20px); opacity: 0; } to { transform: scale(1) translateY(0); opacity: 1; } }
            @keyframes bgPulse { 0%,100% { background: rgba(0,0,0,0.85); } 50% { background: rgba(80,0,0,0.9); } }
            @keyframes shake { 0%,100% { transform: translateX(0); } 15% { transform: translateX(-6px) rotate(-1deg); } 30% { transform: translateX(6px) rotate(1deg); } 45% { transform: translateX(-4px); } 60% { transform: translateX(4px); } 75% { transform: translateX(-2px); } }
            @keyframes glowPulse { 0%,100% { box-shadow: 0 0 30px rgba(239,68,68,0.5), 0 0 60px rgba(239,68,68,0.2), inset 0 1px 0 rgba(255,255,255,0.1); } 50% { box-shadow: 0 0 60px rgba(239,68,68,0.9), 0 0 100px rgba(239,68,68,0.4), inset 0 1px 0 rgba(255,255,255,0.1); } }
            @keyframes scanline { 0% { transform: translateY(-100%); } 100% { transform: translateY(400%); } }
            @keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
            @keyframes borderRotate { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
          `}</style>
          <div style={{ position: 'absolute', inset: 0, animation: 'bgPulse 1.5s infinite', backdropFilter: 'blur(8px)', pointerEvents: 'none' }} />
          <div style={{ position: 'relative', width: '100%', maxWidth: 360, animation: 'cardIn 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)' }}>
            {/* Borda animada */}
            <div style={{ position: 'absolute', inset: -2, borderRadius: 24, background: 'linear-gradient(90deg, #ef4444, #ff6b00, #ef4444, #ff0000, #ef4444)', backgroundSize: '200% 100%', animation: 'borderRotate 2s linear infinite', zIndex: -1 }} />
            <div style={{ background: 'linear-gradient(160deg, #1a0505 0%, #0d0d0d 40%, #1a0a00 100%)', borderRadius: 22, padding: '28px 24px', position: 'relative', overflow: 'hidden', animation: 'glowPulse 1.5s infinite' }}>
              {/* Scanline effect */}
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '20%', background: 'linear-gradient(transparent, rgba(239,68,68,0.05), transparent)', animation: 'scanline 3s linear infinite', pointerEvents: 'none' }} />
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 20 }}>
                <span style={{ fontSize: 32, animation: 'shake 0.6s infinite' }}>🚨</span>
                <div style={{ textAlign: 'center' }}>
                  <p style={{ color: '#ef4444', fontSize: 11, fontWeight: 900, margin: 0, letterSpacing: 3, textTransform: 'uppercase', animation: 'blink 1s infinite' }}>● ATENÇÃO URGENTE</p>
                  <p style={{ color: '#fff', fontSize: 20, fontWeight: 900, margin: '4px 0 0', letterSpacing: -0.5 }}>Cliente Esperando!</p>
                </div>
                <span style={{ fontSize: 32, animation: 'shake 0.6s infinite' }}>🚨</span>
              </div>
              {/* Info */}
              <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 14, padding: '14px 16px', marginBottom: 20 }}>
                <p style={{ color: '#fca5a5', fontSize: 13, fontWeight: 700, margin: '0 0 6px', textAlign: 'center' }}>
                  {escalonados} cliente{escalonados > 1 ? 's' : ''} precisando de atendimento humano agora
                </p>
                {pedidos.filter(p => p.escalonado && p.status === 'novo').slice(0, 2).map((p, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, background: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: '8px 10px' }}>
                    <span style={{ fontSize: 14 }}>👤</span>
                    <div>
                      <p style={{ color: '#fff', fontSize: 13, fontWeight: 700, margin: 0 }}>{p.cliente}</p>
                      <p style={{ color: '#666', fontSize: 11, margin: 0 }}>{p.horario} · aguardando</p>
                    </div>
                  </div>
                ))}
              </div>
              {/* Botões */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {pedidos.filter(p => p.escalonado && p.status === 'novo').slice(0, 1).map(p => (
                  <button key={p.id} onClick={() => { assumirConversa(p.telefone); setCardUrgenciaFechado(true); }} style={{ width: '100%', padding: '16px', background: 'linear-gradient(135deg, #ef4444, #dc2626)', border: 'none', borderRadius: 14, color: '#fff', fontSize: 15, fontWeight: 900, cursor: 'pointer', letterSpacing: 0.3, position: 'relative', overflow: 'hidden' }}>
                    <span style={{ position: 'relative', zIndex: 1 }}>📱 Atender {p.cliente.split(' ')[0]} agora</span>
                  </button>
                ))}
                <button onClick={() => {
                  setCardUrgenciaFechado(true)
                  setTimeout(() => {
                    const el = document.querySelector('[data-urgente="true"]')
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                  }, 100)
                }} style={{ width: '100%', padding: '14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, color: '#aaa', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                  👀 Ver no painel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
        {!somAtivado && (
          <div onClick={ativarSom} style={{ background: "#0d1a0d", border: "1px solid #16a34a40", borderRadius: 14, padding: "12px 14px", marginBottom: 10, display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
            <span style={{ fontSize: 20 }}>🔔</span>
            <div>
              <p style={{ fontWeight: 800, color: "#4ade80", margin: 0, fontSize: 13 }}>Toque aqui para ativar o som</p>
              <p style={{ fontSize: 11, color: "#4ade8060", margin: "2px 0 0" }}>Necessário para notificações no celular</p>
            </div>
          </div>
        )}
        {escalonados > 0 && (
          <div style={{ background: "#1a0505", border: "1px solid #f8717130", borderRadius: 14, padding: "12px 14px", marginBottom: 10, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 22 }}>🚨</span>
            <div>
              <p style={{ fontWeight: 800, color: "#f87171", margin: 0, fontSize: 13 }}>{escalonados} cliente{escalonados > 1 ? "s" : ""} precisando de você AGORA</p>
              <p style={{ fontSize: 11, color: "#f8717160", margin: "2px 0 0" }}>Role até os cards vermelhos abaixo</p>
            </div>
          </div>
        )}
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
        </div>
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
                <div key={pedido.id} data-urgente={isEsc ? "true" : undefined} style={{ background: isEsc ? "#110505" : ativo ? "#0d0d0d" : "#090909", border: `1px solid ${isEsc ? "#f8717125" : isCanc ? "#fb923c25" : ativo ? cfg.border : "#111"}`, borderRadius: 16, overflow: "hidden", opacity: ativo ? 1 : 0.45, transition: "opacity 0.2s" }}>
                  {ativo && <div style={{ height: 3, background: isEsc ? "#f87171" : cfg.color, width: "100%" }} />}
                  <div style={{ padding: "14px 16px 12px" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 6 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 900, fontSize: 17, color: "#fff", letterSpacing: -0.5 }}>{pedido.cliente}</span>
                          {isEsc && <span style={{ background: "#f87171", color: "#fff", fontSize: 9, fontWeight: 800, padding: "2px 7px", borderRadius: 20, letterSpacing: 0.5 }}>🚨 URGENTE</span>}
                          {isCanc && !isEsc && <span style={{ background: "#fb923c", color: "#fff", fontSize: 9, fontWeight: 800, padding: "2px 7px", borderRadius: 20 }}>⚠️ CANCEL.</span>}
                        </div>
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
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                        <span style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`, fontSize: 11, fontWeight: 800, padding: "4px 10px", borderRadius: 20, whiteSpace: "nowrap", marginLeft: 8, letterSpacing: 0.2 }}>
                          {isEsc ? "Urgente" : cfg.label}
                        </span>
                        {pedido.pixConfirmado && (
                          <span style={{ background: "#14532d", color: "#4ade80", border: "1px solid #16a34a40", borderRadius: 8, padding: "3px 8px", fontSize: 10, fontWeight: 800, whiteSpace: "nowrap" }}>✅ Pago</span>
                        )}
                        {pedido.pagamento && !pedido.pixConfirmado && (
                          <span style={{ background: "#1a1a1a", color: pedido.pagamento === "Dinheiro" ? "#fbbf24" : pedido.pagamento === "Cartão" ? "#60a5fa" : "#a78bfa", border: "1px solid #2a2a2a", borderRadius: 8, padding: "3px 8px", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>
                            {pedido.pagamento === "Pix" ? "💛 Pix" : pedido.pagamento === "Dinheiro" ? "💵 Dinheiro" : "💳 Cartão"}
                          </span>
                        )}
                        <button onClick={() => setResumoPedido(pedido)} style={{ background: "#1a1a1a", border: "1px solid #2a2a2a", color: "#666", borderRadius: 8, padding: "3px 8px", fontSize: 10, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                          📋 Resumo
                        </button>
                      </div>
                    </div>
                    <div style={{ marginBottom: 8 }}>
                      {pedido.itens.map((item, i) => (
                        <p key={i} style={{ fontSize: 14, color: ativo ? "#e0e0e0" : "#333", margin: "2px 0", fontWeight: ativo ? 600 : 400, lineHeight: 1.4 }}>{item}</p>
                      ))}
                    </div>
                    {pedido.observacao && (
                      <div style={{ background: "#1a1400", border: "1px solid #fbbf2420", borderRadius: 8, padding: "6px 10px", marginBottom: 8, display: "flex", alignItems: "flex-start", gap: 6 }}>
                        <span style={{ fontSize: 12 }}>✏️</span>
                        <p style={{ fontSize: 12, color: "#fbbf24", margin: 0, fontWeight: 500 }}>{pedido.observacao}</p>
                      </div>
                    )}
                    {pedido.troco && pedido.troco !== "Sem troco" && (
                      <div style={{ background: "#1a1400", border: "1px solid #fbbf2420", borderRadius: 8, padding: "6px 10px", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 12 }}>💵</span>
                        <p style={{ fontSize: 12, color: "#fbbf24", margin: 0, fontWeight: 600 }}>{pedido.troco}</p>
                      </div>
                    )}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <p style={{ fontSize: 18, fontWeight: 900, color: ativo ? "#fff" : "#333", margin: 0, letterSpacing: -0.5 }}>
                        R$ {pedido.total.toFixed(2).replace(".", ",")}
                      </p>
                      {ativo && <span style={{ fontSize: 11, color: "#333" }}>{pedido.itens.length} item{pedido.itens.length !== 1 ? "ns" : ""}</span>}
                    </div>
                  </div>
                  {(ativo || isEsc) && (
                    <div style={{ padding: "0 12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                      {isEsc && (
                        <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={() => assumirConversa(pedido.telefone)} style={{ flex: 1, padding: "14px 0", background: "#f87171", color: "#fff", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 800, cursor: "pointer" }}>📱 Atender agora</button>
                          <button onClick={() => marcarResolvido(pedido.telefone, pedido.id)} style={{ flex: 1, padding: "14px 0", background: "#16a34a", color: "#fff", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 800, cursor: "pointer" }}>✅ Resolvido</button>
                        </div>
                      )}
                      {isCanc && !isEsc && (
                        <button onClick={() => confirmarCancelamento(pedido.id)} disabled={atualizando === pedido.id} style={{ width: "100%", padding: "14px 0", background: "#fb923c", color: "#fff", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 800, cursor: "pointer" }}>
                          {atualizando === pedido.id ? "Cancelando..." : "⚠️ Confirmar cancelamento"}
                        </button>
                      )}
                      {!isEsc && proxStatus && (
                        <button onClick={() => {
                            if (proxStatus === 'saiu_entrega') {
                              const ativos = entregadores.filter(e => e.ativo)
                              if (ativos.length === 1) { avancarStatus(pedido.id, proxStatus, ativos[0]) }
                              else { setModalEntrega({ pedidoId: pedido.id, proxStatus }) }
                            } else { avancarStatus(pedido.id, proxStatus) }
                          }} disabled={atualizando === pedido.id} style={{ width: "100%", padding: "15px 0", background: atualizando === pedido.id ? "#222" : cfg.color, color: atualizando === pedido.id ? "#555" : cfg.btnColor, border: "none", borderRadius: 12, fontSize: 15, fontWeight: 900, cursor: atualizando === pedido.id ? "not-allowed" : "pointer", letterSpacing: -0.2, transition: "all 0.15s" }}>
                          {atualizando === pedido.id ? "Atualizando..." : PROXIMO_LABEL[pedido.status]}
                        </button>
                      )}
                      {!isEsc && (
                        <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={() => window.open("https://wa.me/" + pedido.telefone, "_blank")} style={{ flex: 1, padding: "11px 0", background: "#111", color: "#4ade80", border: "1px solid #16a34a25", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>💬 WhatsApp</button>
                          {emManual ? (
                            <button onClick={() => devolverAoBot(pedido.telefone)} style={{ flex: 1, padding: "11px 0", background: "#111", color: "#60a5fa", border: "1px solid #1d4ed825", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>🤖 Devolver bot</button>
                          ) : (
                            <button onClick={() => assumirConversa(pedido.telefone)} style={{ flex: 1, padding: "11px 0", background: "#111", color: "#888", border: "1px solid #1e1e1e", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>📱 Assumir</button>
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