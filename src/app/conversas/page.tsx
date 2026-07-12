"use client"
import { useEffect, useState, useRef } from "react"
import { useRouter } from "next/navigation"
import PanelShell from "@/components/PanelShell"

type StatusConversa = 'aguardando' | 'humano' | 'robo' | 'finalizado'

type ConversaRecente = {
  phone: string
  nome: string
  ultimaMensagem: string
  ultimaTs: number
  status: StatusConversa
  mensagensCount: number
}

const STATUS_COLOR: Record<StatusConversa, string> = {
  aguardando: "#e05050",
  humano: "#ff6b00",
  robo: "#5577ee",
  finalizado: "#8a8278",
}

const STATUS_LABEL: Record<StatusConversa, string> = {
  aguardando: "Na fila",
  humano: "Em atendimento",
  robo: "Com robô",
  finalizado: "Finalizado",
}

function formatRelTs(ts?: number): string {
  if (!ts) return ""
  const diff = Date.now() - ts
  if (diff < 60000) return "agora"
  if (diff < 3600000) return `${Math.floor(diff / 60000)}min`
  return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
}

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

function labelEspera(min: number, u: Urgency): string {
  if (u === "critico") return `Crítico · ${min}min`
  if (u === "urgente") return `Urgente · ${min}min`
  if (min === 0) return "Agora mesmo"
  return `${min}min esperando`
}

function temPixPendente(p: Pedido): boolean {
  return !!(p.pagamento && p.pagamento.toLowerCase().includes("pix") && !p.pixConfirmado && (p.total || 0) > 0)
}

function getInitials(name?: string | null): string {
  if (!name) return "?"
  const parts = name.trim().split(" ")
  if (parts.length >= 2) return ((parts[0][0] ?? "") + (parts[1][0] ?? "")).toUpperCase() || "?"
  return (parts[0][0] || "?").toUpperCase()
}

function formatTs(ts?: number): string {
  if (!ts) return ""
  return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
}

function ss(val: unknown, fallback = ""): string {
  return typeof val === "string" ? val : fallback
}

function normalizarConversa(raw: unknown): ConversaRecente {
  const c = (raw ?? {}) as Record<string, unknown>
  const validStatuses: StatusConversa[] = ["aguardando", "humano", "robo", "finalizado"]
  const phone = ss(c.phone)
  return {
    phone,
    nome: ss(c.nome) || phone || "?",
    ultimaMensagem: ss(c.ultimaMensagem),
    ultimaTs: typeof c.ultimaTs === "number" ? c.ultimaTs : 0,
    status: validStatuses.includes(c.status as StatusConversa)
      ? (c.status as StatusConversa)
      : "finalizado",
    mensagensCount: typeof c.mensagensCount === "number" ? c.mensagensCount : 0,
  }
}

function normalizarMensagem(raw: unknown): { autor: string; texto: string; ts?: number } {
  const m = (raw ?? {}) as Record<string, unknown>
  return {
    autor: ss(m.autor) || "bot",
    texto: ss(m.texto),
    ts: typeof m.ts === "number" ? m.ts : undefined,
  }
}

function msgTexto(msg: { autor: string; texto?: string | null }): string {
  const t = msg.texto ?? ""
  if (msg.autor === "atendente") return t.replace(/^\[.*?\]\s*/, "")
  return t
}

