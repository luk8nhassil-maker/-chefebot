"use client"
import { useEffect, useState, useRef } from "react"
import { useRouter } from "next/navigation"
import PanelShell from "@/components/PanelShell"

function whatsappLink(telefoneBruto: string, mensagem?: string): string {
  let numero = (telefoneBruto || "").replace(/\D/g, "")
  if (numero && !numero.startsWith("55")) numero = "55" + numero
  const texto = mensagem ? `?text=${encodeURIComponent(mensagem)}` : ""
  return `https://wa.me/${numero}${texto}`
}

type Status = "novo" | "em_preparo" | "saiu_entrega" | "entregue" | "cancelado"
type Pedido = {
  id: string
  numero?: number
  cliente: string
  telefone: string
  itens: string[]
  total: number
  status: Status
  horario: string
  endereco: string
  escalonado?: boolean
  horarioEscalonado?: number
  cancelamentoSolicitado?: boolean
  observacao?: string
  pagamento?: string
  troco?: string
  pixConfirmado?: boolean
  tipoEntrega?: string
  horarioInicio?: string
  horarioEntrega?: string
  bairro?: string
  taxaEntrega?: number
  referencia?: string
}

const NEXT_STATUS: Record<Status, Status | null> = {
  novo: "em_preparo", em_preparo: "saiu_entrega", saiu_entrega: "entregue", entregue: null, cancelado: null,
}
const ACTION_LABEL: Record<Status, string> = {
  novo: "Começar a fazer", em_preparo: "Saiu para entrega", saiu_entrega: "Confirmar entrega", entregue: "", cancelado: "",
}
const STATUS_OPTS: { value: Status; label: string }[] = [
  { value: "novo", label: "Novo" },
  { value: "em_preparo", label: "Fazendo" },
  { value: "saiu_entrega", label: "Na rua" },
  { value: "entregue", label: "Entregue" },
  { value: "cancelado", label: "Cancelado" },
]

const STATUS_COLOR: Record<Status, { accent: string; accentSoft: string; accentBg: string; accentBorder: string; cardBg: string; cardBorder: string; glow: string; btnBg: string; btnFg: string; label: string }> = {
  novo:         { accent: "#ff6b00", accentSoft: "#ff9a3d", accentBg: "rgba(255,107,0,.15)", accentBorder: "rgba(255,107,0,.5)",  cardBg: "linear-gradient(180deg,rgba(255,107,0,.12),rgba(255,107,0,.02) 30%,#0d0906 65%)", cardBorder: "1.5px solid rgba(255,107,0,.55)",  glow: "cbGlowO", btnBg: "linear-gradient(180deg,#ff7d1a,#ff6b00)", btnFg: "#fff",    label: "Novo" },
  em_preparo:   { accent: "#facc15", accentSoft: "#fde68a", accentBg: "rgba(250,204,21,.12)", accentBorder: "rgba(250,204,21,.45)", cardBg: "linear-gradient(180deg,rgba(250,204,21,.1),rgba(250,204,21,.02) 30%,#0d0d06 65%)",  cardBorder: "1.5px solid rgba(250,204,21,.4)",  glow: "cbGlowY", btnBg: "#facc15",                              btnFg: "#060606", label: "Fazendo" },
  saiu_entrega: { accent: "#60a5fa", accentSoft: "#93c5fd", accentBg: "rgba(96,165,250,.12)",  accentBorder: "rgba(96,165,250,.45)",  cardBg: "linear-gradient(180deg,rgba(96,165,250,.1),rgba(96,165,250,.02) 30%,#06080d 65%)",  cardBorder: "1.5px solid rgba(96,165,250,.4)",  glow: "cbGlowB", btnBg: "#60a5fa",                              btnFg: "#060606", label: "Na rua" },
  entregue:     { accent: "#22c55e", accentSoft: "#4ade80", accentBg: "rgba(34,197,94,.12)",   accentBorder: "rgba(34,197,94,.4)",    cardBg: "linear-gradient(180deg,rgba(34,197,94,.1),rgba(34,197,94,.02) 30%,#060d08 65%)",    cardBorder: "1.5px solid rgba(34,197,94,.35)",  glow: "cbGlowG", btnBg: "#22c55e",                              btnFg: "#060606", label: "Entregue" },
  cancelado:    { accent: "#ef4444", accentSoft: "#f87171", accentBg: "rgba(239,68,68,.12)",   accentBorder: "rgba(239,68,68,.45)",   cardBg: "linear-gradient(180deg,rgba(239,68,68,.1),rgba(239,68,68,.02) 30%,#0d0606 65%)",   cardBorder: "1.5px solid rgba(239,68,68,.4)",   glow: "cbGlowR", btnBg: "#ef4444",                              btnFg: "#fff",    label: "Cancelado" },
}

function getItemIcon(item: string): string {
  const n = item.toLowerCase()
  if (n.includes("pizza") || n.includes("calabresa") || n.includes("mussarela") || (n.includes("frango") && n.includes("pizza"))) return "🍕"
  if (n.includes("hambur") || n.includes("x-burg") || n.includes("xburg") || n.includes("lanche") || n.includes("hot dog") || n.includes("cachorro")) return "🍔"
  if (n.includes("coca") || n.includes("pepsi") || n.includes("refri") || n.includes("guaraná") || n.includes("guarana") || n.includes("fanta") || n.includes("sprite") || n.includes("bebida")) return "🥤"
  if (n.includes("suco") || n.includes("vitamina") || n.includes("açaí") || n.includes("acai") || n.includes("smoothie")) return "🧃"
  if (n.includes("massa") || n.includes("macarr") || n.includes("espaguete") || n.includes("lasanha") || n.includes("nhoque")) return "🍝"
  if (n.includes("frango") || n.includes("porção") || n.includes("porcao") || n.includes("asa") || n.includes("coxinha")) return "🍗"
  if (n.includes("batata") || n.includes("frita")) return "🍟"
  if (n.includes("calzone")) return "🥙"
  if (n.includes("sobremesa") || n.includes("torta") || n.includes("bolo") || n.includes("doce") || n.includes("pudim")) return "🍰"
  if (n.includes("agua") || n.includes("água") || n.includes("mineral")) return "💧"
  return "🍽️"
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
  const CIRC = 131.9
  const progress = Math.min(mins / meta, 1)
  const color = progress < 0.5 ? "#34d399" : progress < 0.85 ? "#fbbf24" : "#f87171"
  return { dash: CIRC * (1 - progress), color }
}

function parseHybridPayment(pagamento: string): { metodo: string; valor: number }[] | null {
  if (!pagamento || !pagamento.includes("+")) return null
  const partes = pagamento.split("+").map(s => s.trim())
  const resultado: { metodo: string; valor: number }[] = []
  for (const parte of partes) {
    const match = parte.match(/^(.+?)\s*\(R\$\s*([\d,.]+)\)$/)
    if (!match) return null
    const metodo = match[1].trim()
    const valor = parseFloat(match[2].replace(".", "").replace(",", "."))
    resultado.push({ metodo, valor })
  }
  return resultado.length >= 2 ? resultado : null
}

