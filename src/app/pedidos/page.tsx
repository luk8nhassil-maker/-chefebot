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
  isArchived?: boolean
  archivedAt?: string
  archivedBy?: string
  archivedReason?: string
  origem?: string
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

function imprimirPedidoSilencioso(id: string) {
  if (typeof window === "undefined") return

  const iframe = document.createElement("iframe")
  iframe.src = `/pedidos/${id}/imprimir?auto=1&embedded=1`
  iframe.style.position = "fixed"
  iframe.style.right = "0"
  iframe.style.bottom = "0"
  iframe.style.width = "0"
  iframe.style.height = "0"
  iframe.style.border = "0"
  iframe.style.opacity = "0"
  iframe.setAttribute("aria-hidden", "true")

  document.body.appendChild(iframe)

  const remover = () => {
    setTimeout(() => {
      try { iframe.remove() } catch {}
    }, 1000)
  }

  iframe.onload = () => {
    try {
      iframe.contentWindow?.addEventListener("afterprint", remover)
    } catch {}
  }

  setTimeout(remover, 30000)
}

export default function PedidosPage() {
  const router = useRouter()
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [filtro, setFiltro] = useState<Status | "todos" | "tempo_real" | "arquivados">("novo")
  const [sessoes, setSessoes] = useState<any[]>([])
  const [assumindoSessao, setAssumindoSessao] = useState<string | null>(null)
  const [devolvendoSessaoBot, setDevolvendoSessaoBot] = useState<string | null>(null)
  const [revivendoConversa, setRevivendoConversa] = useState<string | null>(null)
  const [mensagemHumana, setMensagemHumana] = useState<Record<string, string>>({})
  const [enviandoMensagem, setEnviandoMensagem] = useState<string | null>(null)
  const [erroEnvioMensagem, setErroEnvioMensagem] = useState<Record<string, string>>({})
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
  const [pedidosArquivados, setPedidosArquivados] = useState<Pedido[]>([])
  const [carregandoArquivados, setCarregandoArquivados] = useState(false)
  const [modalArquivarExpediente, setModalArquivarExpediente] = useState(false)
  const [arquivandoExpediente, setArquivandoExpediente] = useState(false)
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
  const [sessaoAtiva, setSessaoAtiva] = useState<string | null>(null)
  const [historicoMsgs, setHistoricoMsgs] = useState<{autor:string;texto:string;ts?:number}[]>([])

  type PedidoCombinadoRascunho = {
    cliente: string; telefone: string; tipoEntrega: "delivery" | "retirada" | "dine_in" | ""
    endereco: string; bairro: string; referencia: string; itens: string[]
    total: number; pagamento: string; troco: string; observacao: string
  }
  type MensagemRelevante = { autor: "cliente" | "atendente" | "bot"; texto: string; ts?: number }

  const [modalPedidoCombinado, setModalPedidoCombinado] = useState(false)
  const [pedidoCombinadoPhone, setPedidoCombinadoPhone] = useState<string | null>(null)
  const [pedidoCombinadoRascunho, setPedidoCombinadoRascunho] = useState<PedidoCombinadoRascunho | null>(null)
  const [pedidoCombinadoPendencias, setPedidoCombinadoPendencias] = useState<string[]>([])
  const [pedidoCombinadoConversa, setPedidoCombinadoConversa] = useState<MensagemRelevante[]>([])
  const [carregandoPedidoCombinado, setCarregandoPedidoCombinado] = useState(false)
  const [criandoPedidoCombinado, setCriandoPedidoCombinado] = useState(false)

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
  const historicoBottomRef = useRef<HTMLDivElement>(null)
  const sendInFlightRef = useRef(false)

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

  useEffect(() => {
    if (filtro !== "arquivados") return
    setCarregandoArquivados(true)
    fetch("/api/orders?arquivados=true")
      .then(r => r.ok ? r.json() : [])
      .then(d => { setPedidosArquivados(Array.isArray(d) ? d : []); setCarregandoArquivados(false) })
      .catch(() => setCarregandoArquivados(false))
  }, [filtro])

  useEffect(() => {
    if (filtro !== "tempo_real") return
    const carregarSessoes = () => {
      fetch("/api/sessoes-ativas")
        .then(r => r.ok ? r.json() : [])
        .then(d => Array.isArray(d) ? setSessoes(d) : setSessoes([]))
        .catch(() => {})
    }
    carregarSessoes()
    const iv = setInterval(carregarSessoes, 3000)
    return () => clearInterval(iv)
  }, [filtro])

  useEffect(() => {
    if (filtro !== "tempo_real") {
      setSessaoAtiva(null)
      setHistoricoMsgs([])
    }
  }, [filtro])

  useEffect(() => {
    if (!sessaoAtiva || filtro !== "tempo_real") return
    carregarHistoricoConversa(sessaoAtiva)
    const iv = setInterval(() => carregarHistoricoConversa(sessaoAtiva), 3000)
    return () => clearInterval(iv)
  }, [sessaoAtiva, filtro])

  useEffect(() => {
    historicoBottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [historicoMsgs])

  const limparHistorico = async () => {
    setLimpando(true)
    try {
      const r = await fetch("/api/orders", { method: "DELETE" })
      if (r.ok) setPedidos(prev => prev.filter(p => p.status !== "entregue"))
    } catch {}
    setLimpando(false); setModalLimpar(false)
  }

  const arquivarExpediente = async () => {
    setArquivandoExpediente(true)
    try {
      const r = await fetch("/api/arquivar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ todos: true }) })
      if (r.ok) {
        // Remove pedidos não-finalizados da lista ativa sem recarregar a página
        setPedidos(prev => prev.filter(p => p.status === "entregue" || p.status === "cancelado"))
        setModalArquivarExpediente(false)
        showSimpleToast("Pedidos não resolvidos arquivados com sucesso.")
      }
    } catch {}
    setArquivandoExpediente(false)
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
    try { await fetch("/api/assumir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ telefone: phone }) }); setManuais(prev => ({ ...prev, [phone]: true })) } catch {}
  }

  const assumirSessao = async (phone: string) => {
    setAssumindoSessao(phone)
    try {
      await fetch("/api/assumir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ telefone: phone }) })
      setSessoes(prev => prev.map(s => s.phone === phone ? { ...s, manual: true, postOrderPriority: false } : s))
    } catch {}
    setAssumindoSessao(null)
  }

  const devolverSessaoParaBot = async (phone: string) => {
    setDevolvendoSessaoBot(phone)
    try {
      await fetch("/api/devolver-para-bot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ telefone: phone }) })
      setSessoes(prev => prev.map(s => s.phone === phone ? { ...s, manual: false } : s))
    } catch {}
    setDevolvendoSessaoBot(null)
  }

  const reviverConversa = async (phone: string) => {
    if (!confirm("Reviver conversa e devolver para o robô?")) return
    setRevivendoConversa(phone)
    try {
      await fetch("/api/conversas/reviver", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone }) })
      setSessoes(prev => prev.map(s => s.phone === phone ? { ...s, manual: false } : s))
    } catch {}
    setRevivendoConversa(null)
  }

  const enviarMensagemHumana = async (phone: string) => {
    // Trava síncrona: bloqueia envios duplicados (ex.: Enter apertado 2x rápido)
    // antes de qualquer await ou atualização de estado assíncrona.
    if (sendInFlightRef.current) return
    const texto = (mensagemHumana[phone] || "").trim()
    if (!texto) return
    sendInFlightRef.current = true
    setEnviandoMensagem(phone)
    setErroEnvioMensagem(prev => ({ ...prev, [phone]: "" }))
    try {
      const r = await fetch("/api/conversas/enviar-mensagem-humana", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, text: texto, senderName: userName || "Kellyne" }),
      })
      const data = await r.json()
      if (data.ok) {
        setMensagemHumana(prev => ({ ...prev, [phone]: "" }))
        setHistoricoMsgs(prev => [...prev, { autor: "atendente", texto: `[${userName || "Kellyne"}] ${texto}`, ts: Date.now() }])
      } else {
        setErroEnvioMensagem(prev => ({ ...prev, [phone]: data.error || "Erro ao enviar." }))
      }
    } catch {
      setErroEnvioMensagem(prev => ({ ...prev, [phone]: "Erro de rede ao enviar." }))
    } finally {
      sendInFlightRef.current = false
      setEnviandoMensagem(null)
    }
  }

  const abrirPedidoCombinado = async (phone: string) => {
    setCarregandoPedidoCombinado(true)
    setPedidoCombinadoPhone(phone)
    try {
      const r = await fetch(`/api/pedido-combinado?phone=${encodeURIComponent(phone)}`)
      if (r.ok) {
        const data = await r.json()
        setPedidoCombinadoRascunho(data.rascunho)
        setPedidoCombinadoPendencias(data.pendencias)
        setPedidoCombinadoConversa(data.conversa ?? [])
        setModalPedidoCombinado(true)
      }
    } catch {}
    setCarregandoPedidoCombinado(false)
  }

  const criarPedidoCombinado = async () => {
    if (!pedidoCombinadoRascunho || !pedidoCombinadoPhone) return
    const r = pedidoCombinadoRascunho
    setCriandoPedidoCombinado(true)
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cliente: r.cliente,
          telefone: r.telefone,
          tipoEntrega: r.tipoEntrega || 'delivery',
          endereco: r.endereco,
          bairro: r.bairro || undefined,
          referencia: r.referencia || undefined,
          itens: r.itens,
          total: r.total,
          pagamento: r.pagamento || undefined,
          troco: r.troco || undefined,
          observacao: r.observacao || undefined,
        }),
      })
      if (res.ok) {
        // Limpa sessão manual sem enviar mensagem
        await fetch(`/api/pedido-combinado?phone=${encodeURIComponent(pedidoCombinadoPhone)}`, { method: 'DELETE' })
        setSessoes(prev => prev.filter(s => s.phone !== pedidoCombinadoPhone))
        const novoPedido = await res.json()
        setPedidos(prev => [novoPedido, ...prev])
        setModalPedidoCombinado(false)
        setPedidoCombinadoRascunho(null)
        setPedidoCombinadoPhone(null)
        setFiltro("novo")
        setSimpleToast("Pedido criado e enviado para a cozinha!")
        if (simpleToastTimerRef.current) clearTimeout(simpleToastTimerRef.current)
        simpleToastTimerRef.current = setTimeout(() => setSimpleToast(""), 3000)
      }
    } catch {}
    setCriandoPedidoCombinado(false)
  }

  const carregarHistoricoConversa = async (phone: string) => {
    try {
      const r = await fetch(`/api/pedido-combinado?phone=${encodeURIComponent(phone)}`)
      if (r.ok) {
        const data = await r.json()
        setHistoricoMsgs(data.conversa ?? [])
      }
    } catch {}
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
      if (prevStatus === "novo" && novoStatus === "em_preparo") {
        imprimirPedidoSilencioso(id)
      }
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
  const pedidosFiltrados = (filtro === "todos" || filtro === "tempo_real" || filtro === "arquivados" ? pedidos : pedidos.filter(p => p.status === filtro))
    .filter(p => {
      if (!buscaNorm) return true
      const num = String(p.numero || "")
      const statusLabel = STATUS_COLOR[p.status]?.label?.toLowerCase() || ""
      return (
        p.cliente.toLowerCase().includes(buscaNorm) ||
        p.telefone.replace(/\D/g, "").includes(buscaNorm.replace(/\D/g, "")) ||
        (p.bairro || "").toLowerCase().includes(buscaNorm) ||
        num.includes(buscaNorm) ||
        statusLabel.includes(buscaNorm) ||
        (p.pagamento || "").toLowerCase().includes(buscaNorm)
      )
    })
    .sort((a, b) => {
      const prio = (p: Pedido) => {
        if (p.escalonado) return 0
        if (p.cancelamentoSolicitado) return 1
        if (p.status === "novo" && (p.pagamento || "").toLowerCase().includes("pix") && !p.pixConfirmado) return 2
        if (p.status === "novo") return 3
        if (p.status === "em_preparo") return 4
        if (p.status === "saiu_entrega") return 5
        return 6
      }
      const pa = prio(a), pb = prio(b)
      if (pa !== pb) return pa - pb
      return parseInt(a.id) - parseInt(b.id)
    })

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

  const Row = ({ label, value, missing }: { label: string; value: string; missing?: boolean }) => (
    <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
      <span style={{ fontSize: 11, fontWeight: 800, color: "#56524b", minWidth: 72, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: missing ? "#ef4444" : "#c9c2b4" }}>{value || (missing ? "—" : "—")}</span>
    </div>
  )

  const renderDetalhe = (p: Pedido) => {
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
            Confirmar Pix recebido
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

        {/* Imprimir pedido */}
        <button onClick={() => window.open(`/pedidos/${p.id}/imprimir`, "_blank")} style={{ height: 44, border: "1px solid rgba(255,255,255,.1)", borderRadius: 14, background: "transparent", color: "#a39b8b", fontSize: 14, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, flexShrink: 0 }}>
          🖨️ Imprimir pedido
        </button>

        <button onClick={() => setDetailId(null)} style={{ height: 44, border: "none", background: "transparent", color: "#a39b8b", fontSize: 14, fontWeight: 800, flexShrink: 0 }}>Fechar</button>
      </>
    )
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
        .cb-workspace { display:flex; flex:1; min-height:0; overflow:hidden; }
        .cb-list-col { flex:1; overflow-y:auto; padding:12px 16px; display:flex; flex-direction:column; gap:10px; }
        .cb-list-col.cb-chat-mode { padding:0 !important; gap:0 !important; overflow:hidden !important; }
        .cb-detail-col { display:none; }
        .cb-mob-sheet-wrap { display:block; }
        .cb-row:active { opacity:.85; }
        /* ── Chat layout ── */
        /* Só no modo conversa: fixa a altura da viewport para o container, fazendo
           a lista de mensagens rolar (flex-1/min-h-0/overflow) e o composer ficar
           sempre fixo no rodapé. Não afeta a listagem normal de pedidos. */
        html:has(.cb-chat-mode),body:has(.cb-chat-mode) { overflow:hidden; height:100%; }
        .ps-content:has(.cb-chat-mode) { display:flex; flex-direction:column; height:100svh; min-height:0; overflow:hidden; }
        .ps-content:has(.cb-chat-mode) .cb-header { flex-shrink:0; }
        .cb-chat-root { display:flex; flex:1; min-height:0; overflow:hidden; }
        .cb-chat-left { display:flex; flex-direction:column; overflow:hidden; width:100%; }
        .cb-chat-left-inner { flex:1; overflow-y:auto; }
        .cb-chat-right { display:none; flex-direction:column; flex:1; overflow:hidden; min-height:0; }
        .cb-chat-right.cb-mob-visible { display:flex; }
        .cb-mob-back { display:inline-flex; }
        .cb-chat-msg-area { flex:1; overflow-y:auto; padding:12px 14px; display:flex; flex-direction:column; gap:6px; }
        .cb-chat-msg-area::-webkit-scrollbar { width:4px; }
        .cb-chat-msg-area::-webkit-scrollbar-thumb { background:#2a2723; border-radius:2px; }
        .cb-chat-left-inner::-webkit-scrollbar { width:3px; }
        .cb-chat-left-inner::-webkit-scrollbar-thumb { background:#1e1c19; border-radius:2px; }
        .cb-chat-item { width:100%; text-align:left; background:transparent; border:none; border-bottom:1px solid #111; padding:10px 14px; cursor:pointer; display:flex; align-items:center; gap:10px; transition:background .1s; }
        .cb-chat-item:hover { background:rgba(255,255,255,.03); }
        .cb-chat-item.cb-chat-item-active { background:#131110; border-left:3px solid #ff6b00; padding-left:11px; }
        @keyframes cb-pulse-urgent { 0%,100%{background:rgba(251,191,36,.04)} 50%{background:rgba(251,191,36,.11)} }
        .cb-chat-item.cb-chat-item-urgente { animation:cb-pulse-urgent 2s ease-in-out infinite; border-left:3px solid #fbbf24; padding-left:11px; }
        .cb-chat-item.cb-chat-item-urgente:hover { background:rgba(251,191,36,.09) !important; }
        .cb-assumir-btn { background:#fbbf24; color:#060606; border:none; border-radius:5px; padding:3px 8px; font-size:9px; font-weight:900; cursor:pointer; white-space:nowrap; flex-shrink:0; line-height:1.4; }
        .cb-assumir-btn:hover { background:#f59e0b; }
        .cb-assumir-btn:disabled { opacity:.65; cursor:default; }
        .cb-chat-textarea { width:100%; background:#0d0c0b; border:1px solid #252220; border-radius:10px; padding:9px 12px; color:#f4f1ec; font-size:13px; resize:none; font-family:inherit; outline:none; box-sizing:border-box; line-height:1.4; }
        .cb-chat-textarea:focus { border-color:#ff6b00; }
        @media (min-width: 768px) {
          .cb-header { border-bottom:1px solid #1a1816; padding:24px 28px 20px; position:static; }
          .cb-list-col { padding:16px 24px; }
          .cb-detail-col { display:flex; flex-direction:column; width:420px; min-width:380px; flex-shrink:0; border-left:1px solid #1a1816; background:#080708; overflow-y:auto; padding:16px 20px 32px; gap:12px; }
          .cb-mob-sheet-wrap { display:none !important; }
          .cb-chat-left { width:280px; min-width:240px; flex-shrink:0; border-right:1px solid #1a1816; display:flex !important; }
          .cb-chat-right { display:flex !important; }
          .cb-mob-back { display:none !important; }
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
              <button onClick={() => setFiltro("tempo_real")} style={{ border: `1px solid ${filtro === "tempo_real" ? "#60a5fa" : "#242220"}`, background: filtro === "tempo_real" ? "#60a5fa" : "transparent", color: filtro === "tempo_real" ? "#060606" : "#c9c2b4", fontSize: 11, fontWeight: 900, padding: "6px 11px", borderRadius: 14, flexShrink: 0 }}>⚡ Tempo real · {sessoes.length}</button>
              {steps.map((s) => {
                const active = filtro === s.key; const sc = STATUS_COLOR[s.key]
                return (
                  <button key={s.key} onClick={() => setFiltro(active ? "todos" : s.key)} style={{ border: `1px solid ${active ? sc.accentBorder : "#242220"}`, background: active ? sc.accentBg : "#101010", color: active ? sc.accent : "#c9c2b4", fontSize: 11, fontWeight: 900, padding: "6px 11px", borderRadius: 14, flexShrink: 0 }}>
                    {s.stepLabel} · {s.count}
                  </button>
                )
              })}
              <button onClick={() => setFiltro("arquivados")} style={{ border: `1px solid ${filtro === "arquivados" ? "rgba(139,92,246,.6)" : "#242220"}`, background: filtro === "arquivados" ? "rgba(139,92,246,.15)" : "transparent", color: filtro === "arquivados" ? "#a78bfa" : "#5a564d", fontSize: 11, fontWeight: 900, padding: "6px 11px", borderRadius: 14, flexShrink: 0 }}>📦 Arquivados</button>
            </div>
            <button onClick={() => setModalArquivarExpediente(true)} title="Arquivar não resolvidos do expediente" style={{ height: 32, border: "1px solid rgba(139,92,246,.4)", background: "rgba(139,92,246,.08)", color: "#a78bfa", fontSize: 11, fontWeight: 900, padding: "0 10px", borderRadius: 10, flexShrink: 0, whiteSpace: "nowrap" }}>📦</button>
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
        <div className="cb-workspace">
        <main className={`cb-list-col${filtro === "tempo_real" ? " cb-chat-mode" : ""}`}>

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
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "rgba(239,68,68,.06)", border: "1px solid rgba(239,68,68,.35)", borderLeft: "3px solid #ef4444", borderRadius: 10, animation: "cbUrgentGlow 1.6s infinite" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ef4444", flexShrink: 0, animation: "cbRedPulse 1.6s infinite" }} />
            <span style={{ fontSize: 11, fontWeight: 900, color: "#ef4444", textTransform: "uppercase", letterSpacing: "1px", flexShrink: 0 }}>🚨 URGENTE</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#f4f1ec", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {escalonados.length === 1 ? `${escalonados[0].cliente.split(" ")[0]} quer falar` : `${escalonados.length} conversas aguardando`}
            </span>
            <button onClick={() => { assumirConversa(escalonados[0].telefone); setCardUrgenciaFechado(true) }} style={{ height: 26, padding: "0 10px", border: "none", borderRadius: 7, background: "#ef4444", color: "#fff", fontSize: 11, fontWeight: 900, flexShrink: 0 }}>Assumir</button>
            <button onClick={() => setCardUrgenciaFechado(true)} style={{ height: 26, width: 26, border: "1px solid rgba(239,68,68,.25)", borderRadius: 7, background: "transparent", color: "#ef4444", fontSize: 16, fontWeight: 900, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
          </div>
        )}

        {/* Arquivados */}
        {filtro === "arquivados" && (
          <>
            {carregandoArquivados ? (
              <div style={{ background: "#101010", border: "1px dashed #2a2723", borderRadius: 20, padding: "36px 20px", textAlign: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#5a564d" }}>Carregando...</span>
              </div>
            ) : pedidosArquivados.length === 0 ? (
              <div style={{ background: "#101010", border: "1px dashed #2a2723", borderRadius: 20, padding: "36px 20px", textAlign: "center" }}>
                <span style={{ fontSize: 32, display: "block", marginBottom: 8 }}>📦</span>
                <span style={{ fontSize: 15, fontWeight: 900, color: "#c9c2b4", display: "block" }}>Nenhum pedido arquivado.</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#5a564d", display: "block", marginTop: 4 }}>Pedidos arquivados ficam aqui para consulta.</span>
              </div>
            ) : pedidosArquivados.map(p => {
              const sc = STATUS_COLOR[p.status] || STATUS_COLOR["cancelado"]
              const firstName = p.cliente.split(" ")[0]
              const archivedDate = p.archivedAt ? new Date(p.archivedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) : ""
              const motivo = p.archivedReason === "fim_expediente" ? "Fim de expediente" : p.archivedReason === "manual" ? "Arquivado manualmente" : "Arquivado"
              return (
                <article key={p.id} style={{ background: "rgba(139,92,246,.05)", border: "1px solid rgba(139,92,246,.2)", borderRadius: 20, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8, opacity: 0.85 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <div>
                      {p.numero != null && <span style={{ fontSize: 10, fontWeight: 900, color: "#5a564d", marginRight: 6 }}>#{p.numero}</span>}
                      <span style={{ fontSize: 16, fontWeight: 900, color: "#c9c2b4" }}>{firstName}</span>
                      <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, color: sc.accent, background: sc.accentBg, padding: "2px 6px", borderRadius: 6, border: `1px solid ${sc.accentBorder}` }}>{sc.label}</span>
                    </div>
                    <span style={{ fontSize: 9, fontWeight: 800, color: "#a78bfa", background: "rgba(139,92,246,.12)", padding: "3px 8px", borderRadius: 8 }}>📦 {motivo}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#5a564d", fontWeight: 700 }}>
                    {p.itens.slice(0, 2).join(", ")}{p.itens.length > 2 ? "..." : ""}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#3a3730", fontWeight: 700 }}>
                    <span>Arquivado: {archivedDate}</span>
                    <span>R$ {p.total.toFixed(2).replace(".", ",")}</span>
                  </div>
                </article>
              )
            })}
          </>
        )}

        {/* ── Tempo real: layout de chat em duas colunas ── */}
        {filtro === "tempo_real" && (
          <div className="cb-chat-root">

            {/* ── Coluna esquerda: lista de sessões ── */}
            <div className={`cb-chat-left${sessaoAtiva ? " cb-mob-hidden" : ""}`}>
              <div style={{ padding: "10px 14px 8px", borderBottom: "1px solid #141210", flexShrink: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 900, color: "#4a4640", textTransform: "uppercase", letterSpacing: ".5px" }}>
                  ⚡ Conversas · {sessoes.length}
                </div>
              </div>
              <div className="cb-chat-left-inner">
                {sessoes.length === 0 ? (
                  <div style={{ padding: "40px 16px", textAlign: "center" }}>
                    <div style={{ fontSize: 26, marginBottom: 8 }}>⚡</div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: "#3a3730" }}>Nenhuma conversa ativa</div>
                    <div style={{ fontSize: 11, color: "#2e2c29", fontWeight: 600, marginTop: 4 }}>Clientes em andamento aparecerão aqui.</div>
                  </div>
                ) : [...sessoes].sort((a, b) => {
                    // Precisa de humano (ainda não assumido) → topo
                    const aNH = a.postOrderPriority && !a.manual;
                    const bNH = b.postOrderPriority && !b.manual;
                    if (Number(!!bNH) !== Number(!!aNH)) return Number(!!bNH) - Number(!!aNH);
                    // Já assumido → segundo
                    if (Number(!!b.manual) !== Number(!!a.manual)) return Number(!!b.manual) - Number(!!a.manual);
                    return 0;
                  }).map(s => {
                  const displayName = s.customerName || `…${s.lastDigits}`
                  const initial = ((s.customerName || s.lastDigits || "?")[0]).toUpperCase()
                  const isActive = sessaoAtiva === s.phone
                  return (
                    <button
                      key={s.phone}
                      className={`cb-chat-item${isActive ? " cb-chat-item-active" : ""}${s.postOrderPriority && !s.manual ? " cb-chat-item-urgente" : ""}`}
                      onClick={() => setSessaoAtiva(s.phone)}
                    >
                      <div style={{ width: 38, height: 38, borderRadius: "50%", flexShrink: 0, background: s.manual ? "rgba(239,68,68,.13)" : s.postOrderPriority ? "rgba(251,191,36,.13)" : "rgba(255,107,0,.1)", border: `1.5px solid ${s.manual ? "rgba(239,68,68,.3)" : s.postOrderPriority ? "rgba(251,191,36,.3)" : "rgba(255,107,0,.25)"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 900, color: s.manual ? "#ef4444" : s.postOrderPriority ? "#fbbf24" : "#ff6b00" }}>
                        {initial}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginBottom: 3 }}>
                          <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 900, color: "#f0ede8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayName}</span>
                          {s.postOrderPriority && !s.manual ? (
                            <button
                              className="cb-assumir-btn"
                              disabled={assumindoSessao === s.phone}
                              onClick={e => { e.stopPropagation(); setSessaoAtiva(s.phone); assumirSessao(s.phone) }}
                            >
                              {assumindoSessao === s.phone ? "..." : "Assumir agora"}
                            </button>
                          ) : (
                            <span style={{ fontSize: 9, fontWeight: 900, color: s.manual ? "#ef4444" : "#34d399", background: s.manual ? "rgba(239,68,68,.08)" : "rgba(52,211,153,.08)", border: `1px solid ${s.manual ? "rgba(239,68,68,.25)" : "rgba(52,211,153,.2)"}`, padding: "2px 7px", borderRadius: 5, flexShrink: 0, whiteSpace: "nowrap" }}>
                              {s.manual ? "Você atendendo" : "Bot atendendo"}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: "#4a4640", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {s.ultimaMensagem || s.stepLabel || "—"}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* ── Coluna direita: conversa aberta ── */}
            <div className={`cb-chat-right${sessaoAtiva ? " cb-mob-visible" : ""}`}>
              {!sessaoAtiva ? (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 10 }}>
                  <div style={{ fontSize: 32 }}>💬</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#3a3730" }}>Selecione uma conversa</div>
                </div>
              ) : (() => {
                const s = sessoes.find(x => x.phone === sessaoAtiva)
                if (!s) return (
                  <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ color: "#3a3730", fontSize: 13, fontWeight: 700 }}>Conversa encerrada</span>
                  </div>
                )
                const displayName = s.customerName || `…${s.lastDigits}`
                const initial = ((s.customerName || s.lastDigits || "?")[0]).toUpperCase()
                const canSend = s.manual && !!(mensagemHumana[s.phone] || "").trim()

                return (
                  <>
                    {/* Header da conversa */}
                    <div style={{ padding: "10px 12px", borderBottom: "1px solid #141210", display: "flex", alignItems: "center", gap: 8, flexShrink: 0, background: "#0a0908" }}>
                      <button className="cb-mob-back" onClick={() => setSessaoAtiva(null)} style={{ background: "none", border: "none", color: "#ff6b00", fontSize: 20, lineHeight: 1, padding: "0 4px", cursor: "pointer", flexShrink: 0 }}>←</button>
                      <div style={{ width: 34, height: 34, borderRadius: "50%", flexShrink: 0, background: s.manual ? "rgba(239,68,68,.13)" : s.postOrderPriority ? "rgba(251,191,36,.13)" : "rgba(255,107,0,.1)", border: `1.5px solid ${s.manual ? "rgba(239,68,68,.3)" : s.postOrderPriority ? "rgba(251,191,36,.3)" : "rgba(255,107,0,.25)"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 900, color: s.manual ? "#ef4444" : s.postOrderPriority ? "#fbbf24" : "#ff6b00" }}>
                        {initial}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 900, color: "#f0ede8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayName}</div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: s.manual ? "#ef4444" : s.postOrderPriority ? "#fbbf24" : "#34d399" }}>
                          {s.manual ? "Atendimento humano" : s.postOrderPriority ? "Bot respondendo · pós-pedido" : "Robô atendendo"} · {s.stepLabel}
                        </div>
                      </div>
                      {/* Botões de ação: humano → Pedido/Robô/reviver; pós-pedido → Atender */}
                      {s.manual ? (
                        <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                          <button onClick={() => abrirPedidoCombinado(s.phone)} disabled={carregandoPedidoCombinado && pedidoCombinadoPhone === s.phone} style={{ height: 30, padding: "0 9px", border: "none", borderRadius: 8, background: "#22c55e", color: "#060606", fontSize: 11, fontWeight: 900 }}>
                            {carregandoPedidoCombinado && pedidoCombinadoPhone === s.phone ? "..." : "🧾 Pedido"}
                          </button>
                          <button onClick={() => devolverSessaoParaBot(s.phone)} disabled={devolvendoSessaoBot === s.phone} style={{ height: 30, padding: "0 9px", border: "none", borderRadius: 8, background: "#2563eb", color: "#fff", fontSize: 11, fontWeight: 900 }}>
                            {devolvendoSessaoBot === s.phone ? "..." : "🤖 Robô"}
                          </button>
                          <button onClick={() => reviverConversa(s.phone)} disabled={revivendoConversa === s.phone} title="Reativa o bot. Não envia mensagem ao cliente." style={{ height: 30, padding: "0 8px", border: "1px solid rgba(251,191,36,.35)", borderRadius: 8, background: "rgba(251,191,36,.08)", color: "#fbbf24", fontSize: 11, fontWeight: 800 }}>
                            {revivendoConversa === s.phone ? "..." : "🔄"}
                          </button>
                        </div>
                      ) : s.postOrderPriority ? (
                        <button onClick={() => assumirSessao(s.phone)} disabled={assumindoSessao === s.phone} style={{ height: 30, padding: "0 12px", border: "2px solid #fbbf24", borderRadius: 8, background: "#fbbf24", color: "#060606", fontSize: 11, fontWeight: 900, flexShrink: 0, boxShadow: "0 0 10px rgba(251,191,36,.4)" }}>
                          {assumindoSessao === s.phone ? "..." : "Assumir agora"}
                        </button>
                      ) : (
                        <span style={{ fontSize: 11, color: "#3a3730", fontWeight: 700, flexShrink: 0 }}>Bot atendendo automaticamente</span>
                      )}
                    </div>

                    {/* Resumo rápido compacto (só quando há dados relevantes) */}
                    {s.manual && s.resumoRapido && (s.resumoRapido.cliente || s.resumoRapido.itens.length > 0 || s.resumoRapido.total > 0) && (
                      <div style={{ padding: "6px 14px", background: "rgba(255,107,0,.04)", borderBottom: "1px solid #141210", display: "flex", alignItems: "center", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
                        {s.resumoRapido.cliente && <span style={{ fontSize: 11, fontWeight: 800, color: "#c9c2b4" }}>{s.resumoRapido.cliente}</span>}
                        {s.resumoRapido.itens.length > 0 && <span style={{ fontSize: 11, color: "#6a6460" }}>· {s.resumoRapido.itens.slice(0, 2).join(", ")}{s.resumoRapido.itens.length > 2 ? `... +${s.resumoRapido.itens.length - 2}` : ""}</span>}
                        {s.resumoRapido.total > 0 && <span style={{ fontSize: 11, fontWeight: 900, color: "#4ade80", marginLeft: "auto" }}>R$ {s.resumoRapido.total.toFixed(2).replace(".", ",")}</span>}
                        {s.resumoRapido.pendencias.length > 0 && <span style={{ fontSize: 10, fontWeight: 900, color: "#fbbf24" }}>⚠ {s.resumoRapido.pendencias.length} pendência{s.resumoRapido.pendencias.length > 1 ? "s" : ""}</span>}
                      </div>
                    )}

                    {/* Área de mensagens */}
                    <div className="cb-chat-msg-area">
                      {historicoMsgs.length === 0 ? (
                        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", paddingBottom: 8 }}>
                          {s.ultimaMensagem ? (
                            <>
                              <div style={{ fontSize: 10, fontWeight: 700, color: "#3a3730", textAlign: "center", marginBottom: 8 }}>Histórico não disponível · última mensagem recebida</div>
                              <div style={{ background: "#141210", border: "1px solid #222", borderRadius: 14, borderBottomLeftRadius: 4, padding: "9px 13px", maxWidth: "78%", alignSelf: "flex-start" }}>
                                <div style={{ fontSize: 13, color: "#c9c2b4", lineHeight: 1.5 }}>{s.ultimaMensagem}</div>
                              </div>
                            </>
                          ) : (
                            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <span style={{ fontSize: 12, color: "#3a3730", fontWeight: 700 }}>Sem mensagens registradas</span>
                            </div>
                          )}
                        </div>
                      ) : historicoMsgs.map((msg, i) => {
                        const isCliente = msg.autor === "cliente"
                        const isAtendente = msg.autor === "atendente"
                        const textoLimpo = isAtendente ? (msg.texto || "").replace(/^\[.*?\]\s*/, "") : (msg.texto || "")
                        const ts = msg.ts ? new Date(msg.ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : ""
                        return (
                          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: isCliente ? "flex-start" : "flex-end" }}>
                            {!isCliente && (
                              <span style={{ fontSize: 9, fontWeight: 700, color: isAtendente ? "#ff8533" : "#5a564d", marginBottom: 2, paddingRight: 4 }}>
                                {isAtendente ? (userName || "Atendente") : "🤖 Bot"}
                              </span>
                            )}
                            <div style={{ maxWidth: "76%", background: isCliente ? "#141210" : isAtendente ? "rgba(255,107,0,.15)" : "#0d1117", border: `1px solid ${isCliente ? "#222" : isAtendente ? "rgba(255,107,0,.3)" : "#1a2030"}`, borderRadius: 14, borderBottomLeftRadius: isCliente ? 4 : 14, borderBottomRightRadius: isCliente ? 14 : 4, padding: "8px 12px" }}>
                              <div style={{ fontSize: 13, color: isCliente ? "#c9c2b4" : isAtendente ? "#f4f1ec" : "#7a8fa6", lineHeight: 1.5, wordBreak: "break-word" }}>{textoLimpo}</div>
                            </div>
                            {ts && <span style={{ fontSize: 9, color: "#3a3730", fontWeight: 600, marginTop: 2, paddingLeft: isCliente ? 4 : 0, paddingRight: isCliente ? 0 : 4 }}>{ts}</span>}
                          </div>
                        )
                      })}
                      <div ref={historicoBottomRef} />
                    </div>

                    {/* Carrinho (barra compacta) */}
                    {s.cart && s.cart.length > 0 && (
                      <div style={{ padding: "5px 14px", borderTop: "1px solid #141210", background: "#0a0908", fontSize: 11, color: "#5a564d", fontWeight: 600, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        🛒 {s.cart.join(" · ")}
                      </div>
                    )}

                    {/* Input de resposta */}
                    {s.manual ? (
                      <div style={{ padding: "10px 12px", borderTop: "1px solid #141210", display: "flex", gap: 8, alignItems: "flex-end", flexShrink: 0, background: "#080706" }}>
                        <div style={{ flex: 1 }}>
                          <textarea
                            className="cb-chat-textarea"
                            value={mensagemHumana[s.phone] || ""}
                            onChange={e => setMensagemHumana(prev => ({ ...prev, [s.phone]: e.target.value }))}
                            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (sendInFlightRef.current || enviandoMensagem === s.phone) return; enviarMensagemHumana(s.phone) } }}
                            placeholder={`Responder como ${userName || "Kellyne"}… (Enter para enviar)`}
                            rows={2}
                          />
                          {erroEnvioMensagem[s.phone] && (
                            <span style={{ color: "#f87171", fontSize: 11, fontWeight: 600, display: "block", marginTop: 3 }}>{erroEnvioMensagem[s.phone]}</span>
                          )}
                        </div>
                        <button
                          onClick={() => enviarMensagemHumana(s.phone)}
                          disabled={enviandoMensagem === s.phone || !canSend}
                          style={{ width: 42, height: 42, border: "none", borderRadius: 10, flexShrink: 0, background: enviandoMensagem === s.phone || !canSend ? "#1a1a1a" : "#25d366", color: enviandoMensagem === s.phone || !canSend ? "#444" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", transition: "background .15s", cursor: enviandoMensagem === s.phone || !canSend ? "not-allowed" : "pointer" }}
                        >
                          {enviandoMensagem === s.phone
                            ? <span style={{ fontSize: 10, fontWeight: 900 }}>...</span>
                            : <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M22 2L11 13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/><path d="M22 2L15 22l-4-9-9-4 20-7z" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          }
                        </button>
                      </div>
                    ) : (
                      <div style={{ padding: "10px 12px", borderTop: "1px solid #141210", background: "#0a0908", flexShrink: 0, textAlign: "center" }}>
                        {s.postOrderPriority ? (
                          <span style={{ fontSize: 12, color: "#fbbf24", fontWeight: 700 }}>Bot respondendo · clique em Atender se precisar intervir</span>
                        ) : (
                          <button onClick={() => assumirSessao(s.phone)} disabled={assumindoSessao === s.phone} style={{ height: 30, padding: "0 16px", border: "1px solid rgba(201,194,180,.15)", borderRadius: 8, background: "rgba(201,194,180,.06)", color: "#9a9590", fontSize: 12, fontWeight: 700 }}>
                            {assumindoSessao === s.phone ? "..." : "Assumir atendimento"}
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )
              })()}
            </div>

          </div>
        )}

        {/* Lista */}
          {filtro !== "tempo_real" && filtro !== "arquivados" && pedidosFiltrados.length === 0 && (
            <div style={{ background: "#101010", border: "1px dashed #2a2723", borderRadius: 20, padding: "36px 20px", textAlign: "center" }}>
              <span style={{ fontSize: 17, fontWeight: 900, color: "#c9c2b4", display: "block" }}>Nada por aqui</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#a39b8b", display: "block", marginTop: 4 }}>Nenhum pedido nesse estado agora.</span>
            </div>
          )}

          {filtro !== "tempo_real" && filtro !== "arquivados" && pedidosFiltrados.map(pedido => {
            const sc = STATUS_COLOR[pedido.status]
            const minsDesde = tempoDesde(pedido.horario, undefined, now)
            const minsPrep = tempoDesde(pedido.horario, pedido.horarioInicio, now)
            const isDineIn = pedido.tipoEntrega === "dine_in" || pedido.endereco === "Consumo no local"
            const nextStatus = (isDineIn && pedido.status === "em_preparo") ? "entregue" as Status : NEXT_STATUS[pedido.status]
            const isDone = pedido.status === "entregue"
            const isCanceled = pedido.status === "cancelado"
            const isNovo = pedido.status === "novo"
            const timerMins = isNovo ? minsDesde : minsPrep
            const timerColor = isNovo ? (minsDesde < 3 ? "#34d399" : minsDesde < 7 ? "#fbbf24" : "#f87171") : isDone ? "#34d399" : minsPrep < 20 ? "#34d399" : minsPrep < 34 ? "#fbbf24" : "#f87171"
            const firstName = pedido.cliente.split(" ")[0]
            const pagamento = pedido.pagamento || ""
            const isPix = pagamento.toLowerCase().includes("pix")
            const pixPendente = isPix && !pedido.pixConfirmado && pedido.status === "novo"
            const isRetirada = !isDineIn && (!pedido.tipoEntrega || pedido.tipoEntrega === "pickup" || pedido.tipoEntrega === "retirada" || pedido.endereco === "Retirada na loja")

            let rowBorder = sc.accentBorder
            if (pedido.escalonado) rowBorder = "rgba(239,68,68,.7)"
            if (pedido.cancelamentoSolicitado) rowBorder = "rgba(239,68,68,.5)"
            if (isDone) rowBorder = "rgba(34,197,94,.3)"
            if (isCanceled) rowBorder = "rgba(239,68,68,.2)"

            let rowAnim = `cbCardIn .35s ease both`
            if (flashId === pedido.id) rowAnim = "cbFlash .7s ease"
            if (leavingId === pedido.id) rowAnim = "cbCardOut .3s ease both"

            const isSelected = detailId === pedido.id

            return (
              <article
                key={pedido.id}
                className="cb-row"
                onClick={() => setDetailId(pedido.id === detailId ? null : pedido.id)}
                style={{
                  background: isSelected ? "#131110" : "#0d0c0b",
                  border: `1.5px solid ${isSelected ? sc.accentBorder : rowBorder}`,
                  borderRadius: 14,
                  padding: "11px 13px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 0,
                  animation: rowAnim,
                  cursor: "pointer",
                  transition: "border-color .15s, background .15s",
                }}
              >
                {/* Layout: avatar dot + conteúdo */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: 11 }}>
                  {/* Dot de status */}
                  <div style={{ marginTop: 3, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: isDone ? "#22c55e" : isCanceled ? "#ef4444" : sc.accent, boxShadow: isDone || isCanceled ? "none" : `0 0 6px ${sc.accent}55` }} />
                  </div>

                  {/* Conteúdo principal */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Linha 1: nome + badges + timer */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                      {pedido.numero != null && <span style={{ fontSize: 10, fontWeight: 900, color: "#3a3730", flexShrink: 0 }}>#{pedido.numero}</span>}
                      <span style={{ fontSize: 14, fontWeight: 900, color: "#f0ede8", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{firstName}</span>
                      {pedido.escalonado && <span style={{ fontSize: 11, flexShrink: 0 }}>🚨</span>}
                      {(pedido.origem === "site" || pedido.origem === "app") && <span style={{ fontSize: 9, fontWeight: 900, color: "#60a5fa", background: "rgba(96,165,250,.12)", padding: "2px 5px", borderRadius: 5, flexShrink: 0 }}>🌐 Site</span>}
                      {pixPendente && <span style={{ fontSize: 9, fontWeight: 900, color: "#fbbf24", background: "rgba(251,191,36,.12)", padding: "2px 5px", borderRadius: 5, flexShrink: 0 }}>PIX⏳</span>}
                      {pedido.cancelamentoSolicitado && <span style={{ fontSize: 11, flexShrink: 0 }}>⚠️</span>}
                      <span style={{ fontSize: 10, fontWeight: 900, color: pixPendente ? "#fbbf24" : (isPix && pedido.pixConfirmado && pedido.status === "novo" ? "#34d399" : sc.accent), background: pixPendente ? "rgba(251,191,36,.12)" : (isPix && pedido.pixConfirmado && pedido.status === "novo" ? "rgba(52,211,153,.12)" : sc.accentBg), padding: "2px 7px", borderRadius: 6, border: `1px solid ${pixPendente ? "rgba(251,191,36,.35)" : (isPix && pedido.pixConfirmado && pedido.status === "novo" ? "rgba(52,211,153,.35)" : sc.accentBorder)}`, textTransform: "uppercase", letterSpacing: ".4px", flexShrink: 0 }}>{pixPendente ? "Aguardando Pix" : (isPix && pedido.pixConfirmado && pedido.status === "novo" ? "Pago" : sc.label)}</span>
                    </div>

                    {/* Linha 2: infos compactas */}
                    <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, color: "#4a4640", marginBottom: 9 }}>
                      <span style={{ flexShrink: 0 }}>{isDineIn ? "🍽️" : isRetirada ? "🏪" : "🛵"}</span>
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#5a564d" }}>{isDineIn ? "No local" : isRetirada ? "Retirada" : (pedido.bairro || pedido.endereco || "—")}</span>
                      <span style={{ flexShrink: 0, color: "#3a3730" }}>·</span>
                      <span style={{ flexShrink: 0 }}>{pedido.itens.length}it</span>
                      <span style={{ flexShrink: 0, color: "#3a3730" }}>·</span>
                      <span style={{ flexShrink: 0, color: isPix ? "#22c55e" : "#5a564d" }}>{isPix ? "Pix" : (pagamento.split(" ")[0] || "—")}</span>
                      <span style={{ flexShrink: 0, color: "#3a3730" }}>·</span>
                      <span style={{ flexShrink: 0, fontWeight: 900, color: "#c9c2b4" }}>R${pedido.total.toFixed(2).replace(".", ",")}</span>
                      <span style={{ flexShrink: 0, fontWeight: 900, color: timerColor, marginLeft: 2, fontSize: 11 }}>{timerMins}m</span>
                    </div>

                    {/* Linha 3: botão de ação */}
                    <div onClick={e => e.stopPropagation()}>
                      {pedido.escalonado && (
                        <button
                          onClick={() => { assumirConversa(pedido.telefone); setCardUrgenciaFechado(true) }}
                          style={{ height: 30, padding: "0 14px", border: "none", borderRadius: 8, background: "#ef4444", color: "#fff", fontSize: 12, fontWeight: 900 }}
                        >🚨 Assumir conversa</button>
                      )}
                      {!pedido.escalonado && pixPendente && (
                        <button
                          onClick={() => setConfirmPixModal(pedido.id)}
                          style={{ height: 30, padding: "0 14px", border: "1px solid rgba(251,191,36,.35)", borderRadius: 8, background: "rgba(251,191,36,.08)", color: "#fbbf24", fontSize: 12, fontWeight: 900 }}
                        >Confirmar Pix recebido</button>
                      )}
                      {!pedido.escalonado && !pixPendente && !isDone && !isCanceled && nextStatus && (
                        <button
                          onClick={() => {
                            if (nextStatus === "saiu_entrega" && entregadores.length > 0 && pedido.tipoEntrega !== "pickup") {
                              setModalEntrega({ pedidoId: pedido.id, proxStatus: nextStatus })
                            } else {
                              avancarStatus(pedido.id, nextStatus)
                            }
                          }}
                          disabled={atualizando === pedido.id}
                          style={{ height: 30, padding: "0 14px", border: "none", borderRadius: 8, background: sc.btnBg, color: sc.btnFg, fontSize: 12, fontWeight: 900, opacity: atualizando === pedido.id ? 0.6 : 1 }}
                        >
                          {atualizando === pedido.id ? "..." : (isDineIn && pedido.status === "em_preparo" ? "Pronto 🍽️" : ACTION_LABEL[pedido.status])}
                        </button>
                      )}
                      {isDone && <span style={{ fontSize: 11, fontWeight: 800, color: "#22c55e" }}>✓ Entregue</span>}
                      {isCanceled && <span style={{ fontSize: 11, fontWeight: 800, color: "#5a564d" }}>✗ Cancelado</span>}
                    </div>
                  </div>
                </div>
              </article>
            )
          })}
        </main>

        {detalhePedido && (
          <aside className="cb-detail-col">
            {renderDetalhe(detalhePedido)}
          </aside>
        )}
        </div>

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

      {/* Bottom sheet detalhe — mobile only */}
        {detalhePedido && (
          <div className="cb-mob-sheet-wrap">
            <div onClick={() => setDetailId(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.62)", zIndex: 60, animation: "cbFadeIn .2s ease both" }} />
            <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, margin: "0 auto", maxWidth: 375, background: "#121110", border: "1px solid #242220", borderBottom: "none", borderRadius: "26px 26px 0 0", zIndex: 61, animation: "cbSheetUp .32s cubic-bezier(.2,.9,.3,1) both", padding: "10px 20px 26px", display: "flex", flexDirection: "column", gap: 12, maxHeight: "88vh", overflowY: "auto" }}>
              <div style={{ width: 44, height: 5, borderRadius: 3, background: "#2e2b26", margin: "2px auto 0", flexShrink: 0 }} />
              {renderDetalhe(detalhePedido)}
            </div>
          </div>
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

        {/* Modal Arquivar Expediente */}
        {modalArquivarExpediente && (
          <>
            <div onClick={() => setModalArquivarExpediente(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 60, animation: "cbFadeIn .2s ease both" }} />
            <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, margin: "0 auto", maxWidth: 375, background: "#121110", border: "1px solid #242220", borderBottom: "none", borderRadius: "26px 26px 0 0", zIndex: 61, animation: "cbSheetUp .32s cubic-bezier(.2,.9,.3,1) both", padding: "20px 20px 36px", display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ width: 44, height: 5, borderRadius: 3, background: "#2e2b26", margin: "0 auto 4px" }} />
              <div style={{ width: 48, height: 48, borderRadius: 14, background: "rgba(139,92,246,.1)", border: "1px solid rgba(139,92,246,.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 22 }}>📦</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <p style={{ margin: 0, fontSize: 19, fontWeight: 900, letterSpacing: "-0.4px", lineHeight: 1.2 }}>Arquivar não resolvidos?</p>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#a39b8b", lineHeight: 1.5 }}>Pedidos pendentes, em preparo, na rua, aguardando Pix e conversas abertas serão movidos para a aba Arquivados. Nenhum dado será apagado.</p>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#5a564d", lineHeight: 1.5 }}>Pedidos entregues e cancelados não são afetados.</p>
              </div>
              <button onClick={arquivarExpediente} disabled={arquivandoExpediente} style={{ height: 56, border: "none", borderRadius: 16, background: arquivandoExpediente ? "#3b1e6e" : "#7c3aed", color: "#fff", fontSize: 16, fontWeight: 900, letterSpacing: "-0.2px", opacity: arquivandoExpediente ? 0.7 : 1 }}>
                {arquivandoExpediente ? "Arquivando..." : "📦 Sim, arquivar não resolvidos"}
              </button>
              <button onClick={() => setModalArquivarExpediente(false)} disabled={arquivandoExpediente} style={{ height: 46, border: "none", background: "transparent", color: "#a39b8b", fontSize: 14, fontWeight: 800 }}>Cancelar</button>
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

      {/* Modal Pedido Combinado */}
      {modalPedidoCombinado && pedidoCombinadoRascunho && (
        <>
          <div onClick={() => { setModalPedidoCombinado(false) }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 70, animation: "cbFadeIn .2s ease both" }} />
          <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, margin: "0 auto", maxWidth: 480, background: "#121110", border: "1px solid #242220", borderBottom: "none", borderRadius: "26px 26px 0 0", zIndex: 71, animation: "cbSheetUp .32s cubic-bezier(.2,.9,.3,1) both", padding: "12px 20px 36px", display: "flex", flexDirection: "column", gap: 14, maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ width: 44, height: 5, borderRadius: 3, background: "#2e2b26", margin: "0 auto 4px", flexShrink: 0 }} />
            <p style={{ margin: 0, fontSize: 18, fontWeight: 900, letterSpacing: "-0.3px", flexShrink: 0 }}>Revise o pedido antes de enviar para a cozinha</p>

            {/* Itens */}
            <div style={{ background: "#0d0c0b", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: "#5a564d", textTransform: "uppercase", letterSpacing: ".8px" }}>Itens</span>
              {pedidoCombinadoRascunho.itens.length === 0 ? (
                <span style={{ fontSize: 13, color: "#ef4444", fontWeight: 700 }}>Nenhum item</span>
              ) : pedidoCombinadoRascunho.itens.map((item, i) => (
                <div key={i} style={{ fontSize: 13, fontWeight: 700, color: "#c9c2b4" }}>{getItemIcon(item)} {item}</div>
              ))}
              {pedidoCombinadoRascunho.total > 0 && (
                <div style={{ marginTop: 4, paddingTop: 8, borderTop: "1px solid #1a1816", fontSize: 14, fontWeight: 900, color: "#f5f2ee" }}>Total: R$ {pedidoCombinadoRascunho.total.toFixed(2).replace(".", ",")}</div>
              )}
            </div>

            {/* Dados do pedido */}
            <div style={{ background: "#0d0c0b", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 7 }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: "#5a564d", textTransform: "uppercase", letterSpacing: ".8px" }}>Dados</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <Row label="Cliente" value={pedidoCombinadoRascunho.cliente} missing={!pedidoCombinadoRascunho.cliente} />
                <Row label="Tipo" value={pedidoCombinadoRascunho.tipoEntrega === "delivery" ? "🛵 Entrega" : pedidoCombinadoRascunho.tipoEntrega === "retirada" ? "🏪 Retirada" : pedidoCombinadoRascunho.tipoEntrega === "dine_in" ? "🍽️ Consumo no local" : ""} missing={!pedidoCombinadoRascunho.tipoEntrega} />
                {pedidoCombinadoRascunho.tipoEntrega === "delivery" && <Row label="Endereço" value={[pedidoCombinadoRascunho.endereco, pedidoCombinadoRascunho.bairro].filter(Boolean).join(", ")} missing={!pedidoCombinadoRascunho.endereco} />}
                <Row label="Pagamento" value={pedidoCombinadoRascunho.pagamento} missing={!pedidoCombinadoRascunho.pagamento} />
                {pedidoCombinadoRascunho.troco && <Row label="Troco para" value={pedidoCombinadoRascunho.troco} />}
                {pedidoCombinadoRascunho.observacao && <Row label="Obs." value={pedidoCombinadoRascunho.observacao} />}
              </div>
            </div>

            {/* Pendencias */}
            {pedidoCombinadoPendencias.length > 0 && (
              <div style={{ background: "rgba(239,68,68,.06)", border: "1px solid rgba(239,68,68,.3)", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: "#ef4444", textTransform: "uppercase", letterSpacing: ".8px" }}>Informações que faltam</span>
                {pedidoCombinadoPendencias.map((p, i) => (
                  <div key={i} style={{ fontSize: 13, fontWeight: 700, color: "#f87171", display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 10 }}>●</span> {p}
                  </div>
                ))}
                <p style={{ margin: "4px 0 0", fontSize: 12, fontWeight: 600, color: "#7f1d1d" }}>Volte para a conversa para pegar as informações que faltam.</p>
              </div>
            )}

            {/* Histórico da conversa */}
            {pedidoCombinadoConversa.length > 0 && (
              <div style={{ background: "#0d0c0b", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: "#5a564d", textTransform: "uppercase", letterSpacing: ".8px" }}>Histórico da conversa</span>
                {pedidoCombinadoConversa.map((m, i) => (
                  <div key={i} style={{ fontSize: 12, color: m.autor === "atendente" ? "#60a5fa" : "#c9c2b4", fontWeight: 600 }}>
                    <span style={{ fontWeight: 800, color: m.autor === "atendente" ? "#60a5fa" : "#a39b8b" }}>{m.autor === "atendente" ? "Atendente" : "Cliente"}: </span>{m.texto}
                  </div>
                ))}
              </div>
            )}

            {/* Botões */}
            {pedidoCombinadoPendencias.length === 0 && (
              <button
                onClick={criarPedidoCombinado}
                disabled={criandoPedidoCombinado}
                style={{ height: 56, border: "none", borderRadius: 16, background: criandoPedidoCombinado ? "#14532d" : "#22c55e", color: "#060606", fontSize: 16, fontWeight: 900, opacity: criandoPedidoCombinado ? 0.7 : 1 }}
              >{criandoPedidoCombinado ? "Criando..." : "✅ Criar pedido"}</button>
            )}
            <button
              onClick={() => { setModalPedidoCombinado(false) }}
              disabled={criandoPedidoCombinado}
              style={{ height: 46, border: "none", background: "transparent", color: "#a39b8b", fontSize: 14, fontWeight: 800 }}
            >← Voltar para conversa</button>
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
