"use client"
import { useEffect, useState, useRef } from "react"
import { useRouter } from "next/navigation"
import ConfirmDialog from '@/components/ConfirmDialog'
import { useDialogA11y } from '@/components/useDialogA11y'
import PanelShell from "@/components/PanelShell"
import {
  calcularIntervaloPorIdade,
  aplicarJitter,
  PIX_AUTO_CHECK_INTERVAL_SEM_PENDENTE_MS,
} from "@/lib/pixAutoCheckConfig"
import LimpezaOperacionalGate, { limpezaOperacionalAtiva } from "@/components/LimpezaOperacionalPainel"
import NovoPedidoManual from "./NovoPedidoManual"
import { adaptarCardapioParaMontagem, type MenuManual } from "@/lib/montagemManual"
import type { Pendencia, OpcaoResolucao, RegistroLimpeza } from "@/lib/limpezaOperacionalPedidos"

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
  pix?: {
    status?: string
    confirmadoPor?: string
    confirmadoEm?: string
    confirmadoPorNome?: string
    valorEsperado?: number
    evidencia?: { motivos?: string[] }
    provider?: string
    providerPaymentId?: string
    criadoEm?: string
  }
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
  // Edição de pedido pelo cliente antes da aceitação (ver AGENTS.md).
  editStatus?: "none" | "editing" | "edited"
  editExpiresAt?: string
  changesSummary?: string[]
  // Limpeza operacional (ver src/lib/limpezaOperacionalPedidos.ts).
  statusAtualizadoEm?: string
  limpezaOperacional?: RegistroLimpeza
}

function pedidoEmEdicao(p: Pick<Pedido, "editStatus" | "editExpiresAt">): boolean {
  if (p.editStatus !== "editing") return false
  if (!p.editExpiresAt) return false
  return new Date(p.editExpiresAt).getTime() > Date.now()
}
function pedidoFoiEditado(p: Pick<Pedido, "editStatus">): boolean {
  return p.editStatus === "edited"
}

// Cadência adaptativa da auto-verificação de Pix Mercado Pago (Guardião Pix
// — evolução do Nível 6.4). Todos os números vêm de pixAutoCheckConfig.ts —
// nenhum valor mágico aqui. 0-2min: intervalo inicial configurável (10s por
// padrão); 2-5min: 20s; acima de 5min: 30s; sem nenhum Pix MP pendente: 2min.

const NEXT_STATUS: Record<Status, Status | null> = {
  novo: "em_preparo", em_preparo: "saiu_entrega", saiu_entrega: "entregue", entregue: null, cancelado: null,
}
const ACTION_LABEL: Record<Status, string> = {
  novo: "Começar a fazer", em_preparo: "Saiu para entrega", saiu_entrega: "Confirmar entrega", entregue: "", cancelado: "",
}
function isPedidoDineIn(p: Pick<Pedido, "tipoEntrega" | "endereco">): boolean {
  return p.tipoEntrega === "dine_in" || p.endereco === "Consumo no local"
}
function isPedidoRetirada(p: Pick<Pedido, "tipoEntrega" | "endereco">): boolean {
  return !isPedidoDineIn(p) && (!p.tipoEntrega || p.tipoEntrega === "pickup" || p.tipoEntrega === "retirada" || p.endereco === "Retirada na loja")
}
// Origem da confirmação do Pix (auditoria). Pedidos antigos sem pix.confirmadoPor
// caem no rótulo genérico de sempre.
function labelPixConfirmado(p: Pick<Pedido, "pix">): string {
  const por = p.pix?.confirmadoPor
  if (por === "comprovante") return "✓ validado por comprovante"
  if (por === "webhook") return "✓ confirmado pelo banco"
  if (por === "manual") return "✓ confirmado manualmente"
  return "✓ confirmado"
}
// Etapa 2E: comprovante avaliado por avaliarEvidenciaPix sem evidencia forte o
// suficiente para aprovacao automatica. Nao aparece pixConfirmado — fica pendente
// de conferencia manual pela Kellyne.
function labelPixRevisaoOuSuspeito(p: Pick<Pedido, "pix">): string | null {
  if (p.pix?.status === "em_revisao") return "🔍 Pix em revisão"
  if (p.pix?.status === "suspeito") return "⚠️ Pix suspeito"
  return null
}
function motivoResumidoPix(p: Pick<Pedido, "pix">): string | undefined {
  return p.pix?.evidencia?.motivos?.[0]
}
// Reaproveita dados já existentes (status em_revisao/suspeito/comprovante_recebido
// ou qualquer evidência já registrada pelo bot) para sinalizar "comprovante
// recebido, mas ainda não validado" — não é um estado novo, só uma leitura
// diferente do mesmo pix.status/pix.evidencia que já existe hoje.
function pixTemComprovanteNaoValidado(p: Pick<Pedido, "pix" | "pixConfirmado">): boolean {
  if (p.pixConfirmado) return false
  const status = p.pix?.status
  if (status === "em_revisao" || status === "suspeito" || status === "comprovante_recebido") return true
  const ev = p.pix?.evidencia
  return !!(ev && ev.motivos?.length)
}
function formatarValorReais(v?: number): string {
  return typeof v === "number" && Number.isFinite(v) ? `R$ ${v.toFixed(2).replace(".", ",")}` : "—"
}
function formatarDataHoraBR(iso?: string): string {
  if (!iso) return "—"
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return "—"
    const data = d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })
    const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })
    return `${data} às ${hora}`
  } catch { return "—" }
}
// Mesmo critério de elegibilidade usado no backend (elegivelParaReconciliacao
// em mercadoPagoReconciliacao.ts) — só para decidir a cadência da
// auto-verificação (Nível 6.4), nunca para confirmar nada aqui no frontend.
function temPixMercadoPagoPendente(lista: Pick<Pedido, "pix" | "pixConfirmado">[]): boolean {
  return lista.some(p =>
    p.pix?.provider === "mercadopago" &&
    !!p.pix?.providerPaymentId &&
    p.pix?.status !== "confirmado" &&
    p.pixConfirmado !== true
  )
}
function pixMercadoPagoPendentes(lista: Pick<Pedido, "pix" | "pixConfirmado">[]): Pick<Pedido, "pix" | "pixConfirmado">[] {
  return lista.filter(p =>
    p.pix?.provider === "mercadopago" &&
    !!p.pix?.providerPaymentId &&
    p.pix?.status !== "confirmado" &&
    p.pixConfirmado !== true
  )
}
// Próximo intervalo da auto-verificação (Guardião Pix): entre todos os Pix
// Mercado Pago ainda pendentes, usa o intervalo do MAIS URGENTE (o mais
// jovem), calculado por calcularIntervaloPorIdade (mesma cadência de
// pixAutoCheckConfig.ts usada pelo backend). Pedidos legados sem
// pix.criadoEm (criados antes desta mudança) usam a camada intermediária
// (20s) — nem tão agressivo quanto assumir "recém-criado", nem tão lento
// quanto o piso de 30s, já que não há como saber a idade real.
function calcularProximoIntervaloAutoVerificacaoPix(lista: Pick<Pedido, "pix" | "pixConfirmado">[], agora: number): number {
  const pendentes = pixMercadoPagoPendentes(lista)
  if (pendentes.length === 0) return PIX_AUTO_CHECK_INTERVAL_SEM_PENDENTE_MS

  const intervalos = pendentes.map(p => {
    const criadoEm = p.pix?.criadoEm
    if (!criadoEm) return 20_000
    const criado = new Date(criadoEm).getTime()
    if (!Number.isFinite(criado)) return 20_000
    return calcularIntervaloPorIdade(Math.max(0, agora - criado))
  })
  return aplicarJitter(Math.min(...intervalos))
}
function getActionLabel(p: Pedido): string {
  if (p.status === "em_preparo") {
    if (isPedidoDineIn(p)) return "Pronto"
    if (isPedidoRetirada(p)) return "Pronto para retirada"
  }
  return ACTION_LABEL[p.status]
}
const STATUS_OPTS: { value: Status; label: string }[] = [
  { value: "novo", label: "Novo" },
  { value: "em_preparo", label: "Fazendo" },
  { value: "saiu_entrega", label: "Na rua" },
  { value: "entregue", label: "Entregue" },
  { value: "cancelado", label: "Cancelado" },
]

