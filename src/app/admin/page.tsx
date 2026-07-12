'use client'
import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import TourGuiado from '@/components/TourGuiado'
import PanelShell from '@/components/PanelShell'
import { LayoutDashboard, Pizza, Settings, Wallet, Wrench, ChefHat, DollarSign, TrendingUp, AlertTriangle, Camera, RefreshCw, Calendar, Star, Banknote } from 'lucide-react'

type Pedido = {
  id: string; cliente: string; telefone: string; itens: string[]
  total: number; status: string; horario: string; endereco: string
  escalonado?: boolean; observacao?: string; cancelamentoSolicitado?: boolean; data?: string
  taxaEntrega?: number; bairro?: string; tipoEntrega?: string
  entregador?: { id: string; nome: string; telefone: string }
}
type Config = {
  nomePizzaria: string; horaAbertura: number; horaFechamento: number
  chavePix: string; nomeTitularPix?: string; limitePico?: number
}
type Funcionario = { username: string; name: string; password: string; ativo: boolean; role: string }
type ImagensCardapio = { pizza?: string; lanche?: string; bebida?: string; suco?: string; ativo: boolean }
type Avaliacao = { phone: string; nota: number; data: string }
type AvaliacoesData = { total: number; media: number; ultimas: Avaliacao[] }
type ItemCardapio = { name: string; price: number }
type Cardapio = {
  saltyFlavors: string[]; sweetFlavors: string[]; bebidas: ItemCardapio[]
  sucos: ItemCardapio[]; neighborhoods: { name: string; fee: number }[]
  sizes: { code: string; label: string; price: number }[]
  borders: { label: string; priceSmall: number; priceLarge: number }[]
}
type Entregador = { id: string; nome: string; telefone: string; ativo: boolean }
type Aba = 'dashboard' | 'cardapio' | 'config' | 'financeiro' | 'dev'
type Periodo = 'ontem' | 'hoje' | 'semana' | 'personalizado'
type MercadoPagoConfig = {
  provider: 'mercadopago'
  enabled: boolean
  configured: boolean
  tokenMasked: string | null
  payerEmailFallback?: string
  lastTestAt?: string
  lastTestOk?: boolean
  lastTestMessage?: string
  updatedAt?: string
  updatedBy?: string
}

function getUserInfo(): { name: string; role: string } | null {
  if (typeof document === 'undefined') return null
  try {
    const cookies = document.cookie.split(';')
    for (const c of cookies) {
      const trimmed = c.trim()
      if (trimmed.startsWith('auth-user=')) {
        const raw = trimmed.substring('auth-user='.length)
        let decoded = raw
        try { decoded = decodeURIComponent(raw) } catch { decoded = raw }
        if (decoded.startsWith('%7B')) try { decoded = decodeURIComponent(decoded) } catch {}
        return JSON.parse(decoded)
      }
    }
  } catch { return null }
  return null
}

function filtraPorPeriodo(pedidos: Pedido[], periodo: Periodo, dataInicio: string, dataFim: string): Pedido[] {
  const agora = new Date()
  const hojeStr = agora.toLocaleDateString('pt-BR')
  const ontem = new Date(agora); ontem.setDate(ontem.getDate() - 1)
  const ontemStr = ontem.toLocaleDateString('pt-BR')
  const getDataPedido = (p: Pedido) => {
    if ((p as any).data) return (p as any).data
    const [h, m] = p.horario.split(':').map(Number)
    const d = new Date(); d.setHours(h, m, 0, 0)
    return d.toLocaleDateString('pt-BR')
  }
  if (periodo === 'hoje') return pedidos.filter(p => getDataPedido(p) === hojeStr)
  if (periodo === 'ontem') return pedidos.filter(p => getDataPedido(p) === ontemStr)
  if (periodo === 'semana') {
    const semana = new Date(agora); semana.setDate(semana.getDate() - 7)
    return pedidos.filter(p => {
      const parts = getDataPedido(p).split('/')
      if (parts.length !== 3) return false
      const d = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]))
      return d >= semana
    })
  }
  if (periodo === 'personalizado' && dataInicio && dataFim) {
    const inicio = new Date(dataInicio + 'T00:00:00')
    const fim = new Date(dataFim + 'T23:59:59')
    return pedidos.filter(p => {
      const parts = getDataPedido(p).split('/')
      if (parts.length !== 3) return false
      const d = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]))
      return d >= inicio && d <= fim
    })
  }
  return pedidos
}

function calcularGraficoPico(pedidos: Pedido[]) {
  const contagem: Record<number, number> = {}
  for (const p of pedidos) {
    if (p.status === 'cancelado' || p.escalonado) continue
    const hora = parseInt(p.horario.split(':')[0])
    if (!isNaN(hora)) contagem[hora] = (contagem[hora] || 0) + 1
  }
  const horas = Object.keys(contagem).map(Number).sort((a, b) => a - b)
  if (horas.length === 0) return []
  const min = Math.min(...horas), max = Math.max(...horas)
  const resultado = []
  for (let h = min; h <= max; h++) resultado.push({ hora: `${String(h).padStart(2, '0')}h`, total: contagem[h] || 0 })
  return resultado
}