type NovoPedidoForm = {
  cliente: string
  telefone: string
  tipoEntrega: "delivery" | "retirada" | "dine_in"
  endereco: string
  bairro: string
  referencia: string
  itens: string[]
  observacao: string
  pagamento: string
  total: string
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
  const [_manuais, setManuais] = useState<Record<string, boolean>>({})
  const [detailId, setDetailId] = useState<string | null>(null)
  const [cardUrgenciaFechado, setCardUrgenciaFechado] = useState(false)
  const [toast, setToast] = useState<{ text: string; expires: number; pedidoId: string; prevStatus: Status } | null>(null)
  const [now, setNow] = useState(Date.now())
  const [leavingId, setLeavingId] = useState<string | null>(null)
  const [installPrompt, setInstallPrompt] = useState<any>(null)
  const [showInstallBanner, setShowInstallBanner] = useState(false)
  const [flashId, setFlashId] = useState<string | null>(null)
  const [entregadores, setEntregadores] = useState<{id: string; nome: string; telefone: string; ativo: boolean}[]>([])
  const [modalEntrega, setModalEntrega] = useState<{pedidoId: string; proxStatus: Status} | null>(null)
  const [muteado, setMuteado] = useState(false)
  const [busca, setBusca] = useState("")
  const [modalLimpar, setModalLimpar] = useState(false)
  const [limpando, setLimpando] = useState(false)
  const [modalNovoPedido, setModalNovoPedido] = useState(false)
  const [novoPedidoForm, setNovoPedidoForm] = useState<NovoPedidoForm>({
    cliente: "", telefone: "", tipoEntrega: "delivery", endereco: "", bairro: "", referencia: "", itens: [""], observacao: "", pagamento: "", total: ""
  })
  const [salvandoNovoPedido, setSalvandoNovoPedido] = useState(false)
  const [modalAlterarStatus, setModalAlterarStatus] = useState<string | null>(null)
  const [cancelandoId, setCancelandoId] = useState<string | null>(null)
  const [confirmPixModal, setConfirmPixModal] = useState<string | null>(null)
  const [finalizarModal, setFinalizarModal] = useState<string | null>(null)
  const [simpleToast, setSimpleToast] = useState("")

  const prevIdsRef = useRef<string[]>([])
  const piscarRef = useRef<NodeJS.Timeout | null>(null)
  const somRepetidoRef = useRef<NodeJS.Timeout | null>(null)
  const tituloOriginalRef = useRef(typeof document !== "undefined" ? document.title : "Pedidos")
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null)
  const flashTimerRef = useRef<NodeJS.Timeout | null>(null)
  const leaveTimerRef = useRef<NodeJS.Timeout | null>(null)
  const muteadoRef = useRef(false)
  const prevPixRef = useRef<Record<string, boolean>>({})
  const temposEntregaRef = useRef<Record<string, number>>({})
  const simpleToastTimerRef = useRef<any>(null)

  const tocarSomNormal = () => {
    if (muteadoRef.current) return
    try {
      const audio = new Audio("/pavlov.mp3")
      audio.play().catch(() => {
        try {
          const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext
          const ctx = new Ctx()
          const bipe = (freq: number, delay: number) => setTimeout(() => {
            try {
              const osc = ctx.createOscillator(); const gain = ctx.createGain()
              osc.connect(gain); gain.connect(ctx.destination); osc.type = "square"
              osc.frequency.value = freq
              gain.gain.setValueAtTime(0.4, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18)
              osc.start(); osc.stop(ctx.currentTime + 0.18)
            } catch {}
          }, delay)
          bipe(880, 0); bipe(880, 200); bipe(1175, 400)
        } catch {}
      })
    } catch {}
    if (navigator.vibrate) navigator.vibrate([120, 80, 120, 80, 150])
  }

  const tocarSomUrgente = () => {
    if (muteadoRef.current) return
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext
      const ctx = new Ctx()
      const bipe = (delay: number) => setTimeout(() => {
        try {
          const osc = ctx.createOscillator(); const gain = ctx.createGain()
          osc.connect(gain); gain.connect(ctx.destination); osc.type = "sawtooth"
          osc.frequency.value = 1200
          gain.gain.setValueAtTime(0.6, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14)
          osc.start(); osc.stop(ctx.currentTime + 0.14)
        } catch {}
      }, delay)
      bipe(0); bipe(180); bipe(360); bipe(540)
    } catch {}
    if (navigator.vibrate) navigator.vibrate([150, 50, 150, 50, 150, 50, 200])
  }

  const tocarSomPix = () => {
    if (muteadoRef.current) return
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext
      const ctx = new Ctx()
      ;[523, 659, 784, 1047].forEach((freq, i) => setTimeout(() => {
        try {
          const osc = ctx.createOscillator(); const gain = ctx.createGain()
          osc.connect(gain); gain.connect(ctx.destination); osc.type = "sine"
          osc.frequency.value = freq
          gain.gain.setValueAtTime(0.3, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2)
          osc.start(); osc.stop(ctx.currentTime + 0.2)
        } catch {}
      }, i * 160))
    } catch {}
    if (navigator.vibrate) navigator.vibrate([60, 40, 60, 40, 80])
  }

  const tocarSomEntrega = () => {
    if (muteadoRef.current) return
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext
      const ctx = new Ctx()
      ;[[523, 0], [392, 320]].forEach(([freq, delay]) => setTimeout(() => {
        try {
          const osc = ctx.createOscillator(); const gain = ctx.createGain()
          osc.connect(gain); gain.connect(ctx.destination); osc.type = "sine"
          osc.frequency.value = freq
          gain.gain.setValueAtTime(0.3, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35)
          osc.start(); osc.stop(ctx.currentTime + 0.35)
        } catch {}
      }, delay))
    } catch {}
    if (navigator.vibrate) navigator.vibrate([150, 80, 250])
  }

  const iniciarPiscar = () => {
    if (piscarRef.current) return
    let e = false
    piscarRef.current = setInterval(() => { e = !e; document.title = e ? "🚨 URGENTE!" : tituloOriginalRef.current }, 800)
  }
  const pararPiscar = () => { if (piscarRef.current) { clearInterval(piscarRef.current); piscarRef.current = null } document.title = tituloOriginalRef.current }
  const iniciarSomRepetido = () => { if (somRepetidoRef.current) return; somRepetidoRef.current = setInterval(() => tocarSomUrgente(), 3000) }
  const pararSomRepetido = () => { if (somRepetidoRef.current) { clearInterval(somRepetidoRef.current); somRepetidoRef.current = null } }

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
            if (chegaram.length > 0) { const temEsc = chegaram.some((p: Pedido) => p.escalonado); if (temEsc) { tocarSomUrgente(); iniciarPiscar(); iniciarSomRepetido() } else { tocarSomNormal() } }
            data.forEach((p: Pedido) => { if (p.pixConfirmado && prevPixRef.current[p.id] === false) tocarSomPix(); prevPixRef.current[p.id] = !!p.pixConfirmado })
          } else {
            data.forEach((p: Pedido) => { prevPixRef.current[p.id] = !!p.pixConfirmado })
          }
          prevIdsRef.current = novosIds
          setPedidos(data); setLoading(false)
          if (!data.some((p: Pedido) => p.escalonado && p.status === "novo")) { pararPiscar(); pararSomRepetido() }
        }
      })
      .catch(() => setTimeout(carregarPedidos, 3000))
  }

  useEffect(() => {
    const user = getUserInfo()
    if (user) { setIsAdmin(user.role === "admin" || user.role === "dev"); setUserName(user.name || "Kellyne") }
    const savedMute = localStorage.getItem("chefebot-mute") === "true"
    if (savedMute) { setMuteado(true); muteadoRef.current = true }
    const solicitarNotificacao = async () => {
      if (!("Notification" in window)) return;
      if (Notification.permission === "default") {
        const perm = await Notification.requestPermission();
        if (perm === "granted") { new Notification("ChefeBot ativado! 🍕", { body: "Você vai receber alertas de novos pedidos.", icon: "/icon-192.png" }); }
      }
    };
    solicitarNotificacao();
    const inscreverPush = async () => {
      try {
        if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        if (existing) return;
        const res = await fetch("/api/push");
        const { publicKey } = await res.json();
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
        await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "subscribe", subscription: sub }) });
      } catch {}
    };
    inscreverPush();
    carregarPedidos(); carregarStatusBot()
    fetch("/api/entregadores").then(r => r.json()).then(d => setEntregadores(Array.isArray(d) ? d.filter((e: any) => e.ativo) : [])).catch(() => {})
    try { if (screen.orientation && (screen.orientation as any).lock) { (screen.orientation as any).lock("portrait").catch(() => {}); } } catch {}
    const handleInstall = (e: any) => { e.preventDefault(); setInstallPrompt(e); const jaInstalou = window.matchMedia("(display-mode: standalone)").matches; if (!jaInstalou) setShowInstallBanner(true); };
    window.addEventListener("beforeinstallprompt", handleInstall);
    let wakeLock: any = null;
    const ativarWakeLock = async () => { try { if ("wakeLock" in navigator) { wakeLock = await (navigator as any).wakeLock.request("screen"); } } catch {} };
    ativarWakeLock();
    const handleVisibility = () => { if (document.visibilityState === "visible") ativarWakeLock(); };
    document.addEventListener("visibilitychange", handleVisibility);
    const intervalo = setInterval(carregarPedidos, 3000)
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => { if (wakeLock) wakeLock.release(); document.removeEventListener("visibilitychange", handleVisibility); window.removeEventListener("beforeinstallprompt", handleInstall); clearInterval(intervalo); clearInterval(tick); if (piscarRef.current) clearInterval(piscarRef.current); if (somRepetidoRef.current) clearInterval(somRepetidoRef.current); document.title = tituloOriginalRef.current }
  }, [router])

  const limparHistorico = async () => {
    setLimpando(true)
    try {
      const r = await fetch("/api/orders", { method: "DELETE" })
      if (r.ok) setPedidos(prev => prev.filter(p => p.status !== "entregue"))
    } catch {}
    setLimpando(false); setModalLimpar(false)
  }

  const toggleMute = () => {
    const novo = !muteadoRef.current; muteadoRef.current = novo; setMuteado(novo); localStorage.setItem("chefebot-mute", String(novo))
  }

  const alternarBot = async () => {
    setSalvandoBot(true)
    try { const novo = !botAtivo; const r = await fetch("/api/bot-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ativo: novo }) }); if (r.ok) setBotAtivo(novo) } catch {}
    setSalvandoBot(false)
  }

  const assumirConversa = async (phone: string) => {
    try { await fetch("/api/assumir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone }) }); setManuais(prev => ({ ...prev, [phone]: true })) } catch {}
  }

  const marcarResolvido = async (phone: string, pedidoId: string) => {
    try {
      await fetch("/api/resolver", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone }) })
      setManuais(prev => ({ ...prev, [phone]: false }))
      setPedidos(prev => prev.map(p => p.id === pedidoId ? { ...p, escalonado: false, status: "em_preparo" } : p))
      pararPiscar()
    } catch {}
  }

  const avancarStatus = async (id: string, novoStatus: Status, entregador?: {id: string; nome: string; telefone: string}) => {
    const pedido = pedidos.find(p => p.id === id)
    if (!pedido) return
    const prevStatus = pedido.status
    const F2S: Record<string, Status> = { novo: "novo", em_preparo: "em_preparo", saiu_entrega: "saiu_entrega", entregue: "entregue" }
    const willLeave = filtro !== "todos" && F2S[filtro] === prevStatus
    setAtualizando(id)
    const r = await fetch("/api/orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status: novoStatus, entregador }) })
    if (r.ok) {
      setPedidos(prev => prev.map(p => p.id === id ? { ...p, status: novoStatus } : p))
      if (willLeave) { setLeavingId(id); if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current); leaveTimerRef.current = setTimeout(() => setLeavingId(null), 350) }
      else { setFlashId(id); if (flashTimerRef.current) clearTimeout(flashTimerRef.current); flashTimerRef.current = setTimeout(() => setFlashId(null), 750) }
      const firstName = pedido.cliente.split(" ")[0]
      if (novoStatus === "entregue") { tocarSomEntrega(); temposEntregaRef.current[id] = tempoDesde(pedido.horario, undefined, Date.now()) }
      setToast({ text: `${firstName} → ${STATUS_COLOR[novoStatus].label}`, expires: Date.now() + 5000, pedidoId: id, prevStatus })
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
      toastTimerRef.current = setTimeout(() => setToast(null), 5000)
    }
    setModalEntrega(null); setAtualizando(null); setModalAlterarStatus(null)
  }

  const cancelarPedido = async (id: string) => {
    setCancelandoId(id)
    await avancarStatus(id, "cancelado")
    setCancelandoId(null); setDetailId(null)
  }

  const salvarNovoPedido = async () => {
    const f = novoPedidoForm
    if (!f.cliente.trim() || !f.itens.filter(Boolean).length) return
    setSalvandoNovoPedido(true)
    try {
      const r = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliente: f.cliente.trim(),
          telefone: f.telefone.trim(),
          tipoEntrega: f.tipoEntrega,
          endereco: f.tipoEntrega === "delivery" ? f.endereco.trim() : f.tipoEntrega === "dine_in" ? "Consumo no local" : "Retirada na loja",
          bairro: f.tipoEntrega === "delivery" ? f.bairro.trim() : undefined,
          referencia: f.referencia.trim() || undefined,
          itens: f.itens.filter(Boolean),
          observacao: f.observacao.trim() || undefined,
          pagamento: f.pagamento || undefined,
          total: parseFloat(f.total.replace(",", ".")) || 0,
        }),
      })
      if (r.ok) {
        const novo = await r.json()
        setPedidos(prev => [novo, ...prev])
        setModalNovoPedido(false)
        setNovoPedidoForm({ cliente: "", telefone: "", tipoEntrega: "delivery", endereco: "", bairro: "", referencia: "", itens: [""], observacao: "", pagamento: "", total: "" })
        tocarSomNormal()
      }
    } catch {}
    setSalvandoNovoPedido(false)
  }

  const desfazerToast = () => {
    if (!toast) return
    setPedidos(prev => prev.map(p => p.id === toast.pedidoId ? { ...p, status: toast.prevStatus } : p))
    fetch("/api/orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: toast.pedidoId, status: toast.prevStatus }) })
    setToast(null); setFlashId(null)
  }

  const escalonados = pedidos.filter(p => p.escalonado && p.status === "novo")
  const emAberto = pedidos.filter(p => !["entregue", "cancelado"].includes(p.status)).length
  const totalHoje = pedidos.length
  const contagemPorStatus = (s: Status) => pedidos.filter(p => p.status === s).length

  const buscaNorm = busca.toLowerCase().trim()
  const pedidosFiltrados = (filtro === "todos" ? pedidos : pedidos.filter(p => p.status === filtro))
    .filter(p => {
      if (!buscaNorm) return true
      const num = String(p.numero || "")
      return (
        p.cliente.toLowerCase().includes(buscaNorm) ||
        p.telefone.replace(/\D/g, "").includes(buscaNorm.replace(/\D/g, "")) ||
        (p.bairro || "").toLowerCase().includes(buscaNorm) ||
        num.includes(buscaNorm)
      )
    })
    .sort((a, b) => { if (a.escalonado && !b.escalonado) return -1; if (!a.escalonado && b.escalonado) return 1; if (a.cancelamentoSolicitado && !b.cancelamentoSolicitado) return -1; return 0 })

  const detalhePedido = pedidos.find(p => p.id === detailId) || null

  useEffect(() => {
    if ("setAppBadge" in navigator) {
      if (emAberto > 0) (navigator as any).setAppBadge(emAberto);
      else (navigator as any).clearAppBadge();
    }
  }, [emAberto])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const filtroParam = params.get("filtro");
    const acaoParam = params.get("acao");
    if (filtroParam) setFiltro(filtroParam as any);
    if (acaoParam === "pausar") {
      fetch("/api/bot-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ativo: false }) }).then(() => setBotAtivo(false));
    }
  }, [])

  const toastSegs = toast ? Math.max(0, Math.ceil((toast.expires - now) / 1000)) : 0
  const toastVisible = !!toast && toast.expires > now
  const avaliacaoMedia = "4,9"
  const tempoMedioPreparo = (() => {
    const tempos: number[] = []
    for (const p of pedidos.filter(q => q.status === "entregue")) {
      if (p.horarioEntrega) {
        const [h1, m1] = p.horario.split(":").map(Number)
        const [h2, m2] = p.horarioEntrega.split(":").map(Number)
        const diff = (h2 * 60 + m2) - (h1 * 60 + m1)
        if (diff > 0 && diff < 300) tempos.push(diff)
      } else if (temposEntregaRef.current[p.id] !== undefined) {
        const t = temposEntregaRef.current[p.id]
        if (t > 0 && t < 300) tempos.push(t)
      }
    }
    return tempos.length > 0 ? Math.round(tempos.reduce((a, b) => a + b, 0) / tempos.length) : null
  })()
  const initials = userName.slice(0, 2).toUpperCase()

  const steps = [
    { key: "novo" as Status, stepLabel: "Novos", count: contagemPorStatus("novo") },
    { key: "em_preparo" as Status, stepLabel: "Fazendo", count: contagemPorStatus("em_preparo") },
    { key: "saiu_entrega" as Status, stepLabel: "Na rua", count: contagemPorStatus("saiu_entrega") },
    { key: "entregue" as Status, stepLabel: "Prontos", count: contagemPorStatus("entregue") },
  ]

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#060606", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center" }}><div style={{ fontSize: 36, marginBottom: 12 }}>🍕</div><p style={{ color: "#a39b8b", fontSize: 14, fontFamily: "'Archivo', sans-serif" }}>Carregando...</p></div>
    </div>
  )

  const inputStyle: React.CSSProperties = { width: "100%", height: 46, background: "#0b0b0b", border: "1px solid #242220", borderRadius: 12, padding: "0 14px", color: "#f5f2ee", fontSize: 14, fontFamily: "'Archivo', sans-serif", outline: "none", boxSizing: "border-box" }
  const labelStyle: React.CSSProperties = { display: "block", fontSize: 11, fontWeight: 900, color: "#56524b", textTransform: "uppercase", letterSpacing: ".8px", marginBottom: 6 }

  const showSimpleToast = (msg: string) => {
    setSimpleToast(msg); clearTimeout(simpleToastTimerRef.current)
    simpleToastTimerRef.current = setTimeout(() => setSimpleToast(""), 3500)
  }

  const confirmarPixManual = async (id: string) => {
    try {
      const r = await fetch("/api/orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, pixConfirmado: true }) })
      if (r.ok) {
        setPedidos(prev => prev.map(p => p.id === id ? { ...p, pixConfirmado: true } : p))
        setConfirmPixModal(null)
        showSimpleToast("Pix confirmado manualmente. Nenhuma mensagem foi enviada.")
      }
    } catch {}
  }

  const finalizarPedidoSilencioso = async (id: string) => {
    try {
      const r = await fetch("/api/orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status: "entregue", silent: true }) })
      if (r.ok) {
        setPedidos(prev => prev.map(p => p.id === id ? { ...p, status: "entregue" } : p))
        setFinalizarModal(null); setDetailId(null)
        showSimpleToast("Pedido finalizado internamente. Nenhuma mensagem foi enviada.")
      }
    } catch {}
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800;900&display=swap');
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        html, body { margin: 0; padding: 0; background: #060606; }
        button { cursor: pointer; font-family: 'Archivo', sans-serif; }
        @keyframes cbPulse { 0%{box-shadow:0 0 0 0 rgba(34,197,94,.55)} 70%{box-shadow:0 0 0 7px rgba(34,197,94,0)} 100%{box-shadow:0 0 0 0 rgba(34,197,94,0)} }
        @keyframes cbRedPulse { 0%{box-shadow:0 0 0 0 rgba(239,68,68,.5)} 70%{box-shadow:0 0 0 7px rgba(239,68,68,0)} 100%{box-shadow:0 0 0 0 rgba(239,68,68,0)} }
        @keyframes cbUrgentGlow { 0%,100%{border-color:rgba(239,68,68,.45)} 50%{border-color:rgba(239,68,68,.9)} }
        @keyframes cbGlowO { 0%,100%{box-shadow:0 0 0 0 rgba(255,107,0,.15)} 50%{box-shadow:0 0 0 10px rgba(255,107,0,.04)} }
        @keyframes cbGlowY { 0%,100%{box-shadow:0 0 0 0 rgba(250,204,21,.15)} 50%{box-shadow:0 0 0 10px rgba(250,204,21,.04)} }
        @keyframes cbGlowB { 0%,100%{box-shadow:0 0 0 0 rgba(96,165,250,.15)} 50%{box-shadow:0 0 0 10px rgba(96,165,250,.04)} }
        @keyframes cbGlowG { 0%,100%{box-shadow:0 0 0 0 rgba(34,197,94,.15)} 50%{box-shadow:0 0 0 10px rgba(34,197,94,.04)} }
        @keyframes cbGlowR { 0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.15)} 50%{box-shadow:0 0 0 10px rgba(239,68,68,.04)} }
        @keyframes cbCardIn { from{opacity:0;transform:translateY(16px) scale(.97)} to{opacity:1;transform:none} }
        @keyframes cbCardOut { to{opacity:0;transform:translateX(48px) scale(.96)} }
        @keyframes cbFlash { 0%{transform:scale(1)} 30%{transform:scale(1.012);box-shadow:0 0 0 3px rgba(255,107,0,.55)} 100%{transform:scale(1);box-shadow:0 0 0 0 rgba(255,107,0,0)} }
        @keyframes cbToastIn { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:none} }
        @keyframes cbSheetUp { from{transform:translateY(100%)} to{transform:none} }
        @keyframes cbFadeIn { from{opacity:0} to{opacity:1} }
        @keyframes cbCancelGlow { 0%,100%{border-color:rgba(239,68,68,.3)} 50%{border-color:rgba(239,68,68,.7)} }
        @keyframes cbShimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
        @keyframes cbWait { 0%,100%{opacity:1} 50%{opacity:.35} }
        .cb-header { background:#060606; border-bottom:1px solid #1a1816; padding:calc(env(safe-area-inset-top) + 12px) 16px 12px; position:sticky; top:0; z-index:10; }
        .cb-main { padding:12px 16px; display:flex; flex-direction:column; gap:14px; }
        .cbBusca::placeholder { color: #3a3730; }
        .cbBusca:focus { border-color: #ff6b00 !important; box-shadow: 0 0 0 3px rgba(255,107,0,.1); }
        .cbInput:focus { border-color: #ff6b00 !important; outline: none; }
        .cbPipeScroll { display:flex; gap:4px; overflow-x:auto; scrollbar-width:none; flex:1; }
        .cbPipeScroll::-webkit-scrollbar { display:none; }
        @media (min-width: 768px) {
          .cb-header { border-bottom:1px solid #1a1816; padding:24px 28px 20px; position:static; }
          .cb-main { padding:20px 28px; }
        }
      `}</style>

      <PanelShell
        pedidosCount={emAberto}
        conversasCount={escalonados.length}
        conversasUrgent={escalonados.some(p => Math.floor((Date.now() - (p.horarioEscalonado || parseInt(p.id))) / 60000) >= 8)}
      >

        {/* ── HEADER ── */}
        <header className="cb-header">
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: "-0.4px", lineHeight: 1.1 }}>Pedidos</div>
              <div style={{ fontSize: 11, color: "#5a564d", fontWeight: 700, marginTop: 2 }}>Controle de pedidos da pizzaria</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button onClick={toggleMute} title={muteado ? "Sons desativados" : "Sons ativados"} style={{ fontSize: 15, lineHeight: 1, background: muteado ? "rgba(239,68,68,.1)" : "transparent", border: `1px solid ${muteado ? "rgba(239,68,68,.35)" : "#242220"}`, padding: "5px 8px", borderRadius: 16 }}>{muteado ? "🔇" : "🔊"}</button>
              {isAdmin && <button onClick={() => router.push("/admin")} style={{ fontSize: 11, fontWeight: 800, color: "#a39b8b", background: "transparent", border: "1px solid #242220", padding: "6px 10px", borderRadius: 16 }}>Admin</button>}
              <button onClick={() => fetch("/api/auth/logout", { method: "POST" }).then(() => router.push("/login"))} style={{ fontSize: 11, fontWeight: 800, color: "#5a564d", background: "transparent", border: "1px solid #1f1d1a", padding: "6px 10px", borderRadius: 16 }}>Sair</button>
            </div>
          </div>

          {/* Bot toggle */}
          <button onClick={alternarBot} disabled={salvandoBot} style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "10px 12px", background: botAtivo ? "rgba(34,197,94,.06)" : "rgba(250,204,21,.06)", border: `1px solid ${botAtivo ? "rgba(34,197,94,.28)" : "rgba(250,204,21,.3)"}`, borderRadius: 12, color: "#f5f2ee", textAlign: "left", marginBottom: 10 }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: botAtivo ? "#22c55e" : "#facc15", flexShrink: 0, animation: botAtivo ? "cbPulse 2s infinite" : "none" }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: "-0.2px", color: "#f5f2ee" }}>{botAtivo ? "Bot atendendo" : "Bot pausado"}</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: botAtivo ? "#22c55e" : "#facc15", marginTop: 1 }}>{botAtivo ? "WhatsApp conectado" : "Você no comando"}</div>
            </div>
            <span style={{ fontSize: 11, fontWeight: 900, color: botAtivo ? "#22c55e" : "#facc15", background: "#060606", padding: "5px 10px", borderRadius: 8, flexShrink: 0 }}>{botAtivo ? "Pausar" : "Ativar"}</span>
          </button>

          {/* Métricas */}
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <div style={{ flex: 1, background: "#101010", border: "1px solid #1f1d1a", borderRadius: 12, padding: "10px 10px" }}>
              <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-1px", lineHeight: 1, color: "#f5f2ee" }}>{totalHoje}</div>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: "#5a564d", textTransform: "uppercase", letterSpacing: ".5px", marginTop: 2 }}>Hoje</div>
            </div>
            <div style={{ flex: 1, background: emAberto > 0 ? "#1a0d00" : "#101010", border: `1px solid ${emAberto > 0 ? "rgba(255,107,0,.5)" : "#1f1d1a"}`, borderRadius: 12, padding: "10px 10px" }}>
              <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-1px", lineHeight: 1, color: emAberto > 0 ? "#ff6b00" : "#3a3730" }}>{emAberto}</div>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: emAberto > 0 ? "rgba(255,107,0,.7)" : "#3a3730", textTransform: "uppercase", letterSpacing: ".5px", marginTop: 2 }}>Em aberto</div>
            </div>
            <div style={{ flex: 1, background: "#101010", border: "1px solid #1f1d1a", borderRadius: 12, padding: "10px 10px" }}>
              <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-1px", lineHeight: 1, color: "#22c55e" }}>{contagemPorStatus("entregue")}</div>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: "#5a564d", textTransform: "uppercase", letterSpacing: ".5px", marginTop: 2 }}>Prontos</div>
            </div>
            <div style={{ flex: 1, background: "#101010", border: "1px solid #1f1d1a", borderRadius: 12, padding: "10px 10px" }}>
              <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-1px", lineHeight: 1, color: "#60a5fa" }}>{tempoMedioPreparo !== null ? `${tempoMedioPreparo}` : "—"}<span style={{ fontSize: 10, fontWeight: 700, marginLeft: 2 }}>{tempoMedioPreparo !== null ? "m" : ""}</span></div>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: "#5a564d", textTransform: "uppercase", letterSpacing: ".5px", marginTop: 2 }}>⏱ Média</div>
            </div>
          </div>

          {/* Pipeline + Novo + Limpar */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <div className="cbPipeScroll">
              <button onClick={() => setFiltro("todos")} style={{ border: `1px solid ${filtro === "todos" ? "#ff6b00" : "#242220"}`, background: filtro === "todos" ? "#ff6b00" : "transparent", color: filtro === "todos" ? "#060606" : "#c9c2b4", fontSize: 11, fontWeight: 900, padding: "6px 11px", borderRadius: 14, flexShrink: 0 }}>Todos · {pedidos.length}</button>
              {steps.map((s) => {
                const active = filtro === s.key; const sc = STATUS_COLOR[s.key]
                return (
                  <button key={s.key} onClick={() => setFiltro(active ? "todos" : s.key)} style={{ border: `1px solid ${active ? sc.accentBorder : "#242220"}`, background: active ? sc.accentBg : "#101010", color: active ? sc.accent : "#c9c2b4", fontSize: 11, fontWeight: 900, padding: "6px 11px", borderRadius: 14, flexShrink: 0 }}>
                    {s.stepLabel} · {s.count}
                  </button>
                )
              })}
            </div>
            <button onClick={() => setModalNovoPedido(true)} style={{ height: 32, border: "1px solid rgba(255,107,0,.5)", background: "rgba(255,107,0,.1)", color: "#ff6b00", fontSize: 11, fontWeight: 900, padding: "0 10px", borderRadius: 10, flexShrink: 0 }}>+ Novo</button>
            <button onClick={() => setModalLimpar(true)} title="Limpar histórico" style={{ width: 32, height: 32, border: "1px solid #242220", borderRadius: 10, background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><polyline points="3,6 5,6 21,6" stroke="#5a564d" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" stroke="#5a564d" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/><path d="M10 11v6M14 11v6" stroke="#5a564d" strokeWidth="2.2" strokeLinecap="round"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" stroke="#5a564d" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>

          {/* Busca */}
          <div style={{ position: "relative" }}>
            <input className="cbBusca" type="text" placeholder="Buscar por nome, telefone, bairro ou #número..." value={busca} onChange={e => setBusca(e.target.value)} style={{ width: "100%", height: 44, background: "#101010", border: "1px solid #242220", borderRadius: 12, padding: "0 40px 0 14px", color: "#f5f2ee", fontSize: 13, fontWeight: 700, fontFamily: "'Archivo', sans-serif", outline: "none", boxSizing: "border-box" }} />
            {busca ? <button onClick={() => setBusca("")} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#5a564d", fontSize: 18, lineHeight: 1, padding: "4px", cursor: "pointer" }}>×</button>
              : <svg style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="#3a3730" strokeWidth="2.2"/><path d="M16.5 16.5l3.5 3.5" stroke="#3a3730" strokeWidth="2.2" strokeLinecap="round"/></svg>}
          </div>
        </header>

        {/* ── CONTEÚDO ── */}
        <main className="cb-main">

        {/* Install Banner */}
        {showInstallBanner && (
          <div style={{ padding: "0 0 2px" }}>
            <div style={{ padding: "14px 16px", background: "linear-gradient(135deg,rgba(255,107,0,.15),rgba(255,107,0,.05))", border: "1.5px solid rgba(255,107,0,.4)", borderRadius: 18, display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 32, flexShrink: 0 }}>🍕</span>
              <div style={{ flex: 1, minWidth: 0 }}><p style={{ margin: 0, fontSize: 14, fontWeight: 900, color: "#f4f1ec" }}>Instalar ChefeBot</p><p style={{ margin: "2px 0 0", fontSize: 11, fontWeight: 700, color: "#a39b8b" }}>Acesse mais rápido pela tela inicial</p></div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
                <button onClick={async () => { if (installPrompt) { installPrompt.prompt(); const r = await installPrompt.userChoice; if (r.outcome === "accepted") setShowInstallBanner(false); } }} style={{ border: "none", background: "#ff6b00", color: "#fff", fontSize: 12, fontWeight: 900, padding: "8px 14px", borderRadius: 10 }}>Instalar</button>
                <button onClick={() => setShowInstallBanner(false)} style={{ border: "none", background: "transparent", color: "#5a564d", fontSize: 11, fontWeight: 800, padding: "4px 0" }}>Agora não</button>
              </div>
            </div>
          </div>
        )}
        {/* Urgência */}
        {escalonados.length > 0 && !cardUrgenciaFechado && (
          <div style={{ padding: 16, borderRadius: 18, background: "rgba(239,68,68,.08)", border: "1.5px solid rgba(239,68,68,.45)", animation: "cbUrgentGlow 1.6s infinite", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#ef4444", animation: "cbRedPulse 1.6s infinite" }} />
              <span style={{ fontSize: 11, fontWeight: 900, color: "#ef4444", textTransform: "uppercase", letterSpacing: "1.2px" }}>Atendimento humano</span>
            </div>
            <div style={{ fontSize: 17, fontWeight: 900, letterSpacing: "-0.3px", lineHeight: 1.25 }}>{escalonados[0].cliente.split(" ")[0]} quer falar com você</div>
            <div style={{ fontSize: 13, color: "#c9c2b4", fontWeight: 600, lineHeight: 1.4 }}>O bot pausou a conversa e está esperando.</div>
            <button onClick={() => { assumirConversa(escalonados[0].telefone); setCardUrgenciaFechado(true) }} style={{ height: 52, border: "none", borderRadius: 14, background: "#ef4444", color: "#fff", fontSize: 16, fontWeight: 900, letterSpacing: "-0.2px" }}>Abrir conversa</button>
          </div>
        )}

        {/* Lista */}
          {pedidosFiltrados.length === 0 && (
            <div style={{ background: "#101010", border: "1px dashed #2a2723", borderRadius: 20, padding: "36px 20px", textAlign: "center" }}>
              <span style={{ fontSize: 17, fontWeight: 900, color: "#c9c2b4", display: "block" }}>Nada por aqui</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#a39b8b", display: "block", marginTop: 4 }}>Nenhum pedido nesse estado agora.</span>
            </div>
          )}

          {pedidosFiltrados.map(pedido => {
            const sc = STATUS_COLOR[pedido.status]
            const minsDesde = tempoDesde(pedido.horario, undefined, now)
            const minsPrep = tempoDesde(pedido.horario, pedido.horarioInicio, now)
            const meta = 40
            const isDineIn = pedido.tipoEntrega === "dine_in" || pedido.endereco === "Consumo no local"
            const nextStatus = (isDineIn && pedido.status === "em_preparo") ? "entregue" as Status : NEXT_STATUS[pedido.status]
            const isDone = pedido.status === "entregue"
            const isCanceled = pedido.status === "cancelado"
            const isNovo = pedido.status === "novo"
            const timerMins = isNovo ? minsDesde : minsPrep
            const timerLabel = isNovo ? (minsDesde === 0 ? "agora" : `aguardando ${minsDesde}m`) : isDone ? "concluído" : minsPrep > meta ? `${minsPrep - meta}m atrasado` : `meta ${meta} min`
            const timerColor = isNovo ? (minsDesde < 3 ? "#34d399" : minsDesde < 7 ? "#fbbf24" : "#f87171") : isDone ? "#34d399" : minsPrep < meta * 0.5 ? "#34d399" : minsPrep < meta * 0.85 ? "#fbbf24" : "#f87171"
            const CIRC = 131.9
            const progress = isNovo ? Math.min(minsDesde / 15, 1) : Math.min(minsPrep / meta, 1)
            const dash = CIRC * (1 - progress)
            const firstName = pedido.cliente.split(" ")[0]
            const clientInitial = pedido.cliente.charAt(0).toUpperCase()
            const pagamento = pedido.pagamento || ""
            const isPix = pagamento.toLowerCase().includes("pix")
            const pixPendente = isPix && !pedido.pixConfirmado && pedido.status === "novo"
            const pixConfirmado = isPix && !!pedido.pixConfirmado
            const hibridoParts = parseHybridPayment(pagamento)

            let cardAnim = `cbCardIn .35s ease both, ${sc.glow} 3.4s infinite`
            if (flashId === pedido.id) cardAnim = "cbFlash .7s ease"
            if (leavingId === pedido.id) cardAnim = "cbCardOut .3s ease both"

            let cardBorder = sc.cardBorder
            if (pedido.escalonado) cardBorder = "1.5px solid rgba(239,68,68,.6)"
            if (pedido.cancelamentoSolicitado) cardBorder = "1.5px solid rgba(239,68,68,.4)"

            const isRetirada = !isDineIn && (!pedido.tipoEntrega || pedido.tipoEntrega === "pickup" || pedido.tipoEntrega === "retirada" || pedido.endereco === "Retirada na loja")

            return (
              <article key={pedido.id} onClick={() => setDetailId(pedido.id)} style={{ background: sc.cardBg, border: cardBorder, borderRadius: 26, padding: 18, display: "flex", flexDirection: "column", gap: 12, animation: cardAnim, cursor: "pointer" }}>

                {/* Header */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 48, height: 48, borderRadius: 14, background: sc.accentBg, border: `2px solid ${sc.accentBorder}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <span style={{ fontSize: 18, fontWeight: 900, color: sc.accentSoft }}>{clientInitial}</span>
                    </div>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
                        {pedido.numero != null && <span style={{ background: "rgba(255,255,255,.08)", color: "#c9c2b4", fontSize: 11, fontWeight: 900, padding: "2px 7px", borderRadius: 7, border: "1px solid rgba(255,255,255,.12)", flexShrink: 0 }}>#{pedido.numero}</span>}
                        <span style={{ fontSize: 21, fontWeight: 900, letterSpacing: "-0.5px", lineHeight: 1, color: "#f4f1ec", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{firstName}</span>
                        <span style={{ background: sc.accentBg, color: sc.accent, fontSize: 10, fontWeight: 900, padding: "2px 8px", borderRadius: 8, letterSpacing: "0.5px", textTransform: "uppercase", border: `1px solid ${sc.accentBorder}` }}>{sc.label}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <div style={{ width: 20, height: 20, borderRadius: 5, background: isDineIn ? "rgba(167,139,250,.12)" : isRetirada ? "rgba(250,204,21,.12)" : "rgba(56,189,248,.12)", border: `1px solid ${isDineIn ? "rgba(167,139,250,.3)" : isRetirada ? "rgba(250,204,21,.3)" : "rgba(56,189,248,.3)"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          {isDineIn
                            ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 002-2V2" stroke="#a78bfa" strokeWidth="2.2" strokeLinecap="round"/><path d="M7 2v20M21 15V2a5 5 0 00-5 5v6h3.5" stroke="#a78bfa" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            : isRetirada
                            ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" stroke="#facc15" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            : <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h11a2 2 0 012 2v3" stroke="#38bdf8" strokeWidth="2.2" strokeLinecap="round"/><rect x="9" y="11" width="14" height="10" rx="2" stroke="#38bdf8" strokeWidth="2.2"/></svg>
                          }
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 700, color: isDineIn ? "#a78bfa" : isRetirada ? "#facc15" : "#38bdf8", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{isDineIn ? "Consumo no local" : isRetirada ? "Retirada na loja" : (pedido.bairro ? `${pedido.bairro} · ${pedido.endereco}` : pedido.endereco)}</span>
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, flexShrink: 0 }}>
                    <div style={{ position: "relative", width: 50, height: 50 }}>
                      <svg width="50" height="50" viewBox="0 0 50 50" style={{ transform: "rotate(-90deg)", display: "block" }}>
                        <circle cx="25" cy="25" r="21" fill="none" stroke={`${sc.accentBg}`} strokeWidth="4" />
                        <circle cx="25" cy="25" r="21" fill="none" stroke={isDone ? sc.accent : timerColor} strokeWidth="4" strokeLinecap="round" strokeDasharray="131.9" strokeDashoffset={isDone ? 0 : dash} style={{ transition: "stroke-dashoffset 1s linear, stroke .4s", animation: pixPendente ? "cbWait 2.2s infinite" : "none" }} />
                      </svg>
                      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                        <span style={{ fontSize: 13, fontWeight: 900, lineHeight: 1, color: isDone ? sc.accent : timerColor }}>{isNovo ? (minsDesde === 0 ? "0" : minsDesde) : timerMins}</span>
                        <span style={{ fontSize: 7.5, fontWeight: 800, color: "#a39b8b", letterSpacing: "1px" }}>MIN</span>
                      </div>
                    </div>
                    <span style={{ fontSize: 9, fontWeight: 800, color: isDone ? sc.accent : timerColor, letterSpacing: ".2px", whiteSpace: "nowrap" }}>{timerLabel}</span>
                  </div>
                </div>

                {/* Itens */}
                <div style={{ background: sc.accentBg, borderRadius: 14, padding: "10px 12px" }}>
                  {pedido.itens.map((item, i) => (
                    <div key={i}>
                      {i > 0 && <div style={{ height: 1, background: "rgba(255,255,255,.04)", margin: "6px 0" }} />}
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(255,255,255,.06)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 18 }}>{getItemIcon(item)}</div>
                        <p style={{ flex: 1, fontSize: 13, fontWeight: 800, color: "#f4f1ec", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item}</p>
                        <span style={{ fontSize: 12, fontWeight: 900, color: sc.accentSoft, background: "rgba(255,255,255,.06)", padding: "3px 9px", borderRadius: 7, flexShrink: 0 }}>×1</span>
                      </div>
                    </div>
                  ))}
                  {pedido.observacao && <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: "#facc15", background: "rgba(250,204,21,.08)", borderRadius: 8, padding: "6px 10px" }}>Obs: {pedido.observacao}</div>}
                </div>

                {/* Pagamento híbrido */}
                {hibridoParts && (
                  <div style={{ background: "rgba(250,204,21,.07)", border: "1px solid rgba(250,204,21,.2)", borderRadius: 12, padding: "10px 12px" }}>
                    <div style={{ fontSize: 10, fontWeight: 900, color: "#a39b8b", textTransform: "uppercase", letterSpacing: ".8px", marginBottom: 6 }}>Pagamento Misto</div>
                    {hibridoParts.map((p, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 800, color: "#fde68a", marginBottom: i < hibridoParts.length - 1 ? 3 : 0 }}>
                        <span>{p.metodo}</span><span>R$ {p.valor.toFixed(2).replace(".", ",")}</span>
                      </div>
                    ))}
                    <div style={{ borderTop: "1px solid rgba(250,204,21,.15)", marginTop: 6, paddingTop: 6, display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 900, color: "#facc15" }}>
                      <span>Total</span><span>R$ {pedido.total.toFixed(2).replace(".", ",")}</span>
                    </div>
                  </div>
                )}

                {/* Pix status */}
                {!hibridoParts && isPix && (
                  <div style={{ position: pixPendente ? "relative" : "static", overflow: "hidden", background: pixConfirmado ? "rgba(52,211,153,.08)" : "rgba(251,191,36,.07)", border: `1.5px solid ${pixConfirmado ? "rgba(52,211,153,.3)" : "rgba(251,191,36,.25)"}`, borderRadius: 14, padding: "10px 13px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    {pixPendente && <div style={{ position: "absolute", inset: 0, background: "linear-gradient(105deg,transparent 40%,rgba(251,191,36,.07) 50%,transparent 60%)", backgroundSize: "200% 100%", animation: "cbShimmer 2.2s infinite" }} />}
                    <div style={{ display: "flex", alignItems: "center", gap: 9, position: "relative" }}>
                      <div style={{ width: 32, height: 32, borderRadius: 9, background: pixConfirmado ? "rgba(52,211,153,.18)" : "rgba(251,191,36,.12)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {pixConfirmado ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" stroke="#34d399" strokeWidth="2.2" strokeLinecap="round"/><polyline points="22,4 12,14.01 9,11.01" stroke="#34d399" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          : <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#fbbf24" strokeWidth="2.2"/><polyline points="12,6 12,12 16,14" stroke="#fbbf24" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </div>
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 900, color: pixConfirmado ? "#34d399" : "#fbbf24", margin: 0 }}>{pixConfirmado ? "Pix confirmado" : "Aguardando Pix"}</p>
                        <p style={{ fontSize: 10, fontWeight: 700, color: pixConfirmado ? "#6ee7b7" : "#fcd34d", margin: "2px 0 0" }}>{pixConfirmado ? "Verificado automaticamente" : "Toque para ver o comprovante"}</p>
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0, position: "relative" }}>
                      <p style={{ fontSize: 9, fontWeight: 800, color: "#56524b", margin: 0, textTransform: "uppercase", letterSpacing: "0.5px" }}>VALOR</p>
                      <p style={{ fontSize: 15, fontWeight: 900, color: pixConfirmado ? "#6ee7b7" : "#fcd34d", margin: 0 }}>R$ {pedido.total.toFixed(2).replace(".", ",")}</p>
                    </div>
                  </div>
                )}

                {/* Pagamento não Pix, não híbrido */}
                {!hibridoParts && !isPix && pagamento && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: "#c9c2b4" }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: pagamento.toLowerCase().includes("cart") ? "#60a5fa" : "#facc15", flexShrink: 0 }} />
                    {pagamento}
                  </div>
                )}

                {/* Alerta cancelamento */}
                {pedido.cancelamentoSolicitado && (
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#ef4444", background: "rgba(239,68,68,.08)", borderRadius: 10, padding: "10px 12px", animation: "cbCancelGlow 1.5s infinite", border: "1px solid rgba(239,68,68,.3)" }}>⚠️ Cliente solicitou cancelamento</div>
                )}

                {/* Ações — normal */}
                {!isDone && !isCanceled && nextStatus && !pixPendente && !pedido.escalonado && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }} onClick={e => e.stopPropagation()}>
                    <button onClick={() => { if (nextStatus === "saiu_entrega" && entregadores.length > 0 && pedido.tipoEntrega !== "pickup") { setModalEntrega({ pedidoId: pedido.id, proxStatus: nextStatus }) } else { avancarStatus(pedido.id, nextStatus) } }} disabled={atualizando === pedido.id} style={{ height: 56, border: "none", borderRadius: 16, background: sc.btnBg, color: sc.btnFg, fontSize: 17, fontWeight: 900, letterSpacing: "-0.2px", opacity: atualizando === pedido.id ? 0.6 : 1 }}>
                      {atualizando === pedido.id ? "..." : (isDineIn && pedido.status === "em_preparo" ? "Pedido pronto! 🍽️" : ACTION_LABEL[pedido.status])}
                    </button>
                    <button onClick={e => { e.stopPropagation(); window.open(whatsappLink(pedido.telefone), "_blank"); }} style={{ height: 44, border: `1px solid ${sc.accentBorder}`, borderRadius: 13, background: "transparent", color: "#c9c2b4", fontSize: 13, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#25d366" }} />
                      Falar com {firstName} no WhatsApp
                    </button>
                    <button onClick={e => { e.stopPropagation(); setFinalizarModal(pedido.id) }} style={{ height: 38, border: "1px solid rgba(255,255,255,.07)", borderRadius: 12, background: "transparent", color: "#56524b", fontSize: 11, fontWeight: 800 }}>
                      Finalizar pedido
                    </button>
                  </div>
                )}

                {/* Ações — Pix pendente */}
                {pixPendente && !pedido.escalonado && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }} onClick={e => e.stopPropagation()}>
                    <div style={{ height: 56, border: "2px dashed #2a2723", borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 9 }}>
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><rect x="3" y="11" width="18" height="11" rx="2" stroke="#56524b" strokeWidth="2.2"/><path d="M7 11V7a5 5 0 0110 0v4" stroke="#56524b" strokeWidth="2.2" strokeLinecap="round"/></svg>
                      <span style={{ fontSize: 14, fontWeight: 800, color: "#56524b" }}>Libera ao confirmar Pix</span>
                    </div>
                    <button onClick={e => { e.stopPropagation(); setConfirmPixModal(pedido.id) }} style={{ height: 44, border: "1px solid rgba(251,191,36,.35)", borderRadius: 13, background: "rgba(251,191,36,.08)", color: "#fbbf24", fontSize: 13, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                      Confirmar Pix manualmente
                    </button>
                    <button onClick={e => { e.stopPropagation(); window.open(whatsappLink(pedido.telefone), "_blank"); }} style={{ height: 44, border: `1px solid ${sc.accentBorder}`, borderRadius: 13, background: "transparent", color: "#c9c2b4", fontSize: 13, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#25d366" }} />
                      Falar com {firstName} no WhatsApp
                    </button>
                  </div>
                )}

                {/* Ações — Escalonado */}
                {pedido.escalonado && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }} onClick={e => e.stopPropagation()}>
                    {pixPendente && <div style={{ height: 54, border: "2px dashed #2a2723", borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 9 }}><svg width="17" height="17" viewBox="0 0 24 24" fill="none"><rect x="3" y="11" width="18" height="11" rx="2" stroke="#56524b" strokeWidth="2.2"/><path d="M7 11V7a5 5 0 0110 0v4" stroke="#56524b" strokeWidth="2.2" strokeLinecap="round"/></svg><span style={{ fontSize: 14, fontWeight: 800, color: "#56524b" }}>Libera ao confirmar Pix</span></div>}
                    <button onClick={() => assumirConversa(pedido.telefone)} style={{ height: 50, border: "none", borderRadius: 14, background: "#ef4444", color: "#fff", fontSize: 15, fontWeight: 900 }}>Assumir conversa</button>
                    <button onClick={() => marcarResolvido(pedido.telefone, pedido.id)} style={{ height: 44, border: "1px solid rgba(239,68,68,.4)", borderRadius: 14, background: "rgba(239,68,68,.07)", color: "#f87171", fontSize: 14, fontWeight: 900 }}>✓ Resolvido</button>
                  </div>
                )}

                {isDone && <div style={{ height: 54, borderRadius: 16, background: "rgba(34,197,94,.1)", border: "1px solid rgba(34,197,94,.3)", color: "#22c55e", fontSize: 15, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center" }}>Entregue · tudo certo ✓</div>}
              </article>
            )
          })}
        </main>

      </PanelShell>

      {/* Toast */}
      {toastVisible && (
        <div style={{ position: "fixed", bottom: 96, left: 0, right: 0, margin: "0 auto", width: "calc(100% - 32px)", maxWidth: 343, background: "#1c1a16", border: "1px solid #33302a", borderRadius: 16, padding: "12px 12px 12px 16px", display: "flex", alignItems: "center", gap: 12, animation: "cbToastIn .25s ease both", zIndex: 50, boxShadow: "0 12px 32px rgba(0,0,0,.55)" }}>
          <span style={{ flex: 1, fontSize: 14, fontWeight: 800, letterSpacing: "-0.2px" }}>{toast?.text}</span>
          <button onClick={desfazerToast} style={{ border: "none", background: "rgba(255,107,0,.16)", color: "#ff6b00", fontWeight: 900, fontSize: 14, padding: "11px 14px", borderRadius: 11, flexShrink: 0 }}>Desfazer · {toastSegs}</button>
        </div>
      )}

      {/* Simple Toast */}
      {simpleToast && (
        <div style={{ position: "fixed", bottom: 96, left: 0, right: 0, margin: "0 auto", width: "calc(100% - 32px)", maxWidth: 343, background: "#1a1a0d", border: "1px solid rgba(251,191,36,.3)", borderRadius: 16, padding: "14px 16px", animation: "cbToastIn .25s ease both", zIndex: 50, boxShadow: "0 12px 32px rgba(0,0,0,.55)" }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: "#fbbf24" }}>{simpleToast}</span>
        </div>
      )}

      {/* Bottom sheet detalhe */}
        {detalhePedido && (
          <>
            <div onClick={() => setDetailId(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.62)", zIndex: 60, animation: "cbFadeIn .2s ease both" }} />
            <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, margin: "0 auto", maxWidth: 375, background: "#121110", border: "1px solid #242220", borderBottom: "none", borderRadius: "26px 26px 0 0", zIndex: 61, animation: "cbSheetUp .32s cubic-bezier(.2,.9,.3,1) both", padding: "10px 20px 26px", display: "flex", flexDirection: "column", gap: 12, maxHeight: "88vh", overflowY: "auto" }}>
              <div style={{ width: 44, height: 5, borderRadius: 3, background: "#2e2b26", margin: "2px auto 0", flexShrink: 0 }} />
              {(() => {
                const p = detalhePedido
                const mins = tempoDesde(p.horario, p.horarioInicio, now)
                const meta = 40
                const { dash, color: ringColor } = timerDash(mins, meta)
                const sc = STATUS_COLOR[p.status]
                const isDone = p.status === "entregue"
                const isCanceled = p.status === "cancelado"
                const isDineInDetail = p.tipoEntrega === "dine_in" || p.endereco === "Consumo no local"
                const nextStatus = (isDineInDetail && p.status === "em_preparo") ? "entregue" as Status : NEXT_STATUS[p.status]
                const firstName = p.cliente.split(" ")[0]
                const pagamento = p.pagamento || ""
                const isPix = pagamento.toLowerCase().includes("pix")
                const hibridoParts = parseHybridPayment(pagamento)
                const payDot = isPix ? "#22c55e" : pagamento.toLowerCase().includes("cart") ? "#60a5fa" : "#facc15"
                const isRetirada = !isDineInDetail && (!p.tipoEntrega || p.tipoEntrega === "pickup" || p.tipoEntrega === "retirada" || p.endereco === "Retirada na loja")
                return (
                  <>
                    {/* Cabeçalho */}
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 7 }}>
                        <span style={{ alignSelf: "flex-start", background: sc.accentBg, color: sc.accent, fontSize: 11, fontWeight: 900, letterSpacing: "1.2px", padding: "5px 10px", borderRadius: 8, textTransform: "uppercase", border: `1px solid ${sc.accentBorder}` }}>{sc.label}</span>
                        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900, letterSpacing: "-0.6px", lineHeight: 1.1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.numero != null ? `#${p.numero} · ` : ""}{p.cliente}</h2>
                        <span style={{ fontSize: 12, color: "#a39b8b", fontWeight: 600 }}>Recebido às {p.horario} · há {mins} min</span>
                      </div>
                      <div style={{ position: "relative", width: 50, height: 50, flexShrink: 0 }}>
                        <svg width="50" height="50" viewBox="0 0 50 50" style={{ transform: "rotate(-90deg)", display: "block" }}>
                          <circle cx="25" cy="25" r="21" fill="none" stroke="#1a1a1a" strokeWidth="4" />
                          <circle cx="25" cy="25" r="21" fill="none" stroke={isDone ? "#34d399" : ringColor} strokeWidth="4" strokeLinecap="round" strokeDasharray="131.9" strokeDashoffset={isDone ? 0 : dash} style={{ transition: "stroke-dashoffset 1s linear, stroke .4s" }} />
                        </svg>
                        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                          <span style={{ fontSize: 16, fontWeight: 900, lineHeight: 1, color: isDone ? "#34d399" : ringColor }}>{mins}</span>
                          <span style={{ fontSize: 7.5, fontWeight: 800, color: "#a39b8b", letterSpacing: "1px" }}>MIN</span>
                        </div>
                      </div>
                    </div>

                    {/* Informações completas */}
                    <div style={{ background: "#0b0b0b", borderRadius: 14, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                      {p.telefone && p.telefone !== "App" && (
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#5a564d" }}>Telefone</span>
                          <span style={{ fontSize: 13, fontWeight: 800, color: "#c9c2b4" }}>{p.telefone}</span>
                        </div>
                      )}
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#5a564d" }}>Tipo</span>
                        <span style={{ fontSize: 13, fontWeight: 800, color: isDineInDetail ? "#a78bfa" : isRetirada ? "#facc15" : "#38bdf8" }}>{isDineInDetail ? "Consumo no local 🍽️" : isRetirada ? "Retirada na loja" : "Delivery"}</span>
                      </div>
                      {!isRetirada && !isDineInDetail && (
                        <>
                          {p.bairro && <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 11, fontWeight: 700, color: "#5a564d" }}>Bairro</span><span style={{ fontSize: 13, fontWeight: 800, color: "#f4f1ec" }}>{p.bairro}</span></div>}
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: "#5a564d" }}>Endereço</span>
                            <span style={{ fontSize: 13, fontWeight: 800, color: "#f4f1ec", textAlign: "right", maxWidth: "60%" }}>{p.endereco}</span>
                          </div>
                          {p.referencia && <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 11, fontWeight: 700, color: "#5a564d" }}>Referência</span><span style={{ fontSize: 13, fontWeight: 800, color: "#f4f1ec", textAlign: "right", maxWidth: "60%" }}>{p.referencia}</span></div>}
                          {p.taxaEntrega != null && p.taxaEntrega > 0 && <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 11, fontWeight: 700, color: "#5a564d" }}>Taxa entrega</span><span style={{ fontSize: 13, fontWeight: 800, color: "#f4f1ec" }}>R$ {p.taxaEntrega.toFixed(2).replace(".", ",")}</span></div>}
                        </>
                      )}
                    </div>

                    {/* Itens */}
                    <div style={{ background: sc.accentBg, borderRadius: 14, padding: "12px 13px" }}>
                      <span style={{ fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: "1px", color: "#a39b8b", display: "block", marginBottom: 8 }}>Pedido</span>
                      {p.itens.map((item, i) => (
                        <div key={i}>
                          {i > 0 && <div style={{ height: 1, background: "rgba(255,255,255,.04)", margin: "6px 0" }} />}
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ width: 34, height: 34, borderRadius: 9, background: "rgba(255,255,255,.06)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 17 }}>{getItemIcon(item)}</div>
                            <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: "#f4f1ec" }}>{item}</span>
                            <span style={{ fontSize: 12, fontWeight: 900, color: sc.accentSoft, background: "rgba(255,255,255,.06)", padding: "3px 9px", borderRadius: 7, flexShrink: 0 }}>×1</span>
                          </div>
                        </div>
                      ))}
                      {p.observacao && <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: "#facc15", background: "rgba(250,204,21,.08)", borderRadius: 8, padding: "6px 10px" }}>Obs: {p.observacao}</div>}
                    </div>

                    {/* Pagamento detalhado */}
                    {hibridoParts ? (
                      <div style={{ background: "rgba(250,204,21,.07)", border: "1px solid rgba(250,204,21,.2)", borderRadius: 12, padding: "12px 14px" }}>
                        <div style={{ fontSize: 10, fontWeight: 900, color: "#a39b8b", textTransform: "uppercase", letterSpacing: ".8px", marginBottom: 8 }}>Pagamento Misto</div>
                        {hibridoParts.map((pp, i) => (
                          <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 800, color: "#fde68a", marginBottom: 4 }}>
                            <span>{pp.metodo}</span><span>R$ {pp.valor.toFixed(2).replace(".", ",")}</span>
                          </div>
                        ))}
                        <div style={{ borderTop: "1px solid rgba(250,204,21,.15)", marginTop: 6, paddingTop: 6, display: "flex", justifyContent: "space-between", fontSize: 16, fontWeight: 900, color: "#facc15" }}>
                          <span>Total</span><span>R$ {p.total.toFixed(2).replace(".", ",")}</span>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: "#c9c2b4" }}>
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: payDot, flexShrink: 0 }} />
                          {pagamento || "Pagamento não informado"}
                          {p.pixConfirmado && <span style={{ fontSize: 11, color: "#34d399", fontWeight: 800 }}>✓ confirmado</span>}
                        </div>
                        <span style={{ fontSize: 15, fontWeight: 900, color: "#f4f1ec" }}>R$ {p.total.toFixed(2).replace(".", ",")}</span>
                      </div>
                    )}

                    {/* Alterar status dropdown */}
                    {!isDone && !isCanceled && (
                      <div>
                        {modalAlterarStatus === p.id ? (
                          <div style={{ background: "#0b0b0b", border: "1px solid #242220", borderRadius: 14, overflow: "hidden" }}>
                            <div style={{ padding: "10px 14px", fontSize: 11, fontWeight: 900, color: "#56524b", textTransform: "uppercase", letterSpacing: ".8px" }}>Alterar status</div>
                            {STATUS_OPTS.map(opt => (
                              <button key={opt.value} onClick={() => avancarStatus(p.id, opt.value)} disabled={p.status === opt.value} style={{ width: "100%", padding: "12px 14px", background: p.status === opt.value ? STATUS_COLOR[opt.value].accentBg : "transparent", border: "none", borderTop: "1px solid #1a1a1a", color: p.status === opt.value ? STATUS_COLOR[opt.value].accent : "#c9c2b4", fontSize: 14, fontWeight: 800, textAlign: "left", cursor: p.status === opt.value ? "default" : "pointer" }}>
                                {opt.label} {p.status === opt.value && "· atual"}
                              </button>
                            ))}
                            <button onClick={() => setModalAlterarStatus(null)} style={{ width: "100%", padding: "12px 14px", background: "transparent", border: "none", borderTop: "1px solid #1a1a1a", color: "#5a564d", fontSize: 13, fontWeight: 800, textAlign: "center" }}>Cancelar</button>
                          </div>
                        ) : (
                          <button onClick={() => setModalAlterarStatus(p.id)} style={{ width: "100%", height: 44, border: "1px solid #242220", borderRadius: 12, background: "transparent", color: "#c9c2b4", fontSize: 13, fontWeight: 800 }}>Alterar status</button>
                        )}
                      </div>
                    )}

                    {/* Ação principal */}
                    {!isDone && !isCanceled && nextStatus && (
                      <button onClick={() => { avancarStatus(p.id, nextStatus); setDetailId(null) }} disabled={atualizando === p.id} style={{ height: 58, border: "none", borderRadius: 16, background: sc.btnBg, color: sc.btnFg, fontSize: 17, fontWeight: 900, letterSpacing: "-0.2px", flexShrink: 0, opacity: atualizando === p.id ? 0.6 : 1 }}>
                        {ACTION_LABEL[p.status]}
                      </button>
                    )}
                    {isDone && <div style={{ height: 54, borderRadius: 16, background: "rgba(34,197,94,.1)", border: "1px solid rgba(34,197,94,.3)", color: "#22c55e", fontSize: 15, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>Entregue · tudo certo ✓</div>}

                    {/* Confirmar Pix no detalhe */}
                    {isPix && !p.pixConfirmado && !isDone && (
                      <button onClick={() => { setDetailId(null); setConfirmPixModal(p.id) }} style={{ height: 46, border: "1px solid rgba(251,191,36,.35)", borderRadius: 14, background: "rgba(251,191,36,.08)", color: "#fbbf24", fontSize: 14, fontWeight: 900, flexShrink: 0 }}>
                        Confirmar Pix manualmente
                      </button>
                    )}

                    {/* Finalizar no detalhe */}
                    {!isDone && !isCanceled && (
                      <button onClick={() => { setDetailId(null); setFinalizarModal(p.id) }} style={{ height: 44, border: "1px solid rgba(255,255,255,.07)", borderRadius: 14, background: "transparent", color: "#56524b", fontSize: 13, fontWeight: 800, flexShrink: 0 }}>
                        Finalizar pedido
                      </button>
                    )}

                    {/* WhatsApp */}
                    {p.telefone && p.telefone !== "App" && (
                      <button onClick={() => window.open(whatsappLink(p.telefone), "_blank")} style={{ height: 46, border: "1px solid #2a2723", borderRadius: 14, background: "transparent", color: "#c9c2b4", fontSize: 14, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, flexShrink: 0 }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e" }} />
                        Falar com {firstName} no WhatsApp
                      </button>
                    )}

                    {/* Cancelar */}
                    {!isDone && !isCanceled && (
                      <button onClick={() => cancelarPedido(p.id)} disabled={cancelandoId === p.id} style={{ height: 46, border: "1px solid rgba(239,68,68,.35)", borderRadius: 14, background: "rgba(239,68,68,.06)", color: "#ef4444", fontSize: 14, fontWeight: 800, flexShrink: 0, opacity: cancelandoId === p.id ? 0.6 : 1 }}>
                        {cancelandoId === p.id ? "Cancelando..." : "Cancelar pedido"}
                      </button>
                    )}

                    <button onClick={() => setDetailId(null)} style={{ height: 44, border: "none", background: "transparent", color: "#a39b8b", fontSize: 14, fontWeight: 800, flexShrink: 0 }}>Fechar</button>
                  </>
                )
              })()}
            </div>
          </>
        )}

        {/* Modal entregador */}
        {modalEntrega && (
          <>
            <div onClick={() => setModalEntrega(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.62)", zIndex: 60, animation: "cbFadeIn .2s ease both" }} />
            <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, margin: "0 auto", maxWidth: 375, background: "#121110", border: "1px solid #242220", borderBottom: "none", borderRadius: "26px 26px 0 0", zIndex: 61, animation: "cbSheetUp .32s cubic-bezier(.2,.9,.3,1) both", padding: "20px 20px 36px", display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ width: 44, height: 5, borderRadius: 3, background: "#2e2b26", margin: "0 auto 6px" }} />
              <p style={{ margin: 0, fontSize: 18, fontWeight: 900, letterSpacing: "-0.3px" }}>Selecionar entregador</p>
              {entregadores.filter(e => e.ativo).map(e => (<button key={e.id} onClick={() => avancarStatus(modalEntrega.pedidoId, modalEntrega.proxStatus, e)} style={{ height: 56, border: "1px solid #242220", borderRadius: 16, background: "#101010", color: "#f5f2ee", fontSize: 16, fontWeight: 800, textAlign: "left", padding: "0 16px" }}>{e.nome}</button>))}
              <button onClick={() => avancarStatus(modalEntrega.pedidoId, modalEntrega.proxStatus)} style={{ height: 48, border: "1px solid #2a2723", borderRadius: 14, background: "transparent", color: "#a39b8b", fontSize: 14, fontWeight: 800 }}>Sem entregador</button>
            </div>
          </>
        )}

        {/* Modal limpar histórico */}
        {modalLimpar && (
          <>
            <div onClick={() => setModalLimpar(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 60, animation: "cbFadeIn .2s ease both" }} />
            <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, margin: "0 auto", maxWidth: 375, background: "#121110", border: "1px solid #242220", borderBottom: "none", borderRadius: "26px 26px 0 0", zIndex: 61, animation: "cbSheetUp .32s cubic-bezier(.2,.9,.3,1) both", padding: "20px 20px 36px", display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ width: 44, height: 5, borderRadius: 3, background: "#2e2b26", margin: "0 auto 4px" }} />
              <div style={{ width: 48, height: 48, borderRadius: 14, background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><polyline points="3,6 5,6 21,6" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/><path d="M10 11v6M14 11v6" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <p style={{ margin: 0, fontSize: 19, fontWeight: 900, letterSpacing: "-0.4px", lineHeight: 1.2 }}>Tem certeza?</p>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#a39b8b", lineHeight: 1.5 }}>Isso vai arquivar todos os pedidos entregues. Pedidos em aberto não serão afetados.</p>
              </div>
              <button onClick={limparHistorico} disabled={limpando} style={{ height: 56, border: "none", borderRadius: 16, background: limpando ? "#7f1d1d" : "#ef4444", color: "#fff", fontSize: 16, fontWeight: 900, letterSpacing: "-0.2px", opacity: limpando ? 0.7 : 1 }}>
                {limpando ? "Arquivando..." : "Sim, arquivar entregues"}
              </button>
              <button onClick={() => setModalLimpar(false)} disabled={limpando} style={{ height: 46, border: "none", background: "transparent", color: "#a39b8b", fontSize: 14, fontWeight: 800 }}>Cancelar</button>
            </div>
          </>
        )}

        {/* Modal Novo Pedido */}
        {modalNovoPedido && (
          <>
            <div onClick={() => setModalNovoPedido(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 70, animation: "cbFadeIn .2s ease both" }} />
            <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, margin: "0 auto", maxWidth: 375, background: "#121110", border: "1px solid #242220", borderBottom: "none", borderRadius: "26px 26px 0 0", zIndex: 71, animation: "cbSheetUp .32s cubic-bezier(.2,.9,.3,1) both", padding: "12px 20px 32px", display: "flex", flexDirection: "column", gap: 12, maxHeight: "90vh", overflowY: "auto" }}>
              <div style={{ width: 44, height: 5, borderRadius: 3, background: "#2e2b26", margin: "0 auto 4px", flexShrink: 0 }} />
              <p style={{ margin: 0, fontSize: 19, fontWeight: 900, letterSpacing: "-0.4px", flexShrink: 0 }}>Novo pedido</p>

              <div>
                <label style={labelStyle}>Cliente *</label>
                <input className="cbInput" value={novoPedidoForm.cliente} onChange={e => setNovoPedidoForm(f => ({ ...f, cliente: e.target.value }))} placeholder="Nome do cliente" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Telefone</label>
                <input className="cbInput" value={novoPedidoForm.telefone} onChange={e => setNovoPedidoForm(f => ({ ...f, telefone: e.target.value }))} placeholder="(86) 99999-9999" style={inputStyle} type="tel" />
              </div>
              <div>
                <label style={labelStyle}>Tipo</label>
                <div style={{ display: "flex", gap: 8 }}>
                  {(["delivery", "retirada", "dine_in"] as const).map(t => (
                    <button key={t} onClick={() => setNovoPedidoForm(f => ({ ...f, tipoEntrega: t }))} style={{ flex: 1, height: 40, border: `1px solid ${novoPedidoForm.tipoEntrega === t ? "#ff6b00" : "#242220"}`, borderRadius: 10, background: novoPedidoForm.tipoEntrega === t ? "rgba(255,107,0,.15)" : "transparent", color: novoPedidoForm.tipoEntrega === t ? "#ff6b00" : "#5a564d", fontSize: 13, fontWeight: 900 }}>
                      {t === "delivery" ? "🛵 Entrega" : t === "dine_in" ? "🍽️ Local" : "🏪 Retirada"}
                    </button>
                  ))}
                </div>
              </div>
              {novoPedidoForm.tipoEntrega === "delivery" && (
                <>
                  <div>
                    <label style={labelStyle}>Endereço</label>
                    <input className="cbInput" value={novoPedidoForm.endereco} onChange={e => setNovoPedidoForm(f => ({ ...f, endereco: e.target.value }))} placeholder="Rua, número" style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Bairro</label>
                    <input className="cbInput" value={novoPedidoForm.bairro} onChange={e => setNovoPedidoForm(f => ({ ...f, bairro: e.target.value }))} placeholder="Centro, Tucum..." style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Referência</label>
                    <input className="cbInput" value={novoPedidoForm.referencia} onChange={e => setNovoPedidoForm(f => ({ ...f, referencia: e.target.value }))} placeholder="Perto do mercado..." style={inputStyle} />
                  </div>
                </>
              )}
              <div>
                <label style={labelStyle}>Itens *</label>
                {novoPedidoForm.itens.map((item, i) => (
                  <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                    <input className="cbInput" value={item} onChange={e => { const arr = [...novoPedidoForm.itens]; arr[i] = e.target.value; setNovoPedidoForm(f => ({ ...f, itens: arr })) }} placeholder={`Item ${i + 1}`} style={{ ...inputStyle, flex: 1 }} />
                    {novoPedidoForm.itens.length > 1 && <button onClick={() => setNovoPedidoForm(f => ({ ...f, itens: f.itens.filter((_, j) => j !== i) }))} style={{ width: 40, height: 46, border: "1px solid #242220", borderRadius: 10, background: "transparent", color: "#ef4444", fontSize: 18, flexShrink: 0 }}>×</button>}
                  </div>
                ))}
                <button onClick={() => setNovoPedidoForm(f => ({ ...f, itens: [...f.itens, ""] }))} style={{ height: 36, width: "100%", border: "1px dashed #242220", borderRadius: 10, background: "transparent", color: "#5a564d", fontSize: 13, fontWeight: 800 }}>+ Adicionar item</button>
              </div>
              <div>
                <label style={labelStyle}>Observação</label>
                <input className="cbInput" value={novoPedidoForm.observacao} onChange={e => setNovoPedidoForm(f => ({ ...f, observacao: e.target.value }))} placeholder="Sem cebola, bem passado..." style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Forma de pagamento</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {["Pix", "Dinheiro", "Cartão", "Misto"].map(p => (
                    <button key={p} onClick={() => setNovoPedidoForm(f => ({ ...f, pagamento: p }))} style={{ height: 36, padding: "0 14px", border: `1px solid ${novoPedidoForm.pagamento === p ? "#ff6b00" : "#242220"}`, borderRadius: 10, background: novoPedidoForm.pagamento === p ? "rgba(255,107,0,.15)" : "transparent", color: novoPedidoForm.pagamento === p ? "#ff6b00" : "#5a564d", fontSize: 12, fontWeight: 900 }}>{p}</button>
                  ))}
                </div>
              </div>
              <div>
                <label style={labelStyle}>Total (R$)</label>
                <input className="cbInput" value={novoPedidoForm.total} onChange={e => setNovoPedidoForm(f => ({ ...f, total: e.target.value }))} placeholder="0,00" style={inputStyle} inputMode="decimal" />
              </div>
              <button onClick={salvarNovoPedido} disabled={salvandoNovoPedido || !novoPedidoForm.cliente.trim() || !novoPedidoForm.itens.filter(Boolean).length} style={{ height: 56, border: "none", borderRadius: 16, background: "linear-gradient(180deg,#ff7d1a,#ff6b00)", color: "#fff", fontSize: 17, fontWeight: 900, opacity: (salvandoNovoPedido || !novoPedidoForm.cliente.trim() || !novoPedidoForm.itens.filter(Boolean).length) ? 0.5 : 1, flexShrink: 0 }}>
                {salvandoNovoPedido ? "Salvando..." : "Criar pedido"}
              </button>
              <button onClick={() => setModalNovoPedido(false)} style={{ height: 44, border: "none", background: "transparent", color: "#a39b8b", fontSize: 14, fontWeight: 800, flexShrink: 0 }}>Cancelar</button>
            </div>
          </>
        )}

      {/* Modal Confirmar Pix */}
      {confirmPixModal && (
        <>
          <div onClick={() => setConfirmPixModal(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 70, animation: "cbFadeIn .2s ease both" }} />
          <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, margin: "0 auto", maxWidth: 480, background: "#121110", border: "1px solid #242220", borderBottom: "none", borderRadius: "26px 26px 0 0", zIndex: 71, animation: "cbSheetUp .32s cubic-bezier(.2,.9,.3,1) both", padding: "20px 20px 36px", display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ width: 44, height: 5, borderRadius: 3, background: "#2e2b26", margin: "0 auto 4px" }} />
            <div style={{ width: 48, height: 48, borderRadius: 14, background: "rgba(251,191,36,.1)", border: "1px solid rgba(251,191,36,.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#fbbf24" strokeWidth="2.2"/><polyline points="12,6 12,12 16,14" stroke="#fbbf24" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <p style={{ margin: 0, fontSize: 19, fontWeight: 900, letterSpacing: "-0.4px", lineHeight: 1.2 }}>Confirmar Pix manualmente?</p>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#a39b8b", lineHeight: 1.5 }}>Use apenas se o pagamento já foi verificado. Nenhuma mensagem será enviada ao cliente.</p>
            </div>
            <button onClick={() => confirmarPixManual(confirmPixModal)} style={{ height: 56, border: "none", borderRadius: 16, background: "#fbbf24", color: "#060606", fontSize: 16, fontWeight: 900 }}>Confirmar Pix</button>
            <button onClick={() => setConfirmPixModal(null)} style={{ height: 46, border: "none", background: "transparent", color: "#a39b8b", fontSize: 14, fontWeight: 800 }}>Cancelar</button>
          </div>
        </>
      )}

      {/* Modal Finalizar Pedido */}
      {finalizarModal && (
        <>
          <div onClick={() => setFinalizarModal(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 70, animation: "cbFadeIn .2s ease both" }} />
          <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, margin: "0 auto", maxWidth: 480, background: "#121110", border: "1px solid #242220", borderBottom: "none", borderRadius: "26px 26px 0 0", zIndex: 71, animation: "cbSheetUp .32s cubic-bezier(.2,.9,.3,1) both", padding: "20px 20px 36px", display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ width: 44, height: 5, borderRadius: 3, background: "#2e2b26", margin: "0 auto 4px" }} />
            <div style={{ width: 48, height: 48, borderRadius: 14, background: "rgba(34,197,94,.1)", border: "1px solid rgba(34,197,94,.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" stroke="#22c55e" strokeWidth="2.2" strokeLinecap="round"/><polyline points="22,4 12,14.01 9,11.01" stroke="#22c55e" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <p style={{ margin: 0, fontSize: 19, fontWeight: 900, letterSpacing: "-0.4px", lineHeight: 1.2 }}>Finalizar pedido?</p>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#a39b8b", lineHeight: 1.5 }}>O pedido será marcado como finalizado no painel. Nenhuma mensagem será enviada ao cliente.</p>
            </div>
            <button onClick={() => finalizarPedidoSilencioso(finalizarModal)} style={{ height: 56, border: "none", borderRadius: 16, background: "#22c55e", color: "#060606", fontSize: 16, fontWeight: 900 }}>Finalizar pedido</button>
            <button onClick={() => setFinalizarModal(null)} style={{ height: 46, border: "none", background: "transparent", color: "#a39b8b", fontSize: 14, fontWeight: 800 }}>Cancelar</button>
          </div>
        </>
      )}

      {/* OLD_SIDEBAR - REMOVED */}
      {false && <aside style={{ display: "none" }}>
        <div style={{ fontSize: 9, fontWeight: 900, textTransform: "uppercase", letterSpacing: "1.2px", color: "#3a3730", marginBottom: 4 }}>Dashboard</div>

        {/* Bot status */}
        <div style={{ padding: "12px 14px", borderRadius: 13, background: botAtivo ? "rgba(34,197,94,.06)" : "rgba(250,204,21,.06)", border: `1px solid ${botAtivo ? "rgba(34,197,94,.25)" : "rgba(250,204,21,.28)"}`, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: botAtivo ? "#22c55e" : "#facc15", flexShrink: 0, animation: botAtivo ? "cbPulse 2s infinite" : "none" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 900, color: "#f5f2ee" }}>{botAtivo ? "Bot atendendo" : "Bot pausado"}</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: botAtivo ? "#22c55e" : "#facc15", marginTop: 1 }}>{botAtivo ? "WhatsApp ativo" : "Você no comando"}</div>
          </div>
        </div>

        {/* Métricas */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div style={{ background: "#0e0e0e", border: "1px solid #1a1816", borderRadius: 11, padding: "11px 10px" }}>
              <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-1px", lineHeight: 1, color: "#f5f2ee" }}>{totalHoje}</div>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: "#3a3730", textTransform: "uppercase", letterSpacing: ".5px", marginTop: 3 }}>Hoje</div>
            </div>
            <div style={{ background: emAberto > 0 ? "#1a0d00" : "#0e0e0e", border: `1px solid ${emAberto > 0 ? "rgba(255,107,0,.45)" : "#1a1816"}`, borderRadius: 11, padding: "11px 10px" }}>
              <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-1px", lineHeight: 1, color: emAberto > 0 ? "#ff6b00" : "#3a3730" }}>{emAberto}</div>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: emAberto > 0 ? "rgba(255,107,0,.6)" : "#3a3730", textTransform: "uppercase", letterSpacing: ".5px", marginTop: 3 }}>Em aberto</div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div style={{ background: "#0e0e0e", border: "1px solid #1a1816", borderRadius: 11, padding: "11px 10px" }}>
              <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-1px", lineHeight: 1, color: "#22c55e" }}>{pedidos.filter(p => p.status === "entregue").length}</div>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: "#3a3730", textTransform: "uppercase", letterSpacing: ".5px", marginTop: 3 }}>Entregues</div>
            </div>
            <div style={{ background: "#0e0e0e", border: "1px solid #1a1816", borderRadius: 11, padding: "11px 10px" }}>
              <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-1px", lineHeight: 1, color: "#60a5fa" }}>{tempoMedioPreparo !== null ? `${tempoMedioPreparo}` : "--"}<span style={{ fontSize: 11, fontWeight: 700, marginLeft: 2 }}>{tempoMedioPreparo !== null ? "m" : ""}</span></div>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: "#3a3730", textTransform: "uppercase", letterSpacing: ".5px", marginTop: 3 }}>⏱ Média</div>
            </div>
          </div>
        </div>

        {/* Divisor */}
        <div style={{ height: 1, background: "#1a1816", margin: "4px 0" }} />

        {/* Navegação */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <button
            onClick={() => router.push("/conversas")}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderRadius: 12, border: escalonados.length > 0 ? "1px solid rgba(239,68,68,.35)" : "1px solid #1e1c19", background: escalonados.length > 0 ? "rgba(239,68,68,.05)" : "#0e0e0e", cursor: "pointer", fontFamily: "'Archivo', sans-serif" }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="14" rx="5" stroke={escalonados.length > 0 ? "#ef4444" : "#5a564d"} strokeWidth="2.2"/><circle cx="8.5" cy="11" r="1.4" fill={escalonados.length > 0 ? "#ef4444" : "#5a564d"}/><circle cx="12" cy="11" r="1.4" fill={escalonados.length > 0 ? "#ef4444" : "#5a564d"}/><circle cx="15.5" cy="11" r="1.4" fill={escalonados.length > 0 ? "#ef4444" : "#5a564d"}/></svg>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 800, color: escalonados.length > 0 ? "#ef4444" : "#8a8278", textAlign: "left" }}>Conversas</span>
            {escalonados.length > 0 && <span style={{ minWidth: 20, height: 20, borderRadius: 10, background: "#ef4444", color: "#fff", fontSize: 11, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>{escalonados.length}</span>}
          </button>
          <button
            onClick={() => router.push("/cardapio")}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderRadius: 12, border: "1px solid #1e1c19", background: "#0e0e0e", cursor: "pointer", fontFamily: "'Archivo', sans-serif" }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="7" height="7" rx="2" stroke="#5a564d" strokeWidth="2.2"/><rect x="13" y="4" width="7" height="7" rx="2" stroke="#5a564d" strokeWidth="2.2"/><rect x="4" y="13" width="7" height="7" rx="2" stroke="#5a564d" strokeWidth="2.2"/><rect x="13" y="13" width="7" height="7" rx="2" stroke="#5a564d" strokeWidth="2.2"/></svg>
            <span style={{ fontSize: 13, fontWeight: 800, color: "#8a8278", textAlign: "left" }}>Cardápio</span>
          </button>
        </div>
      </aside>}
    </>
  )
}