const STATUS_COLOR: Record<Status, { accent: string; accentSoft: string; accentBg: string; accentBorder: string; cardBg: string; cardBorder: string; glow: string; btnBg: string; btnFg: string; label: string }> = {
  novo:         { accent: "var(--primary)", accentSoft: "var(--primary)", accentBg: "color-mix(in srgb, var(--primary) 15%, transparent)", accentBorder: "color-mix(in srgb, var(--primary) 50%, transparent)",  cardBg: "linear-gradient(180deg,color-mix(in srgb, var(--primary) 12%, transparent),color-mix(in srgb, var(--primary) 2%, transparent) 30%,var(--background) 65%)", cardBorder: "1.5px solid color-mix(in srgb, var(--primary) 55%, transparent)",  glow: "cbGlowO", btnBg: "linear-gradient(180deg,var(--primary),var(--primary))", btnFg: "var(--foreground)",    label: "Novo" },
  em_preparo:   { accent: "var(--primary)", accentSoft: "var(--primary)", accentBg: "color-mix(in srgb, var(--primary) 12%, transparent)", accentBorder: "color-mix(in srgb, var(--primary) 45%, transparent)", cardBg: "linear-gradient(180deg,color-mix(in srgb, var(--primary) 10%, transparent),color-mix(in srgb, var(--primary) 2%, transparent) 30%,var(--background) 65%)",  cardBorder: "1.5px solid color-mix(in srgb, var(--primary) 40%, transparent)",  glow: "cbGlowY", btnBg: "var(--primary)",                              btnFg: "var(--background)", label: "Fazendo" },
  saiu_entrega: { accent: "var(--info)", accentSoft: "var(--info)", accentBg: "color-mix(in srgb, var(--info) 12%, transparent)",  accentBorder: "color-mix(in srgb, var(--info) 45%, transparent)",  cardBg: "linear-gradient(180deg,color-mix(in srgb, var(--info) 10%, transparent),color-mix(in srgb, var(--info) 2%, transparent) 30%,var(--info-soft) 65%)",  cardBorder: "1.5px solid color-mix(in srgb, var(--info) 40%, transparent)",  glow: "cbGlowB", btnBg: "var(--info)",                              btnFg: "var(--background)", label: "Na rua" },
  entregue:     { accent: "var(--success)", accentSoft: "var(--success)", accentBg: "color-mix(in srgb, var(--success) 12%, transparent)",   accentBorder: "color-mix(in srgb, var(--success) 40%, transparent)",    cardBg: "linear-gradient(180deg,color-mix(in srgb, var(--success) 10%, transparent),color-mix(in srgb, var(--success) 2%, transparent) 30%,var(--success-soft) 65%)",    cardBorder: "1.5px solid color-mix(in srgb, var(--success) 35%, transparent)",  glow: "cbGlowG", btnBg: "var(--success)",                              btnFg: "var(--background)", label: "Entregue" },
  cancelado:    { accent: "var(--danger)", accentSoft: "var(--danger)", accentBg: "color-mix(in srgb, var(--danger) 12%, transparent)",   accentBorder: "color-mix(in srgb, var(--danger) 45%, transparent)",   cardBg: "linear-gradient(180deg,color-mix(in srgb, var(--danger) 10%, transparent),color-mix(in srgb, var(--danger) 2%, transparent) 30%,var(--danger-soft) 65%)",   cardBorder: "1.5px solid color-mix(in srgb, var(--danger) 40%, transparent)",   glow: "cbGlowR", btnBg: "var(--danger)",                              btnFg: "var(--foreground)",    label: "Cancelado" },
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
  const color = progress < 0.5 ? "var(--success)" : progress < 0.85 ? "var(--primary)" : "var(--danger)"
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
  // Visto-até por telefone: guarda o timestamp da última mensagem que a Kellyne
  // já viu. "Visto" é por timestamp, não só por telefone — assim uma NOVA mensagem
  // no mesmo telefone (ts maior) volta a destacar mesmo após a conversa ter sido aberta.
  const [seenConversas, setSeenConversas] = useState<Record<string, number>>({})
  // Fonte única de verdade: usada tanto no sort (subir ao topo) quanto no
  // render do badge verde. Garante que "sobe" e "mostra bolinha" nunca divirjam.
  const getPhoneKey = (s: any) => s.phone || s.telefone || ""
  const getSessaoTs = (s: any) => {
    const raw =
      s.ultimaTs ?? s.lastMessageAt ?? s.updatedAt ?? s.timestamp ?? s.createdAt ?? 0
    if (typeof raw === "number") return raw
    const parsed = Date.parse(raw)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  const temNovaMsgNaoVista = (s: any) => {
    const ultimaTs = getSessaoTs(s)
    const vistoAte = seenConversas[getPhoneKey(s)] ?? 0
    return Boolean(s.novaMsgManual && ultimaTs > vistoAte)
  }
  // Marca a conversa como vista até o ts atual da sessão (e persiste em localStorage).
  // Idempotente: se nada novo a marcar, devolve o estado anterior (sem re-render/loop).
  const marcarConversaComoVista = (s: any) => {
    const phone = getPhoneKey(s)
    if (!phone) return
    const ts = getSessaoTs(s)
    setSeenConversas(prev => {
      const atual = prev[phone] ?? 0
      if (ts <= atual) return prev
      const next = { ...prev, [phone]: ts }
      try { localStorage.setItem("tempoRealSeenConversas", JSON.stringify(next)) } catch {}
      return next
    })
  }
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
  const atualizandoRef = useRef<string | null>(null)
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
  const [reconciliandoPix, setReconciliandoPix] = useState(false)
  const reconciliandoPixRef = useRef(false)
  const [ultimaVerificacaoPix, setUltimaVerificacaoPix] = useState("")
  const [modalEntrega, setModalEntrega] = useState<{pedidoId: string; proxStatus: Status} | null>(null)
  const [muteado, setMuteado] = useState(false)
  const [busca, setBusca] = useState("")
  // Montagem manual de pedido. O cardápio é buscado sob demanda, só quando
  // o atendente abre o fluxo — o painel não paga polling de cardápio o dia
  // inteiro por causa de uma tela que quase sempre está fechada.
  const [novoPedidoAberto, setNovoPedidoAberto] = useState(false)
  const [menuManual, setMenuManual] = useState<MenuManual | null>(null)
  const [carregandoMenu, setCarregandoMenu] = useState(false)
  const [erroMenu, setErroMenu] = useState<string | null>(null)
  const [modalLimpar, setModalLimpar] = useState(false)
  const [limpando, setLimpando] = useState(false)
  const [pedidosArquivados, setPedidosArquivados] = useState<Pedido[]>([])
  const [carregandoArquivados, setCarregandoArquivados] = useState(false)
  const [modalArquivarExpediente, setModalArquivarExpediente] = useState(false)
  const [arquivandoExpediente, setArquivandoExpediente] = useState(false)
  const [modalAlterarStatus, setModalAlterarStatus] = useState<string | null>(null)
  const [cancelandoId, setCancelandoId] = useState<string | null>(null)
  const [confirmPixModal, setConfirmPixModal] = useState<string | null>(null)
  const [pixChecklist, setPixChecklist] = useState({ conferiu: false, valorBate: false, clienteCorreto: false })
  const [pixSenha, setPixSenha] = useState("")
  const [pixSenhaVisivel, setPixSenhaVisivel] = useState(false)
  const [pixConfirmando, setPixConfirmando] = useState(false)
  const [pixErro, setPixErro] = useState<string | null>(null)
  const [modalEditarPagamento, setModalEditarPagamento] = useState<string | null>(null)
  // ESC/armadilha de foco no formulário de troca de pagamento (não tinha
  // nenhum dos dois; o Tab passeava pelo painel atrás do backdrop).
  const editarPagamentoRef = useDialogA11y(!!modalEditarPagamento, () => setModalEditarPagamento(null))
  const [formEditarPagamento, setFormEditarPagamento] = useState<{ pagamento: string; troco: string }>({ pagamento: "", troco: "" })
  const [salvandoEdicaoPagamento, setSalvandoEdicaoPagamento] = useState(false)
  const [erroEdicaoPagamento, setErroEdicaoPagamento] = useState<string | null>(null)
  const pixModalRef = useRef<HTMLDivElement | null>(null)
  const pixSenhaInputRef = useRef<HTMLInputElement | null>(null)
  const pixConfirmandoRef = useRef(false)
  useEffect(() => { pixConfirmandoRef.current = pixConfirmando }, [pixConfirmando])

  // Acessibilidade do modal de segurança: foco inicial no diálogo, Tab preso
  // dentro dele, Escape fecha sem confirmar (exceto durante o envio).
  useEffect(() => {
    if (!confirmPixModal) return
    pixModalRef.current?.focus()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        if (pixConfirmandoRef.current) return
        setConfirmPixModal(null)
        setPixChecklist({ conferiu: false, valorBate: false, clienteCorreto: false })
        setPixSenha("")
        setPixSenhaVisivel(false)
        setPixErro(null)
        return
      }
      if (e.key !== "Tab") return
      const container = pixModalRef.current
      if (!container) return
      const focusables = container.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])')
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [confirmPixModal])
  const [finalizarModal, setFinalizarModal] = useState<string | null>(null)
  const [simpleToast, setSimpleToast] = useState("")
  const [arquivandoConversa, setArquivandoConversa] = useState<string | null>(null)
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
  const pedidosRef = useRef<Pedido[]>([])
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
  const chatMsgAreaRef = useRef<HTMLDivElement>(null)
  const isNearBottomRef = useRef(true)
  const prevMsgCountRef = useRef(0)
  const shouldScrollOnOpenRef = useRef(false)
  const [novasMsgCount, setNovasMsgCount] = useState(0)

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
      fetch(`/api/sessoes-ativas?t=${Date.now()}`, { cache: "no-store" })
        .then(r => r.ok ? r.json() : [])
        .then(d => {
          if (Array.isArray(d)) {
            setSessoes(d)
          } else {
            setSessoes([])
          }
        })
        .catch(() => {})
    }
    carregarSessoes()
    const iv = setInterval(carregarSessoes, 3000)
    return () => clearInterval(iv)
  }, [filtro])

  // Hidrata o "visto-até" do localStorage no mount, para que após F5 uma
  // mensagem já aberta não reapareça como nova.
  useEffect(() => {
    try {
      const raw = localStorage.getItem("tempoRealSeenConversas")
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === "object") setSeenConversas(parsed)
      }
    } catch {}
  }, [])

  // Se a conversa aberta recebe nova mensagem, marca como vista automaticamente
  // (Kellyne está olhando aquela conversa). Roda com valores frescos de sessoes/
  // sessaoAtiva; marcarConversaComoVista é idempotente, então não gera loop.
  useEffect(() => {
    if (!sessaoAtiva) return
    const ativa = sessoes.find(s => getPhoneKey(s) === sessaoAtiva)
    if (ativa) marcarConversaComoVista(ativa)
  }, [sessoes, sessaoAtiva])

  useEffect(() => {
    if (filtro !== "tempo_real") {
      setSessaoAtiva(null)
      setHistoricoMsgs([])
    }
  }, [filtro])

  // Reseta o estado de scroll toda vez que a conversa aberta muda,
  // independente do caminho que ativou a mudança (onClick, "Assumir agora", etc.)
  useEffect(() => {
    if (!sessaoAtiva) return
    shouldScrollOnOpenRef.current = true
    isNearBottomRef.current = true
    prevMsgCountRef.current = 0
    setNovasMsgCount(0)
  }, [sessaoAtiva])

  useEffect(() => {
    if (!sessaoAtiva || filtro !== "tempo_real") return
    carregarHistoricoConversa(sessaoAtiva)
    const iv = setInterval(() => carregarHistoricoConversa(sessaoAtiva), 3000)
    return () => clearInterval(iv)
  }, [sessaoAtiva, filtro])

  useEffect(() => {
    const currentCount = historicoMsgs.length

    if (currentCount === 0) {
      return
    }

    // Scroll de abertura: só dispara quando sessaoAtiva mudou explicitamente.
    // Nunca acionado por polling com array vazio ou qualquer outra fonte.
    if (shouldScrollOnOpenRef.current) {
      shouldScrollOnOpenRef.current = false
      prevMsgCountRef.current = currentCount
      setNovasMsgCount(0)
      requestAnimationFrame(() => {
        historicoBottomRef.current?.scrollIntoView({ behavior: "auto" })
      })
      return
    }

    const prevCount = prevMsgCountRef.current
    const delta = currentCount - prevCount
    prevMsgCountRef.current = currentCount

    // Polling sem mensagem nova ou histórico encolheu: não mexe no scroll
    if (delta <= 0) {
      return
    }

    if (isNearBottomRef.current) {
      historicoBottomRef.current?.scrollIntoView({ behavior: "smooth" })
      setNovasMsgCount(0)
    } else {
      setNovasMsgCount(c => c + delta)
    }
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

  // Conciliador de Pix Mercado Pago (Nivel 6.2A/6.3B) — chama a rota admin
  // já validada em produção (POST /api/admin/mercadopago/reconciliar-pix).
  // Nunca confirma nada no frontend: a decisão inteira (approved + valor +
  // txid batendo) continua no backend, em mercadoPagoReconciliacao.ts —
  // aqui só disparamos a chamada e reagimos ao resultado. `manual` controla
  // só a apresentação: clique no botão mostra o resumo em alert (mesmo
  // comportamento já validado); a verificação automática do painel aberto
  // nunca interrompe com alert, só atualiza a lista quando confirmou algo.
  // `reconciliandoPixRef` (não só o state) evita duas chamadas concorrentes
  // — manual e automática compartilham o mesmo guard.
  const executarReconciliacaoPix = async (manual: boolean) => {
    if (reconciliandoPixRef.current) return
    reconciliandoPixRef.current = true
    setReconciliandoPix(true)
    try {
      const r = await fetch("/api/admin/mercadopago/reconciliar-pix", { method: "POST" })
      const data = await r.json().catch(() => null)
      if (r.ok && data) {
        const resumo = `${data.verificados} verificados, ${data.confirmados} confirmados, ${data.pendentes} pendentes, ${data.ignorados} ignorados, ${data.erros} erros.`
        setUltimaVerificacaoPix(resumo)
        if (manual) alert(`Pix Mercado Pago verificado:\n${resumo}`)
        if (typeof data.confirmados === "number" && data.confirmados > 0) carregarPedidos()
      } else if (manual) {
        alert("Não foi possível verificar os pagamentos Pix Mercado Pago.")
      }
    } catch {
      if (manual) alert("Erro de conexão ao verificar pagamentos Pix Mercado Pago.")
    }
    reconciliandoPixRef.current = false
    setReconciliandoPix(false)
  }

  const reconciliarPixMercadoPago = () => executarReconciliacaoPix(true)

  // Guardião Pix — desde a cadeia server-side via QStash (pixGuardiaoScheduler.ts,
  // iniciada assim que o Pix Mercado Pago é criado), esta chamada do painel é
  // REDUNDÂNCIA, não o caminho principal: a verificação 10s/20s/30s continua
  // avançando sozinha mesmo com o painel fechado. Mantida aqui só como camada
  // extra (nunca um timer separado por pagamento). Best-effort: nunca mostra
  // alert, nunca bloqueia a UI; só atualiza o texto de "última verificação"
  // quando recuperou algo, reaproveitando o mesmo espaço já existente no painel.
  const executarGuardiaoPixPainel = async () => {
    try {
      const r = await fetch("/api/admin/mercadopago/guardiao-pix", { method: "POST" })
      const data = await r.json().catch(() => null)
      if (r.ok && data?.recuperacoesBemSucedidas > 0) {
        setUltimaVerificacaoPix(prev => `${prev} · Guardião recuperou ${data.recuperacoesBemSucedidas} pagamento(s).`)
        carregarPedidos()
      }
    } catch {
      // Best-effort: falha do Guardião nunca deve afetar a auto-verificação normal.
    }
  }

  // pedidosRef espelha o state `pedidos` para a auto-verificação (efeito
  // abaixo) ler a lista sempre atual sem precisar reagendar o loop a cada
  // atualização (o polling normal de /api/orders roda a cada 3s).
  useEffect(() => { pedidosRef.current = pedidos }, [pedidos])

  // Auto-verificação (Guardião Pix — evolução do Nível 6.3B/6.4): sem
  // webhook configurado no painel MP e sem cron frequente (Vercel Hobby não
  // comporta), o próprio painel aberto assume o papel de gatilho. Só para
  // admin/dev, só depois do painel carregar, pausa quando a aba está oculta
  // (document.hidden) e nunca sobrepõe uma verificação já em andamento
  // (guard compartilhado com o botão manual acima). O webhook continua
  // sendo o caminho prioritário — este polling é fallback/conciliação.
  //
  // Cadência adaptativa (pixAutoCheckConfig.ts): 0-2min desde a criação do
  // Pix → intervalo inicial configurável (10s por padrão, rollback via
  // PIX_AUTO_CHECK_INITIAL_INTERVAL_MS=20000); 2-5min → 20s; acima de 5min →
  // 30s; sem nenhum Pix MP pendente → 2 minutos. Um único timer para TODOS
  // os pagamentos pendentes (nunca um timer por pagamento): usa o intervalo
  // do mais urgente entre eles. Guardião Pix roda no mesmo ciclo (nunca um
  // timer concorrente separado) para detectar e recuperar travamentos.
  // Reavaliado a cada ciclo via setTimeout auto-reagendado (não setInterval
  // fixo), sempre olhando pedidosRef.current no momento do agendamento —
  // nunca precisa recriar o loop quando a lista muda.
  useEffect(() => {
    if (!isAdmin || loading) return
    let cancelado = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const agendarProxima = () => {
      if (cancelado) return
      const intervalo = calcularProximoIntervaloAutoVerificacaoPix(pedidosRef.current, Date.now())
      timeoutId = setTimeout(rodar, intervalo)
    }
    const rodar = async () => {
      if (!document.hidden) {
        await executarReconciliacaoPix(false)
        if (temPixMercadoPagoPendente(pedidosRef.current)) await executarGuardiaoPixPainel()
      }
      agendarProxima()
    }

    rodar()
    return () => { cancelado = true; if (timeoutId) clearTimeout(timeoutId) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, loading])

  const assumirConversa = async (phone: string) => {
    try { await fetch("/api/assumir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ telefone: phone }) }); setManuais(prev => ({ ...prev, [phone]: true })) } catch {}
  }

  const assumirSessao = async (phone: string) => {
    setAssumindoSessao(phone)
    try {
      const r = await fetch("/api/assumir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ telefone: phone }) })
      if (r.ok) {
        setSessoes(prev => prev.map(s => s.phone === phone ? { ...s, manual: true, postOrderPriority: false } : s))
      }
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

  const arquivarConversa = async (phone: string, step: string) => {
    const ehPix = step === 'aguardando_pix'
    if (ehPix && !confirm('Esta conversa está aguardando comprovante de Pix.\nDeseja mesmo arquivá-la?')) return
    setArquivandoConversa(phone)
    try {
      const r = await fetch('/api/arquivar-conversa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefone: phone, force: ehPix }),
      })
      if (r.ok) {
        setSessoes(prev => prev.filter(s => s.phone !== phone))
        if (sessaoAtiva === phone) setSessaoAtiva(null)
      }
    } catch {}
    setArquivandoConversa(null)
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
        isNearBottomRef.current = true
        setNovasMsgCount(0)
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

  // `limpeza` acompanha a transição quando ela vem da resolução de uma
  // pendência operacional: o motivo é gravado no mesmo PATCH que muda o
  // status, sem uma segunda escrita concorrente sobre o array de pedidos.
  const avancarStatus = async (
    id: string,
    novoStatus: Status,
    entregador?: {id: string; nome: string; telefone: string},
    limpeza?: { motivo: Pendencia["motivo"]; acao: OpcaoResolucao["acao"] },
  ) => {
    if (atualizandoRef.current === id) return false
    const pedido = pedidos.find(p => p.id === id)
    if (!pedido) return false
    const prevStatus = pedido.status
    const F2S: Record<string, Status> = { novo: "novo", em_preparo: "em_preparo", saiu_entrega: "saiu_entrega", entregue: "entregue" }
    const willLeave = filtro !== "todos" && F2S[filtro] === prevStatus
    atualizandoRef.current = id
    setAtualizando(id)
    // Atualização otimista: o painel reflete o novo status na hora do clique;
    // se a API falhar, o status é revertido e a equipe vê o aviso de erro.
    setPedidos(prev => prev.map(p => p.id === id ? { ...p, status: novoStatus } : p))
    if (willLeave) { setLeavingId(id); if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current); leaveTimerRef.current = setTimeout(() => setLeavingId(null), 350) }
    else { setFlashId(id); if (flashTimerRef.current) clearTimeout(flashTimerRef.current); flashTimerRef.current = setTimeout(() => setFlashId(null), 750) }
    try {
      const r = await fetch("/api/orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status: novoStatus, entregador, ...(limpeza ? { limpeza } : {}) }) })
      if (!r.ok) throw new Error("Falha ao atualizar status")
      const data = await r.json().catch(() => null)
      const firstName = pedido.cliente.split(" ")[0]
      if (novoStatus === "entregue") { tocarSomEntrega(); temposEntregaRef.current[id] = tempoDesde(pedido.horario, undefined, Date.now()) }
      setToast({
        text: data?.avisoOperacional ? `⚠️ ${data.avisoOperacional}` : `${firstName} → ${STATUS_COLOR[novoStatus].label}`,
        expires: Date.now() + 5000,
        pedidoId: id,
        prevStatus,
      })
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
      toastTimerRef.current = setTimeout(() => setToast(null), 5000)
      // Quem dispara a impressão silenciosa é o SERVIDOR (claim atômico e
      // persistente, ver src/lib/impressaoAutomatica.ts) — nunca mais a
      // crença local de "eu vi o status novo". Isso é o que protege contra
      // imprimir duas vezes o mesmo aceite quando duas abas/dispositivos
      // tentam aceitar o mesmo pedido ao mesmo tempo.
      if (data?.podeImprimirAutomaticamente) {
        imprimirPedidoSilencioso(id)
      }
      return true
    } catch {
      setPedidos(prev => prev.map(p => p.id === id ? { ...p, status: prevStatus } : p))
      const firstName = pedido.cliente.split(" ")[0]
      setToast({ text: `⚠️ Não consegui atualizar ${firstName}. Tente de novo.`, expires: Date.now() + 5000, pedidoId: id, prevStatus })
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
      toastTimerRef.current = setTimeout(() => setToast(null), 5000)
      return false
    } finally {
      atualizandoRef.current = null
      setModalEntrega(null); setAtualizando(null); setModalAlterarStatus(null)
    }
  }

  // Resolução de uma pendência do gate de limpeza operacional. A ação de
  // "verificar pagamento" NÃO grava registro de propósito: ela só consulta o
  // Mercado Pago. Se o Pix tiver entrado, o pedido sai do motivo de pagamento
  // sozinho na próxima classificação — e o que sobrar (falta de aceite) é uma
  // pendência legítima, diferente. É assim que se evita cancelar um pedido
  // que já foi pago.
  const resolverPendenciaOperacional = async (pendencia: Pendencia, opcao: OpcaoResolucao) => {
    if (opcao.acao === "verificou_pagamento") {
      await executarReconciliacaoPix(false)
      carregarPedidos()
      return
    }
    if (!opcao.status) return
    const ok = await avancarStatus(pendencia.pedidoId, opcao.status as Status, undefined, {
      motivo: pendencia.motivo,
      acao: opcao.acao,
    })
    if (!ok) throw new Error("falha ao resolver pendência")
  }

  async function abrirNovoPedido() {
    setErroMenu(null)
    // Cardápio já em mãos: abre direto, sem nova requisição.
    if (menuManual) { setNovoPedidoAberto(true); return }
    setCarregandoMenu(true)
    try {
      const r = await fetch("/api/cardapio", { cache: "no-store" })
      if (!r.ok) throw new Error("cardapio indisponivel")
      const data = await r.json()
      // Adaptador validado em vez de cast: uma resposta corrompida é recusada
      // AQUI, com a tela ainda fechada, em vez de quebrar no meio do
      // atendimento (ver adaptarCardapioParaMontagem).
      const validado = adaptarCardapioParaMontagem(data)
      if (!validado) throw new Error("cardapio malformado")
      setMenuManual(validado)
      setNovoPedidoAberto(true)
    } catch {
      // Degrada com aviso em vez de abrir um fluxo sem catálogo: montar um
      // pedido sem cardápio produziria itens que o servidor recusaria.
      setErroMenu("Não consegui carregar o cardápio agora. Tente de novo.")
    } finally {
      setCarregandoMenu(false)
    }
  }

  const cancelarPedido = async (id: string) => {
    setCancelandoId(id)
    await avancarStatus(id, "cancelado")
    setCancelandoId(null); setDetailId(null)
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
    <div style={{ minHeight: "100vh", background: "var(--background)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center" }}><div style={{ fontSize: 36, marginBottom: 12 }}>🍕</div><p style={{ color: "var(--foreground-secondary)", fontSize: 14, fontFamily: "'Archivo', sans-serif" }}>Carregando...</p></div>
    </div>
  )

  const showSimpleToast = (msg: string) => {
    setSimpleToast(msg); clearTimeout(simpleToastTimerRef.current)
    simpleToastTimerRef.current = setTimeout(() => setSimpleToast(""), 3500)
  }

  const abrirVerificacaoPix = (id: string) => {
    setPixChecklist({ conferiu: false, valorBate: false, clienteCorreto: false })
    setPixSenha("")
    setPixSenhaVisivel(false)
    setPixErro(null)
    setConfirmPixModal(id)
  }
  const fecharVerificacaoPix = () => {
    if (pixConfirmando) return
    setConfirmPixModal(null)
    setPixChecklist({ conferiu: false, valorBate: false, clienteCorreto: false })
    setPixSenha("")
    setPixSenhaVisivel(false)
    setPixErro(null)
  }
  const checklistCompleto = pixChecklist.conferiu && pixChecklist.valorBate && pixChecklist.clienteCorreto
  const podeConfirmarPix = checklistCompleto && pixSenha.length > 0 && !pixConfirmando

  const confirmarPixManual = async (id: string) => {
    if (!podeConfirmarPix) return
    setPixConfirmando(true)
    setPixErro(null)
    try {
      const r = await fetch("/api/orders/confirmar-pix-manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, senha: pixSenha }),
      })
      const data = await r.json().catch(() => ({}))
      if (r.ok) {
        setPedidos(prev => prev.map(p => p.id === id ? {
          ...p,
          pixConfirmado: true,
          pix: { ...p.pix, status: "confirmado", confirmadoPor: data.confirmadoPor || "manual", confirmadoEm: data.confirmadoEm, confirmadoPorNome: data.confirmadoPorNome },
        } : p))
        showSimpleToast(data.avisoOperacional
          ? `⚠️ ${data.avisoOperacional}`
          : `PAGAMENTO CONFIRMADO COM SEGURANÇA — ${formatarValorReais(data.valorConfirmado)} foi registrado como recebido.`)
        setPixConfirmando(false)
        fecharVerificacaoPix()
        return
      }
      if (r.status === 409) {
        // Corrida com a confirmação automática (webhook/conciliador): ela venceu,
        // então só refletimos o estado real e fechamos — nunca duplicamos.
        setPedidos(prev => prev.map(p => p.id === id && data.pedido ? { ...p, ...data.pedido } : p))
        setPixErro(data.error || "Este pagamento já foi confirmado.")
        setPixConfirmando(false)
        setTimeout(fecharVerificacaoPix, 1800)
        return
      }
      if (r.status === 401) {
        setPixErro(data.error || "Senha incorreta. O pagamento não foi confirmado.")
        setPixConfirmando(false)
        return
      }
      setPixErro(data.error || "Não foi possível confirmar agora. Verifique a conexão e tente novamente.")
      setPixConfirmando(false)
    } catch {
      setPixErro("Não foi possível confirmar agora. Verifique a conexão e tente novamente.")
      setPixConfirmando(false)
    }
  }

  const inputStyle: React.CSSProperties = { width: "100%", height: 46, background: "var(--surface)", border: "1px solid var(--surface-secondary)", borderRadius: 12, padding: "0 14px", color: "var(--foreground)", fontSize: 14, fontFamily: "'Archivo', sans-serif", outline: "none", boxSizing: "border-box" }
  const labelStyle: React.CSSProperties = { display: "block", fontSize: 11, fontWeight: 900, color: "var(--foreground-muted)", textTransform: "uppercase", letterSpacing: ".8px", marginBottom: 6 }
  const pagamentoJaConfirmadoClient = (p: Pick<Pedido, "pixConfirmado" | "pix">): boolean =>
    p.pixConfirmado === true || p.pix?.status === "confirmado"

  const abrirEditarPagamento = (p: Pedido) => {
    setModalEditarPagamento(p.id)
    setFormEditarPagamento({ pagamento: p.pagamento || "", troco: p.troco || "" })
    setErroEdicaoPagamento(null)
  }
  const fecharEditarPagamento = () => {
    if (salvandoEdicaoPagamento) return
    setModalEditarPagamento(null)
    setErroEdicaoPagamento(null)
  }
  const salvarEdicaoPagamento = async () => {
    if (!modalEditarPagamento || salvandoEdicaoPagamento) return
    setSalvandoEdicaoPagamento(true)
    setErroEdicaoPagamento(null)
    try {
      const r = await fetch(`/api/pedido-app/${modalEditarPagamento}/editar-pagamento-admin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formEditarPagamento),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok || !data?.ok) {
        setErroEdicaoPagamento(data?.error || "Não foi possível salvar agora. Tente de novo.")
        setSalvandoEdicaoPagamento(false)
        return
      }
      setPedidos(prev => prev.map(p => p.id === modalEditarPagamento ? {
        ...p,
        pagamento: data.pagamento ?? p.pagamento,
        troco: data.troco,
        pix: data.pix ?? (data.pixSubstituido ? undefined : p.pix),
      } : p))
      showSimpleToast("Forma de pagamento atualizada.")
      setSalvandoEdicaoPagamento(false)
      setModalEditarPagamento(null)
    } catch {
      setErroEdicaoPagamento("Não foi possível salvar agora. Verifique a conexão e tente de novo.")
      setSalvandoEdicaoPagamento(false)
    }
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
      <span style={{ fontSize: 11, fontWeight: 800, color: "var(--foreground-muted)", minWidth: 72, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: missing ? "var(--danger)" : "var(--foreground-secondary)" }}>{value || (missing ? "—" : "—")}</span>
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
    const payDot = isPix ? "var(--success)" : pagamento.toLowerCase().includes("cart") ? "var(--info)" : "var(--primary)"
    const isRetirada = !isDineInDetail && (!p.tipoEntrega || p.tipoEntrega === "pickup" || p.tipoEntrega === "retirada" || p.endereco === "Retirada na loja")
    const emEdicaoDetail = pedidoEmEdicao(p)
    const foiEditadoDetail = pedidoFoiEditado(p)
    return (
      <>
        {/* Cabeçalho */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 7 }}>
            <span style={{ alignSelf: "flex-start", background: sc.accentBg, color: sc.accent, fontSize: 11, fontWeight: 900, letterSpacing: "1.2px", padding: "5px 10px", borderRadius: 8, textTransform: "uppercase", border: `1px solid ${sc.accentBorder}` }}>{sc.label}</span>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900, letterSpacing: "-0.6px", lineHeight: 1.1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.numero != null ? `#${p.numero} · ` : ""}{p.cliente}</h2>
            <span style={{ fontSize: 12, color: "var(--foreground-secondary)", fontWeight: 600 }}>Recebido às {p.horario} · há {mins} min</span>
          </div>
          <div style={{ position: "relative", width: 50, height: 50, flexShrink: 0 }}>
            <svg width="50" height="50" viewBox="0 0 50 50" style={{ transform: "rotate(-90deg)", display: "block" }}>
              <circle cx="25" cy="25" r="21" fill="none" stroke="var(--surface-secondary)" strokeWidth="4" />
              <circle cx="25" cy="25" r="21" fill="none" stroke={isDone ? "var(--success)" : ringColor} strokeWidth="4" strokeLinecap="round" strokeDasharray="131.9" strokeDashoffset={isDone ? 0 : dash} style={{ transition: "stroke-dashoffset 1s linear, stroke .4s" }} />
            </svg>
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 16, fontWeight: 900, lineHeight: 1, color: isDone ? "var(--success)" : ringColor }}>{mins}</span>
              <span style={{ fontSize: 7.5, fontWeight: 800, color: "var(--foreground-secondary)", letterSpacing: "1px" }}>MIN</span>
            </div>
          </div>
        </div>

        {emEdicaoDetail && (
          <div style={{ background: "color-mix(in srgb, var(--info) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--info) 30%, transparent)", borderRadius: 14, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 900, color: "var(--info)" }}>✎ Cliente editando o pedido</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--foreground-secondary)" }}>O cliente está alterando este pedido. Aguarde a finalização para revisar e aceitar.</span>
            {p.editExpiresAt && <span style={{ fontSize: 11, fontWeight: 700, color: "var(--foreground-muted)" }}>Edição expira em alguns minutos</span>}
          </div>
        )}
        {!emEdicaoDetail && foiEditadoDetail && (
          <div style={{ background: "var(--attention-surface)", border: "1px solid var(--attention-border)", borderRadius: 14, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 900, color: "var(--attention-text)" }}>✎ Pedido alterado pelo cliente</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--foreground-secondary)" }}>Revise as alterações antes de aceitar.</span>
            {p.changesSummary && p.changesSummary.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 4 }}>
                <span style={{ fontSize: 10, fontWeight: 900, color: "var(--foreground-muted)", textTransform: "uppercase", letterSpacing: ".5px" }}>Alterações realizadas</span>
                {p.changesSummary.map((linha, i) => (
                  <span key={i} style={{ fontSize: 12, fontWeight: 700, color: "var(--foreground)" }}>• {linha}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Informações completas */}
        <div style={{ background: "var(--surface)", borderRadius: 14, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
          {p.telefone && p.telefone !== "App" && (
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--foreground-muted)" }}>Telefone</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: "var(--foreground-secondary)" }}>{p.telefone}</span>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--foreground-muted)" }}>Tipo</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: isDineInDetail ? "var(--attention)" : isRetirada ? "var(--text-primary)" : "var(--info)" }}>{isDineInDetail ? "Consumo no local 🍽️" : isRetirada ? "Retirada na loja" : "Delivery"}</span>
          </div>
          {!isRetirada && !isDineInDetail && (
            <>
              {p.bairro && <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 11, fontWeight: 700, color: "var(--foreground-muted)" }}>Bairro</span><span style={{ fontSize: 13, fontWeight: 800, color: "var(--foreground)" }}>{p.bairro}</span></div>}
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--foreground-muted)" }}>Endereço</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: "var(--foreground)", textAlign: "right", maxWidth: "60%" }}>{p.endereco}</span>
              </div>
              {p.referencia && <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 11, fontWeight: 700, color: "var(--foreground-muted)" }}>Referência</span><span style={{ fontSize: 13, fontWeight: 800, color: "var(--foreground)", textAlign: "right", maxWidth: "60%" }}>{p.referencia}</span></div>}
              {p.taxaEntrega != null && p.taxaEntrega > 0 && <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 11, fontWeight: 700, color: "var(--foreground-muted)" }}>Taxa entrega</span><span style={{ fontSize: 13, fontWeight: 800, color: "var(--foreground)" }}>R$ {p.taxaEntrega.toFixed(2).replace(".", ",")}</span></div>}
            </>
          )}
        </div>

        {/* Itens */}
        <div style={{ background: sc.accentBg, borderRadius: 14, padding: "12px 13px" }}>
          <span style={{ fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: "1px", color: "var(--foreground-secondary)", display: "block", marginBottom: 8 }}>Pedido</span>
          {p.itens.map((item, i) => (
            <div key={i}>
              {i > 0 && <div style={{ height: 1, background: "rgba(var(--overlay-rgb), 0.04)", margin: "6px 0" }} />}
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 9, background: "rgba(var(--overlay-rgb), 0.06)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 17 }}>{getItemIcon(item)}</div>
                <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: "var(--foreground)" }}>{item}</span>
                <span style={{ fontSize: 12, fontWeight: 900, color: sc.accentSoft, background: "rgba(var(--overlay-rgb), 0.06)", padding: "3px 9px", borderRadius: 7, flexShrink: 0 }}>×1</span>
              </div>
            </div>
          ))}
          {p.observacao && <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: "var(--brand-text)", background: "color-mix(in srgb, var(--primary) 8%, transparent)", borderRadius: 8, padding: "6px 10px" }}>Obs: {p.observacao}</div>}
        </div>

        {/* Pagamento detalhado */}
        {hibridoParts ? (
          <div style={{ background: "color-mix(in srgb, var(--primary) 7%, transparent)", border: "1px solid color-mix(in srgb, var(--primary) 20%, transparent)", borderRadius: 12, padding: "12px 14px" }}>
            <div style={{ fontSize: 10, fontWeight: 900, color: "var(--foreground-secondary)", textTransform: "uppercase", letterSpacing: ".8px", marginBottom: 8 }}>Pagamento Misto</div>
            {hibridoParts.map((pp, i) => {
              const ehPix = /pix/i.test(pp.metodo)
              const revisaoOuSuspeito = ehPix ? labelPixRevisaoOuSuspeito(p) : null
              return (
                <div key={i} style={{ marginBottom: 4 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 800, color: "var(--brand-text)" }}>
                    <span>{pp.metodo}</span><span>R$ {pp.valor.toFixed(2).replace(".", ",")}</span>
                  </div>
                  {ehPix && (
                    <div style={{ marginTop: 2 }}>
                      {p.pixConfirmado ? (
                        <span style={{ fontSize: 11, color: "var(--success)", fontWeight: 800 }}>{labelPixConfirmado(p)}</span>
                      ) : revisaoOuSuspeito ? (
                        <span style={{ fontSize: 11, color: p.pix?.status === "suspeito" ? "var(--danger)" : "var(--attention-text)", fontWeight: 800 }}>{revisaoOuSuspeito}</span>
                      ) : (
                        <span style={{ fontSize: 11, color: "var(--attention-text)", fontWeight: 800 }}>⏳ Aguardando confirmação</span>
                      )}
                      {!p.pixConfirmado && !revisaoOuSuspeito && motivoResumidoPix(p) && (
                        <div style={{ marginTop: 2, fontSize: 11, fontWeight: 700, color: "var(--foreground-secondary)" }}>{motivoResumidoPix(p)}</div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
            {p.troco && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700, color: "var(--foreground-secondary)", marginTop: 6 }}>
                <span>Troco</span><span>{p.troco === "Sem troco" ? "Sem troco" : p.troco}</span>
              </div>
            )}
            <div style={{ borderTop: "1px solid color-mix(in srgb, var(--primary) 15%, transparent)", marginTop: 6, paddingTop: 6, display: "flex", justifyContent: "space-between", fontSize: 16, fontWeight: 900, color: "var(--brand-text)" }}>
              <span>Total</span><span>R$ {p.total.toFixed(2).replace(".", ",")}</span>
            </div>
          </div>
        ) : isPix && !isCanceled ? (
          p.pixConfirmado ? (
            p.pix?.confirmadoPor === "manual" ? (
              <div style={{ background: "color-mix(in srgb, var(--success) 10%, transparent)", border: "1.5px solid color-mix(in srgb, var(--success) 35%, transparent)", borderRadius: 14, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="var(--success)" strokeWidth="2"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" stroke="var(--success)" strokeWidth="2" strokeLinecap="round"/><path d="M9 12l2 2 4-4" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  <span style={{ fontSize: 12, fontWeight: 900, color: "var(--success)", textTransform: "uppercase", letterSpacing: ".6px" }}>Pagamento confirmado manualmente</span>
                </div>
                <div style={{ fontSize: 22, fontWeight: 900, color: "var(--foreground)" }}>{formatarValorReais(p.pix?.valorEsperado ?? p.total)}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground-secondary)", lineHeight: 1.5 }}>
                  Confirmado manualmente por <strong>{p.pix?.confirmadoPorNome || "atendente"}</strong> em {formatarDataHoraBR(p.pix?.confirmadoEm)}.
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--foreground-muted)" }}>Origem: painel /pedidos · Pedido {p.numero != null ? `#${p.numero}` : p.id}</div>
              </div>
            ) : (
              <div style={{ background: "color-mix(in srgb, var(--success) 10%, transparent)", border: "1.5px solid color-mix(in srgb, var(--success) 35%, transparent)", borderRadius: 14, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2l7 3v6c0 5-3.2 8.4-7 9.7C8.2 19.4 5 16 5 11V5l7-3z" stroke="var(--success)" strokeWidth="2" strokeLinejoin="round"/><path d="M9 12l2 2 4-4" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  <span style={{ fontSize: 12, fontWeight: 900, color: "var(--success)", textTransform: "uppercase", letterSpacing: ".6px" }}>Pagamento confirmado automaticamente</span>
                </div>
                <div style={{ fontSize: 22, fontWeight: 900, color: "var(--foreground)" }}>{formatarValorReais(p.pix?.valorEsperado ?? p.total)}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground-secondary)" }}>
                  {p.pix?.confirmadoPor === "comprovante" ? "Confirmado por comprovante validado." : "Mercado Pago confirmou a entrada deste valor."}
                  {p.pix?.confirmadoEm ? ` ${formatarDataHoraBR(p.pix.confirmadoEm)}.` : ""}
                </div>
              </div>
            )
          ) : (
            <div style={{ background: "var(--attention-surface)", border: "1.5px solid var(--attention-border)", borderRadius: 14, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="var(--attention-text)" strokeWidth="2"/><path d="M12 7v6l4 2" stroke="var(--attention-text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                <span style={{ fontSize: 13, fontWeight: 900, color: "var(--attention-text)", textTransform: "uppercase", letterSpacing: ".6px" }}>PIX ainda não confirmado</span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--attention-text)", lineHeight: 1.5 }}>Não libere este pedido antes de conferir a entrada do dinheiro.</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, background: "rgba(var(--overlay-rgb), 0.04)", borderRadius: 10, padding: "10px 12px" }}>
                <Row label="Valor esperado" value={formatarValorReais(p.pix?.valorEsperado ?? p.total)} />
                <Row label="Cliente" value={p.cliente} />
                <Row label="Pedido" value={p.numero != null ? `#${p.numero}` : p.id} />
                <Row label="Provider" value={p.pix?.provider === "mercadopago" ? "Mercado Pago" : "Pix manual"} />
                <Row label="Criado às" value={p.horario} />
                <Row label="Status atual" value="Ainda não confirmado pelo sistema" />
              </div>
              {pixTemComprovanteNaoValidado(p) && (
                <div style={{ background: p.pix?.status === "suspeito" ? "color-mix(in srgb, var(--danger) 12%, transparent)" : "color-mix(in srgb, var(--attention-text) 12%, transparent)", border: `1px solid ${p.pix?.status === "suspeito" ? "var(--danger)" : "var(--attention-border)"}`, borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ fontSize: 12, fontWeight: 900, color: p.pix?.status === "suspeito" ? "var(--danger)" : "var(--attention-text)", textTransform: "uppercase", letterSpacing: ".4px" }}>Comprovante recebido</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--foreground-secondary)" }}>Confira no banco ou Mercado Pago se o dinheiro realmente entrou.</span>
                  <span style={{ fontSize: 11, fontWeight: 800, color: "var(--foreground-muted)" }}>Comprovante não é confirmação de pagamento.</span>
                </div>
              )}
              {!isDone && (
                <>
                  <button onClick={() => abrirVerificacaoPix(p.id)} style={{ height: 48, border: "none", borderRadius: 12, background: "var(--attention-text)", color: "var(--background)", fontSize: 14, fontWeight: 900, letterSpacing: ".2px" }}>
                    VERIFICAR PAGAMENTO
                  </button>
                  <span style={{ fontSize: 10, fontWeight: 800, color: "var(--foreground-muted)", textAlign: "center", textTransform: "uppercase", letterSpacing: ".4px" }}>Ação manual de exceção</span>
                </>
              )}
            </div>
          )
        ) : (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: "var(--foreground-secondary)" }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: payDot, flexShrink: 0 }} />
                {pagamento || "Pagamento não informado"}
              </div>
              <span style={{ fontSize: 15, fontWeight: 900, color: "var(--foreground)" }}>R$ {p.total.toFixed(2).replace(".", ",")}</span>
            </div>
          </div>
        )}

        {/* Verificar pagamento — pagamento misto com Pix ainda não confirmado (breakdown acima não é alterado) */}
        {hibridoParts && isPix && !p.pixConfirmado && !isDone && !isCanceled && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <button onClick={() => abrirVerificacaoPix(p.id)} style={{ height: 46, border: "1px solid var(--attention-border)", borderRadius: 14, background: "var(--attention-surface)", color: "var(--attention-text)", fontSize: 14, fontWeight: 900, flexShrink: 0 }}>
              VERIFICAR PAGAMENTO
            </button>
            <span style={{ fontSize: 10, fontWeight: 800, color: "var(--foreground-muted)", textAlign: "center", textTransform: "uppercase", letterSpacing: ".4px" }}>Ação manual de exceção</span>
          </div>
        )}

        {/* Editar forma de pagamento — só antes de qualquer confirmação real do dinheiro */}
        {!isDone && !isCanceled && !emEdicaoDetail && !pagamentoJaConfirmadoClient(p) && (
          <button onClick={() => abrirEditarPagamento(p)} style={{ height: 40, border: "1px solid var(--surface-secondary)", borderRadius: 12, background: "transparent", color: "var(--foreground-secondary)", fontSize: 13, fontWeight: 800 }}>
            Editar forma de pagamento
          </button>
        )}

        {/* Alterar status dropdown — indisponível enquanto o cliente edita */}
        {!isDone && !isCanceled && !emEdicaoDetail && (
          <div>
            {modalAlterarStatus === p.id ? (
              <div style={{ background: "var(--surface)", border: "1px solid var(--surface-secondary)", borderRadius: 14, overflow: "hidden" }}>
                <div style={{ padding: "10px 14px", fontSize: 11, fontWeight: 900, color: "var(--foreground-muted)", textTransform: "uppercase", letterSpacing: ".8px" }}>Alterar status</div>
                {STATUS_OPTS.map(opt => (
                  <button key={opt.value} onClick={() => avancarStatus(p.id, opt.value)} disabled={p.status === opt.value} style={{ width: "100%", padding: "12px 14px", background: p.status === opt.value ? STATUS_COLOR[opt.value].accentBg : "transparent", border: "none", borderTop: "1px solid var(--surface-secondary)", color: p.status === opt.value ? STATUS_COLOR[opt.value].accent : "var(--foreground-secondary)", fontSize: 14, fontWeight: 800, textAlign: "left", cursor: p.status === opt.value ? "default" : "pointer" }}>
                    {opt.label} {p.status === opt.value && "· atual"}
                  </button>
                ))}
                <button onClick={() => setModalAlterarStatus(null)} style={{ width: "100%", padding: "12px 14px", background: "transparent", border: "none", borderTop: "1px solid var(--surface-secondary)", color: "var(--foreground-muted)", fontSize: 13, fontWeight: 800, textAlign: "center" }}>Cancelar</button>
              </div>
            ) : (
              <button onClick={() => setModalAlterarStatus(p.id)} style={{ width: "100%", height: 44, border: "1px solid var(--surface-secondary)", borderRadius: 12, background: "transparent", color: "var(--foreground-secondary)", fontSize: 13, fontWeight: 800 }}>Alterar status</button>
            )}
          </div>
        )}

        {/* Ação principal — bloqueada enquanto o cliente edita (o backend também rejeita) */}
        {!isDone && !isCanceled && nextStatus && (
          <button
            onClick={() => { if (emEdicaoDetail) return; avancarStatus(p.id, nextStatus); setDetailId(null) }}
            disabled={atualizando === p.id || emEdicaoDetail}
            title={emEdicaoDetail ? "Aguarde o cliente concluir a edição" : undefined}
            style={{ height: 58, border: "none", borderRadius: 16, background: emEdicaoDetail ? "var(--surface-secondary)" : sc.btnBg, color: emEdicaoDetail ? "var(--foreground-muted)" : sc.btnFg, fontSize: 17, fontWeight: 900, letterSpacing: "-0.2px", flexShrink: 0, opacity: atualizando === p.id ? 0.6 : 1, cursor: emEdicaoDetail ? "not-allowed" : "pointer" }}
          >
            {emEdicaoDetail ? "Aguarde o cliente concluir" : getActionLabel(p)}
          </button>
        )}
        {isDone && <div style={{ height: 54, borderRadius: 16, background: "color-mix(in srgb, var(--success) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--success) 30%, transparent)", color: "var(--success)", fontSize: 15, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>Entregue · tudo certo ✓</div>}

        {/* Finalizar no detalhe — bloqueado durante edição do cliente */}
        {!isDone && !isCanceled && !emEdicaoDetail && (
          <button onClick={() => { setDetailId(null); setFinalizarModal(p.id) }} style={{ height: 44, border: "1px solid rgba(var(--overlay-rgb), 0.07)", borderRadius: 14, background: "transparent", color: "var(--foreground-muted)", fontSize: 13, fontWeight: 800, flexShrink: 0 }}>
            Finalizar pedido
          </button>
        )}

        {/* WhatsApp */}
        {p.telefone && p.telefone !== "App" && (
          <button onClick={() => window.open(whatsappLink(p.telefone), "_blank")} style={{ height: 46, border: "1px solid var(--border)", borderRadius: 14, background: "transparent", color: "var(--foreground-secondary)", fontSize: 14, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, flexShrink: 0 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--success)" }} />
            Falar com {firstName} no WhatsApp
          </button>
        )}

        {/* Cancelar — bloqueado durante edição do cliente (mesma regra do aceite) */}
        {!isDone && !isCanceled && !emEdicaoDetail && (
          <button onClick={() => cancelarPedido(p.id)} disabled={cancelandoId === p.id} style={{ height: 46, border: "1px solid color-mix(in srgb, var(--danger) 35%, transparent)", borderRadius: 14, background: "color-mix(in srgb, var(--danger) 6%, transparent)", color: "var(--danger)", fontSize: 14, fontWeight: 800, flexShrink: 0, opacity: cancelandoId === p.id ? 0.6 : 1 }}>
            {cancelandoId === p.id ? "Cancelando..." : "Cancelar pedido"}
          </button>
        )}

        {/* Imprimir pedido — bloqueado antes do aceite enquanto o cliente edita, para nunca imprimir uma versão desatualizada */}
        {!emEdicaoDetail && (
          <button onClick={() => window.open(`/pedidos/${p.id}/imprimir`, "_blank")} style={{ height: 44, border: "1px solid rgba(var(--overlay-rgb), 0.1)", borderRadius: 14, background: "transparent", color: "var(--foreground-secondary)", fontSize: 14, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, flexShrink: 0 }}>
            🖨️ Imprimir pedido
          </button>
        )}

        <button onClick={() => setDetailId(null)} style={{ height: 44, border: "none", background: "transparent", color: "var(--foreground-secondary)", fontSize: 14, fontWeight: 800, flexShrink: 0 }}>Fechar</button>
      </>
    )
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800;900&display=swap');
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        html, body { margin: 0; padding: 0; background: var(--background); }
        button { cursor: pointer; font-family: 'Archivo', sans-serif; }
        @keyframes cbPulse { 0%{box-shadow:0 0 0 0 color-mix(in srgb, var(--success) 55%, transparent)} 70%{box-shadow:0 0 0 7px color-mix(in srgb, var(--success) 1%, transparent)} 100%{box-shadow:0 0 0 0 color-mix(in srgb, var(--success) 1%, transparent)} }
        @keyframes cbRedPulse { 0%{box-shadow:0 0 0 0 color-mix(in srgb, var(--danger) 50%, transparent)} 70%{box-shadow:0 0 0 7px color-mix(in srgb, var(--danger) 1%, transparent)} 100%{box-shadow:0 0 0 0 color-mix(in srgb, var(--danger) 1%, transparent)} }
        @keyframes cbUrgentGlow { 0%,100%{border-color:color-mix(in srgb, var(--danger) 45%, transparent)} 50%{border-color:color-mix(in srgb, var(--danger) 90%, transparent)} }
        @keyframes cbGlowO { 0%,100%{box-shadow:0 0 0 0 color-mix(in srgb, var(--primary) 15%, transparent)} 50%{box-shadow:0 0 0 10px color-mix(in srgb, var(--primary) 4%, transparent)} }
        @keyframes cbGlowY { 0%,100%{box-shadow:0 0 0 0 color-mix(in srgb, var(--primary) 15%, transparent)} 50%{box-shadow:0 0 0 10px color-mix(in srgb, var(--primary) 4%, transparent)} }
        @keyframes cbGlowB { 0%,100%{box-shadow:0 0 0 0 color-mix(in srgb, var(--info) 15%, transparent)} 50%{box-shadow:0 0 0 10px color-mix(in srgb, var(--info) 4%, transparent)} }
        @keyframes cbGlowG { 0%,100%{box-shadow:0 0 0 0 color-mix(in srgb, var(--success) 15%, transparent)} 50%{box-shadow:0 0 0 10px color-mix(in srgb, var(--success) 4%, transparent)} }
        @keyframes cbGlowR { 0%,100%{box-shadow:0 0 0 0 color-mix(in srgb, var(--danger) 15%, transparent)} 50%{box-shadow:0 0 0 10px color-mix(in srgb, var(--danger) 4%, transparent)} }
        @keyframes cbCardIn { from{opacity:0;transform:translateY(16px) scale(.97)} to{opacity:1;transform:none} }
        @keyframes cbCardOut { to{opacity:0;transform:translateX(48px) scale(.96)} }
        @keyframes cbFlash { 0%{transform:scale(1)} 30%{transform:scale(1.012);box-shadow:0 0 0 3px color-mix(in srgb, var(--primary) 55%, transparent)} 100%{transform:scale(1);box-shadow:0 0 0 0 color-mix(in srgb, var(--primary) 1%, transparent)} }
        @keyframes cbToastIn { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:none} }
        @keyframes cbSheetUp { from{transform:translateY(100%)} to{transform:none} }
        @keyframes cbFadeIn { from{opacity:0} to{opacity:1} }
        @keyframes cbCancelGlow { 0%,100%{border-color:color-mix(in srgb, var(--danger) 30%, transparent)} 50%{border-color:color-mix(in srgb, var(--danger) 70%, transparent)} }
        @keyframes cbShimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
        @keyframes cbWait { 0%,100%{opacity:1} 50%{opacity:.35} }
        .cb-header { background:var(--background); border-bottom:1px solid var(--surface); padding:calc(env(safe-area-inset-top) + 12px) 16px 12px; position:sticky; top:0; z-index:10; }
        .cb-main { padding:12px 16px; display:flex; flex-direction:column; gap:14px; }
        .cbBusca::placeholder { color: var(--border-strong); }
        .cbBusca:focus { border-color: var(--brand-text) !important; box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 10%, transparent); }
        .cbInput:focus { border-color: var(--brand-text) !important; outline: none; }
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
        .cb-chat-msg-area::-webkit-scrollbar-thumb { background:var(--border); border-radius:2px; }
        .cb-chat-left-inner::-webkit-scrollbar { width:3px; }
        .cb-chat-left-inner::-webkit-scrollbar-thumb { background:var(--surface); border-radius:2px; }
        .cb-chat-item { width:100%; text-align:left; background:transparent; border:none; border-bottom:1px solid var(--surface); padding:10px 14px; cursor:pointer; display:flex; align-items:center; gap:10px; transition:background .1s; }
        .cb-chat-item:hover { background:rgba(var(--overlay-rgb), 0.03); }
        .cb-chat-item.cb-chat-item-active { background:var(--background); border-left:3px solid var(--primary); padding-left:11px; }
        @keyframes cb-pulse-urgent { 0%,100%{background:color-mix(in srgb, var(--primary) 4%, transparent)} 50%{background:color-mix(in srgb, var(--primary) 11%, transparent)} }
        .cb-chat-item.cb-chat-item-urgente { animation:cb-pulse-urgent 2s ease-in-out infinite; border-left:3px solid var(--primary); padding-left:11px; }
        .cb-chat-item.cb-chat-item-urgente:hover { background:color-mix(in srgb, var(--primary) 9%, transparent) !important; }
        .cb-chat-item.cb-chat-item-alerta { border-left:3px solid var(--primary); padding-left:11px; }
        .cb-chat-item.cb-chat-item-alerta:hover { background:color-mix(in srgb, var(--primary) 7%, transparent) !important; }
        @keyframes cb-pulse-nova-msg { 0%,100%{background:color-mix(in srgb, var(--success) 4%, transparent)} 50%{background:color-mix(in srgb, var(--success) 11%, transparent)} }
        .cb-chat-item.cb-chat-item-nova-msg { animation:cb-pulse-nova-msg 1.8s ease-in-out infinite; border-left:3px solid var(--success); padding-left:11px; }
        .cb-chat-item.cb-chat-item-nova-msg:hover { background:color-mix(in srgb, var(--success) 9%, transparent) !important; }
        .cb-assumir-btn { background:var(--primary); color:var(--background); border:none; border-radius:5px; padding:3px 8px; font-size:9px; font-weight:900; cursor:pointer; white-space:nowrap; flex-shrink:0; line-height:1.4; }
        .cb-assumir-btn:hover { background:var(--primary); }
        .cb-assumir-btn:disabled { opacity:.65; cursor:default; }
        .cb-chat-textarea { width:100%; background:var(--background); border:1px solid var(--surface-secondary); border-radius:10px; padding:9px 12px; color:var(--foreground); font-size:13px; resize:none; font-family:inherit; outline:none; box-sizing:border-box; line-height:1.4; }
        .cb-chat-textarea:focus { border-color:var(--brand-text); }
        @media (min-width: 768px) {
          .cb-header { border-bottom:1px solid var(--surface); padding:24px 28px 20px; position:static; }
          .cb-list-col { padding:16px 24px; }
          .cb-detail-col { display:flex; flex-direction:column; width:420px; min-width:380px; flex-shrink:0; border-left:1px solid var(--surface); background:var(--background); overflow-y:auto; padding:16px 20px 32px; gap:12px; }
          .cb-mob-sheet-wrap { display:none !important; }
          .cb-chat-left { width:280px; min-width:240px; flex-shrink:0; border-right:1px solid var(--surface); display:flex !important; }
          .cb-chat-right { display:flex !important; }
          .cb-mob-back { display:none !important; }
        }
      `}</style>

      {novoPedidoAberto && menuManual && (
        <NovoPedidoManual
          menu={menuManual}
          onFechar={() => setNovoPedidoAberto(false)}
          onCriado={(pedidoId) => {
            setNovoPedidoAberto(false)
            // O pedido entra no painel como qualquer outro canal e imprime no
            // aceite, pelas regras que já existem — nada especial aqui.
            carregarPedidos()
            setToast({ text: `Pedido criado ✓`, expires: Date.now() + 5000, pedidoId, prevStatus: "novo" })
            if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
            toastTimerRef.current = setTimeout(() => setToast(null), 5000)
          }}
        />
      )}

      {/* Gate de limpeza operacional — bloqueante enquanto houver pendência, e
          só na visão de pedidos ativos: em "arquivados" e "tempo real" a
          operadora está fazendo outra coisa. Desligado por padrão (flag). */}
      {limpezaOperacionalAtiva() && (
        <LimpezaOperacionalGate
          pedidos={pedidos}
          onResolver={resolverPendenciaOperacional}
          ativo={filtro !== "arquivados" && filtro !== "tempo_real"}
        />
      )}

      <PanelShell
        pedidosCount={emAberto}
        conversasCount={escalonados.length}
        conversasUrgent={escalonados.some(p => Math.floor((Date.now() - (p.horarioEscalonado || parseInt(p.id))) / 60000) >= 8)}
        showEquipeNav
      >

        {/* ── HEADER ── */}
        <header className="cb-header">
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: "-0.4px", lineHeight: 1.1 }}>Pedidos</div>
              <div style={{ fontSize: 11, color: "var(--foreground-muted)", fontWeight: 700, marginTop: 2 }}>Controle de pedidos da pizzaria</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button
                onClick={abrirNovoPedido}
                disabled={carregandoMenu}
                title="Montar um pedido de telefone ou balcão"
                style={{ fontSize: 11, fontWeight: 900, color: "var(--background)", background: "var(--primary)", border: "1px solid var(--primary)", padding: "6px 12px", borderRadius: 16, cursor: carregandoMenu ? "default" : "pointer", opacity: carregandoMenu ? 0.6 : 1 }}
              >
                {carregandoMenu ? "Abrindo…" : "+ Novo pedido"}
              </button>
              <button onClick={toggleMute} title={muteado ? "Sons desativados" : "Sons ativados"} style={{ fontSize: 15, lineHeight: 1, background: muteado ? "color-mix(in srgb, var(--danger) 10%, transparent)" : "transparent", border: `1px solid ${muteado ? "color-mix(in srgb, var(--danger) 35%, transparent)" : "var(--surface-secondary)"}`, padding: "5px 8px", borderRadius: 16 }}>{muteado ? "🔇" : "🔊"}</button>
              {isAdmin && <button onClick={() => router.push("/admin")} style={{ fontSize: 11, fontWeight: 800, color: "var(--foreground-secondary)", background: "transparent", border: "1px solid var(--surface-secondary)", padding: "6px 10px", borderRadius: 16 }}>Admin</button>}
              {isAdmin && <button onClick={reconciliarPixMercadoPago} disabled={reconciliandoPix} title={ultimaVerificacaoPix ? `Última verificação: ${ultimaVerificacaoPix}` : "Consulta a API do Mercado Pago para confirmar Pix pendentes"} style={{ fontSize: 11, fontWeight: 800, color: "var(--foreground-secondary)", background: "transparent", border: "1px solid var(--surface-secondary)", padding: "6px 10px", borderRadius: 16, opacity: reconciliandoPix ? 0.6 : 1, cursor: reconciliandoPix ? "not-allowed" : "pointer" }}>{reconciliandoPix ? "Verificando..." : "Verificar pagamentos Pix Mercado Pago"}</button>}
              <button onClick={() => fetch("/api/auth/logout", { method: "POST" }).then(() => router.push("/login"))} style={{ fontSize: 11, fontWeight: 800, color: "var(--foreground-muted)", background: "transparent", border: "1px solid var(--border)", padding: "6px 10px", borderRadius: 16 }}>Sair</button>
            </div>
          </div>

          {erroMenu && (
            <p role="status" aria-live="polite" style={{ fontSize: 11.5, fontWeight: 800, color: "var(--attention-text)", margin: "0 0 10px" }}>
              {erroMenu}
            </p>
          )}

          {/* Bot toggle */}
          <button onClick={alternarBot} disabled={salvandoBot} style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "10px 12px", background: botAtivo ? "color-mix(in srgb, var(--success) 6%, transparent)" : "color-mix(in srgb, var(--primary) 6%, transparent)", border: `1px solid ${botAtivo ? "color-mix(in srgb, var(--success) 28%, transparent)" : "color-mix(in srgb, var(--primary) 30%, transparent)"}`, borderRadius: 12, color: "var(--foreground)", textAlign: "left", marginBottom: 10 }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: botAtivo ? "var(--success)" : "var(--primary)", flexShrink: 0, animation: botAtivo ? "cbPulse 2s infinite" : "none" }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: "-0.2px", color: "var(--foreground)" }}>{botAtivo ? "Bot atendendo" : "Bot pausado"}</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: botAtivo ? "var(--success)" : "var(--brand-text)", marginTop: 1 }}>{botAtivo ? "WhatsApp conectado" : "Você no comando"}</div>
            </div>
            <span style={{ fontSize: 11, fontWeight: 900, color: botAtivo ? "var(--success)" : "var(--brand-text)", background: "var(--background)", padding: "5px 10px", borderRadius: 8, flexShrink: 0 }}>{botAtivo ? "Pausar" : "Ativar"}</span>
          </button>

          {/* Métricas */}
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <div style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 10px" }}>
              <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-1px", lineHeight: 1, color: "var(--foreground)" }}>{totalHoje}</div>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--foreground-muted)", textTransform: "uppercase", letterSpacing: ".5px", marginTop: 2 }}>Hoje</div>
            </div>
            <div style={{ flex: 1, background: emAberto > 0 ? "var(--background)" : "var(--surface)", border: `1px solid ${emAberto > 0 ? "color-mix(in srgb, var(--primary) 50%, transparent)" : "var(--border)"}`, borderRadius: 12, padding: "10px 10px" }}>
              <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-1px", lineHeight: 1, color: emAberto > 0 ? "var(--brand-text)" : "var(--border-strong)" }}>{emAberto}</div>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: emAberto > 0 ? "var(--brand-text)" : "var(--border-strong)", textTransform: "uppercase", letterSpacing: ".5px", marginTop: 2 }}>Em aberto</div>
            </div>
            <div style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 10px" }}>
              <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-1px", lineHeight: 1, color: "var(--success)" }}>{contagemPorStatus("entregue")}</div>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--foreground-muted)", textTransform: "uppercase", letterSpacing: ".5px", marginTop: 2 }}>Prontos</div>
            </div>
            <div style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 10px" }}>
              <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-1px", lineHeight: 1, color: "var(--info)" }}>{tempoMedioPreparo !== null ? `${tempoMedioPreparo}` : "—"}<span style={{ fontSize: 10, fontWeight: 700, marginLeft: 2 }}>{tempoMedioPreparo !== null ? "m" : ""}</span></div>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--foreground-muted)", textTransform: "uppercase", letterSpacing: ".5px", marginTop: 2 }}>⏱ Média</div>
            </div>
          </div>

          {/* Pipeline + Novo + Limpar */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <div className="cbPipeScroll">
              <button onClick={() => setFiltro("tempo_real")} style={{ border: `1px solid ${filtro === "tempo_real" ? "var(--info)" : "var(--surface-secondary)"}`, background: filtro === "tempo_real" ? "var(--info)" : "transparent", color: filtro === "tempo_real" ? "var(--background)" : "var(--foreground-secondary)", fontSize: 11, fontWeight: 900, padding: "6px 11px", borderRadius: 14, flexShrink: 0 }}>⚡ Tempo real · {sessoes.length}</button>
              {steps.map((s) => {
                const active = filtro === s.key; const sc = STATUS_COLOR[s.key]
                return (
                  <button key={s.key} onClick={() => setFiltro(active ? "todos" : s.key)} style={{ border: `1px solid ${active ? sc.accentBorder : "var(--surface-secondary)"}`, background: active ? sc.accentBg : "var(--surface)", color: active ? sc.accent : "var(--foreground-secondary)", fontSize: 11, fontWeight: 900, padding: "6px 11px", borderRadius: 14, flexShrink: 0 }}>
                    {s.stepLabel} · {s.count}
                  </button>
                )
              })}
              <button onClick={() => setFiltro("arquivados")} style={{ border: `1px solid ${filtro === "arquivados" ? "color-mix(in srgb, var(--attention) 60%, transparent)" : "var(--surface-secondary)"}`, background: filtro === "arquivados" ? "color-mix(in srgb, var(--attention) 15%, transparent)" : "transparent", color: filtro === "arquivados" ? "var(--attention)" : "var(--foreground-muted)", fontSize: 11, fontWeight: 900, padding: "6px 11px", borderRadius: 14, flexShrink: 0 }}>📦 Arquivados</button>
            </div>
            <button onClick={() => setModalArquivarExpediente(true)} title="Arquivar não resolvidos do expediente" style={{ height: 32, border: "1px solid color-mix(in srgb, var(--attention) 40%, transparent)", background: "color-mix(in srgb, var(--attention) 8%, transparent)", color: "var(--attention)", fontSize: 11, fontWeight: 900, padding: "0 10px", borderRadius: 10, flexShrink: 0, whiteSpace: "nowrap" }}>📦</button>
            <button onClick={abrirNovoPedido} disabled={carregandoMenu} title="Montar um pedido de telefone ou balcão" style={{ height: 32, border: "1px solid color-mix(in srgb, var(--primary) 50%, transparent)", background: "color-mix(in srgb, var(--primary) 10%, transparent)", color: "var(--brand-text)", fontSize: 11, fontWeight: 900, padding: "0 10px", borderRadius: 10, flexShrink: 0, opacity: carregandoMenu ? 0.6 : 1 }}>+ Novo</button>
            <button onClick={() => setModalLimpar(true)} title="Limpar histórico" style={{ width: 32, height: 32, border: "1px solid var(--surface-secondary)", borderRadius: 10, background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><polyline points="3,6 5,6 21,6" stroke="var(--foreground-muted)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" stroke="var(--foreground-muted)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/><path d="M10 11v6M14 11v6" stroke="var(--foreground-muted)" strokeWidth="2.2" strokeLinecap="round"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" stroke="var(--foreground-muted)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>

          {/* Busca */}
          <div style={{ position: "relative" }}>
            <input className="cbBusca" type="text" placeholder="Buscar por nome, telefone, bairro ou #número..." value={busca} onChange={e => setBusca(e.target.value)} style={{ width: "100%", height: 44, background: "var(--surface)", border: "1px solid var(--surface-secondary)", borderRadius: 12, padding: "0 40px 0 14px", color: "var(--foreground)", fontSize: 13, fontWeight: 700, fontFamily: "'Archivo', sans-serif", outline: "none", boxSizing: "border-box" }} />
            {busca ? <button onClick={() => setBusca("")} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--foreground-muted)", fontSize: 18, lineHeight: 1, padding: "4px", cursor: "pointer" }}>×</button>
              : <svg style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="var(--border-strong)" strokeWidth="2.2"/><path d="M16.5 16.5l3.5 3.5" stroke="var(--border-strong)" strokeWidth="2.2" strokeLinecap="round"/></svg>}
          </div>
        </header>

        {/* ── CONTEÚDO ── */}
        <div className="cb-workspace">
        <main className={`cb-list-col${filtro === "tempo_real" ? " cb-chat-mode" : ""}`}>

        {/* Install Banner */}
        {showInstallBanner && (
          <div style={{ padding: "0 0 2px" }}>
            <div style={{ padding: "14px 16px", background: "linear-gradient(135deg,color-mix(in srgb, var(--primary) 15%, transparent),color-mix(in srgb, var(--primary) 5%, transparent))", border: "1.5px solid color-mix(in srgb, var(--primary) 40%, transparent)", borderRadius: 18, display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 32, flexShrink: 0 }}>🍕</span>
              <div style={{ flex: 1, minWidth: 0 }}><p style={{ margin: 0, fontSize: 14, fontWeight: 900, color: "var(--foreground)" }}>Instalar ChefeBot</p><p style={{ margin: "2px 0 0", fontSize: 11, fontWeight: 700, color: "var(--foreground-secondary)" }}>Acesse mais rápido pela tela inicial</p></div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
                <button onClick={async () => { if (installPrompt) { installPrompt.prompt(); const r = await installPrompt.userChoice; if (r.outcome === "accepted") setShowInstallBanner(false); } }} style={{ border: "none", background: "var(--primary)", color: 'var(--primary-foreground)', fontSize: 12, fontWeight: 900, padding: "8px 14px", borderRadius: 10 }}>Instalar</button>
                <button onClick={() => setShowInstallBanner(false)} style={{ border: "none", background: "transparent", color: "var(--foreground-muted)", fontSize: 11, fontWeight: 800, padding: "4px 0" }}>Agora não</button>
              </div>
            </div>
          </div>
        )}
        {/* Urgência */}
        {escalonados.length > 0 && !cardUrgenciaFechado && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "color-mix(in srgb, var(--danger) 6%, transparent)", border: "1px solid color-mix(in srgb, var(--danger) 35%, transparent)", borderLeft: "3px solid var(--danger)", borderRadius: 10, animation: "cbUrgentGlow 1.6s infinite" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--danger)", flexShrink: 0, animation: "cbRedPulse 1.6s infinite" }} />
            <span style={{ fontSize: 11, fontWeight: 900, color: "var(--danger)", textTransform: "uppercase", letterSpacing: "1px", flexShrink: 0 }}>🚨 URGENTE</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--foreground)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {escalonados.length === 1 ? `${escalonados[0].cliente.split(" ")[0]} quer falar` : `${escalonados.length} conversas aguardando`}
            </span>
            <button onClick={() => { assumirConversa(escalonados[0].telefone); setCardUrgenciaFechado(true) }} style={{ height: 26, padding: "0 10px", border: "none", borderRadius: 7, background: "var(--danger)", color: "var(--foreground)", fontSize: 11, fontWeight: 900, flexShrink: 0 }}>Assumir</button>
            <button onClick={() => setCardUrgenciaFechado(true)} style={{ height: 26, width: 26, border: "1px solid color-mix(in srgb, var(--danger) 25%, transparent)", borderRadius: 7, background: "transparent", color: "var(--danger)", fontSize: 16, fontWeight: 900, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
          </div>
        )}

        {/* Arquivados */}
        {filtro === "arquivados" && (
          <>
            {carregandoArquivados ? (
              <div style={{ background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 20, padding: "36px 20px", textAlign: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground-muted)" }}>Carregando...</span>
              </div>
            ) : pedidosArquivados.length === 0 ? (
              <div style={{ background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 20, padding: "36px 20px", textAlign: "center" }}>
                <span style={{ fontSize: 32, display: "block", marginBottom: 8 }}>📦</span>
                <span style={{ fontSize: 15, fontWeight: 900, color: "var(--foreground-secondary)", display: "block" }}>Nenhum pedido arquivado.</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--foreground-muted)", display: "block", marginTop: 4 }}>Pedidos arquivados ficam aqui para consulta.</span>
              </div>
            ) : pedidosArquivados.map(p => {
              const sc = STATUS_COLOR[p.status] || STATUS_COLOR["cancelado"]
              const firstName = p.cliente.split(" ")[0]
              const archivedDate = p.archivedAt ? new Date(p.archivedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) : ""
              const motivo = p.archivedReason === "fim_expediente" ? "Fim de expediente" : p.archivedReason === "manual" ? "Arquivado manualmente" : "Arquivado"
              return (
                <article key={p.id} style={{ background: "color-mix(in srgb, var(--attention) 5%, transparent)", border: "1px solid color-mix(in srgb, var(--attention) 20%, transparent)", borderRadius: 20, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8, opacity: 0.85 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <div>
                      {p.numero != null && <span style={{ fontSize: 10, fontWeight: 900, color: "var(--foreground-muted)", marginRight: 6 }}>#{p.numero}</span>}
                      <span style={{ fontSize: 16, fontWeight: 900, color: "var(--foreground-secondary)" }}>{firstName}</span>
                      <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, color: sc.accent, background: sc.accentBg, padding: "2px 6px", borderRadius: 6, border: `1px solid ${sc.accentBorder}` }}>{sc.label}</span>
                    </div>
                    <span style={{ fontSize: 9, fontWeight: 800, color: "var(--attention)", background: "color-mix(in srgb, var(--attention) 12%, transparent)", padding: "3px 8px", borderRadius: 8 }}>📦 {motivo}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--foreground-muted)", fontWeight: 700 }}>
                    {p.itens.slice(0, 2).join(", ")}{p.itens.length > 2 ? "..." : ""}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--border-strong)", fontWeight: 700 }}>
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
              <div style={{ padding: "10px 14px 8px", borderBottom: "1px solid var(--background)", flexShrink: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 900, color: "var(--foreground-muted)", textTransform: "uppercase", letterSpacing: ".5px" }}>
                  ⚡ Conversas · {sessoes.length}
                </div>
              </div>
              <div className="cb-chat-left-inner">
                {sessoes.length === 0 ? (
                  <div style={{ padding: "40px 16px", textAlign: "center" }}>
                    <div style={{ fontSize: 26, marginBottom: 8 }}>⚡</div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: "var(--border-strong)" }}>Nenhuma conversa ativa</div>
                  </div>
                ) : [...sessoes].sort((a, b) => {
                    // 1. Nova mensagem não vista: sobe ao topo imediatamente
                    const aNova = temNovaMsgNaoVista(a) ? 1 : 0;
                    const bNova = temNovaMsgNaoVista(b) ? 1 : 0;
                    if (bNova !== aNova) return bNova - aNova;
                    // 2. Urgente: precisa de humano imediato (botão Assumir agora)
                    const aUrgente = (a.postOrderPriority && !a.manual) ? 1 : 0;
                    const bUrgente = (b.postOrderPriority && !b.manual) ? 1 : 0;
                    if (bUrgente !== aUrgente) return bUrgente - aUrgente;
                    // 3. Alerta: 2ª confusão consecutiva, bot ainda conduz
                    const aAlerta = (a.conversationAlert && !a.manual && !a.postOrderPriority) ? 1 : 0;
                    const bAlerta = (b.conversationAlert && !b.manual && !b.postOrderPriority) ? 1 : 0;
                    if (bAlerta !== aAlerta) return bAlerta - aAlerta;
                    // 4. Já assumido, aguardando
                    if (Number(!!b.manual) !== Number(!!a.manual)) return Number(!!b.manual) - Number(!!a.manual);
                    // Tiebreaker: conversa mais recente primeiro
                    return (b.ultimaTs ?? 0) - (a.ultimaTs ?? 0);
                  }).map(s => {
                  const displayName = s.customerName || `…${s.lastDigits}`
                  const initial = ((s.customerName || s.lastDigits || "?")[0]).toUpperCase()
                  const isActive = sessaoAtiva === s.phone
                  const hasNovaMsg = temNovaMsgNaoVista(s)
                  return (
                    <button
                      key={s.phone}
                      style={{ position: "relative" }}
                      className={`cb-chat-item${isActive ? " cb-chat-item-active" : ""}${s.postOrderPriority && !s.manual ? " cb-chat-item-urgente" : s.conversationAlert && !s.manual ? " cb-chat-item-alerta" : hasNovaMsg ? " cb-chat-item-nova-msg" : ""}`}
                      onClick={() => { setSessaoAtiva(s.phone); marcarConversaComoVista(s); isNearBottomRef.current = true; prevMsgCountRef.current = 0; setNovasMsgCount(0) }}
                    >
                      {hasNovaMsg && (
                        <span
                          title="Nova mensagem"
                          style={{ position: "absolute", right: 12, bottom: 10, zIndex: 20, minWidth: 20, height: 20, borderRadius: 10, background: "var(--success)", color: "var(--foreground)", fontSize: 11, fontWeight: 900, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 5px", lineHeight: 1, boxShadow: "0 1px 4px rgba(0,0,0,.4)" }}
                        >
                          1
                        </span>
                      )}
                      <div style={{ width: 38, height: 38, borderRadius: "50%", flexShrink: 0, background: s.manual ? "color-mix(in srgb, var(--danger) 13%, transparent)" : s.postOrderPriority ? "color-mix(in srgb, var(--primary) 13%, transparent)" : "color-mix(in srgb, var(--primary) 10%, transparent)", border: `1.5px solid ${s.manual ? "color-mix(in srgb, var(--danger) 30%, transparent)" : s.postOrderPriority ? "color-mix(in srgb, var(--primary) 30%, transparent)" : "color-mix(in srgb, var(--primary) 25%, transparent)"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 900, color: s.manual ? "var(--danger)" : s.postOrderPriority ? "var(--brand-text)" : "var(--brand-text)" }}>
                        {initial}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginBottom: 3 }}>
                          <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 900, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayName}</span>
                          {s.postOrderPriority && !s.manual ? (
                            <button
                              className="cb-assumir-btn"
                              disabled={assumindoSessao === s.phone}
                              onClick={e => { e.stopPropagation(); setSessaoAtiva(s.phone); assumirSessao(s.phone) }}
                            >
                              {assumindoSessao === s.phone ? "..." : "Assumir e responder"}
                            </button>
                          ) : s.conversationAlert && !s.manual ? (
                            <span style={{ fontSize: 9, fontWeight: 900, color: "var(--brand-text)", background: "color-mix(in srgb, var(--primary) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--primary) 30%, transparent)", padding: "2px 7px", borderRadius: 5, flexShrink: 0, whiteSpace: "nowrap" }}>
                              ⚠ Atenção
                            </span>
                          ) : hasNovaMsg ? (
                            <span style={{ fontSize: 10, fontWeight: 900, color: "var(--success)", background: "color-mix(in srgb, var(--success) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--success) 40%, transparent)", padding: "2px 8px", borderRadius: 5, flexShrink: 0, whiteSpace: "nowrap" }}>
                              ● Nova mensagem
                            </span>
                          ) : (
                            <span style={{ fontSize: 9, fontWeight: 900, color: s.manual ? "var(--danger)" : "var(--success)", background: s.manual ? "color-mix(in srgb, var(--danger) 8%, transparent)" : "color-mix(in srgb, var(--success) 8%, transparent)", border: `1px solid ${s.manual ? "color-mix(in srgb, var(--danger) 25%, transparent)" : "color-mix(in srgb, var(--success) 20%, transparent)"}`, padding: "2px 7px", borderRadius: 5, flexShrink: 0, whiteSpace: "nowrap" }}>
                              {s.manual ? "Em atendimento" : "Bot atendendo"}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: hasNovaMsg ? "var(--success)" : "var(--foreground-muted)", fontWeight: hasNovaMsg ? 800 : 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: hasNovaMsg ? 28 : 0 }}>
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
                  <div style={{ fontSize: 13, fontWeight: 800, color: "var(--border-strong)" }}>Selecione uma conversa</div>
                </div>
              ) : (() => {
                const s = sessoes.find(x => x.phone === sessaoAtiva)
                if (!s) return (
                  <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ color: "var(--border-strong)", fontSize: 13, fontWeight: 700 }}>Conversa encerrada</span>
                  </div>
                )
                const displayName = s.customerName || `…${s.lastDigits}`
                const initial = ((s.customerName || s.lastDigits || "?")[0]).toUpperCase()
                const canSend = s.manual && !!(mensagemHumana[s.phone] || "").trim()

                return (
                  <>
                    {/* Header da conversa */}
                    <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--background)", display: "flex", alignItems: "center", gap: 8, flexShrink: 0, background: "var(--background)" }}>
                      <button className="cb-mob-back" onClick={() => setSessaoAtiva(null)} style={{ background: "none", border: "none", color: "var(--brand-text)", fontSize: 20, lineHeight: 1, padding: "0 4px", cursor: "pointer", flexShrink: 0 }}>←</button>
                      <div style={{ width: 34, height: 34, borderRadius: "50%", flexShrink: 0, background: s.manual ? "color-mix(in srgb, var(--danger) 13%, transparent)" : s.postOrderPriority ? "color-mix(in srgb, var(--primary) 13%, transparent)" : "color-mix(in srgb, var(--primary) 10%, transparent)", border: `1.5px solid ${s.manual ? "color-mix(in srgb, var(--danger) 30%, transparent)" : s.postOrderPriority ? "color-mix(in srgb, var(--primary) 30%, transparent)" : "color-mix(in srgb, var(--primary) 25%, transparent)"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 900, color: s.manual ? "var(--danger)" : s.postOrderPriority ? "var(--brand-text)" : "var(--brand-text)" }}>
                        {initial}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 900, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayName}</div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: s.manual ? "var(--danger)" : s.postOrderPriority ? "var(--brand-text)" : "var(--success)" }}>
                          {s.manual ? "Atendimento humano" : s.postOrderPriority ? "Bot respondendo · pós-pedido" : "Robô atendendo"} · {s.stepLabel}
                        </div>
                      </div>
                      {/* Botões de ação — Arquivar sempre na 1ª posição para garantir visibilidade */}
                      {s.manual ? (
                        <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                          <button onClick={() => arquivarConversa(s.phone, s.step)} disabled={arquivandoConversa === s.phone} title="Arquivar conversa. Histórico preservado." style={{ height: 30, padding: "0 9px", border: "1px solid color-mix(in srgb, var(--danger) 35%, transparent)", borderRadius: 8, background: "color-mix(in srgb, var(--danger) 9%, transparent)", color: "var(--danger)", fontSize: 11, fontWeight: 800 }}>
                            {arquivandoConversa === s.phone ? "..." : "📦 Arquivar"}
                          </button>
                          <button onClick={() => abrirPedidoCombinado(s.phone)} disabled={carregandoPedidoCombinado && pedidoCombinadoPhone === s.phone} style={{ height: 30, padding: "0 9px", border: "none", borderRadius: 8, background: "var(--success)", color: "var(--background)", fontSize: 11, fontWeight: 900 }}>
                            {carregandoPedidoCombinado && pedidoCombinadoPhone === s.phone ? "..." : "🧾 Pedido"}
                          </button>
                          <button onClick={() => devolverSessaoParaBot(s.phone)} disabled={devolvendoSessaoBot === s.phone} style={{ height: 30, padding: "0 9px", border: "none", borderRadius: 8, background: "var(--info)", color: "var(--foreground)", fontSize: 11, fontWeight: 900 }}>
                            {devolvendoSessaoBot === s.phone ? "..." : "🤖 Robô"}
                          </button>
                          <button onClick={() => reviverConversa(s.phone)} disabled={revivendoConversa === s.phone} title="Reativa o bot. Não envia mensagem ao cliente." style={{ height: 30, padding: "0 8px", border: "1px solid color-mix(in srgb, var(--primary) 35%, transparent)", borderRadius: 8, background: "color-mix(in srgb, var(--primary) 8%, transparent)", color: "var(--brand-text)", fontSize: 11, fontWeight: 800 }}>
                            {revivendoConversa === s.phone ? "..." : "🔄"}
                          </button>
                        </div>
                      ) : s.postOrderPriority ? (
                        <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                          <button onClick={() => arquivarConversa(s.phone, s.step)} disabled={arquivandoConversa === s.phone} title="Arquivar conversa. Histórico preservado." style={{ height: 30, padding: "0 9px", border: "1px solid color-mix(in srgb, var(--danger) 35%, transparent)", borderRadius: 8, background: "color-mix(in srgb, var(--danger) 9%, transparent)", color: "var(--danger)", fontSize: 11, fontWeight: 800 }}>
                            {arquivandoConversa === s.phone ? "..." : "📦 Arquivar"}
                          </button>
                          <button onClick={() => assumirSessao(s.phone)} disabled={assumindoSessao === s.phone} style={{ height: 30, padding: "0 12px", border: "2px solid var(--primary)", borderRadius: 8, background: "var(--primary)", color: 'var(--primary-foreground)', fontSize: 11, fontWeight: 900, boxShadow: "0 0 10px color-mix(in srgb, var(--primary) 40%, transparent)" }}>
                            {assumindoSessao === s.phone ? "..." : "Assumir e responder"}
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => arquivarConversa(s.phone, s.step)} disabled={arquivandoConversa === s.phone} title="Arquivar conversa. Histórico preservado." style={{ height: 30, padding: "0 9px", border: "1px solid color-mix(in srgb, var(--danger) 35%, transparent)", borderRadius: 8, background: "color-mix(in srgb, var(--danger) 9%, transparent)", color: "var(--danger)", fontSize: 11, fontWeight: 800, flexShrink: 0 }}>
                          {arquivandoConversa === s.phone ? "..." : "📦 Arquivar"}
                        </button>
                      )}
                    </div>

                    {/* Resumo rápido compacto (só quando há dados relevantes) */}
                    {s.manual && s.resumoRapido && (s.resumoRapido.cliente || s.resumoRapido.itens.length > 0 || s.resumoRapido.total > 0) && (
                      <div style={{ padding: "6px 14px", background: "color-mix(in srgb, var(--primary) 4%, transparent)", borderBottom: "1px solid var(--background)", display: "flex", alignItems: "center", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
                        {s.resumoRapido.cliente && <span style={{ fontSize: 11, fontWeight: 800, color: "var(--foreground-secondary)" }}>{s.resumoRapido.cliente}</span>}
                        {s.resumoRapido.itens.length > 0 && <span style={{ fontSize: 11, color: "var(--foreground-muted)" }}>· {s.resumoRapido.itens.slice(0, 2).join(", ")}{s.resumoRapido.itens.length > 2 ? `... +${s.resumoRapido.itens.length - 2}` : ""}</span>}
                        {s.resumoRapido.total > 0 && <span style={{ fontSize: 11, fontWeight: 900, color: "var(--success)", marginLeft: "auto" }}>R$ {s.resumoRapido.total.toFixed(2).replace(".", ",")}</span>}
                        {s.resumoRapido.pendencias.length > 0 && <span style={{ fontSize: 10, fontWeight: 900, color: "var(--brand-text)" }}>⚠ {s.resumoRapido.pendencias.length} pendência{s.resumoRapido.pendencias.length > 1 ? "s" : ""}</span>}
                      </div>
                    )}

                    {/* Área de mensagens */}
                    <div
                      ref={chatMsgAreaRef}
                      className="cb-chat-msg-area"
                      onScroll={() => {
                        const el = chatMsgAreaRef.current
                        if (!el) return
                        const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
                        isNearBottomRef.current = nearBottom
                        if (nearBottom && novasMsgCount > 0) setNovasMsgCount(0)
                      }}
                    >
                      {historicoMsgs.length === 0 ? (
                        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", paddingBottom: 8 }}>
                          {s.ultimaMensagem ? (
                            <>
                              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--border-strong)", textAlign: "center", marginBottom: 8 }}>Histórico não disponível · última mensagem recebida</div>
                              <div style={{ background: "var(--background)", border: "1px solid var(--surface-secondary)", borderRadius: 14, borderBottomLeftRadius: 4, padding: "9px 13px", maxWidth: "78%", alignSelf: "flex-start" }}>
                                <div style={{ fontSize: 13, color: "var(--foreground-secondary)", lineHeight: 1.5 }}>{s.ultimaMensagem}</div>
                              </div>
                            </>
                          ) : (
                            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <span style={{ fontSize: 12, color: "var(--border-strong)", fontWeight: 700 }}>Sem mensagens registradas</span>
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
                              <span style={{ fontSize: 9, fontWeight: 700, color: isAtendente ? "var(--brand-text)" : "var(--foreground-muted)", marginBottom: 2, paddingRight: 4 }}>
                                {isAtendente ? (userName || "Atendente") : "🤖 Bot"}
                              </span>
                            )}
                            <div style={{ maxWidth: "76%", background: isCliente ? "var(--background)" : isAtendente ? "color-mix(in srgb, var(--primary) 15%, transparent)" : "var(--info-soft)", border: `1px solid ${isCliente ? "var(--surface-secondary)" : isAtendente ? "color-mix(in srgb, var(--primary) 30%, transparent)" : "var(--info-soft)"}`, borderRadius: 14, borderBottomLeftRadius: isCliente ? 4 : 14, borderBottomRightRadius: isCliente ? 14 : 4, padding: "8px 12px" }}>
                              <div style={{ fontSize: 13, color: isCliente ? "var(--foreground-secondary)" : isAtendente ? "var(--foreground)" : "var(--info)", lineHeight: 1.5, wordBreak: "break-word" }}>{textoLimpo}</div>
                            </div>
                            {ts && <span style={{ fontSize: 9, color: "var(--border-strong)", fontWeight: 600, marginTop: 2, paddingLeft: isCliente ? 4 : 0, paddingRight: isCliente ? 0 : 4 }}>{ts}</span>}
                          </div>
                        )
                      })}
                      {novasMsgCount > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            historicoBottomRef.current?.scrollIntoView({ behavior: "smooth" })
                            isNearBottomRef.current = true
                            setNovasMsgCount(0)
                          }}
                          style={{
                            position: "sticky",
                            bottom: 10,
                            alignSelf: "center",
                            background: "var(--whatsapp)",
                            color: 'var(--whatsapp-foreground)',
                            border: 0,
                            borderRadius: 20,
                            padding: "5px 14px",
                            fontSize: 12,
                            fontWeight: 900,
                            cursor: "pointer",
                            boxShadow: "0 2px 10px rgba(0,0,0,.4)",
                            userSelect: "none",
                            zIndex: 5,
                            fontFamily: "inherit",
                          }}
                        >
                          {novasMsgCount === 1 ? "1 nova mensagem" : `${novasMsgCount} novas mensagens`} ↓
                        </button>
                      )}
                      <div ref={historicoBottomRef} />
                    </div>

                    {/* Carrinho (barra compacta) */}
                    {s.cart && s.cart.length > 0 && (
                      <div style={{ padding: "5px 14px", borderTop: "1px solid var(--background)", background: "var(--background)", fontSize: 11, color: "var(--foreground-muted)", fontWeight: 600, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        🛒 {s.cart.join(" · ")}
                      </div>
                    )}

                    {/* Input de resposta */}
                    {s.manual ? (
                      <div style={{ padding: "10px 12px", borderTop: "1px solid var(--background)", display: "flex", gap: 8, alignItems: "flex-end", flexShrink: 0, background: "var(--background)" }}>
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
                            <span style={{ color: "var(--danger)", fontSize: 11, fontWeight: 600, display: "block", marginTop: 3 }}>{erroEnvioMensagem[s.phone]}</span>
                          )}
                        </div>
                        <button
                          onClick={() => enviarMensagemHumana(s.phone)}
                          disabled={enviandoMensagem === s.phone || !canSend}
                          style={{ width: 42, height: 42, border: "none", borderRadius: 10, flexShrink: 0, background: enviandoMensagem === s.phone || !canSend ? "var(--surface-secondary)" : "var(--whatsapp)", color: enviandoMensagem === s.phone || !canSend ? "var(--border-strong)" : "var(--foreground)", display: "flex", alignItems: "center", justifyContent: "center", transition: "background .15s", cursor: enviandoMensagem === s.phone || !canSend ? "not-allowed" : "pointer" }}
                        >
                          {enviandoMensagem === s.phone
                            ? <span style={{ fontSize: 10, fontWeight: 900 }}>...</span>
                            : <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M22 2L11 13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/><path d="M22 2L15 22l-4-9-9-4 20-7z" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          }
                        </button>
                      </div>
                    ) : (
                      <div style={{ padding: "10px 12px", borderTop: "1px solid var(--background)", background: "var(--background)", flexShrink: 0, textAlign: "center" }}>
                        {s.postOrderPriority ? (
                          <span style={{ fontSize: 12, color: "var(--brand-text)", fontWeight: 700 }}>Bot respondendo · clique em Atender se precisar intervir</span>
                        ) : (
                          <button onClick={() => assumirSessao(s.phone)} disabled={assumindoSessao === s.phone} style={{ height: 30, padding: "0 16px", border: "1px solid color-mix(in srgb, var(--foreground-secondary) 15%, transparent)", borderRadius: 8, background: "color-mix(in srgb, var(--foreground-secondary) 6%, transparent)", color: "var(--foreground-secondary)", fontSize: 12, fontWeight: 700 }}>
                            {assumindoSessao === s.phone ? "..." : "Assumir e responder"}
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
            <div style={{ background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 20, padding: "36px 20px", textAlign: "center" }}>
              <span style={{ fontSize: 17, fontWeight: 900, color: "var(--foreground-secondary)", display: "block" }}>Nada por aqui</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground-secondary)", display: "block", marginTop: 4 }}>Nenhum pedido nesse estado agora.</span>
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
            const timerColor = isNovo ? (minsDesde < 3 ? "var(--success)" : minsDesde < 7 ? "var(--primary)" : "var(--danger)") : isDone ? "var(--success)" : minsPrep < 20 ? "var(--success)" : minsPrep < 34 ? "var(--primary)" : "var(--danger)"
            const firstName = pedido.cliente.split(" ")[0]
            const pagamento = pedido.pagamento || ""
            const isPix = pagamento.toLowerCase().includes("pix")
            const hibridoParts = parseHybridPayment(pagamento)
            const pixPendente = isPix && !pedido.pixConfirmado && pedido.status === "novo"
            const pixEmRevisaoOuSuspeito = isPix && !pedido.pixConfirmado && labelPixRevisaoOuSuspeito(pedido)
            const isRetirada = !isDineIn && (!pedido.tipoEntrega || pedido.tipoEntrega === "pickup" || pedido.tipoEntrega === "retirada" || pedido.endereco === "Retirada na loja")
            const emEdicao = pedidoEmEdicao(pedido)
            const foiEditado = pedidoFoiEditado(pedido)

            let rowBorder = sc.accentBorder
            if (pedido.escalonado) rowBorder = "color-mix(in srgb, var(--danger) 70%, transparent)"
            if (pedido.cancelamentoSolicitado) rowBorder = "color-mix(in srgb, var(--danger) 50%, transparent)"
            if (isDone) rowBorder = "color-mix(in srgb, var(--success) 30%, transparent)"
            if (isCanceled) rowBorder = "color-mix(in srgb, var(--danger) 20%, transparent)"

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
                  background: isSelected ? "var(--background)" : "var(--background)",
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
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: isDone ? "var(--success)" : isCanceled ? "var(--danger)" : sc.accent, boxShadow: isDone || isCanceled ? "none" : `0 0 6px color-mix(in srgb, ${sc.accent} 33%, transparent)` }} />
                  </div>

                  {/* Conteúdo principal */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Linha 1: nome + badges + timer */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                      {pedido.numero != null && <span style={{ fontSize: 10, fontWeight: 900, color: "var(--border-strong)", flexShrink: 0 }}>#{pedido.numero}</span>}
                      <span style={{ fontSize: 14, fontWeight: 900, color: "var(--text-primary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{firstName}</span>
                      {pedido.escalonado && <span style={{ fontSize: 11, flexShrink: 0 }}>🚨</span>}
                      {pedido.origem === "painel" && <span style={{ fontSize: 9, fontWeight: 900, color: "var(--brand-text)", background: "color-mix(in srgb, var(--primary) 14%, transparent)", padding: "2px 5px", borderRadius: 5, flexShrink: 0 }}>🧑‍🍳 Painel</span>}
                      {(pedido.origem === "site" || pedido.origem === "app") && <span style={{ fontSize: 9, fontWeight: 900, color: "var(--info)", background: "color-mix(in srgb, var(--info) 12%, transparent)", padding: "2px 5px", borderRadius: 5, flexShrink: 0 }}>🌐 Site</span>}
                      {pixPendente && <span style={{ fontSize: 9, fontWeight: 900, color: "var(--attention-text)", background: "var(--attention-surface)", padding: "2px 5px", borderRadius: 5, flexShrink: 0 }}>{hibridoParts ? "PIX parcial ⏳" : "PIX⏳"}</span>}
                      {pixEmRevisaoOuSuspeito && <span style={{ fontSize: 9, fontWeight: 900, color: pedido.pix?.status === "suspeito" ? "var(--danger)" : "var(--attention-text)", background: pedido.pix?.status === "suspeito" ? "color-mix(in srgb, var(--danger) 12%, transparent)" : "var(--attention-surface)", padding: "2px 5px", borderRadius: 5, flexShrink: 0 }}>{pixEmRevisaoOuSuspeito}</span>}
                      {emEdicao && <span style={{ fontSize: 9, fontWeight: 900, color: "var(--info)", background: "color-mix(in srgb, var(--info) 14%, transparent)", padding: "2px 5px", borderRadius: 5, flexShrink: 0 }}>✎ Cliente editando</span>}
                      {!emEdicao && foiEditado && <span style={{ fontSize: 9, fontWeight: 900, color: "var(--attention-text)", background: "var(--attention-surface)", padding: "2px 5px", borderRadius: 5, flexShrink: 0 }}>✎ Alterado pelo cliente</span>}
                      {pedido.cancelamentoSolicitado && <span style={{ fontSize: 11, flexShrink: 0 }}>⚠️</span>}
                      <span style={{ fontSize: 10, fontWeight: 900, color: pixPendente ? "var(--attention-text)" : (isPix && pedido.pixConfirmado && pedido.status === "novo" ? "var(--success)" : sc.accent), background: pixPendente ? "var(--attention-surface)" : (isPix && pedido.pixConfirmado && pedido.status === "novo" ? "color-mix(in srgb, var(--success) 12%, transparent)" : sc.accentBg), padding: "2px 7px", borderRadius: 6, border: `1px solid ${pixPendente ? "var(--attention-border)" : (isPix && pedido.pixConfirmado && pedido.status === "novo" ? "color-mix(in srgb, var(--success) 35%, transparent)" : sc.accentBorder)}`, textTransform: "uppercase", letterSpacing: ".4px", flexShrink: 0 }}>{pixPendente ? (hibridoParts ? "Aguardando Pix parcial" : "Aguardando Pix") : (isPix && pedido.pixConfirmado && pedido.status === "novo" ? (hibridoParts ? "Pix parcial pago" : "Pago") : sc.label)}</span>
                    </div>

                    {/* Linha 2: infos compactas */}
                    <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, color: "var(--foreground-muted)", marginBottom: 9 }}>
                      <span style={{ flexShrink: 0 }}>{isDineIn ? "🍽️" : isRetirada ? "🏪" : "🛵"}</span>
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--foreground-muted)" }}>{isDineIn ? "No local" : isRetirada ? "Retirada" : (pedido.bairro || pedido.endereco || "—")}</span>
                      <span style={{ flexShrink: 0, color: "var(--border-strong)" }}>·</span>
                      <span style={{ flexShrink: 0 }}>{pedido.itens.length}it</span>
                      <span style={{ flexShrink: 0, color: "var(--border-strong)" }}>·</span>
                      <span style={{ flexShrink: 0, color: isPix ? "var(--success)" : "var(--foreground-muted)" }}>{isPix ? "Pix" : (pagamento.split(" ")[0] || "—")}</span>
                      <span style={{ flexShrink: 0, color: "var(--border-strong)" }}>·</span>
                      <span style={{ flexShrink: 0, fontWeight: 900, color: "var(--foreground-secondary)" }}>R${pedido.total.toFixed(2).replace(".", ",")}</span>
                      <span style={{ flexShrink: 0, fontWeight: 900, color: timerColor, marginLeft: 2, fontSize: 11 }}>{timerMins}m</span>
                    </div>

                    {/* Aviso de edição em andamento — pedido continua na fila, só o aceite fica bloqueado */}
                    {emEdicao && (
                      <div style={{ marginBottom: 8, padding: "6px 10px", borderRadius: 8, background: "color-mix(in srgb, var(--info) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--info) 30%, transparent)" }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: "var(--info)" }}>O cliente está alterando este pedido. Aguarde a finalização para revisar e aceitar.</span>
                      </div>
                    )}
                    {!emEdicao && foiEditado && (
                      <div style={{ marginBottom: 8, padding: "6px 10px", borderRadius: 8, background: "var(--attention-surface)", border: "1px solid var(--attention-border)" }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: "var(--attention-text)" }}>Revise as alterações antes de aceitar.</span>
                      </div>
                    )}

                    {/* Linha 3: botão de ação */}
                    <div onClick={e => e.stopPropagation()}>
                      {pedido.escalonado && (
                        <button
                          onClick={() => { assumirConversa(pedido.telefone); setCardUrgenciaFechado(true) }}
                          style={{ height: 30, padding: "0 14px", border: "none", borderRadius: 8, background: "var(--danger)", color: "var(--foreground)", fontSize: 12, fontWeight: 900 }}
                        >🚨 Assumir conversa</button>
                      )}
                      {!pedido.escalonado && pixPendente && !emEdicao && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-start" }}>
                          <button
                            onClick={() => abrirVerificacaoPix(pedido.id)}
                            style={{ height: 30, padding: "0 14px", border: "1px solid var(--attention-border)", borderRadius: 8, background: "var(--attention-surface)", color: "var(--attention-text)", fontSize: 12, fontWeight: 900 }}
                          >VERIFICAR PAGAMENTO</button>
                          <span style={{ fontSize: 9, fontWeight: 800, color: "var(--foreground-muted)", textTransform: "uppercase", letterSpacing: ".3px" }}>Ação manual de exceção</span>
                        </div>
                      )}
                      {!pedido.escalonado && !pixPendente && !isDone && !isCanceled && nextStatus && (
                        <button
                          onClick={() => {
                            if (emEdicao) return
                            if (nextStatus === "saiu_entrega" && entregadores.length > 0 && pedido.tipoEntrega !== "pickup") {
                              setModalEntrega({ pedidoId: pedido.id, proxStatus: nextStatus })
                            } else {
                              avancarStatus(pedido.id, nextStatus)
                            }
                          }}
                          disabled={atualizando === pedido.id || emEdicao}
                          title={emEdicao ? "Aguarde o cliente concluir a edição" : undefined}
                          style={{ height: 30, padding: "0 14px", border: "none", borderRadius: 8, background: emEdicao ? "var(--surface-secondary)" : sc.btnBg, color: emEdicao ? "var(--foreground-muted)" : sc.btnFg, fontSize: 12, fontWeight: 900, opacity: atualizando === pedido.id ? 0.6 : 1, cursor: emEdicao ? "not-allowed" : "pointer" }}
                        >
                          {atualizando === pedido.id ? "..." : emEdicao ? "Edição em andamento" : getActionLabel(pedido)}
                        </button>
                      )}
                      {isDone && <span style={{ fontSize: 11, fontWeight: 800, color: "var(--success)" }}>✓ Entregue</span>}
                      {isCanceled && <span style={{ fontSize: 11, fontWeight: 800, color: "var(--foreground-muted)" }}>✗ Cancelado</span>}
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
        <div style={{ position: "fixed", bottom: 96, left: 0, right: 0, margin: "0 auto", width: "calc(100% - 32px)", maxWidth: 343, background: "var(--surface)", border: "1px solid var(--surface-elevated)", borderRadius: 16, padding: "12px 12px 12px 16px", display: "flex", alignItems: "center", gap: 12, animation: "cbToastIn .25s ease both", zIndex: 50, boxShadow: "0 12px 32px rgba(0,0,0,.55)" }}>
          <span style={{ flex: 1, fontSize: 14, fontWeight: 800, letterSpacing: "-0.2px" }}>{toast?.text}</span>
          <button onClick={desfazerToast} style={{ border: "none", background: "color-mix(in srgb, var(--primary) 16%, transparent)", color: "var(--brand-text)", fontWeight: 900, fontSize: 14, padding: "11px 14px", borderRadius: 11, flexShrink: 0 }}>Desfazer · {toastSegs}</button>
        </div>
      )}

      {/* Simple Toast */}
      {simpleToast && (
        <div style={{ position: "fixed", bottom: 96, left: 0, right: 0, margin: "0 auto", width: "calc(100% - 32px)", maxWidth: 343, background: "var(--surface)", border: "1px solid color-mix(in srgb, var(--primary) 30%, transparent)", borderRadius: 16, padding: "14px 16px", animation: "cbToastIn .25s ease both", zIndex: 50, boxShadow: "0 12px 32px rgba(0,0,0,.55)" }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: "var(--brand-text)" }}>{simpleToast}</span>
        </div>
      )}

      {/* Bottom sheet detalhe — mobile only */}
        {detalhePedido && (
          <div className="cb-mob-sheet-wrap">
            <div onClick={() => setDetailId(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.62)", zIndex: 60, animation: "cbFadeIn .2s ease both" }} />
            <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, margin: "0 auto", maxWidth: 375, background: "var(--background)", border: "1px solid var(--surface-secondary)", borderBottom: "none", borderRadius: "26px 26px 0 0", zIndex: 61, animation: "cbSheetUp .32s cubic-bezier(.2,.9,.3,1) both", padding: "10px 20px 26px", display: "flex", flexDirection: "column", gap: 12, maxHeight: "88vh", overflowY: "auto" }}>
              <div style={{ width: 44, height: 5, borderRadius: 3, background: "var(--surface-elevated)", margin: "2px auto 0", flexShrink: 0 }} />
              {renderDetalhe(detalhePedido)}
            </div>
          </div>
        )}

        {/* Modal entregador */}
        {modalEntrega && (
          <>
            <div onClick={() => setModalEntrega(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.62)", zIndex: 60, animation: "cbFadeIn .2s ease both" }} />
            <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, margin: "0 auto", maxWidth: 375, background: "var(--background)", border: "1px solid var(--surface-secondary)", borderBottom: "none", borderRadius: "26px 26px 0 0", zIndex: 61, animation: "cbSheetUp .32s cubic-bezier(.2,.9,.3,1) both", padding: "20px 20px 36px", display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ width: 44, height: 5, borderRadius: 3, background: "var(--surface-elevated)", margin: "0 auto 6px" }} />
              <p style={{ margin: 0, fontSize: 18, fontWeight: 900, letterSpacing: "-0.3px" }}>Selecionar entregador</p>
              {entregadores.filter(e => e.ativo).map(e => (<button key={e.id} onClick={() => avancarStatus(modalEntrega.pedidoId, modalEntrega.proxStatus, e)} style={{ height: 56, border: "1px solid var(--surface-secondary)", borderRadius: 16, background: "var(--surface)", color: "var(--foreground)", fontSize: 16, fontWeight: 800, textAlign: "left", padding: "0 16px" }}>{e.nome}</button>))}
              <button onClick={() => avancarStatus(modalEntrega.pedidoId, modalEntrega.proxStatus)} style={{ height: 48, border: "1px solid var(--border)", borderRadius: 14, background: "transparent", color: "var(--foreground-secondary)", fontSize: 14, fontWeight: 800 }}>Sem entregador</button>
            </div>
          </>
        )}

        {/* Confirmação: arquivar entregues — decisão de sim/não, resolvida
            sem rolar (ver @/components/ConfirmDialog). */}
        <ConfirmDialog
          aberto={modalLimpar}
          titulo="Arquivar todos os pedidos entregues?"
          descricao="Pedidos em aberto não são afetados."
          confirmarLabel="Sim, arquivar"
          tom="perigo"
          ocupado={limpando}
          ocupadoLabel="Arquivando..."
          onConfirmar={limparHistorico}
          onCancelar={() => setModalLimpar(false)}
        />

        {/* Confirmação: arquivar não resolvidos. */}
        <ConfirmDialog
          aberto={modalArquivarExpediente}
          titulo="Arquivar os pedidos não resolvidos?"
          descricao="Pendentes, em preparo, na rua, aguardando Pix e conversas abertas vão para a aba Arquivados. Entregues e cancelados não são afetados, e nenhum dado é apagado."
          confirmarLabel="Sim, arquivar"
          tom="atencao"
          ocupado={arquivandoExpediente}
          ocupadoLabel="Arquivando..."
          onConfirmar={arquivarExpediente}
          onCancelar={() => setModalArquivarExpediente(false)}
        />

      {/* Editar forma de pagamento (administrativo) — troca controlada, nunca confirma Pix sozinha */}
      {modalEditarPagamento && (() => {
        const pedidoModal = pedidos.find(p => p.id === modalEditarPagamento)
        const dinheiroSelecionado = /dinheiro/i.test(formEditarPagamento.pagamento)
        return (
          <div ref={editarPagamentoRef} role="dialog" aria-modal="true" aria-label="Editar forma de pagamento" style={{ position: "fixed", inset: 0, zIndex: 3200, background: "rgba(var(--overlay-rgb), 0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
            <div style={{ background: "var(--surface)", borderRadius: 18, padding: 20, width: "100%", maxWidth: 380, display: "flex", flexDirection: "column", gap: 12 }}>
              <p style={{ fontSize: 16, fontWeight: 900, margin: 0, color: "var(--foreground)" }}>Editar forma de pagamento</p>
              {pedidoModal && (
                <p style={{ fontSize: 12.5, color: "var(--foreground-secondary)", margin: 0 }}>
                  Pedido {pedidoModal.numero != null ? `#${pedidoModal.numero}` : pedidoModal.id} · {pedidoModal.cliente} · R$ {pedidoModal.total.toFixed(2).replace(".", ",")}
                </p>
              )}
              <div>
                <label style={labelStyle}>Forma de pagamento</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {["Pix", "Dinheiro", "Cartão", "Misto"].map(opt => (
                    <button
                      key={opt}
                      onClick={() => setFormEditarPagamento(f => ({ ...f, pagamento: opt }))}
                      style={{ height: 36, padding: "0 14px", border: `1px solid ${formEditarPagamento.pagamento === opt ? "var(--primary)" : "var(--surface-secondary)"}`, borderRadius: 10, background: formEditarPagamento.pagamento === opt ? "color-mix(in srgb, var(--primary) 15%, transparent)" : "transparent", color: "var(--foreground)", fontSize: 12, fontWeight: 900 }}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
              {dinheiroSelecionado && (
                <div>
                  <label style={labelStyle}>Troco</label>
                  <input className="cbInput" value={formEditarPagamento.troco} onChange={e => setFormEditarPagamento(f => ({ ...f, troco: e.target.value }))} placeholder="Sem troco, ou troco para quanto" style={inputStyle} />
                </div>
              )}
              {erroEdicaoPagamento && (
                <p role="alert" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--danger)", margin: 0 }}>{erroEdicaoPagamento}</p>
              )}
              <p style={{ fontSize: 11, color: "var(--foreground-muted)", margin: 0 }}>
                Trocar para Pix cria uma cobrança pendente nova — nunca confirma o pagamento sozinho.
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={fecharEditarPagamento} disabled={salvandoEdicaoPagamento} style={{ flex: 1, height: 46, border: "1px solid var(--surface-secondary)", borderRadius: 12, background: "transparent", color: "var(--foreground-secondary)", fontSize: 14, fontWeight: 800 }}>Cancelar</button>
                <button
                  onClick={salvarEdicaoPagamento}
                  disabled={salvandoEdicaoPagamento || !formEditarPagamento.pagamento.trim() || (dinheiroSelecionado && !formEditarPagamento.troco.trim())}
                  style={{ flex: 2, height: 46, border: "none", borderRadius: 12, background: "var(--primary)", color: "var(--background)", fontSize: 14, fontWeight: 900, opacity: (salvandoEdicaoPagamento || !formEditarPagamento.pagamento.trim() || (dinheiroSelecionado && !formEditarPagamento.troco.trim())) ? 0.5 : 1 }}
                >
                  {salvandoEdicaoPagamento ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Modal de segurança — Verificar pagamento Pix manualmente */}
      {confirmPixModal && (() => {
        const pedidoModal = pedidos.find(p => p.id === confirmPixModal)
        if (!pedidoModal) return null
        const valorEsperado = pedidoModal.pix?.valorEsperado ?? pedidoModal.total
        const valorFormatado = formatarValorReais(valorEsperado)
        const checklistItens: Array<{ chave: keyof typeof pixChecklist; texto: string }> = [
          { chave: "conferiu", texto: "Conferi a entrada do dinheiro no banco ou Mercado Pago." },
          { chave: "valorBate", texto: `O valor recebido é exatamente ${valorFormatado}.` },
          { chave: "clienteCorreto", texto: `O pagamento corresponde ao cliente ${pedidoModal.cliente} e a este pedido.` },
        ]
        const faltando: string[] = []
        if (!checklistCompleto) faltando.push("marcar os três itens do checklist")
        if (!pixSenha) faltando.push("digitar sua senha")
        return (
          <>
            <div onClick={fecharVerificacaoPix} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.8)", zIndex: 300, animation: "cbFadeIn .2s ease both" }} />
            <div
              ref={pixModalRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="pix-modal-titulo"
              tabIndex={-1}
              style={{
                position: "fixed", inset: 0, zIndex: 301, display: "flex", alignItems: "flex-end", justifyContent: "center",
                padding: 0, outline: "none",
              }}
            >
              <div style={{
                width: "100%", maxWidth: 560, maxHeight: "92vh", overflowY: "auto",
                background: "var(--background)", border: "1.5px solid var(--attention-border)",
                borderBottom: "none", borderRadius: "26px 26px 0 0",
                animation: "cbSheetUp .32s cubic-bezier(.2,.9,.3,1) both",
                padding: "22px 22px 32px", display: "flex", flexDirection: "column", gap: 18,
                boxSizing: "border-box",
              }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ width: 44, height: 5, borderRadius: 3, background: "var(--surface-elevated)", margin: "0 auto" }} />
                  <button
                    onClick={fecharVerificacaoPix}
                    aria-label="Fechar sem confirmar"
                    disabled={pixConfirmando}
                    style={{ position: "absolute", top: 16, right: 16, width: 36, height: 36, border: "none", borderRadius: 10, background: "rgba(var(--overlay-rgb), 0.06)", color: "var(--foreground-secondary)", fontSize: 18, fontWeight: 900, cursor: pixConfirmando ? "not-allowed" : "pointer" }}
                  >✕</button>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8, textAlign: "center" }}>
                  <div style={{ fontSize: 32, lineHeight: 1 }} aria-hidden="true">⚠️</div>
                  <h2 id="pix-modal-titulo" style={{ margin: 0, fontSize: 24, fontWeight: 900, letterSpacing: "-0.6px", lineHeight: 1.15 }}>O DINHEIRO JÁ ENTROU NA CONTA?</h2>
                  <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "var(--attention-text)" }}>Este Pix ainda NÃO foi confirmado pelo banco.</p>
                </div>

                <div style={{ background: "var(--attention-surface)", border: "1.5px solid var(--attention-border)", borderRadius: 14, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 900, color: "var(--attention-text)", lineHeight: 1.5 }}>Não confirme apenas porque o cliente enviou um comprovante.</p>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--attention-text)", lineHeight: 1.5 }}>Abra o banco ou Mercado Pago e confira se o valor realmente entrou antes de continuar.</p>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8, background: "var(--surface)", border: "1px solid var(--surface-secondary)", borderRadius: 14, padding: "14px 16px" }}>
                  <Row label="Pedido" value={pedidoModal.numero != null ? `#${pedidoModal.numero}` : pedidoModal.id} />
                  <Row label="Cliente" value={pedidoModal.cliente} />
                  <Row label="Pagamento" value="Pix" />
                  <Row label="Provider" value={pedidoModal.pix?.provider === "mercadopago" ? "Mercado Pago" : "Pix manual"} />
                  <Row label="Status" value="Ainda não confirmado" />
                  <Row label="Pedido criado às" value={pedidoModal.horario} />
                  <div style={{ borderTop: "1px solid var(--surface-secondary)", marginTop: 4, paddingTop: 10, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                    <span style={{ fontSize: 11, fontWeight: 900, color: "var(--foreground-muted)", textTransform: "uppercase", letterSpacing: ".6px" }}>Valor esperado</span>
                    <span style={{ fontSize: 34, fontWeight: 900, letterSpacing: "-0.8px", color: "var(--foreground)" }}>{valorFormatado}</span>
                  </div>
                </div>

                <fieldset style={{ border: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                  <legend style={{ fontSize: 12, fontWeight: 900, color: "var(--foreground-muted)", textTransform: "uppercase", letterSpacing: ".6px", padding: 0, marginBottom: 2 }}>Checklist obrigatório</legend>
                  {checklistItens.map(item => (
                    <label key={item.chave} style={{ display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer", padding: "4px 0" }}>
                      <input
                        type="checkbox"
                        checked={pixChecklist[item.chave]}
                        onChange={e => setPixChecklist(prev => ({ ...prev, [item.chave]: e.target.checked }))}
                        style={{ width: 22, height: 22, marginTop: 1, flexShrink: 0, accentColor: "var(--attention-text)" }}
                      />
                      <span style={{ fontSize: 14, fontWeight: 700, color: "var(--foreground)", lineHeight: 1.5 }}>{item.texto}</span>
                    </label>
                  ))}
                </fieldset>

                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label htmlFor="pix-senha-input" style={{ fontSize: 13, fontWeight: 800, color: "var(--foreground)", lineHeight: 1.5 }}>
                    Digite sua senha para autorizar esta confirmação financeira.
                  </label>
                  <div style={{ position: "relative" }}>
                    <input
                      id="pix-senha-input"
                      ref={pixSenhaInputRef}
                      type={pixSenhaVisivel ? "text" : "password"}
                      value={pixSenha}
                      onChange={e => setPixSenha(e.target.value)}
                      autoComplete="current-password"
                      placeholder="Sua senha"
                      style={{ width: "100%", height: 50, background: "var(--surface)", border: "1px solid var(--surface-secondary)", borderRadius: 12, padding: "0 48px 0 14px", color: "var(--foreground)", fontSize: 15, boxSizing: "border-box", outline: "none" }}
                    />
                    <button
                      type="button"
                      onClick={() => setPixSenhaVisivel(v => !v)}
                      aria-label={pixSenhaVisivel ? "Ocultar senha" : "Mostrar senha"}
                      style={{ position: "absolute", right: 6, top: 6, height: 38, width: 38, border: "none", borderRadius: 8, background: "transparent", color: "var(--foreground-secondary)", fontSize: 13, fontWeight: 800 }}
                    >{pixSenhaVisivel ? "🙈" : "👁️"}</button>
                  </div>
                </div>

                <div aria-live="assertive" role="status">
                  {pixErro && (
                    <div style={{ background: "color-mix(in srgb, var(--danger) 12%, transparent)", border: "1px solid var(--danger)", borderRadius: 12, padding: "10px 14px", fontSize: 13, fontWeight: 800, color: "var(--danger)" }}>
                      {pixErro}
                    </div>
                  )}
                </div>

                {!checklistCompleto || !pixSenha ? (
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "var(--foreground-muted)", textAlign: "center" }}>
                    Falta {faltando.join(" e ")} para liberar a confirmação.
                  </p>
                ) : null}

                <button
                  onClick={() => confirmarPixManual(confirmPixModal)}
                  disabled={!podeConfirmarPix}
                  aria-disabled={!podeConfirmarPix}
                  style={{
                    height: 60, border: "none", borderRadius: 16,
                    background: podeConfirmarPix ? "var(--danger)" : "var(--surface-secondary)",
                    color: podeConfirmarPix ? "var(--foreground)" : "var(--foreground-muted)",
                    fontSize: 16, fontWeight: 900, letterSpacing: "-0.2px",
                    cursor: podeConfirmarPix ? "pointer" : "not-allowed",
                    transition: "background .15s, color .15s",
                  }}
                >
                  {pixConfirmando ? "Confirmando..." : `CONFIRMAR ${valorFormatado} COMO RECEBIDO`}
                </button>
                <button onClick={fecharVerificacaoPix} disabled={pixConfirmando} style={{ height: 46, border: "none", background: "transparent", color: "var(--foreground-secondary)", fontSize: 14, fontWeight: 800, cursor: pixConfirmando ? "not-allowed" : "pointer" }}>
                  Voltar e conferir novamente
                </button>
              </div>
            </div>
          </>
        )
      })()}

      {/* Modal Finalizar Pedido */}
      {/* Confirmação: finalizar pedido em silêncio. */}
      <ConfirmDialog
        aberto={!!finalizarModal}
        titulo="Finalizar pedido?"
        descricao="O pedido é marcado como finalizado no painel. Nenhuma mensagem é enviada ao cliente."
        confirmarLabel="Finalizar"
        tom="sucesso"
        onConfirmar={() => { if (finalizarModal) finalizarPedidoSilencioso(finalizarModal) }}
        onCancelar={() => setFinalizarModal(null)}
      />

      {/* Modal Pedido Combinado */}
      {modalPedidoCombinado && pedidoCombinadoRascunho && (
        <>
          <div onClick={() => { setModalPedidoCombinado(false) }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 70, animation: "cbFadeIn .2s ease both" }} />
          <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, margin: "0 auto", maxWidth: 480, background: "var(--background)", border: "1px solid var(--surface-secondary)", borderBottom: "none", borderRadius: "26px 26px 0 0", zIndex: 71, animation: "cbSheetUp .32s cubic-bezier(.2,.9,.3,1) both", padding: "12px 20px 36px", display: "flex", flexDirection: "column", gap: 14, maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ width: 44, height: 5, borderRadius: 3, background: "var(--surface-elevated)", margin: "0 auto 4px", flexShrink: 0 }} />
            <p style={{ margin: 0, fontSize: 18, fontWeight: 900, letterSpacing: "-0.3px", flexShrink: 0 }}>Revise o pedido antes de enviar para a cozinha</p>

            {/* Itens */}
            <div style={{ background: "var(--background)", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: "var(--foreground-muted)", textTransform: "uppercase", letterSpacing: ".8px" }}>Itens</span>
              {pedidoCombinadoRascunho.itens.length === 0 ? (
                <span style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>Nenhum item</span>
              ) : pedidoCombinadoRascunho.itens.map((item, i) => (
                <div key={i} style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground-secondary)" }}>{getItemIcon(item)} {item}</div>
              ))}
              {pedidoCombinadoRascunho.total > 0 && (
                <div style={{ marginTop: 4, paddingTop: 8, borderTop: "1px solid var(--surface)", fontSize: 14, fontWeight: 900, color: "var(--foreground)" }}>Total: R$ {pedidoCombinadoRascunho.total.toFixed(2).replace(".", ",")}</div>
              )}
            </div>

            {/* Dados do pedido */}
            <div style={{ background: "var(--background)", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 7 }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: "var(--foreground-muted)", textTransform: "uppercase", letterSpacing: ".8px" }}>Dados</span>
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
              <div style={{ background: "color-mix(in srgb, var(--danger) 6%, transparent)", border: "1px solid color-mix(in srgb, var(--danger) 30%, transparent)", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: "var(--danger)", textTransform: "uppercase", letterSpacing: ".8px" }}>Informações que faltam</span>
                {pedidoCombinadoPendencias.map((p, i) => (
                  <div key={i} style={{ fontSize: 13, fontWeight: 700, color: "var(--danger)", display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 10 }}>●</span> {p}
                  </div>
                ))}
                <p style={{ margin: "4px 0 0", fontSize: 12, fontWeight: 600, color: "var(--danger)" }}>Volte para a conversa para pegar as informações que faltam.</p>
              </div>
            )}

            {/* Histórico da conversa */}
            {pedidoCombinadoConversa.length > 0 && (
              <div style={{ background: "var(--background)", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: "var(--foreground-muted)", textTransform: "uppercase", letterSpacing: ".8px" }}>Histórico da conversa</span>
                {pedidoCombinadoConversa.map((m, i) => (
                  <div key={i} style={{ fontSize: 12, color: m.autor === "atendente" ? "var(--info)" : "var(--foreground-secondary)", fontWeight: 600 }}>
                    <span style={{ fontWeight: 800, color: m.autor === "atendente" ? "var(--info)" : "var(--foreground-secondary)" }}>{m.autor === "atendente" ? "Atendente" : "Cliente"}: </span>{m.texto}
                  </div>
                ))}
              </div>
            )}

            {/* Botões */}
            {pedidoCombinadoPendencias.length === 0 && (
              <button
                onClick={criarPedidoCombinado}
                disabled={criandoPedidoCombinado}
                style={{ height: 56, border: "none", borderRadius: 16, background: criandoPedidoCombinado ? "var(--success-soft)" : "var(--success)", color: "var(--background)", fontSize: 16, fontWeight: 900, opacity: criandoPedidoCombinado ? 0.7 : 1 }}
              >{criandoPedidoCombinado ? "Criando..." : "✅ Criar pedido"}</button>
            )}
            <button
              onClick={() => { setModalPedidoCombinado(false) }}
              disabled={criandoPedidoCombinado}
              style={{ height: 46, border: "none", background: "transparent", color: "var(--foreground-secondary)", fontSize: 14, fontWeight: 800 }}
            >← Voltar para conversa</button>
          </div>
        </>
      )}

      {/* OLD_SIDEBAR - REMOVED */}
      {false && <aside style={{ display: "none" }}>
        <div style={{ fontSize: 9, fontWeight: 900, textTransform: "uppercase", letterSpacing: "1.2px", color: "var(--border-strong)", marginBottom: 4 }}>Dashboard</div>

        {/* Bot status */}
        <div style={{ padding: "12px 14px", borderRadius: 13, background: botAtivo ? "color-mix(in srgb, var(--success) 6%, transparent)" : "color-mix(in srgb, var(--primary) 6%, transparent)", border: `1px solid ${botAtivo ? "color-mix(in srgb, var(--success) 25%, transparent)" : "color-mix(in srgb, var(--primary) 28%, transparent)"}`, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: botAtivo ? "var(--success)" : "var(--primary)", flexShrink: 0, animation: botAtivo ? "cbPulse 2s infinite" : "none" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 900, color: "var(--foreground)" }}>{botAtivo ? "Bot atendendo" : "Bot pausado"}</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: botAtivo ? "var(--success)" : "var(--brand-text)", marginTop: 1 }}>{botAtivo ? "WhatsApp ativo" : "Você no comando"}</div>
          </div>
        </div>

        {/* Métricas */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div style={{ background: "var(--surface)", border: "1px solid var(--surface)", borderRadius: 11, padding: "11px 10px" }}>
              <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-1px", lineHeight: 1, color: "var(--foreground)" }}>{totalHoje}</div>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--border-strong)", textTransform: "uppercase", letterSpacing: ".5px", marginTop: 3 }}>Hoje</div>
            </div>
            <div style={{ background: emAberto > 0 ? "var(--background)" : "var(--surface)", border: `1px solid ${emAberto > 0 ? "color-mix(in srgb, var(--primary) 45%, transparent)" : "var(--surface)"}`, borderRadius: 11, padding: "11px 10px" }}>
              <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-1px", lineHeight: 1, color: emAberto > 0 ? "var(--brand-text)" : "var(--border-strong)" }}>{emAberto}</div>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: emAberto > 0 ? "var(--brand-text)" : "var(--border-strong)", textTransform: "uppercase", letterSpacing: ".5px", marginTop: 3 }}>Em aberto</div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div style={{ background: "var(--surface)", border: "1px solid var(--surface)", borderRadius: 11, padding: "11px 10px" }}>
              <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-1px", lineHeight: 1, color: "var(--success)" }}>{pedidos.filter(p => p.status === "entregue").length}</div>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--border-strong)", textTransform: "uppercase", letterSpacing: ".5px", marginTop: 3 }}>Entregues</div>
            </div>
            <div style={{ background: "var(--surface)", border: "1px solid var(--surface)", borderRadius: 11, padding: "11px 10px" }}>
              <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-1px", lineHeight: 1, color: "var(--info)" }}>{tempoMedioPreparo !== null ? `${tempoMedioPreparo}` : "--"}<span style={{ fontSize: 11, fontWeight: 700, marginLeft: 2 }}>{tempoMedioPreparo !== null ? "m" : ""}</span></div>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--border-strong)", textTransform: "uppercase", letterSpacing: ".5px", marginTop: 3 }}>⏱ Média</div>
            </div>
          </div>
        </div>

        {/* Divisor */}
        <div style={{ height: 1, background: "var(--surface)", margin: "4px 0" }} />

        {/* Navegação */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <button
            onClick={() => router.push("/conversas")}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderRadius: 12, border: escalonados.length > 0 ? "1px solid color-mix(in srgb, var(--danger) 35%, transparent)" : "1px solid var(--surface)", background: escalonados.length > 0 ? "color-mix(in srgb, var(--danger) 5%, transparent)" : "var(--surface)", cursor: "pointer", fontFamily: "'Archivo', sans-serif" }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="14" rx="5" stroke={escalonados.length > 0 ? "var(--danger)" : "var(--foreground-muted)"} strokeWidth="2.2"/><circle cx="8.5" cy="11" r="1.4" fill={escalonados.length > 0 ? "var(--danger)" : "var(--foreground-muted)"}/><circle cx="12" cy="11" r="1.4" fill={escalonados.length > 0 ? "var(--danger)" : "var(--foreground-muted)"}/><circle cx="15.5" cy="11" r="1.4" fill={escalonados.length > 0 ? "var(--danger)" : "var(--foreground-muted)"}/></svg>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 800, color: escalonados.length > 0 ? "var(--danger)" : "var(--foreground-secondary)", textAlign: "left" }}>Conversas</span>
            {escalonados.length > 0 && <span style={{ minWidth: 20, height: 20, borderRadius: 10, background: "var(--danger)", color: "var(--foreground)", fontSize: 11, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>{escalonados.length}</span>}
          </button>
          <button
            onClick={() => router.push("/cardapio")}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderRadius: 12, border: "1px solid var(--surface)", background: "var(--surface)", cursor: "pointer", fontFamily: "'Archivo', sans-serif" }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="7" height="7" rx="2" stroke="var(--foreground-muted)" strokeWidth="2.2"/><rect x="13" y="4" width="7" height="7" rx="2" stroke="var(--foreground-muted)" strokeWidth="2.2"/><rect x="4" y="13" width="7" height="7" rx="2" stroke="var(--foreground-muted)" strokeWidth="2.2"/><rect x="13" y="13" width="7" height="7" rx="2" stroke="var(--foreground-muted)" strokeWidth="2.2"/></svg>
            <span style={{ fontSize: 13, fontWeight: 800, color: "var(--foreground-secondary)", textAlign: "left" }}>Cardápio</span>
          </button>
        </div>
      </aside>}
    </>
  )
}