const inp = { width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px', color: 'var(--foreground)', fontSize: 16, outline: 'none', boxSizing: 'border-box' as const, minHeight: 52, fontFamily: "'Archivo', sans-serif" }
const btn = (active: boolean) => ({ padding: '10px 0', minHeight: 48, borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: active ? 'var(--primary)' : 'var(--surface)', color: active ? 'var(--foreground)' : 'var(--foreground-secondary)', fontFamily: "'Archivo', sans-serif" })
const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }
const sectionTitle = { color: 'var(--foreground-secondary)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 12 }

const CATEGORIAS_FIN = [
  { key: 'ingredientes', label: 'Ingredientes', cor: 'var(--primary)' },
  { key: 'embalagens', label: 'Embalagens', cor: 'var(--info)' },
  { key: 'energia', label: 'Energia/Gas', cor: 'var(--primary)' },
  { key: 'funcionarios', label: 'Funcionarios', cor: 'var(--attention)' },
  { key: 'aluguel', label: 'Aluguel', cor: 'var(--attention)' },
  { key: 'marketing', label: 'Marketing', cor: 'var(--info)' },
  { key: 'manutencao', label: 'Manutencao', cor: 'var(--success)' },
  { key: 'outros', label: 'Outros', cor: 'var(--foreground-muted)' },
]

const PASSOS_TOUR_CARDAPIO = [
  { face: String.fromCodePoint(0x1F468, 0x200D, 0x1F373), tag: 'Bem-vindo!', tagBg: 'color-mix(in srgb, var(--primary) 8%, transparent)', tagColor: 'var(--brand-text)', title: 'Sou o Chef, seu guia!', text: 'Vou te ensinar como editar seu cardapio em 4 passos rapidos!', nextLabel: 'Bora!', nextBg: 'linear-gradient(135deg,var(--primary),var(--primary))', accent: 'var(--primary)' },
  { face: String.fromCodePoint(0x1F9D0), tag: 'Passo 1 de 4', tagBg: 'var(--info-soft)', tagColor: 'var(--info-text)', title: 'Toque no x para remover', text: 'Cada bolinha e um sabor. Quer tirar algum? So tocar no x ao lado do nome!', highlightId: 'cardapio-sabores', arrowId: 'cardapio-sabores', nextLabel: 'Entendi!', nextBg: 'linear-gradient(135deg,var(--info),var(--info))', accent: 'var(--info)', particles: true },
  { face: String.fromCodePoint(0x1F604), tag: 'Passo 2 de 4', tagBg: 'var(--attention-soft)', tagColor: 'var(--attention-text)', title: 'Toque + para adicionar', text: 'Clique em + Add para incluir novos sabores. Pode adicionar quantos quiser!', highlightId: 'cardapio-add-btn', arrowId: 'cardapio-add-btn', nextLabel: 'Facil demais!', nextBg: 'linear-gradient(135deg,var(--attention),var(--attention))', accent: 'var(--attention)', particles: true },
  { face: String.fromCodePoint(0x1F62E), tag: 'Passo 3 - IMPORTANTE', tagBg: 'var(--danger-soft)', tagColor: 'var(--danger)', title: 'Sempre salve no final!', text: 'Depois de editar aperte o botao verde Salvar Cardapio. Sem salvar o bot nao aprende!', highlightId: 'cardapio-salvar', arrowId: 'cardapio-salvar', nextLabel: 'Anotado!', nextBg: 'linear-gradient(135deg,var(--danger),var(--primary))', accent: 'var(--danger)', particles: true, showDismiss: true },
  { face: String.fromCodePoint(0x1F973), tag: 'Pronto!', tagBg: 'var(--success-soft)', tagColor: 'var(--success)', title: 'Voce e um craque!', text: 'Agora e so editar o cardapio do seu jeito. Qualquer duvida e so chamar!', nextLabel: 'Usar agora!', nextBg: 'linear-gradient(135deg,var(--success),var(--success))', accent: 'var(--success)', showDismiss: true, last: true },
]

const ABA_TABS: { key: Aba; Icon: typeof LayoutDashboard; label: string }[] = [
  { key: 'dashboard', Icon: LayoutDashboard, label: 'Painel' },
  { key: 'cardapio', Icon: Pizza, label: 'Cardapio' },
  { key: 'config', Icon: Settings, label: 'Configuracao' },
  { key: 'financeiro', Icon: Wallet, label: 'Financeiro' },
  { key: 'dev', Icon: Wrench, label: 'Suporte' },
]

export default function AdminPage() {
  const router = useRouter()
  const [aba, setAba] = useState<Aba>('dashboard')
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [config, setConfig] = useState<Config>({ nomePizzaria: '', horaAbertura: 18, horaFechamento: 23, chavePix: '' })
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([])
  const [cardapio, setCardapio] = useState<Cardapio>({ saltyFlavors: [], sweetFlavors: [], bebidas: [], sucos: [], neighborhoods: [], sizes: [], borders: [] })
  const [entregadores, setEntregadores] = useState<Entregador[]>([])
  const [loading, setLoading] = useState(true)
  const [periodo, setPeriodo] = useState<Periodo>('hoje')
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [showPeriodo, setShowPeriodo] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [salvandoCardapio, setSalvandoCardapio] = useState(false)
  const [mensagem, setMensagem] = useState('')
  const [senhas, setSenhas] = useState<Record<string, string>>({})
  const [nomes, setNomes] = useState<Record<string, string>>({})
  const [showNovoFunc, setShowNovoFunc] = useState(false)
  const [novoFunc, setNovoFunc] = useState({ name: '', username: '', password: '', role: 'atendente' })
  const [criando, setCriando] = useState(false)
  const [nomeUsuario, setNomeUsuario] = useState('')
  const [logoError, setLogoError] = useState(false)
  const [imagens, setImagens] = useState<ImagensCardapio>({ ativo: true })
  const [avaliacoes, setAvaliacoes] = useState<AvaliacoesData>({ total: 0, media: 0, ultimas: [] })
  const [ranking, setRanking] = useState<Array<{ nome: string; total: number }>>([])
  const [limitePico, setLimitePico] = useState(0)
  const [uploadando, setUploadando] = useState<string | null>(null)
  const [novoSabor, setNovoSabor] = useState('')
  const [novaBebida, setNovaBebida] = useState({ name: '', price: '' })
  const [novoBairro, setNovoBairro] = useState({ name: '', fee: '' })
  const [novoEntregador, setNovoEntregador] = useState({ nome: '', telefone: '' })
  const [salvandoEntregador, setSalvandoEntregador] = useState(false)
  const [custos, setCustos] = useState<{id: string; descricao: string; valor: number; categoria: string; data: string; mes: string}[]>([])
  const [faturamentoMes, setFaturamentoMes] = useState(0)
  const [novoDescricao, setNovoDescricao] = useState('')
  const [novoValor, setNovoValor] = useState('')
  const [novaCategoria, setNovaCategoria] = useState('ingredientes')
  const [salvandoCusto, setSalvandoCusto] = useState(false)
  const [analisandoNota, setAnalisandoNota] = useState(false)
  const [mesFechado, setMesFechado] = useState(false)
  const [editandoCusto, setEditandoCusto] = useState<string | null>(null)
  const [editDescricao, setEditDescricao] = useState('')
  const [editValor, setEditValor] = useState('')
  const [editCategoria, setEditCategoria] = useState('ingredientes')
  const [showTourCardapio, setShowTourCardapio] = useState(false)
  const [waStatus, setWaStatus] = useState<'unknown' | 'connected' | 'disconnected'>('unknown')
  const [waQrBase64, setWaQrBase64] = useState<string | null>(null)
  const [waShowQr, setWaShowQr] = useState(false)
  const [waTimer, setWaTimer] = useState(60)
  const [waExpired, setWaExpired] = useState(false)
  const [waLoadingQr, setWaLoadingQr] = useState(false)
  const [waQrError, setWaQrError] = useState<string | null>(null)
  const [waResetting, setWaResetting] = useState(false)
  const [mpConfig, setMpConfig] = useState<MercadoPagoConfig | null>(null)
  const [mpToken, setMpToken] = useState('')
  const [mpPayerEmail, setMpPayerEmail] = useState('')
  const [mpLoading, setMpLoading] = useState(false)
  const [mpSaving, setMpSaving] = useState(false)
  const [mpTesting, setMpTesting] = useState(false)
  const [mpRemoving, setMpRemoving] = useState(false)
  const cameraRef = useRef<HTMLInputElement>(null)
  const inputPizzaRef = useRef<HTMLInputElement>(null)
  const inputLancheRef = useRef<HTMLInputElement>(null)
  const inputBebidaRef = useRef<HTMLInputElement>(null)
  const inputSucoRef = useRef<HTMLInputElement>(null)
  const waTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const waPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mesAtual = new Date().toISOString().slice(0, 7)
  const mesLabel = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  const is24h = config.horaAbertura === 0 && config.horaFechamento === 24

  useEffect(() => {
    const user = getUserInfo()
    if (!user || (user.role !== 'admin' && user.role !== 'dev')) { router.push('/login?callbackUrl=/admin'); return }
    setNomeUsuario(user.name)
    Promise.all([
      fetch('/api/orders').then(r => r.json()).catch(err => { console.error('Falha ao carregar pedidos:', err); return [] }),
      fetch('/api/configuracoes').then(r => r.json()).catch(err => { console.error('Falha ao carregar configuracoes:', err); return { nomePizzaria: '', horaAbertura: 18, horaFechamento: 23, chavePix: '' } }),
      fetch('/api/funcionarios').then(r => r.json()),
      fetch('/api/cardapio-imagens').then(r => r.json()).catch(() => ({ ativo: true })),
      fetch('/api/avaliacoes').then(r => r.json()).catch(() => ({ total: 0, media: 0, ultimas: [] })),
      fetch('/api/ranking').then(r => r.json()).catch(() => []),
      fetch('/api/cardapio').then(r => r.json()).catch(() => null),
      fetch('/api/entregadores').then(r => r.json()).catch(() => []),
      fetch(`/api/financeiro?mes=${new Date().toISOString().slice(0, 7)}`).then(r => r.json()).catch(() => ({ custos: [], status: { fechado: false } })),
    ]).then(([ped, cfg, funcs, imgs, avals, rank, card, entreg, fin]) => {
      setPedidos(Array.isArray(ped) ? ped : [])
      setConfig(cfg)
      setLimitePico(cfg.limitePico || 0)
      setImagens(imgs || { ativo: true })
      setAvaliacoes(avals || { total: 0, media: 0, ultimas: [] })
      setRanking(Array.isArray(rank) ? rank : [])
      if (card) setCardapio({ saltyFlavors: card.saltyFlavors || [], sweetFlavors: card.sweetFlavors || [], bebidas: card.bebidas || [], sucos: card.sucos || [], neighborhoods: card.neighborhoods || [], sizes: card.sizes?.length ? card.sizes : [{ code: 'P', label: 'Pequena', price: 35 }, { code: 'M', label: 'Media', price: 40 }, { code: 'G', label: 'Grande', price: 50 }, { code: 'F', label: 'Familia', price: 55 }], borders: card.borders || [] })
      setEntregadores(Array.isArray(entreg) ? entreg : [])
      if (fin?.custos) { setCustos(fin.custos); setMesFechado(fin.status?.fechado || false) }
      const entreguesMes = Array.isArray(ped) ? ped.filter((p: any) => p.status === 'entregue').reduce((s: number, p: any) => s + (Number(p.total) || 0), 0) : 0
      setFaturamentoMes(entreguesMes)
      if (Array.isArray(funcs)) {
        setFuncionarios(funcs)
        const s: Record<string, string> = {}, n: Record<string, string> = {}
        funcs.forEach((f: Funcionario) => { s[f.username] = ''; n[f.username] = f.name })
        setSenhas(s); setNomes(n)
      }
      setLoading(false)
      // Verifica status do WhatsApp ao carregar e tenta exibir QR se desconectado
      fetch('/api/whatsapp/state').then(r => r.json()).then(d => {
        const state = d?.instance?.state
        const connected = state === 'open'
        setWaStatus(connected ? 'connected' : 'disconnected')
        if (!connected) tryAutoQr()
      }).catch(() => { setWaStatus('disconnected'); tryAutoQr() })
      carregarMercadoPago()
    }).catch(err => {
      console.error('Falha ao carregar dados do dashboard:', err)
      setLoading(false)
    })
  }, [router])

  useEffect(() => {
    if (aba === 'cardapio') {
      try {
        const visto = localStorage.getItem('tour_cardapio_visto')
        if (!visto) setShowTourCardapio(true)
      } catch {}
    }
  }, [aba])

  useEffect(() => {
    return () => {
      if (waTimerRef.current) clearInterval(waTimerRef.current)
      if (waPollRef.current) clearInterval(waPollRef.current)
    }
  }, [])

  const fetchWaStatus = async () => {
    try {
      const d = await fetch('/api/whatsapp/state').then(r => r.json())
      const state = d?.instance?.state
      if (state === 'open') {
        setWaStatus('connected')
        setWaShowQr(false)
        setWaQrBase64(null)
        if (waPollRef.current) { clearInterval(waPollRef.current); waPollRef.current = null }
        if (waTimerRef.current) { clearInterval(waTimerRef.current); waTimerRef.current = null }
      } else {
        setWaStatus('disconnected')
      }
    } catch { setWaStatus('disconnected') }
  }

  const startQrTimer = (base64: string) => {
    setWaQrBase64(base64)
    setWaShowQr(true)
    setWaTimer(60)
    setWaExpired(false)
    if (waTimerRef.current) clearInterval(waTimerRef.current)
    let t = 60
    waTimerRef.current = setInterval(() => {
      t -= 1
      setWaTimer(t)
      if (t <= 0) { clearInterval(waTimerRef.current!); waTimerRef.current = null; setWaExpired(true) }
    }, 1000)
    if (waPollRef.current) clearInterval(waPollRef.current)
    waPollRef.current = setInterval(fetchWaStatus, 3000)
  }

  // Tenta exibir QR atual sem reset (usado na abertura automática da tela)
  const tryAutoQr = async () => {
    try {
      const res = await fetch('/api/whatsapp/qrcode')
      const d = await res.json()
      const base64 = d?.base64 || d?.qrcode?.base64 || null
      if (base64) startQrTimer(base64)
    } catch {}
  }

  // Busca o QR já existente na instância (sem reset, sem Redis)
  const fetchQrCode = async () => {
    setWaLoadingQr(true)
    setWaExpired(false)
    setWaQrError(null)
    try {
      const res = await fetch('/api/whatsapp/qrcode')
      const d = await res.json()
      const base64 = d?.base64 || d?.qrcode?.base64 || null
      if (base64) {
        startQrTimer(base64)
      } else {
        setWaQrError(d?.error || 'QR code não disponível. Tente novamente em instantes.')
      }
    } catch {
      setWaQrError('Erro de rede ao buscar QR code.')
    } finally {
      setWaLoadingQr(false)
    }
  }

  // Recria a instância na Evolution API (logout + delete + create + webhook).
  // Necessário quando a instância foi perdida (ex.: "Application not found"
  // no connect) — buscar QR sozinho nunca resolve esse caso, só reconecta uma
  // instância que já existe.
  const resetWhatsapp = async () => {
    setWaResetting(true)
    setWaQrError(null)
    try {
      const res = await fetch('/api/whatsapp/reset', { method: 'POST' })
      const d = await res.json()
      const base64 = d?.qrcode?.base64 || null
      if (d?.ok && base64) {
        startQrTimer(base64)
      } else {
        setWaQrError(d?.error || 'Não foi possível resetar a conexão do WhatsApp.')
      }
    } catch {
      setWaQrError('Erro de rede ao resetar a conexão.')
    } finally {
      setWaResetting(false)
    }
  }

  const msg = (m: string) => { setMensagem(m); setTimeout(() => setMensagem(''), 3000) }

  const carregarMercadoPago = async () => {
    setMpLoading(true)
    try {
      const res = await fetch('/api/admin/integracoes/mercadopago')
      if (!res.ok) throw new Error('erro')
      const data = await res.json()
      setMpConfig(data)
      setMpPayerEmail(data.payerEmailFallback || '')
    } catch {
      msg('Erro ao carregar Mercado Pago.')
    } finally {
      setMpLoading(false)
    }
  }

  const salvarMercadoPago = async () => {
    setMpSaving(true)
    try {
      const res = await fetch('/api/admin/integracoes/mercadopago', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken: mpToken,
          payerEmailFallback: mpPayerEmail,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'erro')
      setMpConfig(data.config)
      setMpToken('')
      setMpPayerEmail(data.config?.payerEmailFallback || '')
      msg('Mercado Pago salvo. Pix automatico ainda nao foi ativado.')
    } catch {
      msg('Erro ao salvar Mercado Pago.')
    } finally {
      setMpSaving(false)
    }
  }

  const testarMercadoPago = async () => {
    setMpTesting(true)
    try {
      const res = await fetch('/api/admin/integracoes/mercadopago/test', { method: 'POST' })
      const data = await res.json().catch(() => null)
      if (data?.config) setMpConfig(data.config)
      if (!res.ok || !data?.ok) throw new Error(data?.config?.lastTestMessage || 'erro')
      msg('Conexao Mercado Pago validada.')
    } catch {
      msg('Nao foi possivel validar Mercado Pago.')
    } finally {
      setMpTesting(false)
    }
  }

  const removerMercadoPago = async () => {
    setMpRemoving(true)
    try {
      const res = await fetch('/api/admin/integracoes/mercadopago', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearToken: true, enabled: false, payerEmailFallback: mpPayerEmail }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'erro')
      setMpConfig(data.config)
      setMpToken('')
      msg('Mercado Pago desconectado.')
    } catch {
      msg('Erro ao remover token Mercado Pago.')
    } finally {
      setMpRemoving(false)
    }
  }

  const pedidosFiltrados = filtraPorPeriodo(pedidos, periodo, dataInicio, dataFim).filter(p => !p.escalonado && p.status !== 'cancelado')
  const pedidosEntregues = pedidosFiltrados.filter(p => p.status === 'entregue')
  const faturamento = pedidosEntregues.reduce((s, p) => s + (Number(p.total) || 0), 0)
  const totalEntregues = pedidosEntregues.length
  const ticketMedio = totalEntregues > 0 ? faturamento / totalEntregues : 0
  const graficoPico = calcularGraficoPico(pedidosFiltrados)
  const maxPico = graficoPico.length > 0 ? Math.max(...graficoPico.map(g => g.total)) : 1
  const statusCounts = pedidosFiltrados.reduce((acc: Record<string, number>, p) => { acc[p.status] = (acc[p.status] || 0) + 1; return acc }, {})
  const emAndamento = (statusCounts['pendente'] || 0) + (statusCounts['em preparo'] || 0) + (statusCounts['saiu para entrega'] || 0)

  const salvarConfig = async () => {
    setSalvando(true)
    try {
      const res = await fetch('/api/configuracoes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...config, limitePico }) })
      if (res.ok) msg('Configuracoes salvas!')
      else msg('Erro ao salvar.')
    } catch { msg('Erro ao salvar.') }
    setSalvando(false)
  }

  const toggle24h = async () => {
    const novaConfig = is24h ? { ...config, horaAbertura: 18, horaFechamento: 23 } : { ...config, horaAbertura: 0, horaFechamento: 24 }
    setConfig(novaConfig)
    try {
      await fetch('/api/configuracoes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...novaConfig, limitePico }) })
      msg(is24h ? 'Horario padrao!' : 'Aberto 24h!')
    } catch { msg('Erro.') }
  }

  const salvarFunc = async (username: string) => {
    const f = funcionarios.find(f => f.username === username)
    if (!f) return
    try {
      await fetch('/api/funcionarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, name: nomes[username] || f.name, password: senhas[username] || undefined }) })
      msg('Funcionario salvo!')
    } catch { msg('Erro.') }
  }

  const criarFunc = async () => {
    if (!novoFunc.name || !novoFunc.username || !novoFunc.password) return
    setCriando(true)
    try {
      await fetch('/api/funcionarios', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(novoFunc) })
      setFuncionarios(prev => [...prev, { ...novoFunc, ativo: true }])
      setSenhas(prev => ({ ...prev, [novoFunc.username]: '' }))
      setNomes(prev => ({ ...prev, [novoFunc.username]: novoFunc.name }))
      setNovoFunc({ name: '', username: '', password: '', role: 'atendente' })
      setShowNovoFunc(false)
      msg('Funcionario criado!')
    } catch { msg('Erro.') }
    setCriando(false)
  }

  const salvarCardapio = async () => {
    setSalvandoCardapio(true)
    try {
      await fetch('/api/cardapio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cardapio) })
      msg('Cardapio salvo!')
    } catch { msg('Erro.') }
    setSalvandoCardapio(false)
  }

  const uploadImagem = async (tipo: string, file: File) => {
    setUploadando(tipo)
    try {
      const formData = new FormData(); formData.append('file', file); formData.append('tipo', tipo)
      const res = await fetch('/api/cardapio-imagens', { method: 'POST', body: formData })
      if (res.ok) { const d = await res.json(); setImagens(prev => ({ ...prev, [tipo]: d.url })); msg('Imagem carregada!') }
    } catch { msg('Erro.') }
    setUploadando(null)
  }

  const toggleImagensAtivo = async () => {
    const novo = { ...imagens, ativo: !imagens.ativo }
    setImagens(novo)
    try { await fetch('/api/cardapio-imagens', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ativo: novo.ativo }) }) } catch {}
  }

  if (loading) return (
    <div style={{ minHeight: '100svh', background: 'var(--background)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Archivo', sans-serif" }}>
      <p style={{ color: 'var(--foreground-secondary)', fontSize: 14 }}>Carregando...</p>
    </div>
  )
  return (
    <PanelShell showGestaoNav>
    <div style={{ minHeight: '100svh', background: 'var(--background)', fontFamily: "'Archivo', sans-serif", paddingBottom: 'calc(env(safe-area-inset-bottom) + 80px)', overflowX: 'hidden' }}>
      <style>{`@keyframes slideUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } } input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(1); } .ps-bottom-nav { display: none !important; } .ps-content { padding-bottom: 0 !important; } .cb-admin-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; } .cb-admin-acesso { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; } .cb-admin-bottomnav { left: 0; display: flex; } .cb-admin-desktop-tabs { display: none; } .cb-admin-tab { display: flex; align-items: center; gap: 7px; padding: 9px 16px; border-radius: 10px; background: transparent; color: var(--foreground-muted); font-size: 13px; font-weight: 700; font-family: 'Archivo', sans-serif; border: none; cursor: pointer; } .cb-admin-tab-active { background: color-mix(in srgb, var(--primary) 8%, transparent); color: var(--brand-text); } @media (min-width: 768px) { .cb-admin-bottomnav { left: 220px; display: none; } .cb-admin-desktop-tabs { display: flex; gap: 6px; padding: 12px 16px 0; } } @media (min-width: 1024px) { .cb-admin-metrics { grid-template-columns: repeat(4, minmax(0,1fr)); } .cb-admin-acesso { grid-template-columns: repeat(4, minmax(0,1fr)); } .cb-admin-bottomnav { left: 240px; } }`}</style>

      {/* Header */}
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '18px 16px', paddingTop: 'calc(env(safe-area-inset-top) + 18px)', position: 'sticky', top: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
          {logoError ? (
            <div style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Pizza size={20} color="var(--foreground)" aria-hidden="true" /></div>
          ) : (
            <Image
              src="/logo-chefe-da-pizza.jpg"
              alt="Chefe da Pizza"
              width={40}
              height={40}
              style={{ objectFit: 'contain', flexShrink: 0 }}
              onError={() => setLogoError(true)}
            />
          )}
          <div style={{ minWidth: 0 }}>
            <p style={{ color: 'var(--foreground)', fontSize: 15, fontWeight: 700, margin: 0, letterSpacing: -0.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>ChefeBot</p>
            <p style={{ color: 'var(--foreground-secondary)', fontSize: 10, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Olá, {nomeUsuario}</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {getUserInfo()?.role === 'dev' && <button onClick={() => router.push('/dev')} style={{ background: 'var(--surface-secondary)', border: '1px solid var(--surface-elevated)', color: 'var(--info)', borderRadius: 10, padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Dev</button>}
          <button onClick={() => router.push('/pedidos')} style={{ background: 'var(--surface-secondary)', border: '1px solid var(--surface-elevated)', color: 'var(--foreground)', borderRadius: 10, padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Cozinha</button>
          <button onClick={() => fetch('/api/auth/logout', { method: 'POST' }).then(() => router.push('/login'))} style={{ background: 'var(--surface-secondary)', border: '1px solid var(--surface-elevated)', color: 'var(--border-strong)', borderRadius: 10, padding: '8px 12px', cursor: 'pointer', fontSize: 12 }}>Sair</button>
        </div>
      </div>

      {mensagem && (
        <div style={{ background: mensagem.includes('salv') || mensagem.includes('cri') || mensagem.includes('carr') ? 'var(--success-soft)' : 'var(--danger)', margin: '12px 16px 0', borderRadius: 10, padding: '10px 14px', color: mensagem.includes('salv') || mensagem.includes('cri') || mensagem.includes('carr') ? 'var(--success)' : 'var(--danger)', fontWeight: 600, fontSize: 13, animation: 'slideUp 0.2s ease' }}>
          {mensagem}
        </div>
      )}

      {/* Navegação por abas — visível só em desktop/tablet (>=768px); no mobile a navegação é a bottom nav */}
      <div className="cb-admin-desktop-tabs">
        {ABA_TABS.map(({ key, Icon, label }) => (
          <button key={key} className={`cb-admin-tab${aba === key ? ' cb-admin-tab-active' : ''}`} onClick={() => setAba(key)}>
            <Icon size={16} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      <div style={{ padding: '16px 16px 0', maxWidth: 1400, margin: '0 auto', width: '100%' }}>

        {/* ABA DASHBOARD */}
        {aba === 'dashboard' && (
          <div>

            {/* ── Card WhatsApp ── */}
            {waStatus === 'connected' && (
              <div style={{ ...card, marginBottom: 16, border: '1px solid color-mix(in srgb, var(--whatsapp) 35%, transparent)', background: 'color-mix(in srgb, var(--whatsapp) 7%, transparent)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--whatsapp)', boxShadow: '0 0 8px color-mix(in srgb, var(--whatsapp) 38%, transparent)', flexShrink: 0 }} />
                  <div>
                    <p style={{ color: 'var(--success)', fontSize: 14, fontWeight: 700, margin: 0 }}>WhatsApp conectado</p>
                    <p style={{ color: 'var(--foreground-secondary)', fontSize: 11, margin: '2px 0 0' }}>Bot ativo — atendimento automático ligado</p>
                  </div>
                </div>
              </div>
            )}

            {waStatus === 'disconnected' && (
              <div style={{ ...card, marginBottom: 16, border: waShowQr ? '1px solid var(--surface-secondary)' : '1px solid color-mix(in srgb, var(--primary) 35%, transparent)', background: waShowQr ? 'var(--background)' : 'color-mix(in srgb, var(--primary) 7%, transparent)' }}>
                {!waShowQr ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <AlertTriangle size={18} color="var(--primary)" aria-hidden="true" />
                      <p style={{ color: 'var(--brand-text)', fontSize: 14, fontWeight: 700, margin: 0 }}>Conectar WhatsApp</p>
                    </div>
                    <p style={{ color: 'var(--foreground-secondary)', fontSize: 12, margin: '0 0 12px', lineHeight: 1.5 }}>
                      Nenhum WhatsApp está conectado. Escaneie o QR Code para ativar o atendimento automático.
                    </p>
                    <button onClick={fetchQrCode} disabled={waLoadingQr || waResetting} style={{ width: '100%', background: 'var(--whatsapp)', border: 'none', borderRadius: 10, padding: '14px', color: 'var(--whatsapp-foreground)', fontSize: 14, fontWeight: 700, cursor: (waLoadingQr || waResetting) ? 'not-allowed' : 'pointer', opacity: (waLoadingQr || waResetting) ? 0.7 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                      {waLoadingQr ? 'Gerando QR Code...' : <><Camera size={16} aria-hidden="true" /> Escanear QR Code</>}
                    </button>
                    {waQrError && (
                      <>
                        <p style={{ color: 'var(--danger)', fontSize: 12, margin: '10px 0 0', textAlign: 'center' }}>{waQrError}</p>
                        {/* Reset é mais destrutivo que só reconectar (derruba e recria a
                            instância) — nunca oferecido a atendente, só admin/dev. A rota
                            já exige o mesmo no servidor; isso é só a UI não oferecer a ação
                            a quem não pode usá-la. */}
                        {(getUserInfo()?.role === 'admin' || getUserInfo()?.role === 'dev') && (
                          <button
                            onClick={() => { if (confirm('Isso desconecta e recria a instância do WhatsApp do zero. Um novo QR Code será gerado. Continuar?')) resetWhatsapp() }}
                            disabled={waResetting || waLoadingQr}
                            style={{ width: '100%', marginTop: 10, background: 'transparent', border: '1px solid var(--danger)', borderRadius: 10, padding: '10px', color: 'var(--danger)', fontSize: 12.5, fontWeight: 700, cursor: (waResetting || waLoadingQr) ? 'not-allowed' : 'pointer', opacity: (waResetting || waLoadingQr) ? 0.7 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                          >
                            <RefreshCw size={14} aria-hidden="true" /> {waResetting ? 'Resetando conexão...' : 'Resetar conexão do WhatsApp'}
                          </button>
                        )}
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <p style={{ ...sectionTitle, marginBottom: 12 }}>Conectar WhatsApp</p>
                    {waQrBase64 && !waExpired && (
                      <div style={{ textAlign: 'center', marginBottom: 12 }}>
                        <img src={waQrBase64} alt="QR Code WhatsApp" style={{ width: '100%', maxWidth: 220, borderRadius: 12, background: 'var(--foreground)', padding: 10, boxSizing: 'border-box' }} />
                      </div>
                    )}
                    {waExpired ? (
                      <div style={{ textAlign: 'center', marginBottom: 12 }}>
                        <p style={{ color: 'var(--danger)', fontSize: 13, fontWeight: 600, margin: '0 0 12px' }}>QR Code expirado.</p>
                        <button onClick={fetchQrCode} disabled={waLoadingQr} style={{ background: 'var(--whatsapp)', border: 'none', borderRadius: 10, padding: '12px 24px', color: 'var(--whatsapp-foreground)', fontSize: 13, fontWeight: 700, cursor: waLoadingQr ? 'not-allowed' : 'pointer', opacity: waLoadingQr ? 0.7 : 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {waLoadingQr ? 'Gerando...' : <><RefreshCw size={15} aria-hidden="true" /> Gerar novo QR Code</>}
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                        <span style={{ color: 'var(--foreground-secondary)', fontSize: 13 }}>
                          Expira em: <strong style={{ color: waTimer < 15 ? 'var(--danger)' : 'var(--primary)' }}>{waTimer}s</strong>
                        </span>
                        <button onClick={fetchQrCode} disabled={waLoadingQr} style={{ background: 'transparent', border: '1px solid var(--surface-secondary)', borderRadius: 8, padding: '6px 12px', color: 'var(--foreground-secondary)', fontSize: 11, fontWeight: 700, cursor: waLoadingQr ? 'not-allowed' : 'pointer' }}>
                          {waLoadingQr ? '...' : 'Novo QR'}
                        </button>
                      </div>
                    )}
                    <p style={{ color: 'var(--foreground-muted)', fontSize: 11, margin: 0, lineHeight: 1.5 }}>
                      Abra o WhatsApp, toque em <strong>Aparelhos conectados</strong> e escaneie o código.
                    </p>
                  </>
                )}
              </div>
            )}

            {/* Filtro de período */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
              {(['ontem', 'hoje', 'semana'] as Periodo[]).map(p => (
                <button key={p} onClick={() => { setPeriodo(p); setShowPeriodo(false) }} style={{ ...btn(periodo === p), flex: 1 }}>
                  {p === 'ontem' ? 'Ontem' : p === 'hoje' ? 'Hoje' : 'Semana'}
                </button>
              ))}
              <button onClick={() => setShowPeriodo(!showPeriodo)} style={{ ...btn(periodo === 'personalizado'), padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Calendar size={16} aria-hidden="true" /></button>
            </div>

            {showPeriodo && (
              <div style={{ ...card, marginBottom: 16, animation: 'slideUp 0.2s ease' }}>
                <p style={sectionTitle}>Periodo personalizado</p>
                <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ color: 'var(--foreground-secondary)', fontSize: 11, display: 'block', marginBottom: 4 }}>De</label>
                    <input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)} style={inp} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ color: 'var(--foreground-secondary)', fontSize: 11, display: 'block', marginBottom: 4 }}>Ate</label>
                    <input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)} style={inp} />
                  </div>
                </div>
                <button onClick={() => { if (dataInicio && dataFim) { setPeriodo('personalizado'); setShowPeriodo(false) } }} style={{ width: '100%', background: 'var(--primary)', border: 'none', borderRadius: 10, padding: '14px', color: 'var(--primary-foreground)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Aplicar</button>
              </div>
            )}

            {/* 4 métricas principais */}
            <div className="cb-admin-metrics">
              <div style={{ ...card, background: 'linear-gradient(135deg, var(--surface), var(--surface))' }}>
                <p style={{ color: 'var(--foreground-secondary)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', margin: '0 0 6px', letterSpacing: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Pedidos hoje</p>
                <p style={{ color: 'var(--foreground)', fontSize: 30, fontWeight: 900, margin: 0, letterSpacing: -1, lineHeight: 1 }}>{pedidosFiltrados.length}</p>
                <p style={{ color: 'var(--border-strong)', fontSize: 10, margin: '6px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{totalEntregues} entregues</p>
              </div>
              <div style={{ ...card, background: 'linear-gradient(135deg, var(--surface), var(--surface))' }}>
                <p style={{ color: 'var(--foreground-secondary)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', margin: '0 0 6px', letterSpacing: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Faturamento dia</p>
                <p style={{ color: 'var(--success)', fontSize: faturamento >= 1000 ? 18 : 22, fontWeight: 800, margin: 0, letterSpacing: -0.5, lineHeight: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>R${faturamento.toFixed(2).replace('.', ',')}</p>
                <p style={{ color: 'var(--border-strong)', fontSize: 10, margin: '6px 0 0' }}>dos entregues</p>
              </div>
              <div style={{ ...card, background: 'linear-gradient(135deg, var(--surface), var(--surface))' }}>
                <p style={{ color: 'var(--foreground-secondary)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', margin: '0 0 6px', letterSpacing: 0.5 }}>Ticket medio</p>
                <p style={{ color: 'var(--text-primary)', fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: -0.5, lineHeight: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>R${ticketMedio.toFixed(2).replace('.', ',')}</p>
                <p style={{ color: 'var(--border-strong)', fontSize: 10, margin: '6px 0 0' }}>por pedido</p>
              </div>
              <div style={{ ...card, background: 'linear-gradient(135deg, var(--surface), var(--surface))', border: emAndamento > 0 ? '1px solid color-mix(in srgb, var(--primary) 19%, transparent)' : '1px solid var(--border)' }}>
                <p style={{ color: 'var(--foreground-secondary)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', margin: '0 0 6px', letterSpacing: 0.5 }}>Em andamento</p>
                <p style={{ color: emAndamento > 0 ? 'var(--text-primary)' : 'var(--foreground)', fontSize: 30, fontWeight: 900, margin: 0, letterSpacing: -1, lineHeight: 1 }}>{emAndamento}</p>
                <p style={{ color: emAndamento > 0 ? 'var(--text-secondary)' : 'var(--border-strong)', fontSize: 10, margin: '6px 0 0' }}>{emAndamento > 0 ? 'ativos agora' : 'nenhum ativo'}</p>
              </div>
            </div>

            {/* Breakdown por status */}
            {pedidosFiltrados.length > 0 && (
              <div style={{ ...card, marginBottom: 16 }}>
                <p style={sectionTitle}>Pedidos por status</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {[
                    { key: 'pendente', label: 'Pendente', color: 'var(--attention)' },
                    { key: 'em preparo', label: 'Em preparo', color: 'var(--info)' },
                    { key: 'saiu para entrega', label: 'A caminho', color: 'var(--attention)' },
                    { key: 'entregue', label: 'Entregue', color: 'var(--success)' },
                  ].map(({ key, label, color }) => (
                    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface)', borderRadius: 20, padding: '7px 12px', border: `1px solid ${statusCounts[key] ? `color-mix(in srgb, ${color} 19%, transparent)` : 'var(--border)'}` }}>
                      <div style={{ width: 7, height: 7, borderRadius: '50%', background: statusCounts[key] ? color : 'var(--surface-elevated)', flexShrink: 0 }} />
                      <span style={{ color: 'var(--foreground-secondary)', fontSize: 11 }}>{label}</span>
                      <span style={{ color: statusCounts[key] ? 'var(--foreground)' : 'var(--border-strong)', fontSize: 13, fontWeight: 800 }}>{statusCounts[key] || 0}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Gráfico de vendas por hora */}
            {graficoPico.length > 0 && (
              <div style={{ ...card, marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <p style={{ ...sectionTitle, margin: 0 }}>Vendas por hora</p>
                  <span style={{ color: 'var(--brand-text)', fontSize: 11, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>pico {graficoPico.find(g => g.total === maxPico)?.hora}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 90 }}>
                  {graficoPico.map((item, i) => {
                    const altura = maxPico > 0 ? Math.max((item.total / maxPico) * 90, 4) : 4
                    const isPico = item.total === maxPico && maxPico > 0
                    return (
                      <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 0 }}>
                        {item.total > 0 && <p style={{ color: isPico ? 'var(--primary)' : 'var(--border-strong)', fontSize: 8, margin: 0, fontWeight: 700 }}>{item.total}</p>}
                        <div style={{ width: '100%', height: `${altura}%`, background: isPico ? 'linear-gradient(180deg, var(--primary), var(--primary))' : item.total > 0 ? 'var(--surface-secondary)' : 'var(--surface)', borderRadius: '3px 3px 0 0', minHeight: 4, boxShadow: isPico ? '0 0 10px color-mix(in srgb, var(--primary) 31%, transparent)' : 'none', transition: 'background 0.3s' }} />
                      </div>
                    )
                  })}
                </div>
                <div style={{ display: 'flex', gap: 2, marginTop: 5, borderTop: '1px solid var(--surface-secondary)', paddingTop: 5 }}>
                  {graficoPico.map((item, i) => (
                    <p key={i} style={{ flex: 1, color: item.total > 0 ? 'var(--border-strong)' : 'var(--surface-secondary)', fontSize: 7, margin: 0, textAlign: 'center', overflow: 'hidden' }}>{item.hora.replace('h','')}</p>
                  ))}
                </div>
              </div>
            )}

            {/* Top 5 sabores com medalhas */}
            {ranking.length > 0 && (
              <div style={{ ...card, marginBottom: 16 }}>
                <p style={sectionTitle}>Top 5 sabores mais pedidos</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {ranking.slice(0, 5).map((item, i) => {
                    const medals = ['🥇', '🥈', '🥉', '🏅', '🏅']
                    const barColor = i === 0 ? 'var(--primary)' : i === 1 ? 'var(--foreground-secondary)' : i === 2 ? 'var(--primary)' : 'var(--surface-elevated)'
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 20, minWidth: 26, textAlign: 'center' }}>{medals[i]}</span>
                        <p style={{ color: 'var(--foreground)', fontSize: 13, margin: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.nome}</p>
                        <div style={{ width: 60, background: 'var(--border)', borderRadius: 4, height: 5, flexShrink: 0 }}>
                          <div style={{ height: 5, borderRadius: 4, background: barColor, width: `${Math.max((item.total / (ranking[0]?.total || 1)) * 100, 8)}%` }} />
                        </div>
                        <span style={{ color: 'var(--foreground-secondary)', fontSize: 11, minWidth: 28, textAlign: 'right', fontWeight: 600 }}>{item.total}x</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Cards de acesso rápido */}
            <div style={{ marginBottom: 16 }}>
              <p style={sectionTitle}>Acesso rapido</p>
              <div className="cb-admin-acesso">
                {[
                  { Icon: ChefHat, label: 'Cozinha', sub: 'Pedidos ativos', action: () => router.push('/pedidos'), color: 'var(--brand-text)' },
                  { Icon: Settings, label: 'Configuracoes', sub: 'Horario e cardapio', action: () => router.push('/configuracoes'), color: 'var(--info)' },
                  { Icon: DollarSign, label: 'Financeiro', sub: 'Custos e lucro', action: () => router.push('/financeiro'), color: 'var(--success)' },
                  { Icon: TrendingUp, label: 'Relatorios', sub: 'Historico completo', action: () => router.push('/relatorios'), color: 'var(--attention)' },
                ].map(({ Icon, label, sub, action, color }) => (
                  <button key={label} onClick={action} style={{ background: 'var(--surface)', border: `1px solid var(--border)`, borderRadius: 14, padding: '14px 12px', cursor: 'pointer', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 2, transition: 'border-color 0.2s', minHeight: 90 }}>
                    <div style={{ width: 34, height: 34, borderRadius: 10, background: `color-mix(in srgb, ${color} 9%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 19%, transparent)`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 6 }}><Icon size={18} color={color} aria-hidden="true" /></div>
                    <p style={{ color: 'var(--foreground)', fontSize: 13, fontWeight: 700, margin: 0, fontFamily: "'Archivo', sans-serif" }}>{label}</p>
                    <p style={{ color: 'var(--foreground-muted)', fontSize: 10, margin: 0 }}>{sub}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Avaliações recentes */}
            {avaliacoes.total > 0 && (
              <div style={{ ...card, marginBottom: 16 }}>
                <p style={sectionTitle}>Avaliacoes recentes</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <p style={{ color: 'var(--brand-text)', fontSize: 36, fontWeight: 900, margin: 0, letterSpacing: -2 }}>{avaliacoes.media.toFixed(1)}</p>
                  <div>
                    <div style={{ display: 'flex', gap: 2 }}>
                      {[1,2,3,4,5].map(s => <Star key={s} size={14} color={s <= Math.round(avaliacoes.media) ? 'var(--primary)' : 'var(--surface-elevated)'} fill={s <= Math.round(avaliacoes.media) ? 'var(--primary)' : 'var(--surface-elevated)'} aria-hidden="true" />)}
                    </div>
                    <p style={{ color: 'var(--foreground-muted)', fontSize: 11, margin: '2px 0 0' }}>{avaliacoes.total} avaliacoes</p>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {avaliacoes.ultimas.slice(0, 3).map((a, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--surface)', borderRadius: 8, padding: '10px 12px' }}>
                      <span style={{ color: 'var(--foreground-muted)', fontSize: 11 }}>{a.phone.slice(-4).padStart(8, '*')}</span>
                      <div style={{ display: 'flex', gap: 1 }}>
                        {[1,2,3,4,5].map(s => <Star key={s} size={13} color={s <= a.nota ? 'var(--primary)' : 'var(--surface-elevated)'} fill={s <= a.nota ? 'var(--primary)' : 'var(--surface-elevated)'} aria-hidden="true" />)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {/* ABA CARDAPIO */}
        {aba === 'cardapio' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {showTourCardapio && (
              <TourGuiado
                storageKey="tour_cardapio_visto"
                onClose={() => setShowTourCardapio(false)}
                passos={PASSOS_TOUR_CARDAPIO}
              />
            )}
            <div style={card}>
              <p style={sectionTitle}>Sabores salgados</p>
              <div id="cardapio-sabores" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {cardapio.saltyFlavors.map((s, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface-secondary)', border: '1px solid var(--surface-elevated)', borderRadius: 20, padding: '4px 10px' }}>
                    <span style={{ color: 'var(--foreground)', fontSize: 12 }}>{s}</span>
                    <button onClick={() => setCardapio(prev => ({ ...prev, saltyFlavors: prev.saltyFlavors.filter((_, idx) => idx !== i) }))} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1 }}>x</button>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input placeholder="Novo sabor" value={novoSabor} onChange={e => setNovoSabor(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && novoSabor.trim()) { setCardapio(prev => ({ ...prev, saltyFlavors: [...prev.saltyFlavors, novoSabor.trim()] })); setNovoSabor('') }}} style={{ ...inp, flex: 1 }} />
                <button id="cardapio-add-btn" onClick={() => { if (novoSabor.trim()) { setCardapio(prev => ({ ...prev, saltyFlavors: [...prev.saltyFlavors, novoSabor.trim()] })); setNovoSabor('') }}} style={{ background: 'var(--primary)', border: 'none', color: 'var(--primary-foreground)', borderRadius: 10, padding: '10px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>+ Add</button>
              </div>
            </div>

            <div style={card}>
              <p style={sectionTitle}>Sabores doces</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {cardapio.sweetFlavors.map((s, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface-secondary)', border: '1px solid var(--surface-elevated)', borderRadius: 20, padding: '4px 10px' }}>
                    <span style={{ color: 'var(--foreground)', fontSize: 12 }}>{s}</span>
                    <button onClick={() => setCardapio(prev => ({ ...prev, sweetFlavors: prev.sweetFlavors.filter((_, idx) => idx !== i) }))} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1 }}>x</button>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input placeholder="Novo sabor doce" value={novoSabor} onChange={e => setNovoSabor(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && novoSabor.trim()) { setCardapio(prev => ({ ...prev, sweetFlavors: [...prev.sweetFlavors, novoSabor.trim()] })); setNovoSabor('') }}} style={{ ...inp, flex: 1 }} />
                <button onClick={() => { if (novoSabor.trim()) { setCardapio(prev => ({ ...prev, sweetFlavors: [...prev.sweetFlavors, novoSabor.trim()] })); setNovoSabor('') }}} style={{ background: 'var(--primary)', border: 'none', color: 'var(--primary-foreground)', borderRadius: 10, padding: '10px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>+ Add</button>
              </div>
            </div>

            {cardapio.sizes.length > 0 && (
              <div style={card}>
                <p style={sectionTitle}>Precos das pizzas</p>
                {cardapio.sizes.map((s, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <span style={{ color: 'var(--foreground)', fontSize: 13, fontWeight: 700, width: 100 }}>{s.label} ({s.code})</span>
                    <input type="number" value={s.price} onChange={e => setCardapio(prev => ({ ...prev, sizes: prev.sizes.map((sz, idx) => idx === i ? { ...sz, price: parseFloat(e.target.value) || 0 } : sz) }))} style={{ ...inp, width: 90 }} />
                  </div>
                ))}
              </div>
            )}

            {cardapio.borders.length > 0 && (
              <div style={card}>
                <p style={sectionTitle}>Precos das bordas</p>
                {cardapio.borders.map((b, i) => (
                  <div key={i} style={{ marginBottom: 10 }}>
                    <p style={{ color: 'var(--foreground)', fontSize: 12, fontWeight: 600, margin: '0 0 6px' }}>{b.label}</p>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ color: 'var(--border-strong)', fontSize: 10, display: 'block', marginBottom: 4 }}>P/M</label>
                        <input type="number" value={b.priceSmall} onChange={e => setCardapio(prev => ({ ...prev, borders: prev.borders.map((bd, idx) => idx === i ? { ...bd, priceSmall: parseFloat(e.target.value) || 0 } : bd) }))} style={inp} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ color: 'var(--border-strong)', fontSize: 10, display: 'block', marginBottom: 4 }}>G/F</label>
                        <input type="number" value={b.priceLarge} onChange={e => setCardapio(prev => ({ ...prev, borders: prev.borders.map((bd, idx) => idx === i ? { ...bd, priceLarge: parseFloat(e.target.value) || 0 } : bd) }))} style={inp} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={card}>
              <p style={sectionTitle}>Bebidas</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                {cardapio.bebidas.map((b, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface)', borderRadius: 8, padding: '8px 12px' }}>
                    <span style={{ color: 'var(--foreground)', fontSize: 13 }}>{b.name}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: 'var(--success)', fontSize: 13, fontWeight: 700 }}>R$ {b.price.toFixed(2).replace('.', ',')}</span>
                      <button onClick={() => setCardapio(prev => ({ ...prev, bebidas: prev.bebidas.filter((_, idx) => idx !== i) }))} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 16 }}>x</button>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input placeholder="Nome" value={novaBebida.name} onChange={e => setNovaBebida(prev => ({ ...prev, name: e.target.value }))} style={{ ...inp, flex: 2 }} />
                <input placeholder="R$" value={novaBebida.price} onChange={e => setNovaBebida(prev => ({ ...prev, price: e.target.value }))} style={{ ...inp, flex: 1 }} />
                <button onClick={() => { if (novaBebida.name && novaBebida.price) { setCardapio(prev => ({ ...prev, bebidas: [...prev.bebidas, { name: novaBebida.name, price: parseFloat(novaBebida.price) }] })); setNovaBebida({ name: '', price: '' }) }}} style={{ background: 'var(--primary)', border: 'none', color: 'var(--primary-foreground)', borderRadius: 10, padding: '10px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>+</button>
              </div>
            </div>

            <div style={card}>
              <p style={sectionTitle}>Sucos</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                {cardapio.sucos.map((s, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface)', borderRadius: 8, padding: '8px 12px' }}>
                    <span style={{ color: 'var(--foreground)', fontSize: 13 }}>{s.name}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: 'var(--success)', fontSize: 13, fontWeight: 700 }}>R$ {s.price.toFixed(2).replace('.', ',')}</span>
                      <button onClick={() => setCardapio(prev => ({ ...prev, sucos: prev.sucos.filter((_, idx) => idx !== i) }))} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 16 }}>x</button>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input placeholder="Nome" value={novaBebida.name} onChange={e => setNovaBebida(prev => ({ ...prev, name: e.target.value }))} style={{ ...inp, flex: 2 }} />
                <input placeholder="R$" value={novaBebida.price} onChange={e => setNovaBebida(prev => ({ ...prev, price: e.target.value }))} style={{ ...inp, flex: 1 }} />
                <button onClick={() => { if (novaBebida.name && novaBebida.price) { setCardapio(prev => ({ ...prev, sucos: [...prev.sucos, { name: novaBebida.name, price: parseFloat(novaBebida.price) }] })); setNovaBebida({ name: '', price: '' }) }}} style={{ background: 'var(--primary)', border: 'none', color: 'var(--primary-foreground)', borderRadius: 10, padding: '10px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>+</button>
              </div>
            </div>

            <div style={card}>
              <p style={sectionTitle}>Bairros e taxas</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                {cardapio.neighborhoods.map((n, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface)', borderRadius: 8, padding: '8px 12px' }}>
                    <span style={{ color: 'var(--foreground)', fontSize: 13 }}>{n.name}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: 'var(--brand-text)', fontSize: 13, fontWeight: 700 }}>R$ {n.fee.toFixed(2).replace('.', ',')}</span>
                      <button onClick={() => setCardapio(prev => ({ ...prev, neighborhoods: prev.neighborhoods.filter((_, idx) => idx !== i) }))} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 16 }}>x</button>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input placeholder="Bairro" value={novoBairro.name} onChange={e => setNovoBairro(prev => ({ ...prev, name: e.target.value }))} style={{ ...inp, flex: 2 }} />
                <input placeholder="Taxa" value={novoBairro.fee} onChange={e => setNovoBairro(prev => ({ ...prev, fee: e.target.value }))} style={{ ...inp, flex: 1 }} />
                <button onClick={() => { if (novoBairro.name && novoBairro.fee) { setCardapio(prev => ({ ...prev, neighborhoods: [...prev.neighborhoods, { name: novoBairro.name, fee: parseFloat(novoBairro.fee) }] })); setNovoBairro({ name: '', fee: '' }) }}} style={{ background: 'var(--primary)', border: 'none', color: 'var(--primary-foreground)', borderRadius: 10, padding: '10px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>+</button>
              </div>
            </div>

            <button id="cardapio-salvar" onClick={salvarCardapio} disabled={salvandoCardapio} style={{ width: '100%', background: salvandoCardapio ? 'var(--surface-secondary)' : 'var(--primary)', border: 'none', borderRadius: 12, padding: '15px', color: 'var(--foreground)', fontSize: 15, fontWeight: 700, cursor: salvandoCardapio ? 'not-allowed' : 'pointer', marginBottom: 8 }}>
              {salvandoCardapio ? 'Salvando...' : 'Salvar Cardapio'}
            </button>
          </div>
        )}
        {/* ABA CONFIG */}
        {aba === 'config' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={card}>
              <p style={sectionTitle}>Pizzaria</p>
              <label style={{ color: 'var(--border-strong)', fontSize: 11, display: 'block', marginBottom: 6 }}>Nome</label>
              <input type="text" value={config.nomePizzaria} onChange={e => setConfig(p => ({ ...p, nomePizzaria: e.target.value }))} style={{ ...inp, marginBottom: 14 }} />
              <label style={{ color: 'var(--border-strong)', fontSize: 11, display: 'block', marginBottom: 6 }}>Chave Pix</label>
              <input type="text" value={config.chavePix} onChange={e => setConfig(p => ({ ...p, chavePix: e.target.value }))} style={{ ...inp, marginBottom: 14 }} placeholder="Ex: 99999999999" />
              <label style={{ color: 'var(--border-strong)', fontSize: 11, display: 'block', marginBottom: 6 }}>Nome do titular</label>
              <input type="text" value={config.nomeTitularPix || ''} onChange={e => setConfig(p => ({ ...p, nomeTitularPix: e.target.value }))} style={inp} placeholder="Ex: Joao Silva" />
            </div>

            <div style={card}>
              <p style={sectionTitle}>Horario</p>
              <button onClick={toggle24h} style={{ width: '100%', background: is24h ? 'var(--success-soft)' : 'var(--surface-secondary)', border: `1px solid ${is24h ? 'color-mix(in srgb, var(--success) 25%, transparent)' : 'var(--surface-elevated)'}`, borderRadius: 10, padding: '12px', color: is24h ? 'var(--success)' : 'var(--foreground-muted)', fontSize: 14, fontWeight: 700, cursor: 'pointer', marginBottom: 12 }}>
                {is24h ? 'Aberto 24 horas — clique para desativar' : 'Ativar 24 horas'}
              </button>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ color: 'var(--border-strong)', fontSize: 11, display: 'block', marginBottom: 4 }}>Abre as</label>
                  <input type="number" min={0} max={23} value={config.horaAbertura} onChange={e => setConfig(p => ({ ...p, horaAbertura: Number(e.target.value) }))} style={inp} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ color: 'var(--border-strong)', fontSize: 11, display: 'block', marginBottom: 4 }}>Fecha as</label>
                  <input type="number" min={0} max={24} value={config.horaFechamento} onChange={e => setConfig(p => ({ ...p, horaFechamento: Number(e.target.value) }))} style={inp} />
                </div>
              </div>
            </div>

            <div style={card}>
              <p style={sectionTitle}>Alerta de pico</p>
              <label style={{ color: 'var(--border-strong)', fontSize: 11, display: 'block', marginBottom: 6 }}>Avisar quando atingir X pedidos simultaneos (0 = desativado)</label>
              <input type="number" value={limitePico} onChange={e => setLimitePico(Number(e.target.value))} style={inp} min={0} />
            </div>

            <div style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
                <div>
                  <p style={{ ...sectionTitle, marginBottom: 4 }}>Integracoes / Mercado Pago</p>
                  <p style={{ color: 'var(--border-strong)', fontSize: 11, margin: 0, lineHeight: 1.45 }}>
                    Preparacao da integracao. Esta etapa nao ativa Pix automatico nem altera o Pix manual.
                  </p>
                </div>
                <span style={{
                  background: mpConfig?.configured && mpConfig.lastTestOk ? 'var(--success-soft)' : 'var(--surface-secondary)',
                  border: `1px solid ${mpConfig?.configured && mpConfig.lastTestOk ? 'color-mix(in srgb, var(--success) 25%, transparent)' : 'var(--surface-elevated)'}`,
                  color: mpConfig?.configured && mpConfig.lastTestOk ? 'var(--success)' : 'var(--foreground-secondary)',
                  borderRadius: 999,
                  padding: '5px 10px',
                  fontSize: 11,
                  fontWeight: 800,
                  whiteSpace: 'nowrap',
                }}>
                  {mpLoading ? 'Carregando' : mpConfig?.configured && mpConfig.lastTestOk ? 'Conectado' : 'Desconectado'}
                </span>
              </div>

              <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-secondary)', borderRadius: 12, padding: 12, marginBottom: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <p style={{ color: 'var(--border-strong)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', margin: '0 0 4px' }}>Token</p>
                    <p style={{ color: mpConfig?.configured ? 'var(--primary)' : 'var(--foreground-muted)', fontSize: 13, fontWeight: 800, margin: 0 }}>
                      {mpConfig?.configured ? 'Configurado' : 'Nao configurado'}
                    </p>
                  </div>
                  <div>
                    <p style={{ color: 'var(--border-strong)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', margin: '0 0 4px' }}>Mascarado</p>
                    <p style={{ color: 'var(--foreground-secondary)', fontSize: 13, fontWeight: 700, margin: 0, wordBreak: 'break-all' }}>
                      {mpConfig?.tokenMasked || '-'}
                    </p>
                  </div>
                </div>
                {mpConfig?.lastTestMessage && (
                  <p style={{ color: mpConfig.lastTestOk ? 'var(--success)' : 'var(--danger)', fontSize: 12, fontWeight: 700, margin: '10px 0 0', lineHeight: 1.4 }}>
                    {mpConfig.lastTestMessage}
                  </p>
                )}
              </div>

              <label style={{ color: 'var(--border-strong)', fontSize: 11, display: 'block', marginBottom: 6 }}>Access Token</label>
              <input
                type="password"
                value={mpToken}
                onChange={e => setMpToken(e.target.value)}
                style={{ ...inp, marginBottom: 6 }}
                placeholder={mpConfig?.configured ? 'Deixe vazio para manter o token atual' : 'Cole o access token do Mercado Pago'}
                autoComplete="off"
              />
              <p style={{ color: 'var(--border-strong)', fontSize: 11, margin: '0 0 12px', lineHeight: 1.4 }}>
                Depois de salvo, o token completo nunca sera exibido novamente.
              </p>

              <label style={{ color: 'var(--border-strong)', fontSize: 11, display: 'block', marginBottom: 6 }}>E-mail fallback do pagador</label>
              <input
                type="email"
                value={mpPayerEmail}
                onChange={e => setMpPayerEmail(e.target.value)}
                style={{ ...inp, marginBottom: 12 }}
                placeholder="cliente@example.com"
              />

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button onClick={salvarMercadoPago} disabled={mpSaving || mpLoading} style={{ width: '100%', background: mpSaving ? 'var(--surface-secondary)' : 'var(--primary)', border: 'none', borderRadius: 10, padding: '12px', color: 'var(--foreground)', fontSize: 14, fontWeight: 800, cursor: mpSaving || mpLoading ? 'not-allowed' : 'pointer' }}>
                  {mpSaving ? 'Salvando...' : 'Salvar configuracao'}
                </button>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={testarMercadoPago} disabled={mpTesting || !mpConfig?.configured} style={{ flex: 1, background: mpTesting || !mpConfig?.configured ? 'var(--background)' : 'var(--surface-secondary)', border: '1px solid var(--surface-elevated)', color: mpConfig?.configured ? 'var(--success)' : 'var(--border-strong)', borderRadius: 10, padding: '11px', fontSize: 13, fontWeight: 800, cursor: mpTesting || !mpConfig?.configured ? 'not-allowed' : 'pointer' }}>
                    {mpTesting ? 'Testando...' : 'Testar conexao'}
                  </button>
                  <button onClick={removerMercadoPago} disabled={mpRemoving || !mpConfig?.configured} style={{ flex: 1, background: mpRemoving || !mpConfig?.configured ? 'var(--background)' : 'var(--surface-secondary)', border: '1px solid var(--surface-elevated)', color: mpConfig?.configured ? 'var(--danger)' : 'var(--border-strong)', borderRadius: 10, padding: '11px', fontSize: 13, fontWeight: 800, cursor: mpRemoving || !mpConfig?.configured ? 'not-allowed' : 'pointer' }}>
                    {mpRemoving ? 'Removendo...' : 'Desconectar Mercado Pago'}
                  </button>
                </div>
              </div>
            </div>

            <div style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <p style={sectionTitle}>Cardapio por imagem</p>
                <button onClick={toggleImagensAtivo} style={{ background: imagens.ativo ? 'var(--success-soft)' : 'var(--surface-secondary)', border: `1px solid ${imagens.ativo ? 'color-mix(in srgb, var(--success) 25%, transparent)' : 'var(--surface-elevated)'}`, color: imagens.ativo ? 'var(--success)' : 'var(--foreground-muted)', borderRadius: 8, padding: '4px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                  {imagens.ativo ? 'Ativo' : 'Inativo'}
                </button>
              </div>
              {[{ key: 'pizza', label: 'Pizzas', ref: inputPizzaRef }, { key: 'lanche', label: 'Lanches', ref: inputLancheRef }, { key: 'bebida', label: 'Bebidas', ref: inputBebidaRef }, { key: 'suco', label: 'Sucos', ref: inputSucoRef }].map(({ key, label, ref }) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--surface-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                    {(imagens as any)[key] ? <img src={(imagens as any)[key]} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt={label} /> : <span style={{ color: 'var(--border-strong)', fontSize: 11 }}>{label}</span>}
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={{ color: 'var(--foreground)', fontSize: 13, margin: '0 0 4px' }}>{label}</p>
                    <p style={{ color: 'var(--border-strong)', fontSize: 11, margin: 0 }}>{(imagens as any)[key] ? 'Imagem carregada' : 'Sem imagem'}</p>
                  </div>
                  <input ref={ref} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { if (e.target.files?.[0]) uploadImagem(key, e.target.files[0]) }} />
                  <button onClick={() => ref.current?.click()} disabled={uploadando === key} style={{ background: 'var(--surface-secondary)', border: '1px solid var(--surface-elevated)', color: 'var(--brand-text)', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {uploadando === key ? '...' : 'Carregar'}
                  </button>
                </div>
              ))}
            </div>

            <button onClick={salvarConfig} disabled={salvando} style={{ width: '100%', background: salvando ? 'var(--surface-secondary)' : 'var(--primary)', border: 'none', borderRadius: 12, padding: '15px', color: 'var(--foreground)', fontSize: 15, fontWeight: 700, cursor: salvando ? 'not-allowed' : 'pointer', marginBottom: 8 }}>
              {salvando ? 'Salvando...' : 'Salvar Configuracoes'}
            </button>

            <div style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <p style={sectionTitle}>Funcionarios</p>
                <button onClick={() => setShowNovoFunc(!showNovoFunc)} style={{ background: 'var(--primary)', border: 'none', color: 'var(--primary-foreground)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>+ Novo</button>
              </div>
              {showNovoFunc && (
                <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 14, marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input placeholder="Nome" value={novoFunc.name} onChange={e => setNovoFunc(p => ({ ...p, name: e.target.value }))} style={inp} />
                  <input placeholder="@usuario" value={novoFunc.username} onChange={e => setNovoFunc(p => ({ ...p, username: e.target.value }))} style={inp} />
                  <input placeholder="Senha" type="password" value={novoFunc.password} onChange={e => setNovoFunc(p => ({ ...p, password: e.target.value }))} style={inp} />
                  <select value={novoFunc.role} onChange={e => setNovoFunc(p => ({ ...p, role: e.target.value }))} style={{ ...inp, appearance: 'none' as any }}>
                    <option value="atendente">Atendente (Cozinha)</option>
                    <option value="financeiro">Financeiro (Dono)</option>
                    <option value="contador">Contador</option>
                    <option value="entregador">Entregador</option>
                    {getUserInfo()?.role === 'dev' && <option value="admin">Admin (Dono total)</option>}
                  </select>
                  <button onClick={criarFunc} disabled={criando} style={{ background: 'var(--primary)', border: 'none', color: 'var(--primary-foreground)', borderRadius: 10, padding: '11px', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>
                    {criando ? 'Criando...' : 'Criar funcionario'}
                  </button>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {funcionarios.map(f => (
                  <div key={f.username} style={{ background: 'var(--surface)', borderRadius: 10, padding: 14 }}>
                    <p style={{ color: 'var(--foreground)', fontSize: 14, fontWeight: 700, margin: '0 0 10px' }}>{f.name} <span style={{ color: 'var(--border-strong)', fontSize: 11, fontWeight: 400 }}>@{f.username}</span></p>
                    <input placeholder="Novo nome" value={nomes[f.username] || ''} onChange={e => setNomes(p => ({ ...p, [f.username]: e.target.value }))} style={{ ...inp, marginBottom: 8 }} />
                    <input placeholder="Nova senha" type="password" value={senhas[f.username] || ''} onChange={e => setSenhas(p => ({ ...p, [f.username]: e.target.value }))} style={{ ...inp, marginBottom: 8 }} />
                    <button onClick={() => salvarFunc(f.username)} style={{ width: '100%', background: 'var(--surface-secondary)', border: '1px solid var(--surface-elevated)', color: 'var(--foreground)', borderRadius: 8, padding: '10px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Salvar</button>
                  </div>
                ))}
              </div>
            </div>

            <div style={card}>
              <p style={sectionTitle}>Entregadores</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                {entregadores.map(e => (
                  <div key={e.id} style={{ background: 'var(--surface)', borderRadius: 10, padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <p style={{ color: 'var(--foreground)', fontSize: 13, fontWeight: 700, margin: 0 }}>{e.nome}</p>
                      <p style={{ color: 'var(--border-strong)', fontSize: 11, margin: '2px 0 0' }}>{e.telefone}</p>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={async () => {
                        await fetch('/api/entregadores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: e.id, ativo: !e.ativo }) })
                        setEntregadores(prev => prev.map(x => x.id === e.id ? { ...x, ativo: !x.ativo } : x))
                      }} style={{ background: e.ativo ? 'var(--success-soft)' : 'var(--surface-secondary)', border: `1px solid ${e.ativo ? 'color-mix(in srgb, var(--success) 25%, transparent)' : 'var(--surface-elevated)'}`, color: e.ativo ? 'var(--success)' : 'var(--foreground-muted)', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
                        {e.ativo ? 'Ativo' : 'Inativo'}
                      </button>
                      <button onClick={async () => {
                        await fetch('/api/entregadores', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: e.id }) })
                        setEntregadores(prev => prev.filter(x => x.id !== e.id))
                      }} style={{ background: 'var(--surface-secondary)', border: '1px solid var(--surface-elevated)', color: 'var(--danger)', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 11 }}>x</button>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input placeholder="Nome" value={novoEntregador.nome} onChange={e => setNovoEntregador(prev => ({ ...prev, nome: e.target.value }))} style={{ ...inp, flex: 1 }} />
                <input placeholder="Telefone" value={novoEntregador.telefone} onChange={e => setNovoEntregador(prev => ({ ...prev, telefone: e.target.value }))} style={{ ...inp, flex: 1 }} />
              </div>
              <button onClick={async () => {
                if (!novoEntregador.nome || !novoEntregador.telefone) return
                setSalvandoEntregador(true)
                const res = await fetch('/api/entregadores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(novoEntregador) })
                const d = await res.json()
                if (d.ok) { setEntregadores(prev => [...prev, d.entregador]); setNovoEntregador({ nome: '', telefone: '' }); msg('Entregador adicionado!') }
                setSalvandoEntregador(false)
              }} disabled={salvandoEntregador} style={{ width: '100%', background: 'var(--primary)', border: 'none', borderRadius: 10, padding: '11px', color: 'var(--primary-foreground)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                {salvandoEntregador ? 'Salvando...' : '+ Adicionar entregador'}
              </button>
            </div>
          </div>
        )}
        {/* ABA FINANCEIRO */}
        {aba === 'financeiro' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-secondary)', borderRadius: 14, padding: '12px 10px' }}>
                <p style={{ color: 'var(--border-strong)', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', margin: '0 0 4px', letterSpacing: 0.5 }}>Entradas</p>
                <p style={{ color: 'var(--success)', fontSize: 15, fontWeight: 800, margin: 0 }}>R$ {faturamentoMes.toFixed(2).replace('.', ',')}</p>
              </div>
              <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-secondary)', borderRadius: 14, padding: '12px 10px' }}>
                <p style={{ color: 'var(--border-strong)', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', margin: '0 0 4px', letterSpacing: 0.5 }}>Custos</p>
                <p style={{ color: 'var(--danger)', fontSize: 15, fontWeight: 800, margin: 0 }}>R$ {custos.reduce((s, c) => s + c.valor, 0).toFixed(2).replace('.', ',')}</p>
              </div>
              <div style={{ background: 'var(--surface)', border: `1px solid ${faturamentoMes - custos.reduce((s, c) => s + c.valor, 0) >= 0 ? 'color-mix(in srgb, var(--success) 19%, transparent)' : 'color-mix(in srgb, var(--danger) 19%, transparent)'}`, borderRadius: 14, padding: '12px 10px' }}>
                <p style={{ color: 'var(--border-strong)', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', margin: '0 0 4px', letterSpacing: 0.5 }}>Lucro</p>
                <p style={{ color: faturamentoMes - custos.reduce((s, c) => s + c.valor, 0) >= 0 ? 'var(--success)' : 'var(--danger)', fontSize: 15, fontWeight: 800, margin: 0 }}>R$ {(faturamentoMes - custos.reduce((s, c) => s + c.valor, 0)).toFixed(2).replace('.', ',')}</p>
              </div>
            </div>

            {mesFechado && (
              <div style={{ background: 'color-mix(in srgb, var(--success-soft) 13%, transparent)', border: '1px solid color-mix(in srgb, var(--success) 19%, transparent)', borderRadius: 14, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <p style={{ color: 'var(--success)', fontSize: 13, fontWeight: 700, margin: 0 }}>Mes fechado pelo contador — somente leitura</p>
              </div>
            )}

            {!mesFechado && (
              <>
                <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={async e => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  setAnalisandoNota(true)
                  try {
                    const base64 = await new Promise<string>((resolve, reject) => {
                      const reader = new FileReader()
                      reader.onload = () => resolve((reader.result as string).split(',')[1])
                      reader.onerror = reject
                      reader.readAsDataURL(file)
                    })
                    const res = await fetch('/api/analisar-nota', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base64, mimeType: file.type }) })
                    const d = await res.json()
                    if (d.descricao) setNovoDescricao(d.descricao)
                    if (d.valor) setNovoValor(String(d.valor))
                    if (d.categoria) setNovaCategoria(d.categoria)
                    msg('Nota reconhecida!')
                  } catch { msg('Nao consegui ler a nota.') }
                  setAnalisandoNota(false)
                }} />

                <button onClick={() => cameraRef.current?.click()} disabled={analisandoNota} style={{ width: '100%', background: analisandoNota ? 'var(--surface-secondary)' : 'var(--success-soft)', border: `2px dashed ${analisandoNota ? 'var(--surface-elevated)' : 'color-mix(in srgb, var(--success) 31%, transparent)'}`, borderRadius: 16, padding: '24px 16px', cursor: analisandoNota ? 'not-allowed' : 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 60, height: 60, borderRadius: '50%', background: analisandoNota ? 'var(--surface-secondary)' : 'color-mix(in srgb, var(--success) 13%, transparent)', border: `2px solid ${analisandoNota ? 'var(--surface-elevated)' : 'color-mix(in srgb, var(--success) 25%, transparent)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>
                    {analisandoNota ? '...' : <Camera size={26} color="var(--success)" aria-hidden="true" />}
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <p style={{ color: analisandoNota ? 'var(--border-strong)' : 'var(--success)', fontSize: 15, fontWeight: 700, margin: 0 }}>{analisandoNota ? 'Analisando nota...' : 'Fotografar nota fiscal'}</p>
                    <p style={{ color: 'var(--surface-elevated)', fontSize: 11, margin: '4px 0 0' }}>A IA preenche tudo automaticamente</p>
                  </div>
                </button>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1, height: 1, background: 'var(--surface-secondary)' }} />
                  <span style={{ color: 'var(--surface-elevated)', fontSize: 11 }}>ou preencha manualmente</span>
                  <div style={{ flex: 1, height: 1, background: 'var(--surface-secondary)' }} />
                </div>

                <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-secondary)', borderRadius: 16, padding: 16 }}>
                  <input placeholder="Descricao do produto" value={novoDescricao} onChange={e => setNovoDescricao(e.target.value)} style={{ ...inp, marginBottom: 8 }} />
                  <input placeholder="Valor (R$)" value={novoValor} onChange={e => setNovoValor(e.target.value)} style={{ ...inp, marginBottom: 10 }} />
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                    {CATEGORIAS_FIN.map(cat => (
                      <button key={cat.key} onClick={() => setNovaCategoria(cat.key)} style={{ padding: '5px 10px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, background: novaCategoria === cat.key ? cat.cor : 'var(--surface-secondary)', color: novaCategoria === cat.key ? 'var(--foreground)' : 'var(--border-strong)' }}>
                        {cat.label}
                      </button>
                    ))}
                  </div>
                  <button onClick={async () => {
                    if (!novoDescricao.trim() || !novoValor.trim()) return
                    setSalvandoCusto(true)
                    const res = await fetch('/api/financeiro', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ descricao: novoDescricao.trim(), valor: parseFloat(novoValor.replace(',', '.')), categoria: novaCategoria }) })
                    const d = await res.json()
                    if (d.ok) { setCustos(prev => [...prev, d.custo]); setNovoDescricao(''); setNovoValor(''); msg('Custo adicionado!') }
                    setSalvandoCusto(false)
                  }} disabled={salvandoCusto} style={{ width: '100%', background: salvandoCusto ? 'var(--surface-secondary)' : 'var(--success)', border: 'none', borderRadius: 12, padding: '13px', color: 'var(--foreground)', fontSize: 14, fontWeight: 700, cursor: salvandoCusto ? 'not-allowed' : 'pointer' }}>
                    {salvandoCusto ? 'Salvando...' : '+ Adicionar'}
                  </button>
                </div>
              </>
            )}

            {custos.length > 0 && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-secondary)', borderRadius: 16, padding: 16 }}>
                <p style={{ color: 'var(--border-strong)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 12px' }}>Lancamentos de {mesLabel}</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {custos.slice().reverse().map(c => {
                    const cat = CATEGORIAS_FIN.find(cat => cat.key === c.categoria)
                    const estaEditando = editandoCusto === c.id
                    return (
                      <div key={c.id} style={{ background: 'var(--surface)', borderRadius: 12, padding: '10px 12px' }}>
                        {estaEditando ? (
                          <div>
                            <input value={editDescricao} onChange={e => setEditDescricao(e.target.value)} style={{ ...inp, marginBottom: 6 }} />
                            <input value={editValor} onChange={e => setEditValor(e.target.value)} style={{ ...inp, marginBottom: 8 }} />
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                              {CATEGORIAS_FIN.map(cat => (
                                <button key={cat.key} onClick={() => setEditCategoria(cat.key)} style={{ padding: '3px 8px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 10, fontWeight: 600, background: editCategoria === cat.key ? cat.cor : 'var(--surface-secondary)', color: editCategoria === cat.key ? 'var(--foreground)' : 'var(--border-strong)' }}>{cat.label}</button>
                              ))}
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button onClick={async () => {
                                const res = await fetch('/api/financeiro', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: c.id, descricao: editDescricao, valor: parseFloat(editValor.replace(',', '.')), categoria: editCategoria, mes: mesAtual }) })
                                if (res.ok) { setCustos(prev => prev.map(x => x.id === c.id ? { ...x, descricao: editDescricao, valor: parseFloat(editValor.replace(',', '.')), categoria: editCategoria } : x)); setEditandoCusto(null); msg('Atualizado!') }
                              }} style={{ flex: 1, background: 'var(--success)', border: 'none', borderRadius: 8, padding: '9px', color: 'var(--foreground)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Salvar</button>
                              <button onClick={() => setEditandoCusto(null)} style={{ background: 'var(--surface-secondary)', border: '1px solid var(--surface-elevated)', borderRadius: 8, padding: '9px 14px', color: 'var(--foreground-muted)', fontSize: 12, cursor: 'pointer' }}>Cancelar</button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ flex: 1 }}>
                              <p style={{ color: 'var(--foreground)', fontSize: 13, fontWeight: 600, margin: 0 }}>{c.descricao}</p>
                              <p style={{ color: 'var(--border-strong)', fontSize: 11, margin: '2px 0 0' }}>{cat?.label} · {c.data}</p>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ color: 'var(--danger)', fontSize: 13, fontWeight: 700 }}>R$ {c.valor.toFixed(2).replace('.', ',')}</span>
                              {!mesFechado && (
                                <>
                                  <button onClick={() => { setEditandoCusto(c.id); setEditDescricao(c.descricao); setEditValor(String(c.valor)); setEditCategoria(c.categoria) }} style={{ background: 'none', border: 'none', color: 'var(--border-strong)', cursor: 'pointer', fontSize: 12, padding: 0 }}>edit</button>
                                  <button onClick={async () => {
                                    await fetch('/api/financeiro', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: c.id, mes: mesAtual }) })
                                    setCustos(prev => prev.filter(x => x.id !== c.id))
                                    msg('Removido!')
                                  }} style={{ background: 'none', border: 'none', color: 'var(--surface-elevated)', cursor: 'pointer', fontSize: 17, padding: 0 }}>x</button>
                                </>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ABA DEV */}
        {aba === 'financeiro' && pedidos.filter(p => p.status === 'entregue' && p.entregador).length > 0 && (() => {
          const entregasFeitas = pedidos.filter(p => p.status === 'entregue' && p.entregador)
          const porEntregador: Record<string, { nome: string; entregas: Pedido[] }> = {}
          entregasFeitas.forEach(p => {
            if (!p.entregador) return
            const id = p.entregador.id
            if (!porEntregador[id]) porEntregador[id] = { nome: p.entregador.nome, entregas: [] }
            porEntregador[id].entregas.push(p)
          })
          return (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-secondary)', borderRadius: 16, padding: 16, marginTop: 8 }}>
              <p style={{ color: 'var(--brand-text)', fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1, margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: 6 }}><Banknote size={14} aria-hidden="true" /> Pagamento de Entregadores</p>
              {Object.values(porEntregador).map(({ nome, entregas }) => {
                const total = entregas.reduce((s, p) => s + (p.taxaEntrega || 0), 0)
                const porBairro: Record<string, { count: number; taxa: number }> = {}
                entregas.forEach(p => {
                  const b = p.bairro || 'Sem bairro'
                  if (!porBairro[b]) porBairro[b] = { count: 0, taxa: p.taxaEntrega || 0 }
                  porBairro[b].count++
                })
                return (
                  <div key={nome} style={{ background: 'var(--surface)', borderRadius: 12, padding: 14, marginBottom: 10, border: '1px solid var(--surface-secondary)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <div>
                        <p style={{ color: 'var(--foreground)', fontSize: 15, fontWeight: 900, margin: 0 }}>{nome}</p>
                        <p style={{ color: 'var(--foreground-muted)', fontSize: 11, fontWeight: 600, margin: '2px 0 0' }}>{entregas.length} entrega{entregas.length > 1 ? 's' : ''}</p>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <p style={{ color: 'var(--success)', fontSize: 20, fontWeight: 900, margin: 0 }}>R$ {total.toFixed(2).replace('.', ',')}</p>
                        <p style={{ color: 'var(--foreground-muted)', fontSize: 10, fontWeight: 600, margin: '2px 0 0' }}>a receber</p>
                      </div>
                    </div>
                    <div style={{ borderTop: '1px solid var(--surface-secondary)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {Object.entries(porBairro).map(([bairro, { count, taxa }]) => (
                        <div key={bairro} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ color: 'var(--brand-text)', fontSize: 12, fontWeight: 800 }}>{count}×</span>
                            <span style={{ color: 'var(--foreground-secondary)', fontSize: 13, fontWeight: 600 }}>{bairro}</span>
                          </div>
                          <span style={{ color: 'var(--brand-text)', fontSize: 13, fontWeight: 700 }}>R$ {(count * taxa).toFixed(2).replace('.', ',')}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })()}

        {aba === 'dev' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={card}>
              <p style={sectionTitle}>Suporte tecnico</p>
              <p style={{ color: 'var(--border-strong)', fontSize: 12, margin: '0 0 12px' }}>Precisa de ajuda? Entre em contato com a Ominix.</p>
              <button onClick={() => window.open('https://wa.me/5599974000691?text=Ola! Preciso de suporte com o ChefeBot.', '_blank')} style={{ width: '100%', background: 'var(--success-soft)', border: '1px solid color-mix(in srgb, var(--success) 15%, transparent)', borderRadius: 10, padding: '13px', color: 'var(--success)', fontSize: 14, fontWeight: 700, cursor: 'pointer', marginBottom: 8 }}>
                Falar com suporte no WhatsApp
              </button>
            </div>

            {getUserInfo()?.role === 'dev' && (
              <div style={card}>
                <p style={sectionTitle}>Ferramentas dev</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button onClick={() => router.push('/dev')} style={{ background: 'var(--surface-secondary)', border: '1px solid var(--surface-elevated)', color: 'var(--foreground)', borderRadius: 10, padding: '12px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600, textAlign: 'left' }}>Logs do sistema</button>
                  <button onClick={() => router.push('/relatorios')} style={{ background: 'var(--surface-secondary)', border: '1px solid var(--surface-elevated)', color: 'var(--foreground)', borderRadius: 10, padding: '12px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600, textAlign: 'left' }}>Relatorios</button>
                </div>
              </div>
            )}

            <div style={card}>
              <p style={sectionTitle}>Reset de sessao</p>
              <label style={{ color: 'var(--border-strong)', fontSize: 11, display: 'block', marginBottom: 6 }}>Numero do cliente (com DDI)</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input id="reset-phone" placeholder="5599999999999" style={{ ...inp, flex: 1 }} />
                <button onClick={async () => {
                  const phone = (document.getElementById('reset-phone') as HTMLInputElement)?.value
                  if (!phone) return
                  const res = await fetch('/api/reset-session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone }) })
                  if (res.ok) msg('Sessao resetada!')
                  else msg('Erro ao resetar.')
                }} style={{ background: 'var(--primary)', border: 'none', color: 'var(--primary-foreground)', borderRadius: 10, padding: '10px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>
                  Reset
                </button>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* Navegacao inferior */}
      <div className="cb-admin-bottomnav" style={{ position: 'fixed', bottom: 0, right: 0, background: 'var(--surface)', borderTop: '1px solid var(--border)', padding: '10px 0', paddingBottom: 'calc(env(safe-area-inset-bottom) + 10px)', zIndex: 100 }}>
        {ABA_TABS.map(({ key, Icon, label }) => (
          <button key={key} onClick={() => setAba(key)} style={{ flex: 1, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '6px 0', minHeight: 48, fontFamily: "'Archivo', sans-serif" }}>
            <Icon size={20} color={aba === key ? 'var(--primary)' : 'var(--border-strong)'} opacity={aba === key ? 1 : 0.3} aria-hidden="true" />
            <span style={{ fontSize: 10, color: aba === key ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: aba === key ? 700 : 400 }}>{label}</span>
            {aba === key && <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--primary)' }} />}
          </button>
        ))}
      </div>
    </div>
    </PanelShell>
  )
}
