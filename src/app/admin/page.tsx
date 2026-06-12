'use client'
import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import TourGuiado from '@/components/TourGuiado'

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

const inp = { width: '100%', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 10, padding: '11px 14px', color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box' as const }
const btn = (active: boolean) => ({ padding: '10px 0', borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: active ? '#ff6b00' : '#1a1a1a', color: active ? '#fff' : '#555' })
const card = { background: '#111', border: '1px solid #1e1e1e', borderRadius: 14, padding: 16 }
const sectionTitle = { color: '#555', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 12 }

const CATEGORIAS_FIN = [
  { key: 'ingredientes', label: 'Ingredientes', cor: '#f97316' },
  { key: 'embalagens', label: 'Embalagens', cor: '#3b82f6' },
  { key: 'energia', label: 'Energia/Gas', cor: '#eab308' },
  { key: 'funcionarios', label: 'Funcionarios', cor: '#8b5cf6' },
  { key: 'aluguel', label: 'Aluguel', cor: '#ec4899' },
  { key: 'marketing', label: 'Marketing', cor: '#06b6d4' },
  { key: 'manutencao', label: 'Manutencao', cor: '#84cc16' },
  { key: 'outros', label: 'Outros', cor: '#6b7280' },
]

const PASSOS_TOUR_CARDAPIO = [
  { face: String.fromCodePoint(0x1F468, 0x200D, 0x1F373), tag: 'Bem-vindo!', tagBg: '#ff6b0015', tagColor: '#ff6b00', title: 'Sou o Chef, seu guia!', text: 'Vou te ensinar como editar seu cardapio em 4 passos rapidos!', nextLabel: 'Bora!', nextBg: 'linear-gradient(135deg,#ff6b00,#ff9500)', accent: '#ff6b00' },
  { face: String.fromCodePoint(0x1F9D0), tag: 'Passo 1 de 4', tagBg: '#1d3a6e', tagColor: '#60a5fa', title: 'Toque no x para remover', text: 'Cada bolinha e um sabor. Quer tirar algum? So tocar no x ao lado do nome!', highlightId: 'cardapio-sabores', arrowId: 'cardapio-sabores', nextLabel: 'Entendi!', nextBg: 'linear-gradient(135deg,#3b82f6,#6366f1)', accent: '#3b82f6', particles: true },
  { face: String.fromCodePoint(0x1F604), tag: 'Passo 2 de 4', tagBg: '#2e1a5e', tagColor: '#a78bfa', title: 'Toque + para adicionar', text: 'Clique em + Add para incluir novos sabores. Pode adicionar quantos quiser!', highlightId: 'cardapio-add-btn', arrowId: 'cardapio-add-btn', nextLabel: 'Facil demais!', nextBg: 'linear-gradient(135deg,#8b5cf6,#ec4899)', accent: '#8b5cf6', particles: true },
  { face: String.fromCodePoint(0x1F62E), tag: 'Passo 3 - IMPORTANTE', tagBg: '#3d0f0f', tagColor: '#f87171', title: 'Sempre salve no final!', text: 'Depois de editar aperte o botao verde Salvar Cardapio. Sem salvar o bot nao aprende!', highlightId: 'cardapio-salvar', arrowId: 'cardapio-salvar', nextLabel: 'Anotado!', nextBg: 'linear-gradient(135deg,#ef4444,#ff6b00)', accent: '#ef4444', particles: true, showDismiss: true },
  { face: String.fromCodePoint(0x1F973), tag: 'Pronto!', tagBg: '#0d2e16', tagColor: '#4ade80', title: 'Voce e um craque!', text: 'Agora e so editar o cardapio do seu jeito. Qualquer duvida e so chamar!', nextLabel: 'Usar agora!', nextBg: 'linear-gradient(135deg,#16a34a,#4ade80)', accent: '#16a34a', showDismiss: true, last: true },
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
  const cameraRef = useRef<HTMLInputElement>(null)
  const inputPizzaRef = useRef<HTMLInputElement>(null)
  const inputLancheRef = useRef<HTMLInputElement>(null)
  const inputBebidaRef = useRef<HTMLInputElement>(null)
  const inputSucoRef = useRef<HTMLInputElement>(null)
  const mesAtual = new Date().toISOString().slice(0, 7)
  const mesLabel = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  const is24h = config.horaAbertura === 0 && config.horaFechamento === 24

  useEffect(() => {
    const user = getUserInfo()
    if (!user || (user.role !== 'admin' && user.role !== 'dev')) { router.push('/login?callbackUrl=/admin'); return }
    setNomeUsuario(user.name)
    Promise.all([
      fetch('/api/orders').then(r => r.json()),
      fetch('/api/configuracoes').then(r => r.json()),
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

  const msg = (m: string) => { setMensagem(m); setTimeout(() => setMensagem(''), 3000) }

  const pedidosFiltrados = filtraPorPeriodo(pedidos, periodo, dataInicio, dataFim).filter(p => !p.escalonado && p.status !== 'cancelado')
  const pedidosEntregues = pedidosFiltrados.filter(p => p.status === 'entregue')
  const faturamento = pedidosEntregues.reduce((s, p) => s + (Number(p.total) || 0), 0)
  const totalEntregues = pedidosEntregues.length
  const ticketMedio = totalEntregues > 0 ? faturamento / totalEntregues : 0
  const telefonesTotal = pedidosEntregues.reduce((acc: Record<string, number>, p) => { acc[p.telefone] = (acc[p.telefone] || 0) + 1; return acc }, {})
  const recorrentes = Object.values(telefonesTotal).filter(v => v > 1).length
  const graficoPico = calcularGraficoPico(pedidosFiltrados)
  const maxPico = graficoPico.length > 0 ? Math.max(...graficoPico.map(g => g.total)) : 1

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
    <div style={{ minHeight: '100vh', background: '#080808', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#333', fontSize: 14 }}>Carregando...</p>
    </div>
  )
  return (
    <div style={{ minHeight: '100vh', background: '#080808', fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", paddingBottom: 80 }}>
      <style>{`@keyframes slideUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } } input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(1); }`}</style>

      {/* Header */}
      <div style={{ background: '#0d0d0d', borderBottom: '1px solid #161616', padding: '14px 16px', position: 'sticky', top: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: '#ff6b00', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🍕</div>
          <div>
            <p style={{ color: '#fff', fontSize: 15, fontWeight: 700, margin: 0, letterSpacing: -0.3 }}>ChefeBot</p>
            <p style={{ color: '#444', fontSize: 10, margin: 0 }}>Ola, {nomeUsuario}</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {getUserInfo()?.role === 'dev' && <button onClick={() => router.push('/dev')} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#60a5fa', borderRadius: 10, padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Dev</button>}
          <button onClick={() => router.push('/pedidos')} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#fff', borderRadius: 10, padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Cozinha</button>
          <button onClick={() => fetch('/api/auth/logout', { method: 'POST' }).then(() => router.push('/login'))} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#555', borderRadius: 10, padding: '8px 12px', cursor: 'pointer', fontSize: 12 }}>Sair</button>
        </div>
      </div>

      {mensagem && (
        <div style={{ background: mensagem.includes('salv') || mensagem.includes('cri') || mensagem.includes('carr') ? '#14532d' : '#7f1d1d', margin: '12px 16px 0', borderRadius: 10, padding: '10px 14px', color: mensagem.includes('salv') || mensagem.includes('cri') || mensagem.includes('carr') ? '#4ade80' : '#f87171', fontWeight: 600, fontSize: 13, animation: 'slideUp 0.2s ease' }}>
          {mensagem}
        </div>
      )}

      <div style={{ padding: '16px 16px 0' }}>

        {/* ABA DASHBOARD */}
        {aba === 'dashboard' && (
          <div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
              {(['ontem', 'hoje', 'semana'] as Periodo[]).map(p => (
                <button key={p} onClick={() => { setPeriodo(p); setShowPeriodo(false) }} style={{ ...btn(periodo === p), flex: 1 }}>
                  {p === 'ontem' ? 'Ontem' : p === 'hoje' ? 'Hoje' : 'Semana'}
                </button>
              ))}
              <button onClick={() => setShowPeriodo(!showPeriodo)} style={{ ...btn(periodo === 'personalizado'), padding: '10px 14px' }}>📅</button>
            </div>

            {showPeriodo && (
              <div style={{ ...card, marginBottom: 16, animation: 'slideUp 0.2s ease' }}>
                <p style={sectionTitle}>Periodo personalizado</p>
                <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ color: '#555', fontSize: 11, display: 'block', marginBottom: 4 }}>De</label>
                    <input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)} style={inp} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ color: '#555', fontSize: 11, display: 'block', marginBottom: 4 }}>Ate</label>
                    <input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)} style={inp} />
                  </div>
                </div>
                <button onClick={() => { if (dataInicio && dataFim) { setPeriodo('personalizado'); setShowPeriodo(false) } }} style={{ width: '100%', background: '#ff6b00', border: 'none', borderRadius: 10, padding: '11px', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Aplicar</button>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
              <div style={card}>
                <p style={{ color: '#555', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', margin: '0 0 6px', letterSpacing: 0.5 }}>Faturamento</p>
                <p style={{ color: '#4ade80', fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: -0.5 }}>R$ {faturamento.toFixed(2).replace('.', ',')}</p>
                <p style={{ color: '#333', fontSize: 10, margin: '4px 0 0' }}>{totalEntregues} entregues</p>
              </div>
              <div style={card}>
                <p style={{ color: '#555', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', margin: '0 0 6px', letterSpacing: 0.5 }}>Ticket medio</p>
                <p style={{ color: '#fbbf24', fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: -0.5 }}>R$ {ticketMedio.toFixed(2).replace('.', ',')}</p>
                <p style={{ color: '#333', fontSize: 10, margin: '4px 0 0' }}>por pedido</p>
              </div>
              <div style={card}>
                <p style={{ color: '#555', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', margin: '0 0 6px', letterSpacing: 0.5 }}>Clientes</p>
                <p style={{ color: '#fff', fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: -0.5 }}>{Object.keys(telefonesTotal).length}</p>
                <p style={{ color: '#333', fontSize: 10, margin: '4px 0 0' }}>{recorrentes} retornaram</p>
              </div>
              <div style={card}>
                <p style={{ color: '#555', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', margin: '0 0 6px', letterSpacing: 0.5 }}>Avaliacao</p>
                <p style={{ color: '#fbbf24', fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: -0.5 }}>{avaliacoes.media > 0 ? avaliacoes.media.toFixed(1) : '—'} ★</p>
                <p style={{ color: '#333', fontSize: 10, margin: '4px 0 0' }}>{avaliacoes.total} avaliacoes</p>
              </div>
            </div>

            {graficoPico.length > 0 && (
              <div style={{ ...card, marginBottom: 16 }}>
                <p style={sectionTitle}>Horario de pico</p>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 80 }}>
                  {graficoPico.map((item, i) => {
                    const altura = maxPico > 0 ? Math.max((item.total / maxPico) * 100, 4) : 4
                    const isPico = item.total === maxPico && maxPico > 0
                    return (
                      <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                        {item.total > 0 && <p style={{ color: isPico ? '#ff6b00' : '#555', fontSize: 7, margin: 0, fontWeight: isPico ? 900 : 400 }}>{item.total}</p>}
                        <div style={{ width: '100%', height: `${altura}%`, background: isPico ? '#ff6b00' : item.total > 0 ? '#2a2a2a' : '#161616', borderRadius: '3px 3px 0 0', minHeight: 3 }} />
                      </div>
                    )
                  })}
                </div>
                <div style={{ display: 'flex', gap: 2, marginTop: 4, overflowX: 'hidden' }}>
                  {graficoPico.map((item, i) => (
                    <p key={i} style={{ flex: 1, color: item.total > 0 ? '#555' : '#222', fontSize: 7, margin: 0, textAlign: 'center' }}>{item.hora.replace('h','')}</p>
                  ))}
                </div>
              </div>
            )}

            {ranking.length > 0 && (
              <div style={{ ...card, marginBottom: 16 }}>
                <p style={sectionTitle}>Pizzas mais pedidas</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {ranking.slice(0, 5).map((item, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 14, fontWeight: 800, color: i === 0 ? '#fbbf24' : i === 1 ? '#9ca3af' : i === 2 ? '#b45309' : '#333', minWidth: 20 }}>{i + 1}.</span>
                      <p style={{ color: '#e0e0e0', fontSize: 13, margin: 0, flex: 1 }}>{item.nome}</p>
                      <div style={{ width: 70, background: '#1e1e1e', borderRadius: 4, height: 6 }}>
                        <div style={{ height: 6, borderRadius: 4, background: '#ff6b00', width: `${Math.max((item.total / (ranking[0]?.total || 1)) * 100, 8)}%` }} />
                      </div>
                      <span style={{ color: '#444', fontSize: 11, minWidth: 24, textAlign: 'right' }}>{item.total}x</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {avaliacoes.total > 0 && (
              <div style={{ ...card, marginBottom: 16 }}>
                <p style={sectionTitle}>Avaliacoes recentes</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <p style={{ color: '#fbbf24', fontSize: 36, fontWeight: 800, margin: 0, letterSpacing: -1 }}>{avaliacoes.media.toFixed(1)}</p>
                  <div>
                    <div style={{ display: 'flex', gap: 2 }}>
                      {[1,2,3,4,5].map(s => <span key={s} style={{ color: s <= Math.round(avaliacoes.media) ? '#fbbf24' : '#333', fontSize: 14 }}>★</span>)}
                    </div>
                    <p style={{ color: '#444', fontSize: 11, margin: '2px 0 0' }}>{avaliacoes.total} avaliacoes</p>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {avaliacoes.ultimas.slice(0, 3).map((a, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#0d0d0d', borderRadius: 8, padding: '8px 12px' }}>
                      <span style={{ color: '#555', fontSize: 11 }}>{a.phone.slice(-4).padStart(8, '*')}</span>
                      <div style={{ display: 'flex', gap: 1 }}>
                        {[1,2,3,4,5].map(s => <span key={s} style={{ color: s <= a.nota ? '#fbbf24' : '#333', fontSize: 12 }}>★</span>)}
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
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 20, padding: '4px 10px' }}>
                    <span style={{ color: '#e0e0e0', fontSize: 12 }}>{s}</span>
                    <button onClick={() => setCardapio(prev => ({ ...prev, saltyFlavors: prev.saltyFlavors.filter((_, idx) => idx !== i) }))} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1 }}>x</button>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input placeholder="Novo sabor" value={novoSabor} onChange={e => setNovoSabor(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && novoSabor.trim()) { setCardapio(prev => ({ ...prev, saltyFlavors: [...prev.saltyFlavors, novoSabor.trim()] })); setNovoSabor('') }}} style={{ ...inp, flex: 1 }} />
                <button id="cardapio-add-btn" onClick={() => { if (novoSabor.trim()) { setCardapio(prev => ({ ...prev, saltyFlavors: [...prev.saltyFlavors, novoSabor.trim()] })); setNovoSabor('') }}} style={{ background: '#ff6b00', border: 'none', color: '#fff', borderRadius: 10, padding: '10px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>+ Add</button>
              </div>
            </div>

            <div style={card}>
              <p style={sectionTitle}>Sabores doces</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {cardapio.sweetFlavors.map((s, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 20, padding: '4px 10px' }}>
                    <span style={{ color: '#e0e0e0', fontSize: 12 }}>{s}</span>
                    <button onClick={() => setCardapio(prev => ({ ...prev, sweetFlavors: prev.sweetFlavors.filter((_, idx) => idx !== i) }))} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1 }}>x</button>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input placeholder="Novo sabor doce" value={novoSabor} onChange={e => setNovoSabor(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && novoSabor.trim()) { setCardapio(prev => ({ ...prev, sweetFlavors: [...prev.sweetFlavors, novoSabor.trim()] })); setNovoSabor('') }}} style={{ ...inp, flex: 1 }} />
                <button onClick={() => { if (novoSabor.trim()) { setCardapio(prev => ({ ...prev, sweetFlavors: [...prev.sweetFlavors, novoSabor.trim()] })); setNovoSabor('') }}} style={{ background: '#ff6b00', border: 'none', color: '#fff', borderRadius: 10, padding: '10px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>+ Add</button>
              </div>
            </div>

            {cardapio.sizes.length > 0 && (
              <div style={card}>
                <p style={sectionTitle}>Precos das pizzas</p>
                {cardapio.sizes.map((s, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <span style={{ color: '#e0e0e0', fontSize: 13, fontWeight: 700, width: 100 }}>{s.label} ({s.code})</span>
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
                    <p style={{ color: '#e0e0e0', fontSize: 12, fontWeight: 600, margin: '0 0 6px' }}>{b.label}</p>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ color: '#555', fontSize: 10, display: 'block', marginBottom: 4 }}>P/M</label>
                        <input type="number" value={b.priceSmall} onChange={e => setCardapio(prev => ({ ...prev, borders: prev.borders.map((bd, idx) => idx === i ? { ...bd, priceSmall: parseFloat(e.target.value) || 0 } : bd) }))} style={inp} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ color: '#555', fontSize: 10, display: 'block', marginBottom: 4 }}>G/F</label>
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
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0d0d0d', borderRadius: 8, padding: '8px 12px' }}>
                    <span style={{ color: '#e0e0e0', fontSize: 13 }}>{b.name}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: '#4ade80', fontSize: 13, fontWeight: 700 }}>R$ {b.price.toFixed(2).replace('.', ',')}</span>
                      <button onClick={() => setCardapio(prev => ({ ...prev, bebidas: prev.bebidas.filter((_, idx) => idx !== i) }))} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 16 }}>x</button>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input placeholder="Nome" value={novaBebida.name} onChange={e => setNovaBebida(prev => ({ ...prev, name: e.target.value }))} style={{ ...inp, flex: 2 }} />
                <input placeholder="R$" value={novaBebida.price} onChange={e => setNovaBebida(prev => ({ ...prev, price: e.target.value }))} style={{ ...inp, flex: 1 }} />
                <button onClick={() => { if (novaBebida.name && novaBebida.price) { setCardapio(prev => ({ ...prev, bebidas: [...prev.bebidas, { name: novaBebida.name, price: parseFloat(novaBebida.price) }] })); setNovaBebida({ name: '', price: '' }) }}} style={{ background: '#ff6b00', border: 'none', color: '#fff', borderRadius: 10, padding: '10px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>+</button>
              </div>
            </div>

            <div style={card}>
              <p style={sectionTitle}>Sucos</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                {cardapio.sucos.map((s, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0d0d0d', borderRadius: 8, padding: '8px 12px' }}>
                    <span style={{ color: '#e0e0e0', fontSize: 13 }}>{s.name}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: '#4ade80', fontSize: 13, fontWeight: 700 }}>R$ {s.price.toFixed(2).replace('.', ',')}</span>
                      <button onClick={() => setCardapio(prev => ({ ...prev, sucos: prev.sucos.filter((_, idx) => idx !== i) }))} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 16 }}>x</button>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input placeholder="Nome" value={novaBebida.name} onChange={e => setNovaBebida(prev => ({ ...prev, name: e.target.value }))} style={{ ...inp, flex: 2 }} />
                <input placeholder="R$" value={novaBebida.price} onChange={e => setNovaBebida(prev => ({ ...prev, price: e.target.value }))} style={{ ...inp, flex: 1 }} />
                <button onClick={() => { if (novaBebida.name && novaBebida.price) { setCardapio(prev => ({ ...prev, sucos: [...prev.sucos, { name: novaBebida.name, price: parseFloat(novaBebida.price) }] })); setNovaBebida({ name: '', price: '' }) }}} style={{ background: '#ff6b00', border: 'none', color: '#fff', borderRadius: 10, padding: '10px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>+</button>
              </div>
            </div>

            <div style={card}>
              <p style={sectionTitle}>Bairros e taxas</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                {cardapio.neighborhoods.map((n, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0d0d0d', borderRadius: 8, padding: '8px 12px' }}>
                    <span style={{ color: '#e0e0e0', fontSize: 13 }}>{n.name}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: '#fbbf24', fontSize: 13, fontWeight: 700 }}>R$ {n.fee.toFixed(2).replace('.', ',')}</span>
                      <button onClick={() => setCardapio(prev => ({ ...prev, neighborhoods: prev.neighborhoods.filter((_, idx) => idx !== i) }))} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 16 }}>x</button>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input placeholder="Bairro" value={novoBairro.name} onChange={e => setNovoBairro(prev => ({ ...prev, name: e.target.value }))} style={{ ...inp, flex: 2 }} />
                <input placeholder="Taxa" value={novoBairro.fee} onChange={e => setNovoBairro(prev => ({ ...prev, fee: e.target.value }))} style={{ ...inp, flex: 1 }} />
                <button onClick={() => { if (novoBairro.name && novoBairro.fee) { setCardapio(prev => ({ ...prev, neighborhoods: [...prev.neighborhoods, { name: novoBairro.name, fee: parseFloat(novoBairro.fee) }] })); setNovoBairro({ name: '', fee: '' }) }}} style={{ background: '#ff6b00', border: 'none', color: '#fff', borderRadius: 10, padding: '10px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>+</button>
              </div>
            </div>

            <button id="cardapio-salvar" onClick={salvarCardapio} disabled={salvandoCardapio} style={{ width: '100%', background: salvandoCardapio ? '#1a1a1a' : '#ff6b00', border: 'none', borderRadius: 12, padding: '15px', color: '#fff', fontSize: 15, fontWeight: 700, cursor: salvandoCardapio ? 'not-allowed' : 'pointer', marginBottom: 8 }}>
              {salvandoCardapio ? 'Salvando...' : 'Salvar Cardapio'}
            </button>
          </div>
        )}
        {/* ABA CONFIG */}
        {aba === 'config' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={card}>
              <p style={sectionTitle}>Pizzaria</p>
              <label style={{ color: '#555', fontSize: 11, display: 'block', marginBottom: 6 }}>Nome</label>
              <input type="text" value={config.nomePizzaria} onChange={e => setConfig(p => ({ ...p, nomePizzaria: e.target.value }))} style={{ ...inp, marginBottom: 14 }} />
              <label style={{ color: '#555', fontSize: 11, display: 'block', marginBottom: 6 }}>Chave Pix</label>
              <input type="text" value={config.chavePix} onChange={e => setConfig(p => ({ ...p, chavePix: e.target.value }))} style={{ ...inp, marginBottom: 14 }} placeholder="Ex: 99999999999" />
              <label style={{ color: '#555', fontSize: 11, display: 'block', marginBottom: 6 }}>Nome do titular</label>
              <input type="text" value={config.nomeTitularPix || ''} onChange={e => setConfig(p => ({ ...p, nomeTitularPix: e.target.value }))} style={inp} placeholder="Ex: Joao Silva" />
            </div>

            <div style={card}>
              <p style={sectionTitle}>Horario</p>
              <button onClick={toggle24h} style={{ width: '100%', background: is24h ? '#14532d' : '#1a1a1a', border: `1px solid ${is24h ? '#16a34a40' : '#2a2a2a'}`, borderRadius: 10, padding: '12px', color: is24h ? '#4ade80' : '#666', fontSize: 14, fontWeight: 700, cursor: 'pointer', marginBottom: 12 }}>
                {is24h ? 'Aberto 24 horas — clique para desativar' : 'Ativar 24 horas'}
              </button>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ color: '#555', fontSize: 11, display: 'block', marginBottom: 4 }}>Abre as</label>
                  <input type="number" min={0} max={23} value={config.horaAbertura} onChange={e => setConfig(p => ({ ...p, horaAbertura: Number(e.target.value) }))} style={inp} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ color: '#555', fontSize: 11, display: 'block', marginBottom: 4 }}>Fecha as</label>
                  <input type="number" min={0} max={24} value={config.horaFechamento} onChange={e => setConfig(p => ({ ...p, horaFechamento: Number(e.target.value) }))} style={inp} />
                </div>
              </div>
            </div>

            <div style={card}>
              <p style={sectionTitle}>Alerta de pico</p>
              <label style={{ color: '#555', fontSize: 11, display: 'block', marginBottom: 6 }}>Avisar quando atingir X pedidos simultaneos (0 = desativado)</label>
              <input type="number" value={limitePico} onChange={e => setLimitePico(Number(e.target.value))} style={inp} min={0} />
            </div>

            <div style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <p style={sectionTitle}>Cardapio por imagem</p>
                <button onClick={toggleImagensAtivo} style={{ background: imagens.ativo ? '#14532d' : '#1a1a1a', border: `1px solid ${imagens.ativo ? '#16a34a40' : '#2a2a2a'}`, color: imagens.ativo ? '#4ade80' : '#666', borderRadius: 8, padding: '4px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                  {imagens.ativo ? 'Ativo' : 'Inativo'}
                </button>
              </div>
              {[{ key: 'pizza', label: 'Pizzas', ref: inputPizzaRef }, { key: 'lanche', label: 'Lanches', ref: inputLancheRef }, { key: 'bebida', label: 'Bebidas', ref: inputBebidaRef }, { key: 'suco', label: 'Sucos', ref: inputSucoRef }].map(({ key, label, ref }) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 10, background: '#0d0d0d', border: '1px solid #1e1e1e', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                    {(imagens as any)[key] ? <img src={(imagens as any)[key]} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt={label} /> : <span style={{ color: '#444', fontSize: 11 }}>{label}</span>}
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={{ color: '#e0e0e0', fontSize: 13, margin: '0 0 4px' }}>{label}</p>
                    <p style={{ color: '#444', fontSize: 11, margin: 0 }}>{(imagens as any)[key] ? 'Imagem carregada' : 'Sem imagem'}</p>
                  </div>
                  <input ref={ref} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { if (e.target.files?.[0]) uploadImagem(key, e.target.files[0]) }} />
                  <button onClick={() => ref.current?.click()} disabled={uploadando === key} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#fbbf24', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {uploadando === key ? '...' : 'Carregar'}
                  </button>
                </div>
              ))}
            </div>

            <button onClick={salvarConfig} disabled={salvando} style={{ width: '100%', background: salvando ? '#1a1a1a' : '#ff6b00', border: 'none', borderRadius: 12, padding: '15px', color: '#fff', fontSize: 15, fontWeight: 700, cursor: salvando ? 'not-allowed' : 'pointer', marginBottom: 8 }}>
              {salvando ? 'Salvando...' : 'Salvar Configuracoes'}
            </button>

            <div style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <p style={sectionTitle}>Funcionarios</p>
                <button onClick={() => setShowNovoFunc(!showNovoFunc)} style={{ background: '#ff6b00', border: 'none', color: '#fff', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>+ Novo</button>
              </div>
              {showNovoFunc && (
                <div style={{ background: '#0d0d0d', borderRadius: 10, padding: 14, marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
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
                  <button onClick={criarFunc} disabled={criando} style={{ background: '#ff6b00', border: 'none', color: '#fff', borderRadius: 10, padding: '11px', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>
                    {criando ? 'Criando...' : 'Criar funcionario'}
                  </button>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {funcionarios.map(f => (
                  <div key={f.username} style={{ background: '#0d0d0d', borderRadius: 10, padding: 14 }}>
                    <p style={{ color: '#fff', fontSize: 14, fontWeight: 700, margin: '0 0 10px' }}>{f.name} <span style={{ color: '#444', fontSize: 11, fontWeight: 400 }}>@{f.username}</span></p>
                    <input placeholder="Novo nome" value={nomes[f.username] || ''} onChange={e => setNomes(p => ({ ...p, [f.username]: e.target.value }))} style={{ ...inp, marginBottom: 8 }} />
                    <input placeholder="Nova senha" type="password" value={senhas[f.username] || ''} onChange={e => setSenhas(p => ({ ...p, [f.username]: e.target.value }))} style={{ ...inp, marginBottom: 8 }} />
                    <button onClick={() => salvarFunc(f.username)} style={{ width: '100%', background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#fff', borderRadius: 8, padding: '10px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Salvar</button>
                  </div>
                ))}
              </div>
            </div>

            <div style={card}>
              <p style={sectionTitle}>Entregadores</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                {entregadores.map(e => (
                  <div key={e.id} style={{ background: '#0d0d0d', borderRadius: 10, padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <p style={{ color: '#fff', fontSize: 13, fontWeight: 700, margin: 0 }}>{e.nome}</p>
                      <p style={{ color: '#444', fontSize: 11, margin: '2px 0 0' }}>{e.telefone}</p>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={async () => {
                        await fetch('/api/entregadores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: e.id, ativo: !e.ativo }) })
                        setEntregadores(prev => prev.map(x => x.id === e.id ? { ...x, ativo: !x.ativo } : x))
                      }} style={{ background: e.ativo ? '#14532d' : '#1a1a1a', border: `1px solid ${e.ativo ? '#16a34a40' : '#2a2a2a'}`, color: e.ativo ? '#4ade80' : '#666', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
                        {e.ativo ? 'Ativo' : 'Inativo'}
                      </button>
                      <button onClick={async () => {
                        await fetch('/api/entregadores', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: e.id }) })
                        setEntregadores(prev => prev.filter(x => x.id !== e.id))
                      }} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#f87171', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 11 }}>x</button>
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
              }} disabled={salvandoEntregador} style={{ width: '100%', background: '#ff6b00', border: 'none', borderRadius: 10, padding: '11px', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                {salvandoEntregador ? 'Salvando...' : '+ Adicionar entregador'}
              </button>
            </div>
          </div>
        )}
        {/* ABA FINANCEIRO */}
        {aba === 'financeiro' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <div style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: 14, padding: '12px 10px' }}>
                <p style={{ color: '#555', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', margin: '0 0 4px', letterSpacing: 0.5 }}>Entradas</p>
                <p style={{ color: '#4ade80', fontSize: 15, fontWeight: 800, margin: 0 }}>R$ {faturamentoMes.toFixed(2).replace('.', ',')}</p>
              </div>
              <div style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: 14, padding: '12px 10px' }}>
                <p style={{ color: '#555', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', margin: '0 0 4px', letterSpacing: 0.5 }}>Custos</p>
                <p style={{ color: '#f87171', fontSize: 15, fontWeight: 800, margin: 0 }}>R$ {custos.reduce((s, c) => s + c.valor, 0).toFixed(2).replace('.', ',')}</p>
              </div>
              <div style={{ background: '#111', border: `1px solid ${faturamentoMes - custos.reduce((s, c) => s + c.valor, 0) >= 0 ? '#16a34a30' : '#dc262630'}`, borderRadius: 14, padding: '12px 10px' }}>
                <p style={{ color: '#555', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', margin: '0 0 4px', letterSpacing: 0.5 }}>Lucro</p>
                <p style={{ color: faturamentoMes - custos.reduce((s, c) => s + c.valor, 0) >= 0 ? '#4ade80' : '#f87171', fontSize: 15, fontWeight: 800, margin: 0 }}>R$ {(faturamentoMes - custos.reduce((s, c) => s + c.valor, 0)).toFixed(2).replace('.', ',')}</p>
              </div>
            </div>

            {mesFechado && (
              <div style={{ background: '#14532d20', border: '1px solid #16a34a30', borderRadius: 14, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <p style={{ color: '#4ade80', fontSize: 13, fontWeight: 700, margin: 0 }}>Mes fechado pelo contador — somente leitura</p>
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

                <button onClick={() => cameraRef.current?.click()} disabled={analisandoNota} style={{ width: '100%', background: analisandoNota ? '#1a1a1a' : '#0d1a0d', border: `2px dashed ${analisandoNota ? '#2a2a2a' : '#16a34a50'}`, borderRadius: 16, padding: '24px 16px', cursor: analisandoNota ? 'not-allowed' : 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 60, height: 60, borderRadius: '50%', background: analisandoNota ? '#1e1e1e' : '#16a34a20', border: `2px solid ${analisandoNota ? '#2a2a2a' : '#16a34a40'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>
                    {analisandoNota ? '...' : '📷'}
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <p style={{ color: analisandoNota ? '#444' : '#4ade80', fontSize: 15, fontWeight: 700, margin: 0 }}>{analisandoNota ? 'Analisando nota...' : 'Fotografar nota fiscal'}</p>
                    <p style={{ color: '#333', fontSize: 11, margin: '4px 0 0' }}>A IA preenche tudo automaticamente</p>
                  </div>
                </button>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1, height: 1, background: '#1e1e1e' }} />
                  <span style={{ color: '#333', fontSize: 11 }}>ou preencha manualmente</span>
                  <div style={{ flex: 1, height: 1, background: '#1e1e1e' }} />
                </div>

                <div style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: 16, padding: 16 }}>
                  <input placeholder="Descricao do produto" value={novoDescricao} onChange={e => setNovoDescricao(e.target.value)} style={{ ...inp, marginBottom: 8 }} />
                  <input placeholder="Valor (R$)" value={novoValor} onChange={e => setNovoValor(e.target.value)} style={{ ...inp, marginBottom: 10 }} />
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                    {CATEGORIAS_FIN.map(cat => (
                      <button key={cat.key} onClick={() => setNovaCategoria(cat.key)} style={{ padding: '5px 10px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, background: novaCategoria === cat.key ? cat.cor : '#1a1a1a', color: novaCategoria === cat.key ? '#fff' : '#555' }}>
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
                  }} disabled={salvandoCusto} style={{ width: '100%', background: salvandoCusto ? '#1a1a1a' : '#16a34a', border: 'none', borderRadius: 12, padding: '13px', color: '#fff', fontSize: 14, fontWeight: 700, cursor: salvandoCusto ? 'not-allowed' : 'pointer' }}>
                    {salvandoCusto ? 'Salvando...' : '+ Adicionar'}
                  </button>
                </div>
              </>
            )}

            {custos.length > 0 && (
              <div style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: 16, padding: 16 }}>
                <p style={{ color: '#555', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 12px' }}>Lancamentos de {mesLabel}</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {custos.slice().reverse().map(c => {
                    const cat = CATEGORIAS_FIN.find(cat => cat.key === c.categoria)
                    const estaEditando = editandoCusto === c.id
                    return (
                      <div key={c.id} style={{ background: '#0d0d0d', borderRadius: 12, padding: '10px 12px' }}>
                        {estaEditando ? (
                          <div>
                            <input value={editDescricao} onChange={e => setEditDescricao(e.target.value)} style={{ ...inp, marginBottom: 6 }} />
                            <input value={editValor} onChange={e => setEditValor(e.target.value)} style={{ ...inp, marginBottom: 8 }} />
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                              {CATEGORIAS_FIN.map(cat => (
                                <button key={cat.key} onClick={() => setEditCategoria(cat.key)} style={{ padding: '3px 8px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 10, fontWeight: 600, background: editCategoria === cat.key ? cat.cor : '#1a1a1a', color: editCategoria === cat.key ? '#fff' : '#555' }}>{cat.label}</button>
                              ))}
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button onClick={async () => {
                                const res = await fetch('/api/financeiro', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: c.id, descricao: editDescricao, valor: parseFloat(editValor.replace(',', '.')), categoria: editCategoria, mes: mesAtual }) })
                                if (res.ok) { setCustos(prev => prev.map(x => x.id === c.id ? { ...x, descricao: editDescricao, valor: parseFloat(editValor.replace(',', '.')), categoria: editCategoria } : x)); setEditandoCusto(null); msg('Atualizado!') }
                              }} style={{ flex: 1, background: '#16a34a', border: 'none', borderRadius: 8, padding: '9px', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Salvar</button>
                              <button onClick={() => setEditandoCusto(null)} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '9px 14px', color: '#666', fontSize: 12, cursor: 'pointer' }}>Cancelar</button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ flex: 1 }}>
                              <p style={{ color: '#e0e0e0', fontSize: 13, fontWeight: 600, margin: 0 }}>{c.descricao}</p>
                              <p style={{ color: '#444', fontSize: 11, margin: '2px 0 0' }}>{cat?.label} · {c.data}</p>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ color: '#f87171', fontSize: 13, fontWeight: 700 }}>R$ {c.valor.toFixed(2).replace('.', ',')}</span>
                              {!mesFechado && (
                                <>
                                  <button onClick={() => { setEditandoCusto(c.id); setEditDescricao(c.descricao); setEditValor(String(c.valor)); setEditCategoria(c.categoria) }} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 12, padding: 0 }}>edit</button>
                                  <button onClick={async () => {
                                    await fetch('/api/financeiro', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: c.id, mes: mesAtual }) })
                                    setCustos(prev => prev.filter(x => x.id !== c.id))
                                    msg('Removido!')
                                  }} style={{ background: 'none', border: 'none', color: '#333', cursor: 'pointer', fontSize: 17, padding: 0 }}>x</button>
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
            <div style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: 16, padding: 16, marginTop: 8 }}>
              <p style={{ color: '#ff6b00', fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1, margin: '0 0 14px' }}>💸 Pagamento de Entregadores</p>
              {Object.values(porEntregador).map(({ nome, entregas }) => {
                const total = entregas.reduce((s, p) => s + (p.taxaEntrega || 0), 0)
                const porBairro: Record<string, { count: number; taxa: number }> = {}
                entregas.forEach(p => {
                  const b = p.bairro || 'Sem bairro'
                  if (!porBairro[b]) porBairro[b] = { count: 0, taxa: p.taxaEntrega || 0 }
                  porBairro[b].count++
                })
                return (
                  <div key={nome} style={{ background: '#0d0d0d', borderRadius: 12, padding: 14, marginBottom: 10, border: '1px solid #1a1a1a' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <div>
                        <p style={{ color: '#f5f2ee', fontSize: 15, fontWeight: 900, margin: 0 }}>{nome}</p>
                        <p style={{ color: '#5a564d', fontSize: 11, fontWeight: 600, margin: '2px 0 0' }}>{entregas.length} entrega{entregas.length > 1 ? 's' : ''}</p>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <p style={{ color: '#4ade80', fontSize: 20, fontWeight: 900, margin: 0 }}>R$ {total.toFixed(2).replace('.', ',')}</p>
                        <p style={{ color: '#5a564d', fontSize: 10, fontWeight: 600, margin: '2px 0 0' }}>a receber</p>
                      </div>
                    </div>
                    <div style={{ borderTop: '1px solid #1a1a1a', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {Object.entries(porBairro).map(([bairro, { count, taxa }]) => (
                        <div key={bairro} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ color: '#ff6b00', fontSize: 12, fontWeight: 800 }}>{count}×</span>
                            <span style={{ color: '#c9c2b4', fontSize: 13, fontWeight: 600 }}>{bairro}</span>
                          </div>
                          <span style={{ color: '#facc15', fontSize: 13, fontWeight: 700 }}>R$ {(count * taxa).toFixed(2).replace('.', ',')}</span>
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
              <p style={{ color: '#555', fontSize: 12, margin: '0 0 12px' }}>Precisa de ajuda? Entre em contato com a Ominix.</p>
              <button onClick={() => window.open('https://wa.me/5599974000691?text=Ola! Preciso de suporte com o ChefeBot.', '_blank')} style={{ width: '100%', background: '#0d1a0d', border: '1px solid #16a34a25', borderRadius: 10, padding: '13px', color: '#4ade80', fontSize: 14, fontWeight: 700, cursor: 'pointer', marginBottom: 8 }}>
                Falar com suporte no WhatsApp
              </button>
            </div>

            {getUserInfo()?.role === 'dev' && (
              <div style={card}>
                <p style={sectionTitle}>Ferramentas dev</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button onClick={() => router.push('/dev')} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#e0e0e0', borderRadius: 10, padding: '12px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600, textAlign: 'left' }}>Logs do sistema</button>
                  <button onClick={() => router.push('/relatorios')} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#e0e0e0', borderRadius: 10, padding: '12px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600, textAlign: 'left' }}>Relatorios</button>
                </div>
              </div>
            )}

            <div style={card}>
              <p style={sectionTitle}>Reset de sessao</p>
              <label style={{ color: '#555', fontSize: 11, display: 'block', marginBottom: 6 }}>Numero do cliente (com DDI)</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input id="reset-phone" placeholder="5599999999999" style={{ ...inp, flex: 1 }} />
                <button onClick={async () => {
                  const phone = (document.getElementById('reset-phone') as HTMLInputElement)?.value
                  if (!phone) return
                  const res = await fetch('/api/reset-session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone }) })
                  if (res.ok) msg('Sessao resetada!')
                  else msg('Erro ao resetar.')
                }} style={{ background: '#ff6b00', border: 'none', color: '#fff', borderRadius: 10, padding: '10px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>
                  Reset
                </button>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* Navegacao inferior */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#0d0d0d', borderTop: '1px solid #161616', display: 'flex', padding: '8px 0 4px', zIndex: 100 }}>
        {([
          { key: 'dashboard', icon: '📊', label: 'Painel' },
          { key: 'cardapio', icon: '🍕', label: 'Cardapio' },
          { key: 'config', icon: '⚙️', label: 'Configuracao' },
          { key: 'financeiro', icon: '💰', label: 'Financeiro' },
          { key: 'dev', icon: '🛠️', label: 'Suporte' },
        ] as { key: Aba; icon: string; label: string }[]).map(({ key, icon, label }) => (
          <button key={key} onClick={() => setAba(key)} style={{ flex: 1, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '6px 0' }}>
            <span style={{ fontSize: 20, opacity: aba === key ? 1 : 0.3 }}>{icon}</span>
            <span style={{ fontSize: 10, color: aba === key ? '#ff6b00' : '#444', fontWeight: aba === key ? 700 : 400 }}>{label}</span>
            {aba === key && <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#ff6b00' }} />}
          </button>
        ))}
      </div>
    </div>
  )
}