"use client"
import { useEffect, useState, useRef } from "react"
import ConfirmDialog from '@/components/ConfirmDialog'
import { useRouter } from "next/navigation"
import PanelShell from "@/components/PanelShell"

type StatusConversa = 'aguardando' | 'humano' | 'robo' | 'finalizado'

export type ConversaRecente = {
  phone: string
  nome: string
  ultimaMensagem: string
  ultimaTs: number
  status: StatusConversa
  mensagensCount: number
}

const STATUS_COLOR: Record<StatusConversa, string> = {
  aguardando: "var(--danger)",
  humano: "var(--brand-text)",
  robo: "var(--info)",
  finalizado: "var(--foreground-secondary)",
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

const UC: Record<Urgency, string> = { normal: "var(--success)", atencao: "var(--primary)", urgente: "var(--danger)", critico: "var(--danger)" }

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

// Defesa em segunda camada: mesmo com a API normalizando o phone (camada 1),
// o telefone pode chegar aqui como number (proxy/serialização intermediária)
// ou vir de um registro antigo só com o campo "telefone". Nunca aceitar só
// string — e nunca deixar cair em "" (string vazia é falsy e quebra a
// comparação de seleção `conversaSelecionada === c.phone`).
export function normalizarTelefone(val: unknown): string {
  if (typeof val === "number" && Number.isFinite(val)) return String(val)
  if (typeof val === "string") return val.trim()
  return ""
}

export function normalizarConversa(raw: unknown): ConversaRecente | null {
  const c = (raw ?? {}) as Record<string, unknown>
  const validStatuses: StatusConversa[] = ["aguardando", "humano", "robo", "finalizado"]
  const phone = normalizarTelefone(c.phone) || normalizarTelefone(c.telefone)
  if (!phone) return null
  return {
    phone,
    nome: ss(c.nome) || phone,
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
        const normalizadas = Array.isArray(json)
          ? json.map(normalizarConversa).filter((c): c is ConversaRecente => c !== null)
          : []
        setConversasRecentes(normalizadas)
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
    // Atualiza a lista só enquanto a aba está visível, e imediatamente ao
    // voltar para ela — mesmo padrão de src/app/cliente/pedidos/page.tsx.
    function talvezCarregar() {
      if (document.visibilityState === 'visible') carregar()
    }
    const ivData = setInterval(talvezCarregar, 15000)
    const ivTime = setInterval(() => setNow(Date.now()), 30000)
    document.addEventListener('visibilitychange', talvezCarregar)
    return () => { clearInterval(ivData); clearInterval(ivTime); document.removeEventListener('visibilitychange', talvezCarregar) }
  }, [router])

  useEffect(() => {
    carregarRecentes()
    function talvezCarregarRecentes() {
      if (document.visibilityState === 'visible') carregarRecentes()
    }
    const iv = setInterval(talvezCarregarRecentes, 8000)
    document.addEventListener('visibilitychange', talvezCarregarRecentes)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', talvezCarregarRecentes) }
  }, [])

  // Poll history for selected conversation. A conversa permanece aberta enquanto
  // selecionada — mesmo que saia da lista de recentes (ex.: finalizada ou após 30 min),
  // garantindo leitura do histórico sem fechar sozinha. Só consulta com a aba
  // visível, e atualiza imediatamente ao voltar para ela.
  useEffect(() => {
    if (!conversaSelecionada) { setHistoricoMsgs([]); setHistoricoErro(false); return }
    const phone = conversaSelecionada
    setHistoricoErro(false)
    carregarHistorico(phone)
    function talvezCarregarHistorico() {
      if (document.visibilityState === 'visible') carregarHistorico(phone)
    }
    const iv = setInterval(talvezCarregarHistorico, 3000)
    document.addEventListener('visibilitychange', talvezCarregarHistorico)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', talvezCarregarHistorico) }
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
    <div style={{ height: "100svh", background: "var(--background)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Archivo', sans-serif" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>💬</div>
        <p style={{ color: "var(--foreground-muted)", fontSize: 13, fontWeight: 700, margin: 0 }}>Carregando…</p>
      </div>
    </div>
  )

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800;900&display=swap');
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        html, body { margin: 0; padding: 0; background: var(--background); }
        button { cursor: pointer; font-family: 'Archivo', sans-serif; border: none; }
        @keyframes cbPulse { 0%{opacity:1} 50%{opacity:.4} 100%{opacity:1} }
        @keyframes cbFadeIn { from{opacity:0;transform:translateY(5px)} to{opacity:1;transform:none} }
        @keyframes cbSheetUp { from{transform:translateY(100%)} to{transform:none} }

        /* Override ps-content */
        .ps-content {
          overflow: hidden !important;
          padding-bottom: 0 !important;
          display: flex !important;
          flex-direction: column !important;
          background:
            radial-gradient(ellipse 55% 45% at 96% 4%, color-mix(in srgb, var(--primary) 9%, transparent) 0%, transparent 65%),
            radial-gradient(ellipse 38% 30% at 4% 96%, color-mix(in srgb, var(--primary) 7%, transparent) 0%, transparent 60%),
            var(--background) !important;
        }

        /* ── Chat root ── */
        .cv-root {
          display: flex;
          flex-direction: row;
          background: var(--background);
          border-radius: 0;
          overflow: hidden;
          height: calc(100svh - 72px - env(safe-area-inset-bottom));
        }
        @media (min-width: 768px) {
          .cv-root {
            margin: 16px;
            border-radius: 32px;
            box-shadow:
              0 24px 80px rgba(0,0,0,.72),
              0 4px 24px rgba(0,0,0,.42),
              0 0 0 1px rgba(var(--overlay-rgb), 0.05);
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
          background: var(--background);
          overflow: hidden;
          flex-shrink: 0;
          position: relative;
          z-index: 1;
        }
        @media (min-width: 768px) {
          .cv-left { width: 300px; border-radius: 32px 0 0 32px; }
        }
        @media (min-width: 1024px) {
          .cv-left { width: 320px; }
        }

        /* ── Right column ── */
        .cv-right {
          display: none;
          flex-direction: column;
          flex: 1;
          background: var(--background);
          overflow: hidden;
        }
        @media (min-width: 768px) {
          .cv-right { display: flex !important; border-radius: 0 32px 32px 0; }
        }

        /* Mobile toggle */
        .cv-left.cv-mob-hidden { display: none !important; }
        .cv-right.cv-mob-visible { display: flex !important; }
        @media (min-width: 768px) {
          .cv-left.cv-mob-hidden { display: flex !important; }
          .cv-right { display: flex !important; }
        }

        /* ── List header — sem sombra (remove a linha abaixo da busca) ── */
        .cv-list-header {
          padding: 20px 16px 14px;
          background: transparent;
          flex-shrink: 0;
          position: relative;
          z-index: 1;
        }

        /* ── Título "Conversas" — força cor clara (inline style usa dark) ── */
        .cv-list-header > div > div:first-child > div:first-child {
          color: var(--brand-text) !important;
          font-size: clamp(18px, 1.6vw, 24px) !important;
          letter-spacing: -0.5px !important;
        }
        .cv-list-header > div > div:first-child > div:last-child {
          color: var(--border-strong) !important;
        }

        /* ── Search ── */
        .cv-search {
          width: 100%; height: 40px;
          background: rgba(var(--overlay-rgb), 0.07);
          border: none;
          border-radius: 22px;
          padding: 0 14px 0 38px;
          color: var(--brand-text); font-size: 13px; font-weight: 600;
          font-family: 'Archivo', sans-serif;
          box-shadow: 0 1px 4px rgba(0,0,0,.35) inset;
          transition: box-shadow .15s;
        }
        .cv-search::placeholder { color: var(--border-strong); }
        .cv-search:focus { outline: none; box-shadow: 0 0 0 2.5px color-mix(in srgb, var(--primary) 30%, transparent), 0 1px 4px rgba(0,0,0,.35) inset; }

        /* ── List scroll area ── */
        .cv-list-scroll {
          flex: 1;
          overflow-y: auto;
          padding: 4px 0 8px;
        }
        .cv-list-scroll::-webkit-scrollbar { width: 3px; }
        .cv-list-scroll::-webkit-scrollbar-track { background: transparent; }
        .cv-list-scroll::-webkit-scrollbar-thumb { background: var(--surface-secondary); border-radius: 2px; }

        /* ── Section label ── */
        .cv-section-label {
          font-size: 10px; font-weight: 900; letter-spacing: .7px;
          text-transform: uppercase; color: var(--border-strong);
          padding: 14px 20px 5px;
        }

        /* ── Conversation items ── */
        .cv-item {
          display: flex; align-items: center; gap: 12px;
          padding: 12px 14px;
          margin: 3px 10px;
          border-radius: 16px;
          cursor: pointer;
          transition: background .14s, box-shadow .14s, transform .1s;
          animation: cbFadeIn .22s ease both;
        }
        .cv-item:hover {
          background: rgba(var(--overlay-rgb), 0.06);
          box-shadow: 0 3px 14px rgba(0,0,0,.3);
          transform: translateY(-1px);
        }
        .cv-item.cv-item-active {
          background: rgba(var(--overlay-rgb), 0.09);
          box-shadow:
            0 6px 20px color-mix(in srgb, var(--primary) 16%, transparent),
            0 2px 6px rgba(0,0,0,.3);
        }
        .cv-item-avatar {
          width: 44px; height: 44px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 14px; font-weight: 900; flex-shrink: 0;
          letter-spacing: -0.5px;
        }
        .cv-item-body { flex: 1; min-width: 0; }
        .cv-item-name {
          font-size: 13.5px; font-weight: 800; color: var(--brand-text);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .cv-item-preview {
          font-size: 12px; font-weight: 600; color: var(--foreground-muted);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          margin-top: 2px;
        }
        .cv-item-meta {
          display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0;
        }
        .cv-item-time { font-size: 11px; font-weight: 700; color: var(--border-strong); }

        /* ── Empty states ── */
        .cv-list-empty { padding: 44px 24px; text-align: center; }
        .cv-no-select {
          flex: 1; display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          color: var(--foreground-muted); gap: 12px;
        }

        /* ── Chat header ── */
        .cv-chat-header {
          display: flex; align-items: center; gap: 12px;
          padding: 16px 20px;
          background: var(--surface);
          flex-shrink: 0;
          min-height: 72px;
          position: relative; z-index: 1;
          box-shadow: 0 3px 16px rgba(0,0,0,.35);
        }
        .cv-chat-header-avatar {
          width: 42px; height: 42px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 14px; font-weight: 900; flex-shrink: 0;
        }
        .cv-chat-header-info { flex: 1; min-width: 0; }
        .cv-chat-header-name {
          font-size: 14px; font-weight: 900; color: var(--brand-text);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .cv-chat-header-sub { font-size: 11px; font-weight: 700; color: var(--foreground-muted); margin-top: 2px; }
        .cv-chat-header-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

        /* Header buttons */
        .cv-btn-wa {
          display: flex; align-items: center; gap: 5px;
          height: 36px; padding: 0 13px;
          background: var(--whatsapp); border-radius: 22px;
          color: var(--foreground); font-family: 'Archivo', sans-serif;
          font-size: 12px; font-weight: 900; text-decoration: none;
          box-shadow: 0 2px 8px color-mix(in srgb, var(--whatsapp) 30%, transparent);
          transition: opacity .15s, transform .1s;
        }
        .cv-btn-wa:hover { opacity: .92; transform: translateY(-1px); }
        .cv-btn-wa:active { opacity: .8; transform: none; }
        .cv-btn-bot {
          height: 36px; padding: 0 12px;
          background: color-mix(in srgb, var(--info) 10%, transparent);
          border: 1.5px solid color-mix(in srgb, var(--info) 25%, transparent);
          border-radius: 22px; color: var(--info);
          font-size: 12px; font-weight: 900;
          transition: opacity .15s;
        }
        .cv-btn-bot:disabled { opacity: .4; }
        .cv-btn-fin {
          height: 36px; padding: 0 12px;
          background: transparent;
          border: 1.5px solid rgba(var(--overlay-rgb), 0.12);
          border-radius: 22px; color: var(--foreground-muted);
          font-size: 12px; font-weight: 800;
          transition: background .15s;
        }
        .cv-btn-fin:hover:not(:disabled) { background: rgba(var(--overlay-rgb), 0.06); }
        .cv-btn-fin:disabled { opacity: .4; }
        .cv-btn-back {
          height: 36px; width: 36px;
          background: transparent; border: none;
          color: var(--foreground-muted); font-size: 18px;
          display: flex; align-items: center; justify-content: center;
          border-radius: 50%; flex-shrink: 0;
          transition: background .12s;
        }
        .cv-btn-back:hover { background: rgba(var(--overlay-rgb), 0.06); }
        @media (min-width: 768px) {
          .cv-btn-back { display: none !important; }
        }

        /* ── Messages area (única região rolável) ── */
        .cv-msgs {
          flex: 1; overflow-y: auto;
          padding: 20px 20px 12px;
          display: flex; flex-direction: column; gap: 10px;
          background: var(--background);
        }
        .cv-msgs::-webkit-scrollbar { width: 3px; }
        .cv-msgs::-webkit-scrollbar-track { background: transparent; }
        .cv-msgs::-webkit-scrollbar-thumb { background: var(--surface-secondary); border-radius: 2px; }

        /* Message rows */
        .cv-msg-row { display: flex; flex-direction: column; max-width: 74%; gap: 3px; }
        .cv-msg-row.cv-row-client { align-self: flex-start; }
        .cv-msg-row.cv-row-atendente { align-self: flex-end; align-items: flex-end; }
        .cv-msg-row.cv-row-bot { align-self: flex-end; align-items: flex-end; }

        /* Bubbles */
        .cv-bubble {
          padding: 10px 16px; border-radius: 22px;
          font-size: 13px; font-weight: 600; line-height: 1.55;
          word-break: break-word;
        }
        .cv-bubble-client {
          background: var(--surface-secondary); color: var(--foreground);
          border-bottom-left-radius: 6px;
        }
        .cv-bubble-atendente {
          background: linear-gradient(135deg, var(--primary) 0%, var(--primary) 100%);
          color: var(--foreground);
          border-bottom-right-radius: 6px;
          box-shadow: 0 3px 10px color-mix(in srgb, var(--primary) 28%, transparent);
        }
        .cv-bubble-bot {
          background: var(--info-soft); color: var(--info);
          border-bottom-right-radius: 6px;
        }

        /* Sender label + time */
        .cv-msg-sender { font-size: 10.5px; font-weight: 700; color: var(--border-strong); padding: 0 4px; }
        .cv-msg-time { font-size: 10.5px; font-weight: 700; color: var(--surface-elevated); padding: 0 4px; }
        .cv-msgs-empty {
          flex: 1; display: flex; align-items: center; justify-content: center;
          color: var(--border-strong); font-size: 13px; font-weight: 700;
        }

        /* ── Input area ── */
        .cv-input-wrap {
          display: flex; align-items: flex-end; gap: 10px;
          padding: 14px 18px calc(14px + env(safe-area-inset-bottom));
          background: var(--surface);
          flex-shrink: 0;
          box-shadow: 0 -3px 16px rgba(0,0,0,.3);
        }
        @media (min-width: 768px) {
          .cv-input-wrap { padding: 14px 18px; }
        }

        /* Textarea */
        .cv-textarea {
          flex: 1; min-height: 44px; max-height: 110px;
          background: var(--surface-secondary);
          border: none;
          border-radius: 24px;
          padding: 11px 18px;
          color: var(--brand-text); font-size: 13.5px; font-weight: 600;
          font-family: 'Archivo', sans-serif; resize: none;
          line-height: 1.45;
          box-shadow: 0 1px 4px rgba(0,0,0,.35) inset;
          transition: box-shadow .15s;
        }
        .cv-textarea::placeholder { color: var(--border-strong); }
        .cv-textarea:focus {
          outline: none;
          box-shadow: 0 0 0 2.5px color-mix(in srgb, var(--primary) 25%, transparent), 0 1px 4px rgba(0,0,0,.35) inset;
        }

        /* Send button */
        .cv-send-btn {
          width: 46px; height: 46px; border-radius: 50%; flex-shrink: 0;
          background: linear-gradient(135deg, var(--primary) 0%, var(--danger) 100%);
          color: var(--foreground);
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 4px 14px color-mix(in srgb, var(--primary) 40%, transparent);
          transition: opacity .15s, transform .1s, box-shadow .15s;
        }
        .cv-send-btn:hover:not(:disabled) {
          opacity: .95;
          transform: translateY(-1px);
          box-shadow: 0 6px 18px color-mix(in srgb, var(--primary) 50%, transparent);
        }
        .cv-send-btn:active:not(:disabled) { transform: scale(.92); box-shadow: 0 2px 8px color-mix(in srgb, var(--primary) 30%, transparent); }
        .cv-send-btn:disabled { background: var(--surface-secondary); color: var(--border-strong); box-shadow: none; }

        /* ── Status badges ── */
        .cv-badge-fila {
          font-size: 10px; font-weight: 900; padding: 3px 8px; border-radius: 20px;
          background: color-mix(in srgb, var(--danger) 12%, transparent); color: var(--danger);
          border: 1px solid color-mix(in srgb, var(--danger) 25%, transparent);
          white-space: nowrap;
        }
        .cv-badge-atend {
          font-size: 10px; font-weight: 900; padding: 3px 8px; border-radius: 20px;
          background: color-mix(in srgb, var(--success) 10%, transparent); color: var(--success);
          border: 1px solid color-mix(in srgb, var(--success) 25%, transparent);
          white-space: nowrap;
        }
        .cv-badge-pix {
          font-size: 10px; font-weight: 900; padding: 3px 7px; border-radius: 20px;
          background: var(--attention-surface); color: var(--attention-text);
          white-space: nowrap;
        }
        .cv-dot {
          width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
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
                  <div style={{ fontSize: 17, fontWeight: 900, color: "var(--surface)", letterSpacing: "-0.3px" }}>Conversas</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--foreground-secondary)", marginTop: 1 }}>Últimas 30 minutos</div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {aguardandoCount > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 5, background: "color-mix(in srgb, var(--danger) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--danger) 22%, transparent)", borderRadius: 20, padding: "4px 10px" }}>
                      <span className="cv-dot" style={{ background: "var(--danger)" }} />
                      <span style={{ fontSize: 11, fontWeight: 900, color: "var(--danger)" }}>{aguardandoCount}</span>
                    </div>
                  )}
                  {humanoCount > 0 && (
                    <div style={{ background: "color-mix(in srgb, var(--primary) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--primary) 22%, transparent)", borderRadius: 20, padding: "4px 10px" }}>
                      <span style={{ fontSize: 11, fontWeight: 900, color: "var(--brand-text)" }}>{humanoCount}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Search */}
              <div style={{ position: "relative" }}>
                <svg style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <circle cx="11" cy="11" r="7" stroke="var(--foreground-secondary)" strokeWidth="2.2" />
                  <path d="M16.5 16.5l3.5 3.5" stroke="var(--foreground-secondary)" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
                <input
                  className="cv-search"
                  type="text"
                  placeholder="Buscar por nome ou telefone…"
                  value={busca}
                  onChange={e => setBusca(e.target.value)}
                />
                {busca && (
                  <button onClick={() => setBusca("")} style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--foreground-secondary)", fontSize: 17, lineHeight: 1, padding: 4 }}>×</button>
                )}
              </div>

              {/* Compact metrics */}
              {aguardandoCount > 0 && maxEsperaMin > 0 && (
                <div style={{ marginTop: 10, fontSize: 11, fontWeight: 700, color: maxEsperaMin >= 8 ? "var(--danger)" : "var(--foreground-secondary)" }}>
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
                    onClick={() => { if (c.phone) setConversaSelecionada(c.phone) }}
                    style={{ animationDelay: `${idx * 0.03}s` }}
                  >
                    <div className="cv-item-avatar" style={{ background: `color-mix(in srgb, ${cor} 9%, transparent)`, border: `1.5px solid color-mix(in srgb, ${cor} 27%, transparent)`, color: cor }}>
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
                        : <span style={{ fontSize: 10, fontWeight: 900, padding: "3px 8px", borderRadius: 20, background: `color-mix(in srgb, ${cor} 7%, transparent)`, color: cor, border: `1px solid color-mix(in srgb, ${cor} 19%, transparent)`, whiteSpace: "nowrap" }}>{STATUS_LABEL[c.status]}</span>
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
                      <div style={{ fontSize: 13, fontWeight: 800, color: "var(--foreground-secondary)" }}>Nenhum resultado para "{busca}"</div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 30, marginBottom: 10 }}>✅</div>
                      <div style={{ fontSize: 14, fontWeight: 900, color: "var(--success)", marginBottom: 6 }}>Nenhuma conversa recente</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--foreground-secondary)", lineHeight: 1.6 }}>
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
                <div style={{ fontSize: 15, fontWeight: 800, color: "var(--foreground-secondary)" }}>
                  {conversaSelecionada ? "Carregando…" : "Selecione uma conversa"}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground-secondary)", textAlign: "center", maxWidth: 240 }}>
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
                      <div className="cv-chat-header-avatar" style={{ background: `color-mix(in srgb, ${cor} 9%, transparent)`, color: cor, border: `1.5px solid color-mix(in srgb, ${cor} 27%, transparent)` }}>
                        {getInitials(nomeHeader)}
                      </div>
                      <div className="cv-chat-header-info">
                        <div className="cv-chat-header-name">{nomeHeader}</div>
                        <div className="cv-chat-header-sub">{conversaRecenteSelecionada.phone}</div>
                      </div>
                      <div className="cv-chat-header-actions">
                        <span style={{ fontSize: 10, fontWeight: 900, padding: "3px 8px", borderRadius: 20, background: `color-mix(in srgb, ${cor} 7%, transparent)`, color: cor, border: `1px solid color-mix(in srgb, ${cor} 19%, transparent)` }}>
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
                  <div style={{ background: "var(--attention-surface)", borderBottom: "1px solid var(--attention-border)", padding: "8px 18px", fontSize: 12, fontWeight: 800, color: "var(--attention-text)", flexShrink: 0 }}>
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
      {/* Confirmação: finalizar atendimento. O alerta de Pix pendente
          continua aparecendo, agora como aviso dentro do diálogo compacto —
          é a informação que muda a decisão, então nunca é escondida. */}
      <ConfirmDialog
        aberto={!!confirmando}
        titulo={`Finalizar o atendimento de ${confirmando ? (ss(confirmando.cliente).split(" ")[0] || "cliente") : ""}?`}
        descricao="O atendimento sai da tela de conversas. Nenhuma mensagem é enviada ao cliente."
        aviso={confirmando && temPixPendente(confirmando) ? (
          <div style={{ background: "color-mix(in srgb, var(--primary) 7%, transparent)", border: "1px solid color-mix(in srgb, var(--primary) 22%, transparent)", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: "var(--brand-text)", marginBottom: 3 }}>⚠ Pix pendente</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--foreground-secondary)", lineHeight: 1.45 }}>
              Esse pedido ainda aguarda confirmação de Pix.
            </div>
          </div>
        ) : undefined}
        confirmarLabel="Finalizar"
        tom="sucesso"
        onConfirmar={() => { if (confirmando) finalizarAtendimento(confirmando) }}
        onCancelar={() => setConfirmando(null)}
      />

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", bottom: "calc(env(safe-area-inset-bottom) + 80px)", left: "50%", transform: "translateX(-50%)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "12px 18px", fontSize: 13, fontWeight: 700, color: "var(--brand-text)", zIndex: 80, whiteSpace: "nowrap", maxWidth: "calc(100% - 32px)", fontFamily: "'Archivo', sans-serif", boxShadow: "0 4px 20px rgba(0,0,0,.4)" }}>
          {toast}
        </div>
      )}
    </>
  )
}