function msgSenderLabel(msg: { autor: string; texto?: string | null }): string {
  if (msg.autor === "atendente") {
    const m = (msg.texto ?? "").match(/^\[(.*?)\]/)
    return m ? m[1] : "Atendente"
  }
  if (msg.autor === "bot") return "Bot"
  return ""
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

  // Chat state
  const [conversaSelecionada, setConversaSelecionada] = useState<string | null>(null)
  const [historicoMsgs, setHistoricoMsgs] = useState<{ autor: string; texto: string; ts?: number }[]>([])
  const [mensagem, setMensagem] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [historicoErro, setHistoricoErro] = useState(false)
  const historicoBottomRef = useRef<HTMLDivElement>(null)
  const mensagemInputRef = useRef<HTMLTextAreaElement>(null)

  // Recentes: all conversations from last 30 min (conversa:* TTL)
  const [conversasRecentes, setConversasRecentes] = useState<ConversaRecente[]>([])

  async function carregarRecentes() {
    try {
      const r = await fetch("/api/conversas/recentes")
      if (r.ok) {
        const json = await r.json()
        setConversasRecentes(Array.isArray(json) ? json.map(normalizarConversa) : [])
      }
    } catch {}
  }

  function carregar() {
    fetch("/api/orders")
      .then(r => { if (r.status === 401) { router.push("/login?callbackUrl=/conversas"); return null } return r.json() })
      .then(data => { if (data) { setPedidos(Array.isArray(data) ? data : []); setLoading(false) } })
      .catch(() => setLoading(false))
  }

  useEffect(() => {
    carregar()
    const ivData = setInterval(carregar, 15000)
    const ivTime = setInterval(() => setNow(Date.now()), 30000)
    return () => { clearInterval(ivData); clearInterval(ivTime) }
  }, [router])

  useEffect(() => {
    carregarRecentes()
    const iv = setInterval(carregarRecentes, 8000)
    return () => clearInterval(iv)
  }, [])

  // Poll history for selected conversation. A conversa permanece aberta enquanto
  // selecionada — mesmo que saia da lista de recentes (ex.: finalizada ou após 30 min),
  // garantindo leitura do histórico sem fechar sozinha.
  useEffect(() => {
    if (!conversaSelecionada) { setHistoricoMsgs([]); setHistoricoErro(false); return }
    setHistoricoErro(false)
    carregarHistorico(conversaSelecionada)
    const iv = setInterval(() => carregarHistorico(conversaSelecionada), 3000)
    return () => clearInterval(iv)
  }, [conversaSelecionada])

  // Auto-scroll to newest message
  useEffect(() => {
    historicoBottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [historicoMsgs])

  function showToast(msg: string) {
    setToast(msg); clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(""), 3500)
  }

  async function carregarHistorico(phone: string) {
    try {
      const r = await fetch(`/api/pedido-combinado?phone=${encodeURIComponent(phone)}`)
      if (r.ok) {
        const data = await r.json()
        const msgs = Array.isArray(data?.conversa) ? data.conversa : []
        setHistoricoMsgs(msgs.map(normalizarMensagem))
        setHistoricoErro(false)
      } else {
        setHistoricoErro(true)
      }
    } catch {
      setHistoricoErro(true)
    }
  }

  async function enviarMensagem() {
    if (!conversaSelecionada || !mensagem.trim() || enviando) return
    const texto = mensagem.trim()
    setEnviando(true)
    try {
      const r = await fetch("/api/conversas/enviar-mensagem-humana", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: conversaSelecionada, text: texto, senderName: "Kellyne" }),
      })
      const data = await r.json()
      if (data.ok) {
        setMensagem("")
        setHistoricoMsgs(prev => [...prev, { autor: "atendente", texto: `[Kellyne] ${texto}`, ts: Date.now() }])
        mensagemInputRef.current?.focus()
      } else {
        showToast(data.error || "Erro ao enviar mensagem.")
      }
    } catch {
      showToast("Erro ao enviar mensagem.")
    }
    setEnviando(false)
  }

  async function devolverParaBot(p: Pedido) {
    setDevolvendoBot(p.id)
    try {
      const r = await fetch("/api/devolver-para-bot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefone: p.telefone }),
      })
      if (r.ok) {
        setPedidos(prev => prev.map(x => x.id === p.id ? { ...x, escalonado: false } : x))
        showToast("Conversa devolvida para o robô! 🤖")
      } else { showToast("Não foi possível devolver para o robô.") }
    } catch { showToast("Não foi possível devolver para o robô.") }
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
    ? fila.filter(p => ss(p.cliente).toLowerCase().includes(busca.toLowerCase()) || ss(p.telefone).includes(busca))
    : fila

  const atendBusca = busca.trim()
    ? emAtendimento.filter(p => ss(p.cliente).toLowerCase().includes(busca.toLowerCase()) || ss(p.telefone).includes(busca))
    : emAtendimento

  const maxEsperaMin = fila.length > 0 ? minEsperando(getTimestampEspera(fila[0]), now) : 0

  const pedidoSelecionado = conversaSelecionada
    ? pedidos.find(p => p.telefone === conversaSelecionada) ?? null
    : null
  const isFilaItem = pedidoSelecionado ? fila.some(p => p.id === pedidoSelecionado.id) : false

  // O painel abre com base no que foi clicado (conversaSelecionada), não na
  // permanência na lista de recentes. Se a conversa já saiu de recentes (ex.:
  // finalizada ou após 30 min), monta-se um registro de fallback somente-leitura
  // para que o histórico ainda abra.
  const conversaRecenteSelecionada: ConversaRecente | null = conversaSelecionada
    ? conversasRecentes.find(c => c.phone === conversaSelecionada) ?? {
        phone: conversaSelecionada,
        nome: pedidos.find(p => p.telefone === conversaSelecionada)?.cliente || conversaSelecionada,
        ultimaMensagem: "",
        ultimaTs: 0,
        status: "finalizado" as StatusConversa,
        mensagensCount: 0,
      }
    : null

  const recentesBusca = busca.trim()
    ? conversasRecentes.filter(c =>
        ss(c.nome).toLowerCase().includes(busca.toLowerCase()) || ss(c.phone).includes(busca)
      )
    : conversasRecentes

  const aguardandoCount = conversasRecentes.filter(c => c.status === 'aguardando').length
  const humanoCount = conversasRecentes.filter(c => c.status === 'humano').length

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
        @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&display=swap');
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        html, body { margin: 0; padding: 0; background: #060606; }
        button { cursor: pointer; font-family: 'Archivo', sans-serif; border: none; }
        @keyframes cbPulse { 0%{opacity:1} 50%{opacity:.4} 100%{opacity:1} }
        @keyframes cbFadeIn { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:none} }
        @keyframes cbSheetUp { from{transform:translateY(100%)} to{transform:none} }

        /* Override ps-content */
        .ps-content {
          overflow: hidden !important;
          padding-bottom: 0 !important;
          display: flex !important;
          flex-direction: column !important;
          background:
            radial-gradient(ellipse 55% 45% at 96% 4%, rgba(255,107,0,.07) 0%, transparent 65%),
            radial-gradient(ellipse 38% 30% at 4% 96%, rgba(180,110,30,.05) 0%, transparent 60%),
            #060606 !important;
        }

        /* ── Chat root ── */
        .cv-root {
          display: flex;
          flex-direction: row;
          background: #16130e;
          border-radius: 0;
          overflow: hidden;
          height: calc(100svh - 72px - env(safe-area-inset-bottom));
        }
        @media (min-width: 768px) {
          .cv-root {
            margin: 16px;
            border-radius: 28px;
            box-shadow:
              0 32px 88px rgba(0,0,0,.78),
              0 4px 20px rgba(0,0,0,.38),
              0 0 0 1px rgba(255,255,255,.042);
            height: calc(100vh - 32px);
          }
        }
        @media (min-width: 1024px) {
          .cv-root { margin: 20px; height: calc(100vh - 40px); }
        }

        /* ── Left column ── */
        .cv-left {
          display: flex;
          flex-direction: column;
          width: 100%;
          background: #16130e;
          overflow: hidden;
          flex-shrink: 0;
          position: relative;
          z-index: 1;
        }
        @media (min-width: 768px) {
          .cv-left { width: 300px; border-radius: 28px 0 0 28px; }
        }
        @media (min-width: 1024px) {
          .cv-left { width: 320px; }
        }

        /* ── Right column ── */
        .cv-right {
          display: none;
          flex-direction: column;
          flex: 1;
          background: #16130e;
          overflow: hidden;
        }
        @media (min-width: 768px) {
          .cv-right { display: flex !important; border-radius: 0 28px 28px 0; }
        }

        /* Mobile toggle */
        .cv-left.cv-mob-hidden { display: none !important; }
        .cv-right.cv-mob-visible { display: flex !important; }
        @media (min-width: 768px) {
          .cv-left.cv-mob-hidden { display: flex !important; }
          .cv-right { display: flex !important; }
        }

        /* ── List header ── */
        .cv-list-header {
          padding: 26px 18px 16px;
          background: transparent;
          flex-shrink: 0;
          position: relative;
          z-index: 1;
        }

        /* ── Título "Conversas" — sobrescreve inline style ── */
        .cv-list-header > div > div:first-child > div:first-child {
          color: #eae5de !important;
          font-size: clamp(20px, 1.8vw, 26px) !important;
          font-weight: 800 !important;
          letter-spacing: -0.7px !important;
          line-height: 1.15 !important;
        }
        /* Subtítulo — discreto, quase apagado */
        .cv-list-header > div > div:first-child > div:last-child {
          color: #312c27 !important;
          font-size: 10.5px !important;
          font-weight: 600 !important;
          letter-spacing: 0.05px !important;
          margin-top: 3px !important;
        }

        /* ── Search ── */
        .cv-search {
          width: 100%; height: 38px;
          background: rgba(255,255,255,.062);
          border: none;
          border-radius: 20px;
          padding: 0 14px 0 38px;
          color: #eae5de; font-size: 12.5px; font-weight: 600;
          font-family: 'Archivo', sans-serif;
          box-shadow: 0 1px 3px rgba(0,0,0,.32) inset;
          transition: box-shadow .15s, background .15s;
        }
        .cv-search::placeholder { color: #3c3830; }
        .cv-search:focus {
          outline: none;
          background: rgba(255,255,255,.082);
          box-shadow: 0 0 0 2px rgba(255,107,0,.24), 0 1px 3px rgba(0,0,0,.32) inset;
        }

        /* ── List scroll area ── */
        .cv-list-scroll {
          flex: 1;
          overflow-y: auto;
          padding: 6px 0 16px;
        }
        .cv-list-scroll::-webkit-scrollbar { width: 3px; }
        .cv-list-scroll::-webkit-scrollbar-track { background: transparent; }
        .cv-list-scroll::-webkit-scrollbar-thumb { background: #282018; border-radius: 2px; }

        /* ── Section label ── */
        .cv-section-label {
          font-size: 9.5px; font-weight: 800; letter-spacing: .9px;
          text-transform: uppercase; color: #38322c;
          padding: 16px 20px 6px;
        }

        /* ── Conversation items ── */
        .cv-item {
          display: flex; align-items: center; gap: 11px;
          padding: 11px 13px;
          margin: 2px 8px;
          border-radius: 14px;
          cursor: pointer;
          transition: background .12s, box-shadow .12s, transform .1s;
          animation: cbFadeIn .2s ease both;
        }
        .cv-item:hover {
          background: rgba(255,255,255,.054);
          transform: translateY(-1px);
        }
        /* Item selecionado — indicador laranja na borda esquerda */
        .cv-item.cv-item-active {
          background: rgba(255,107,0,.065);
          box-shadow:
            inset 3px 0 0 rgba(255,107,0,.6),
            0 4px 16px rgba(0,0,0,.26);
        }

        /* Avatar */
        .cv-item-avatar {
          width: 40px; height: 40px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 13px; font-weight: 800; flex-shrink: 0;
          letter-spacing: -0.3px;
        }
        .cv-item-body { flex: 1; min-width: 0; }
        .cv-item-name {
          font-size: 13px; font-weight: 700; color: #e8e3dc;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          line-height: 1.3;
        }
        .cv-item-preview {
          font-size: 11.5px; font-weight: 500; color: #565048;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          margin-top: 3px;
          line-height: 1.3;
        }
        .cv-item-meta {
          display: flex; flex-direction: column; align-items: flex-end; gap: 5px; flex-shrink: 0;
        }
        .cv-item-time { font-size: 10.5px; font-weight: 600; color: #423c36; }

        /* ── Empty states ── */
        .cv-list-empty { padding: 52px 28px; text-align: center; }
        .cv-no-select {
          flex: 1; display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          color: #504840; gap: 10px;
        }

        /* ── Chat header ── */
        .cv-chat-header {
          display: flex; align-items: center; gap: 12px;
          padding: 14px 20px;
          background: #1c1913;
          flex-shrink: 0;
          min-height: 68px;
          position: relative; z-index: 1;
          box-shadow: 0 2px 14px rgba(0,0,0,.32);
        }
        .cv-chat-header-avatar {
          width: 40px; height: 40px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 13px; font-weight: 800; flex-shrink: 0;
        }
        .cv-chat-header-info { flex: 1; min-width: 0; }
        .cv-chat-header-name {
          font-size: 15px; font-weight: 800; color: #ece8e1;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          letter-spacing: -0.3px; line-height: 1.2;
        }
        .cv-chat-header-sub {
          font-size: 11px; font-weight: 500; color: #454038;
          margin-top: 3px; letter-spacing: 0.1px;
        }
        .cv-chat-header-actions { display: flex; align-items: center; gap: 7px; flex-shrink: 0; }

        /* Header buttons */
        .cv-btn-wa {
          display: flex; align-items: center; gap: 5px;
          height: 34px; padding: 0 12px;
          background: #25d366; border-radius: 20px;
          color: #fff; font-family: 'Archivo', sans-serif;
          font-size: 11.5px; font-weight: 800; text-decoration: none;
          box-shadow: 0 2px 8px rgba(37,211,102,.22);
          transition: opacity .15s, transform .1s;
        }
        .cv-btn-wa:hover { opacity: .9; transform: translateY(-1px); }
        .cv-btn-wa:active { opacity: .8; transform: none; }
        .cv-btn-bot {
          height: 34px; padding: 0 12px;
          background: rgba(100,140,255,.08);
          border: 1px solid rgba(100,140,255,.2);
          border-radius: 20px; color: #7090de;
          font-size: 11.5px; font-weight: 800;
          transition: opacity .15s;
        }
        .cv-btn-bot:disabled { opacity: .35; }
        .cv-btn-fin {
          height: 34px; padding: 0 12px;
          background: transparent;
          border: 1px solid rgba(255,255,255,.1);
          border-radius: 20px; color: #686058;
          font-size: 11.5px; font-weight: 700;
          transition: background .15s;
        }
        .cv-btn-fin:hover:not(:disabled) { background: rgba(255,255,255,.05); }
        .cv-btn-fin:disabled { opacity: .35; }
        .cv-btn-back {
          height: 34px; width: 34px;
          background: transparent; border: none;
          color: #686058; font-size: 17px;
          display: flex; align-items: center; justify-content: center;
          border-radius: 50%; flex-shrink: 0;
          transition: background .12s;
        }
        .cv-btn-back:hover { background: rgba(255,255,255,.05); }
        @media (min-width: 768px) {
          .cv-btn-back { display: none !important; }
        }

        /* ── Messages area ── */
        .cv-msgs {
          flex: 1; overflow-y: auto;
          padding: 24px 22px 16px;
          display: flex; flex-direction: column; gap: 8px;
          background: #121008;
        }
        .cv-msgs::-webkit-scrollbar { width: 3px; }
        .cv-msgs::-webkit-scrollbar-track { background: transparent; }
        .cv-msgs::-webkit-scrollbar-thumb { background: #282018; border-radius: 2px; }

        /* Message rows */
        .cv-msg-row { display: flex; flex-direction: column; max-width: 72%; gap: 3px; }
        .cv-msg-row.cv-row-client { align-self: flex-start; }
        .cv-msg-row.cv-row-atendente { align-self: flex-end; align-items: flex-end; }
        .cv-msg-row.cv-row-bot { align-self: flex-end; align-items: flex-end; }

        /* Bubbles */
        .cv-bubble {
          padding: 9px 15px; border-radius: 18px;
          font-size: 13px; font-weight: 500; line-height: 1.6;
          word-break: break-word;
        }
        .cv-bubble-client {
          background: #272019; color: #cec8bf;
          border-bottom-left-radius: 5px;
        }
        .cv-bubble-atendente {
          background: linear-gradient(148deg, #f07422 0%, #e04a00 100%);
          color: #fff;
          border-bottom-right-radius: 5px;
          box-shadow: 0 3px 12px rgba(210,85,0,.26);
        }
        .cv-bubble-bot {
          background: #181b2c; color: #7d91c2;
          border-bottom-right-radius: 5px;
        }

        /* Sender label + time */
        .cv-msg-sender { font-size: 10px; font-weight: 600; color: #48403a; padding: 0 4px; }
        .cv-msg-time { font-size: 10px; font-weight: 500; color: #4c4440; padding: 0 4px; }
        .cv-msgs-empty {
          flex: 1; display: flex; align-items: center; justify-content: center;
          color: #38322c; font-size: 12.5px; font-weight: 600;
        }

        /* ── Input area ── */
        .cv-input-wrap {
          display: flex; align-items: flex-end; gap: 10px;
          padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
          background: #1c1913;
          flex-shrink: 0;
          box-shadow: 0 -2px 14px rgba(0,0,0,.3);
        }
        @media (min-width: 768px) {
          .cv-input-wrap { padding: 12px 16px; }
        }

        /* Textarea */
        .cv-textarea {
          flex: 1; min-height: 42px; max-height: 110px;
          background: #252018;
          border: none;
          border-radius: 22px;
          padding: 10px 16px;
          color: #ece8e1; font-size: 13px; font-weight: 500;
          font-family: 'Archivo', sans-serif; resize: none;
          line-height: 1.5;
          box-shadow: 0 1px 3px rgba(0,0,0,.3) inset;
          transition: box-shadow .15s, background .15s;
        }
        .cv-textarea::placeholder { color: #3a3428; }
        .cv-textarea:focus {
          outline: none;
          background: #2b2318;
          box-shadow: 0 0 0 2px rgba(255,107,0,.22), 0 1px 3px rgba(0,0,0,.3) inset;
        }

        /* Send button */
        .cv-send-btn {
          width: 44px; height: 44px; border-radius: 50%; flex-shrink: 0;
          background: linear-gradient(150deg, #f07e2c 0%, #e04e00 100%);
          color: #fff;
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 4px 14px rgba(210,85,0,.36);
          transition: opacity .15s, transform .1s, box-shadow .15s;
        }
        .cv-send-btn:hover:not(:disabled) {
          opacity: .93;
          transform: translateY(-1px);
          box-shadow: 0 6px 20px rgba(210,85,0,.46);
        }
        .cv-send-btn:active:not(:disabled) { transform: scale(.92); box-shadow: 0 2px 8px rgba(210,85,0,.26); }
        .cv-send-btn:disabled { background: #222018; color: #3a3428; box-shadow: none; }

        /* ── Status badges ── */
        .cv-badge-fila {
          font-size: 9.5px; font-weight: 800; padding: 3px 8px; border-radius: 18px;
          background: rgba(210,72,72,.1); color: #cc4444;
          border: 1px solid rgba(210,72,72,.22);
          white-space: nowrap;
        }
        .cv-badge-atend {
          font-size: 9.5px; font-weight: 800; padding: 3px 8px; border-radius: 18px;
          background: rgba(80,168,112,.08); color: #4a9a68;
          border: 1px solid rgba(80,168,112,.2);
          white-space: nowrap;
        }
        .cv-badge-pix {
          font-size: 9.5px; font-weight: 800; padding: 3px 7px; border-radius: 18px;
          background: rgba(220,155,0,.1); color: #a07800;
          white-space: nowrap;
        }
        .cv-dot {
          width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
          animation: cbPulse 1.8s ease-in-out infinite;
        }
      `}</style>

      <PanelShell
        conversasCount={aguardandoCount + humanoCount}
        conversasUrgent={aguardandoCount > 0}
      >
        <div className="cv-root">

          {/* ── LEFT COLUMN: conversation list ── */}
          <div className={`cv-left${conversaSelecionada ? " cv-mob-hidden" : ""}`}>

            {/* List header */}
            <div className="cv-list-header">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 900, color: "#1a1715", letterSpacing: "-0.3px" }}>Conversas</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#a09790", marginTop: 1 }}>Últimas 30 minutos</div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {aguardandoCount > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(224,80,80,.08)", border: "1px solid rgba(224,80,80,.22)", borderRadius: 20, padding: "4px 10px" }}>
                      <span className="cv-dot" style={{ background: "#e05050" }} />
                      <span style={{ fontSize: 11, fontWeight: 900, color: "#e05050" }}>{aguardandoCount}</span>
                    </div>
                  )}
                  {humanoCount > 0 && (
                    <div style={{ background: "rgba(255,107,0,.08)", border: "1px solid rgba(255,107,0,.22)", borderRadius: 20, padding: "4px 10px" }}>
                      <span style={{ fontSize: 11, fontWeight: 900, color: "#ff6b00" }}>{humanoCount}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Search */}
              <div style={{ position: "relative" }}>
                <svg style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <circle cx="11" cy="11" r="7" stroke="#b0a89e" strokeWidth="2.2" />
                  <path d="M16.5 16.5l3.5 3.5" stroke="#b0a89e" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
                <input
                  className="cv-search"
                  type="text"
                  placeholder="Buscar por nome ou telefone…"
                  value={busca}
                  onChange={e => setBusca(e.target.value)}
                />
                {busca && (
                  <button onClick={() => setBusca("")} style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#a09790", fontSize: 17, lineHeight: 1, padding: 4 }}>×</button>
                )}
              </div>

              {/* Compact metrics */}
              {aguardandoCount > 0 && maxEsperaMin > 0 && (
                <div style={{ marginTop: 10, fontSize: 11, fontWeight: 700, color: maxEsperaMin >= 8 ? "#e05050" : "#a09790" }}>
                  Aguardando há {maxEsperaMin}min (mais antigo)
                </div>
              )}
            </div>

            {/* List scroll */}
            <div className="cv-list-scroll">
              {recentesBusca.map((c, idx) => {
                const isActive = conversaSelecionada === c.phone
                const cor = STATUS_COLOR[c.status]
                const pedidoC = pedidos.find(p => p.telefone === c.phone)
                const pixPendente = pedidoC ? temPixPendente(pedidoC) : false
                return (
                  <div
                    key={c.phone}
                    className={`cv-item${isActive ? " cv-item-active" : ""}`}
                    onClick={() => setConversaSelecionada(c.phone)}
                    style={{ animationDelay: `${idx * 0.03}s` }}
                  >
                    <div className="cv-item-avatar" style={{ background: `${cor}18`, border: `1.5px solid ${cor}44`, color: cor }}>
                      {getInitials(c.nome)}
                    </div>
                    <div className="cv-item-body">
                      <div className="cv-item-name">{c.nome}</div>
                      <div className="cv-item-preview">{c.ultimaMensagem}</div>
                    </div>
                    <div className="cv-item-meta">
                      <span className="cv-item-time">{formatRelTs(c.ultimaTs)}</span>
                      {pixPendente
                        ? <span className="cv-badge-pix">PIX⏳</span>
                        : <span style={{ fontSize: 10, fontWeight: 900, padding: "3px 8px", borderRadius: 20, background: `${cor}12`, color: cor, border: `1px solid ${cor}30`, whiteSpace: "nowrap" }}>{STATUS_LABEL[c.status]}</span>
                      }
                    </div>
                  </div>
                )
              })}

              {/* Empty states */}
              {recentesBusca.length === 0 && (
                <div className="cv-list-empty">
                  {busca ? (
                    <>
                      <div style={{ fontSize: 26, marginBottom: 8 }}>🔍</div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: "#a09790" }}>Nenhum resultado para "{busca}"</div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 30, marginBottom: 10 }}>✅</div>
                      <div style={{ fontSize: 14, fontWeight: 900, color: "#56b87e", marginBottom: 6 }}>Nenhuma conversa recente</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#b0a89e", lineHeight: 1.6 }}>
                        As conversas das últimas 30 minutos aparecem aqui automaticamente.
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── RIGHT COLUMN: open conversation ── */}
          <div className={`cv-right${conversaSelecionada ? " cv-mob-visible" : ""}`}>
            {!conversaRecenteSelecionada ? (
              <div className="cv-no-select">
                <div style={{ fontSize: 36 }}>💬</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: "#8a8278" }}>
                  {conversaSelecionada ? "Carregando…" : "Selecione uma conversa"}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#b0a89e", textAlign: "center", maxWidth: 240 }}>
                  {!conversaSelecionada && "Escolha um cliente na lista ao lado para ver o histórico."}
                </div>
              </div>
            ) : (
              <>
                {/* Chat header */}
                {(() => {
                  const nomeHeader = pedidoSelecionado?.cliente ?? conversaRecenteSelecionada.nome
                  const cor = STATUS_COLOR[conversaRecenteSelecionada.status]
                  return (
                    <div className="cv-chat-header">
                      <button className="cv-btn-back" onClick={() => setConversaSelecionada(null)} aria-label="Voltar">
                        ←
                      </button>
                      <div className="cv-chat-header-avatar" style={{ background: `${cor}18`, color: cor, border: `1.5px solid ${cor}44` }}>
                        {getInitials(nomeHeader)}
                      </div>
                      <div className="cv-chat-header-info">
                        <div className="cv-chat-header-name">{nomeHeader}</div>
                        <div className="cv-chat-header-sub">{conversaRecenteSelecionada.phone}</div>
                      </div>
                      <div className="cv-chat-header-actions">
                        <span style={{ fontSize: 10, fontWeight: 900, padding: "3px 8px", borderRadius: 20, background: `${cor}12`, color: cor, border: `1px solid ${cor}30` }}>
                          {STATUS_LABEL[conversaRecenteSelecionada.status]}
                        </span>
                        <a href={whatsappLink(conversaRecenteSelecionada.phone)} target="_blank" rel="noreferrer" className="cv-btn-wa">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                            <path d="M9.5 8.5c-.28 0-.5.04-.7.12C8.3 8.2 7 9.5 7 11c0 2.5 2.5 5 5 6.5 1.5.8 3.5.5 4.5-.5.2-.2.4-.5.5-.8.1-.3 0-.6-.2-.8l-1.8-1.3c-.2-.15-.5-.1-.7.05l-.8.8c-.15.15-.4.2-.6.1C12 14.8 11.2 14 10.6 13c-.1-.2-.05-.45.1-.6l.8-.8c.15-.2.2-.5.05-.7L10.3 9.1c-.2-.22-.5-.6-.8-.6z" fill="white" />
                          </svg>
                          WA
                        </a>
                        {pedidoSelecionado && isFilaItem && (
                          <button
                            className="cv-btn-bot"
                            disabled={devolvendoBot === pedidoSelecionado.id}
                            onClick={() => devolverParaBot(pedidoSelecionado)}
                          >
                            {devolvendoBot === pedidoSelecionado.id ? "…" : "🤖"}
                          </button>
                        )}
                        {pedidoSelecionado && (
                          <button
                            className="cv-btn-fin"
                            disabled={finalizando === pedidoSelecionado.id}
                            onClick={() => setConfirmando(pedidoSelecionado)}
                          >
                            {finalizando === pedidoSelecionado.id ? "…" : "Finalizar"}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })()}

                {/* PIX warning strip */}
                {pedidoSelecionado && temPixPendente(pedidoSelecionado) && (
                  <div style={{ background: "rgba(255,170,0,.08)", borderBottom: "1px solid rgba(255,170,0,.2)", padding: "8px 18px", fontSize: 12, fontWeight: 800, color: "#c08000", flexShrink: 0 }}>
                    ⚠ Pix pendente de confirmação neste pedido
                  </div>
                )}

                {/* Status info strip for non-humano conversations */}
                {conversaRecenteSelecionada.status !== 'humano' && (
                  <div style={{ background: "rgba(0,0,0,.03)", borderBottom: "1px solid rgba(0,0,0,.06)", padding: "7px 18px", fontSize: 12, fontWeight: 700, color: STATUS_COLOR[conversaRecenteSelecionada.status], flexShrink: 0 }}>
                    {conversaRecenteSelecionada.status === 'aguardando' && "⏳ Na fila — aguardando atendimento humano"}
                    {conversaRecenteSelecionada.status === 'robo' && "🤖 Robô está respondendo esta conversa"}
                    {conversaRecenteSelecionada.status === 'finalizado' && "✓ Atendimento finalizado — histórico somente leitura"}
                  </div>
                )}

                {/* Messages area */}
                <div className="cv-msgs">
                  {historicoErro && historicoMsgs.length === 0 ? (
                    <div className="cv-msgs-empty">Não foi possível carregar o histórico. Tentando novamente…</div>
                  ) : historicoMsgs.length === 0 ? (
                    <div className="cv-msgs-empty">Sem histórico de mensagens disponível</div>
                  ) : (
                    historicoMsgs.map((msg, i) => {
                      const isClient = msg.autor === "cliente"
                      const isBot = msg.autor === "bot"
                      const rowClass = isClient ? "cv-row-client" : isBot ? "cv-row-bot" : "cv-row-atendente"
                      const bubbleClass = isClient ? "cv-bubble-client" : isBot ? "cv-bubble-bot" : "cv-bubble-atendente"
                      const sender = msgSenderLabel(msg)
                      return (
                        <div key={i} className={`cv-msg-row ${rowClass}`}>
                          {sender && <span className="cv-msg-sender">{sender}</span>}
                          <div className={`cv-bubble ${bubbleClass}`}>{msgTexto(msg)}</div>
                          {msg.ts && <span className="cv-msg-time">{formatTs(msg.ts)}</span>}
                        </div>
                      )
                    })
                  )}
                  <div ref={historicoBottomRef} />
                </div>

                {/* Message input — only when human is handling */}
                {conversaRecenteSelecionada.status === 'humano' && (
                  <div className="cv-input-wrap">
                    <textarea
                      ref={mensagemInputRef}
                      className="cv-textarea"
                      placeholder="Digite sua mensagem…"
                      value={mensagem}
                      rows={1}
                      onChange={e => setMensagem(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault()
                          enviarMensagem()
                        }
                      }}
                    />
                    <button
                      className="cv-send-btn"
                      onClick={enviarMensagem}
                      disabled={enviando || !mensagem.trim()}
                      aria-label="Enviar mensagem"
                    >
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                        <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

        </div>
      </PanelShell>

      {/* ── MODAL CONFIRMAÇÃO ── */}
      {confirmando && (
        <>
          <div onClick={() => setConfirmando(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 90 }} />
          <div style={{
            position: "fixed", bottom: 0, left: 0, right: 0, margin: "0 auto", maxWidth: 480,
            background: "#ffffff", border: "1px solid #e2ddd6", borderBottom: "none",
            borderRadius: "22px 22px 0 0", zIndex: 91,
            animation: "cbSheetUp .3s cubic-bezier(.2,.9,.3,1) both",
            padding: "18px 20px calc(env(safe-area-inset-bottom) + 28px)",
            display: "flex", flexDirection: "column", gap: 10,
          }}>
            <div style={{ width: 40, height: 4, borderRadius: 2, background: "#e2ddd6", margin: "0 auto 6px" }} />

            {temPixPendente(confirmando) && (
              <div style={{ background: "rgba(255,170,0,.07)", border: "1px solid rgba(255,170,0,.22)", borderRadius: 10, padding: "10px 14px" }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: "#c08000", marginBottom: 3 }}>⚠ Pix pendente</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#8a8278", lineHeight: 1.5 }}>
                  Esse pedido aguarda confirmação de Pix. Finalizar removerá o atendimento da fila.
                </div>
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: "50%", background: "rgba(90,86,77,.1)", border: "1px solid #e2ddd6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 900, color: "#8a8278", flexShrink: 0 }}>
                {getInitials(confirmando.cliente)}
              </div>
              <div>
                <div style={{ fontSize: 17, fontWeight: 900, letterSpacing: "-0.3px", color: "#1a1715" }}>Finalizar atendimento?</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#8a8278" }}>{ss(confirmando.cliente).split(" ")[0] || "Cliente"}</div>
              </div>
            </div>

            <div style={{ fontSize: 13, fontWeight: 600, color: "#8a8278", lineHeight: 1.55 }}>
              Esse atendimento será removido da tela de conversas. Nenhuma mensagem será enviada ao cliente.
            </div>
            <button onClick={() => finalizarAtendimento(confirmando)} style={{ height: 52, borderRadius: 13, background: "#e8f5ed", border: "1px solid rgba(86,184,126,.3)", color: "#3a7a52", fontSize: 15, fontWeight: 900 }}>
              Sim, finalizar
            </button>
            <button onClick={() => setConfirmando(null)} style={{ height: 42, background: "transparent", color: "#8a8278", fontSize: 13, fontWeight: 800, border: "none" }}>
              Cancelar
            </button>
          </div>
        </>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", bottom: "calc(env(safe-area-inset-bottom) + 80px)", left: "50%", transform: "translateX(-50%)", background: "#1a1715", border: "1px solid #2a2723", borderRadius: 14, padding: "12px 18px", fontSize: 13, fontWeight: 700, color: "#f8f5f1", zIndex: 80, whiteSpace: "nowrap", maxWidth: "calc(100% - 32px)", fontFamily: "'Archivo', sans-serif", boxShadow: "0 4px 20px rgba(0,0,0,.4)" }}>
          {toast}
        </div>
      )}
    </>
  )
}
