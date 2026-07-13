'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import PanelShell from '@/components/PanelShell'
import ThemeToggle from '@/components/ThemeToggle'

type Config = {
  nomePizzaria: string
  horaAbertura: number
  horaFechamento: number
  chavePix: string
  nomeTitularPix: string
  limitePico: number
  whatsappPizzaria: string
  tempoEntregaDelivery: string
  tempoEntregaRetirada: string
}

type ConfigFidelidade = {
  ativo: boolean
  pizzasParaPremio: number
  tipoRecompensa: 'pizza_gratis' | 'desconto_fixo' | 'desconto_percentual'
  descricaoRecompensa: string
  validadeDias?: number
}

const FIDELIDADE_PADRAO: ConfigFidelidade = {
  ativo: false,
  pizzasParaPremio: 10,
  tipoRecompensa: 'pizza_gratis',
  descricaoRecompensa: 'Pizza grátis',
}

// Config efetiva do programa de pontos — é ESTA que a área do cliente (/cliente)
// realmente lê. Distinta do modelo antigo de pizzas acima (ConfigFidelidade):
// os dois convivem em chaves separadas no Redis, mas só esta afeta o que o
// cliente vê e o crédito/débito de pontos em /api/orders.
type ConfigPontos = {
  ativo: boolean
  metaPontos: number
  descricaoRecompensa: string
}

const PONTOS_PADRAO: ConfigPontos = {
  ativo: false,
  metaPontos: 720,
  descricaoRecompensa: '1 Pizza Família',
}

type PreviaRecuperacaoPontos = {
  ok: boolean
  encontrado: boolean
  numero?: number
  proprietarioClienteIdMascarado?: string
  pontosCalculados?: number
  motivoRecusaAutomatica?: string
  elegivelParaRecuperacao: boolean
  error?: string
}

type ResultadoRecuperacaoPontos = {
  ok: boolean
  numero?: number
  pontosCreditados?: number
  eventoId?: string
  jaExistia?: boolean
  motivoRecusa?: string
  error?: string
}

type ItemCardapio = { name: string; price: number }

type Cardapio = {
  saltyFlavors: string[]
  sweetFlavors: string[]
  bebidas: ItemCardapio[]
  sucos: ItemCardapio[]
  neighborhoods: { name: string; fee: number }[]
  sizes: { code: string; label: string; price: number }[]
  borders: { label: string; priceSmall: number; priceLarge: number }[]
}

const CONFIG_PADRAO: Config = {
  nomePizzaria: 'Chefe da Pizza',
  horaAbertura: 18,
  horaFechamento: 23,
  chavePix: '',
  nomeTitularPix: '',
  limitePico: 0,
  whatsappPizzaria: '',
  tempoEntregaDelivery: '40-60 minutos',
  tempoEntregaRetirada: '20-30 minutos',
}

function getUserRole(): string | null {
  if (typeof document === 'undefined') return null
  try {
    const cookies = document.cookie.split(';')
    for (const c of cookies) {
      const trimmed = c.trim()
      if (trimmed.startsWith('auth-user=')) {
        const raw = trimmed.substring('auth-user='.length)
        let decoded = raw
        try { decoded = decodeURIComponent(raw) } catch { decoded = raw }
        if (decoded.startsWith('%7B')) { try { decoded = decodeURIComponent(decoded) } catch {} }
        const user = JSON.parse(decoded)
        return user?.role ?? null
      }
    }
  } catch { return null }
  return null
}

const FONT = "'Archivo', sans-serif"
const BG = 'var(--background)'
const CARD_BG = 'var(--surface)'
const BORDER = '1px solid var(--border)'
const TEXT = 'var(--foreground)'
const TEXT2 = 'var(--foreground-secondary)'
const ACCENT = 'var(--primary)'

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--background)',
  border: '1px solid var(--surface-secondary)',
  borderRadius: 10,
  padding: '13px 14px',
  color: TEXT,
  fontSize: 16,
  outline: 'none',
  boxSizing: 'border-box',
  minHeight: 50,
  fontFamily: FONT,
}

const labelStyle: React.CSSProperties = {
  color: TEXT2,
  fontSize: 12,
  fontWeight: 700,
  display: 'block',
  marginBottom: 7,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
}

const btnAdicionar: React.CSSProperties = {
  background: 'var(--danger)',
  border: 'none',
  color: 'var(--foreground)',
  borderRadius: 8,
  padding: '13px 14px',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 700,
  whiteSpace: 'nowrap',
  minHeight: 48,
  fontFamily: FONT,
  flexShrink: 0,
}

const tagStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  background: 'rgba(var(--overlay-rgb), 0.06)',
  border: '1px solid var(--border)',
  borderRadius: 20,
  padding: '6px 12px',
  fontSize: 13,
  color: TEXT,
  maxWidth: '100%',
  overflow: 'hidden',
}

const btnRemoveTag: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--danger)',
  cursor: 'pointer',
  fontSize: 16,
  padding: '0 2px',
  lineHeight: 1,
  flexShrink: 0,
  minHeight: 32,
  minWidth: 32,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const btnRemoveRow: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--danger)',
  cursor: 'pointer',
  fontSize: 18,
  padding: '0 4px',
  minHeight: 44,
  minWidth: 44,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
}

function SectionCard({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: CARD_BG, border: BORDER, borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', gap: 18, ...style }}>
      {children}
    </div>
  )
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  )
}

export default function ConfiguracoesPage() {
  const router = useRouter()
  const [aba, setAba] = useState<'geral' | 'cardapio'>('geral')
  const [config, setConfig] = useState<Config>(CONFIG_PADRAO)
  const [cardapio, setCardapio] = useState<Cardapio>({ saltyFlavors: [], sweetFlavors: [], bebidas: [], sucos: [], neighborhoods: [], sizes: [], borders: [] })
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [mensagem, setMensagem] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [novoItem, setNovoItem] = useState('')
  const [novoPreco, setNovoPreco] = useState('')
  const [novoTaxa, setNovoTaxa] = useState('')
  const [fidelidade, setFidelidade] = useState<ConfigFidelidade>(FIDELIDADE_PADRAO)
  const [salvandoFidelidade, setSalvandoFidelidade] = useState(false)
  const [mensagemFidelidade, setMensagemFidelidade] = useState('')
  const [pontos, setPontos] = useState<ConfigPontos>(PONTOS_PADRAO)
  const [salvandoPontos, setSalvandoPontos] = useState(false)
  const [mensagemPontos, setMensagemPontos] = useState('')
  const [recuperarPedidoId, setRecuperarPedidoId] = useState('')
  const [recuperarMotivo, setRecuperarMotivo] = useState('')
  const [recuperarPrevia, setRecuperarPrevia] = useState<PreviaRecuperacaoPontos | null>(null)
  const [recuperarCarregandoPrevia, setRecuperarCarregandoPrevia] = useState(false)
  const [recuperarProcessando, setRecuperarProcessando] = useState(false)
  const [recuperarErro, setRecuperarErro] = useState('')
  const [recuperarResultado, setRecuperarResultado] = useState<ResultadoRecuperacaoPontos | null>(null)
  const is24h = config.horaAbertura === 0 && config.horaFechamento === 24

  useEffect(() => {
    const role = getUserRole()
    const admin = role === 'admin' || role === 'dev'
    setIsAdmin(admin)
    setChecking(false)
    if (admin) {
      fetch('/api/fidelidade/config')
        .then(r => (r.ok ? r.json() : null))
        .then(data => { if (data) setFidelidade({ ...FIDELIDADE_PADRAO, ...data }) })
        .catch(err => console.error('Falha ao carregar fidelidade:', err))
      fetch('/api/fidelidade/config/pontos')
        .then(r => (r.ok ? r.json() : null))
        .then(data => { if (data) setPontos({ ...PONTOS_PADRAO, ...data }) })
        .catch(err => console.error('Falha ao carregar programa de pontos:', err))
    }
    fetch('/api/configuracoes')
      .then(r => { if (r.status === 401) { router.push('/login?callbackUrl=/configuracoes'); return null } return r.json() })
      .then(data => {
        if (data) {
          setConfig({ ...CONFIG_PADRAO, ...data })
          setLoading(false)
        }
      })
      .catch(err => {
        console.error('Falha ao carregar configuracoes:', err)
        setConfig(CONFIG_PADRAO)
        setLoading(false)
      })
    fetch('/api/cardapio')
      .then(r => r.json())
      .then(data => {
        if (data) setCardapio({
          saltyFlavors: data.saltyFlavors || [],
          sweetFlavors: data.sweetFlavors || [],
          bebidas: data.bebidas || [],
          sucos: data.sucos || [],
          neighborhoods: data.neighborhoods || [],
          sizes: data.sizes || [],
          borders: data.borders || [],
        })
      })
      .catch(err => {
        console.error('Falha ao carregar cardapio:', err)
        setCardapio({ saltyFlavors: [], sweetFlavors: [], bebidas: [], sucos: [], neighborhoods: [], sizes: [], borders: [] })
      })
  }, [router])

  function showMsg(msg: string) {
    setMensagem(msg)
    setTimeout(() => setMensagem(''), 3000)
  }

  const toggle24h = async () => {
    const novaConfig = is24h ? { ...config, horaAbertura: 18, horaFechamento: 23 } : { ...config, horaAbertura: 0, horaFechamento: 24 }
    setConfig(novaConfig)
    setSalvando(true)
    try {
      const res = await fetch('/api/configuracoes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(novaConfig) })
      if (res.ok) showMsg(is24h ? '✅ Horário padrão restaurado!' : '✅ Aberto 24h!')
      else showMsg('❌ Erro ao salvar.')
    } catch { showMsg('❌ Erro ao salvar.') }
    setSalvando(false)
  }

  const salvar = async () => {
    setSalvando(true)
    try {
      const res = await fetch('/api/configuracoes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) })
      if (res.ok) showMsg('✅ Configurações salvas!')
      else showMsg('❌ Erro ao salvar.')
    } catch { showMsg('❌ Erro ao salvar.') }
    setSalvando(false)
  }

  const salvarFidelidade = async () => {
    setSalvandoFidelidade(true)
    setMensagemFidelidade('')
    try {
      const res = await fetch('/api/fidelidade/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fidelidade) })
      setMensagemFidelidade(res.ok ? '✅ Fidelidade salva!' : '❌ Erro ao salvar.')
    } catch { setMensagemFidelidade('❌ Erro ao salvar.') }
    setSalvandoFidelidade(false)
    setTimeout(() => setMensagemFidelidade(''), 3000)
  }

  const salvarPontos = async () => {
    setSalvandoPontos(true)
    setMensagemPontos('')
    try {
      const res = await fetch('/api/fidelidade/config/pontos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pontos) })
      setMensagemPontos(res.ok ? '✅ Programa de pontos salvo!' : '❌ Erro ao salvar.')
    } catch { setMensagemPontos('❌ Erro ao salvar.') }
    setSalvandoPontos(false)
    setTimeout(() => setMensagemPontos(''), 3000)
  }

  const buscarPreviaRecuperacaoPontos = async () => {
    const pedidoId = recuperarPedidoId.trim()
    if (!pedidoId) return
    setRecuperarCarregandoPrevia(true)
    setRecuperarErro('')
    setRecuperarPrevia(null)
    setRecuperarResultado(null)
    try {
      const res = await fetch(`/api/admin/fidelidade/pontos/recuperar-pedido?pedidoId=${encodeURIComponent(pedidoId)}`)
      const data: PreviaRecuperacaoPontos = await res.json().catch(() => ({ ok: false, encontrado: false, elegivelParaRecuperacao: false }))
      if (!res.ok || !data.ok) {
        setRecuperarErro(data.error || 'Pedido nao encontrado.')
        return
      }
      setRecuperarPrevia(data)
    } catch {
      setRecuperarErro('Erro de conexao ao buscar o pedido.')
    } finally {
      setRecuperarCarregandoPrevia(false)
    }
  }

  const confirmarRecuperacaoPontos = async () => {
    const pedidoId = recuperarPedidoId.trim()
    const motivo = recuperarMotivo.trim()
    if (!pedidoId || !motivo) return
    setRecuperarProcessando(true)
    setRecuperarErro('')
    try {
      const res = await fetch('/api/admin/fidelidade/pontos/recuperar-pedido', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pedidoId, motivo }),
      })
      const data: ResultadoRecuperacaoPontos = await res.json().catch(() => ({ ok: false }))
      if (!res.ok || !data.ok) {
        setRecuperarErro(data.motivoRecusa || data.error || 'Nao foi possivel recuperar os pontos deste pedido.')
        return
      }
      setRecuperarResultado(data)
      setRecuperarPrevia(null)
    } catch {
      setRecuperarErro('Erro de conexao ao reprocessar os pontos.')
    } finally {
      setRecuperarProcessando(false)
    }
  }

  const salvarCardapio = async () => {
    setSalvando(true)
    try {
      const res = await fetch('/api/cardapio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cardapio) })
      if (res.ok) showMsg('✅ Cardápio salvo!')
      else showMsg('❌ Erro ao salvar.')
    } catch { showMsg('❌ Erro ao salvar.') }
    setSalvando(false)
  }

  const removerSabor = (tipo: 'saltyFlavors' | 'sweetFlavors', idx: number) =>
    setCardapio(prev => ({ ...prev, [tipo]: prev[tipo].filter((_, i) => i !== idx) }))

  const adicionarSabor = (tipo: 'saltyFlavors' | 'sweetFlavors') => {
    if (!novoItem.trim()) return
    setCardapio(prev => ({ ...prev, [tipo]: [...prev[tipo], novoItem.trim()] }))
    setNovoItem('')
  }

  const removerBebida = (tipo: 'bebidas' | 'sucos', idx: number) =>
    setCardapio(prev => ({ ...prev, [tipo]: prev[tipo].filter((_, i) => i !== idx) }))

  const adicionarBebida = (tipo: 'bebidas' | 'sucos') => {
    if (!novoItem.trim() || !novoPreco.trim()) return
    setCardapio(prev => ({ ...prev, [tipo]: [...prev[tipo], { name: novoItem.trim(), price: parseFloat(novoPreco) }] }))
    setNovoItem(''); setNovoPreco('')
  }

  const removerBairro = (idx: number) =>
    setCardapio(prev => ({ ...prev, neighborhoods: prev.neighborhoods.filter((_, i) => i !== idx) }))

  const adicionarBairro = () => {
    if (!novoItem.trim() || !novoTaxa.trim()) return
    setCardapio(prev => ({ ...prev, neighborhoods: [...prev.neighborhoods, { name: novoItem.trim(), fee: parseFloat(novoTaxa) }] }))
    setNovoItem(''); setNovoTaxa('')
  }

  if (checking || loading) return (
    <div style={{ minHeight: '100svh', background: BG, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT }}>
      <p style={{ color: TEXT2 }}>Carregando...</p>
    </div>
  )

  return (
    <PanelShell showGestaoNav>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800;900&display=swap');`}</style>
      <div style={{ minHeight: '100svh', background: BG, fontFamily: FONT, overflowX: 'hidden' }}>

        {/* Sticky Header com safe area */}
        <div style={{
          position: 'sticky',
          top: 0,
          zIndex: 100,
          background: 'var(--surface)',
          borderBottom: '1px solid var(--surface-secondary)',
          paddingTop: 'calc(env(safe-area-inset-top) + 14px)',
          paddingBottom: 14,
          paddingLeft: 16,
          paddingRight: 16,
        }}>
          <div style={{ maxWidth: 680, display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={() => router.push('/admin')}
              style={{ background: 'rgba(var(--overlay-rgb), 0.06)', border: BORDER, color: TEXT2, borderRadius: 10, padding: '10px 14px', cursor: 'pointer', fontSize: 14, minHeight: 48, fontFamily: FONT, fontWeight: 700, flexShrink: 0 }}
            >←</button>
            <div style={{ minWidth: 0, flex: 1 }}>
              <h1 style={{ color: TEXT, fontSize: 20, fontWeight: 900, margin: 0, letterSpacing: '-0.3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Configurações</h1>
              <p style={{ color: TEXT2, fontSize: 11, fontWeight: 700, margin: '2px 0 0', textTransform: 'uppercase', letterSpacing: '0.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>ChefeBot · Alto Alegre</p>
            </div>
          </div>
        </div>

        {/* Conteúdo rolável */}
        <div style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 32px)', paddingLeft: 16, paddingRight: 16, paddingTop: 16 }}>
          <div style={{ maxWidth: 680 }}>

            {/* Abas */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 20, background: 'var(--surface)', border: BORDER, borderRadius: 12, padding: 4 }}>
              {(['geral', 'cardapio'] as const).map(a => (
                <button
                  key={a}
                  onClick={() => setAba(a)}
                  style={{ flex: 1, padding: '10px 0', minHeight: 48, borderRadius: 9, border: 'none', cursor: 'pointer', fontWeight: 800, fontSize: 13, fontFamily: FONT, transition: 'all .15s', background: aba === a ? ACCENT : 'transparent', color: aba === a ? 'var(--foreground)' : TEXT2 }}
                >
                  {a === 'geral' ? '⚙️  Geral' : '🍕  Cardápio'}
                </button>
              ))}
            </div>

            {/* ── ABA GERAL ── */}
            {aba === 'geral' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

                {/* Aparência (tema Light / Dark) */}
                <SectionCard>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: -4 }}>
                    <span style={{ fontSize: 16, flexShrink: 0 }}>🎨</span>
                    <span style={{ fontSize: 13, fontWeight: 900, color: TEXT, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Aparência</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ color: TEXT, fontSize: 14, fontWeight: 700, margin: 0 }}>Tema do painel</p>
                      <p style={{ color: TEXT2, fontSize: 12, fontWeight: 600, margin: '2px 0 0' }}>Claro é o padrão. Escuro fica salvo só neste dispositivo.</p>
                    </div>
                    <ThemeToggle />
                  </div>
                </SectionCard>

                {/* Identidade */}
                <SectionCard>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: -4 }}>
                    <span style={{ fontSize: 16, flexShrink: 0 }}>🍕</span>
                    <span style={{ fontSize: 13, fontWeight: 900, color: TEXT, textTransform: 'uppercase', letterSpacing: '0.8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Identidade</span>
                  </div>
                  <FieldGroup label="Nome da Pizzaria">
                    <input
                      type="text"
                      value={config.nomePizzaria}
                      onChange={e => setConfig(prev => ({ ...prev, nomePizzaria: e.target.value }))}
                      style={inputStyle}
                      placeholder="Ex: Chefe da Pizza"
                    />
                  </FieldGroup>

                  <FieldGroup label="WhatsApp da Pizzaria">
                    <div style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', fontSize: 15, pointerEvents: 'none' }}>📱</span>
                      <input
                        type="tel"
                        value={config.whatsappPizzaria}
                        onChange={e => setConfig(prev => ({ ...prev, whatsappPizzaria: e.target.value.replace(/\D/g, '') }))}
                        style={{ ...inputStyle, paddingLeft: 40 }}
                        placeholder="5598999999999 (com DDI)"
                        maxLength={15}
                      />
                    </div>
                    <p style={{ color: 'var(--foreground-muted)', fontSize: 11, fontWeight: 700, margin: '6px 0 0' }}>
                      Botão "Falar com a pizzaria" · inclua o código do país (55)
                    </p>
                  </FieldGroup>
                </SectionCard>

                {/* Horário */}
                <SectionCard>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: -4 }}>
                    <span style={{ fontSize: 16, flexShrink: 0 }}>⏰</span>
                    <span style={{ fontSize: 13, fontWeight: 900, color: TEXT, textTransform: 'uppercase', letterSpacing: '0.8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Horário de Funcionamento</span>
                  </div>
                  <button
                    onClick={toggle24h}
                    disabled={salvando}
                    style={{ width: '100%', background: is24h ? 'color-mix(in srgb, var(--success) 10%, transparent)' : 'rgba(var(--overlay-rgb), 0.04)', border: `1.5px solid ${is24h ? 'color-mix(in srgb, var(--success) 40%, transparent)' : 'var(--border)'}`, borderRadius: 12, padding: '13px 16px', color: is24h ? 'var(--success)' : TEXT2, fontSize: 13, fontWeight: 800, cursor: salvando ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48, fontFamily: FONT, letterSpacing: '-0.1px' }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {is24h ? '✅ Aberto 24h — toque para voltar ao normal' : '🕐 Ativar funcionamento 24 horas'}
                    </span>
                  </button>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                    <FieldGroup label="Abre às (h)">
                      <input type="number" min={0} max={23} value={config.horaAbertura} onChange={e => setConfig(prev => ({ ...prev, horaAbertura: Number(e.target.value) }))} style={{ ...inputStyle, width: 90 }} />
                    </FieldGroup>
                    <span style={{ color: TEXT2, fontSize: 18, fontWeight: 900, paddingBottom: 13 }}>→</span>
                    <FieldGroup label="Fecha às (h)">
                      <input type="number" min={0} max={24} value={config.horaFechamento} onChange={e => setConfig(prev => ({ ...prev, horaFechamento: Number(e.target.value) }))} style={{ ...inputStyle, width: 90 }} />
                    </FieldGroup>
                  </div>
                </SectionCard>

                {/* Tempo de entrega */}
                <SectionCard>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: -4 }}>
                    <span style={{ fontSize: 16, flexShrink: 0 }}>🛵</span>
                    <span style={{ fontSize: 13, fontWeight: 900, color: TEXT, textTransform: 'uppercase', letterSpacing: '0.8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Tempo Estimado de Entrega</span>
                  </div>
                  <p style={{ color: 'var(--foreground-muted)', fontSize: 11, fontWeight: 700, margin: '-10px 0 -4px' }}>
                    O bot usa esse texto na confirmação do pedido
                  </p>
                  <FieldGroup label="Delivery 🛵">
                    <input
                      type="text"
                      value={config.tempoEntregaDelivery}
                      onChange={e => setConfig(prev => ({ ...prev, tempoEntregaDelivery: e.target.value }))}
                      style={inputStyle}
                      placeholder="Ex: 40-60 minutos"
                      maxLength={30}
                    />
                  </FieldGroup>
                  <FieldGroup label="Retirada na loja 🏪">
                    <input
                      type="text"
                      value={config.tempoEntregaRetirada}
                      onChange={e => setConfig(prev => ({ ...prev, tempoEntregaRetirada: e.target.value }))}
                      style={inputStyle}
                      placeholder="Ex: 20-30 minutos"
                      maxLength={30}
                    />
                  </FieldGroup>

                  <div style={{ background: 'color-mix(in srgb, var(--primary) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--primary) 20%, transparent)', borderRadius: 12, padding: '12px 14px' }}>
                    <p style={{ color: TEXT2, fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 6px' }}>Preview da mensagem</p>
                    <p style={{ color: 'var(--foreground-secondary)', fontSize: 13, fontWeight: 600, margin: 0, lineHeight: 1.5 }}>
                      {"\"Pedido confirmado! 🎉 Sua pizza chega em "}<span style={{ color: ACCENT, fontWeight: 900 }}>{config.tempoEntregaDelivery}</span>{" 🛵\""}
                    </p>
                  </div>
                </SectionCard>

                {/* Pix + Admin */}
                {isAdmin && (
                  <SectionCard style={{ border: '1px solid color-mix(in srgb, var(--primary) 15%, transparent)', background: 'color-mix(in srgb, var(--primary) 3%, transparent)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: -4, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 16, flexShrink: 0 }}>💸</span>
                      <span style={{ fontSize: 13, fontWeight: 900, color: 'color-mix(in srgb, var(--primary) 90%, transparent)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Pagamento</span>
                      <span style={{ fontSize: 10, background: 'color-mix(in srgb, var(--primary) 12%, transparent)', color: 'color-mix(in srgb, var(--primary) 80%, transparent)', padding: '2px 8px', borderRadius: 20, fontWeight: 800, whiteSpace: 'nowrap' }}>Somente Admin</span>
                    </div>
                    <FieldGroup label="Chave Pix">
                      <input
                        type="text"
                        placeholder="CPF, CNPJ, email ou telefone"
                        value={config.chavePix}
                        onChange={e => setConfig(prev => ({ ...prev, chavePix: e.target.value }))}
                        style={{ ...inputStyle, border: '1px solid color-mix(in srgb, var(--primary) 20%, transparent)' }}
                      />
                    </FieldGroup>
                    <FieldGroup label="Nome do Titular Pix">
                      <input
                        type="text"
                        placeholder="Nome como aparece no Pix"
                        value={config.nomeTitularPix}
                        onChange={e => setConfig(prev => ({ ...prev, nomeTitularPix: e.target.value }))}
                        style={{ ...inputStyle, border: '1px solid color-mix(in srgb, var(--primary) 20%, transparent)' }}
                      />
                      <p style={{ color: 'var(--foreground-muted)', fontSize: 11, fontWeight: 700, margin: '6px 0 0' }}>
                        Usado na validação automática do comprovante
                      </p>
                    </FieldGroup>
                    <FieldGroup label="Limite de pedidos simultâneos (pico)">
                      <input
                        type="number"
                        min={0}
                        value={config.limitePico}
                        onChange={e => setConfig(prev => ({ ...prev, limitePico: Number(e.target.value) }))}
                        style={{ ...inputStyle, border: '1px solid color-mix(in srgb, var(--primary) 20%, transparent)' }}
                        placeholder="0 = sem limite"
                      />
                      <p style={{ color: 'var(--foreground-muted)', fontSize: 11, fontWeight: 700, margin: '6px 0 0' }}>
                        Acima desse número, o bot avisa sobre demora extra · 0 = desativado
                      </p>
                    </FieldGroup>
                  </SectionCard>
                )}

                {/* Fidelidade (legado — mantido só por compatibilidade, ver Programa de Pontos abaixo) */}
                {isAdmin && (
                  <SectionCard>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: -4, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 16, flexShrink: 0 }}>🎁</span>
                      <span style={{ fontSize: 13, fontWeight: 900, color: TEXT, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Fidelidade antiga</span>
                      <span style={{ fontSize: 10, background: 'color-mix(in srgb, var(--primary) 12%, transparent)', color: 'color-mix(in srgb, var(--primary) 80%, transparent)', padding: '2px 8px', borderRadius: 20, fontWeight: 800, whiteSpace: 'nowrap' }}>Somente Admin</span>
                    </div>
                    <p style={{ fontSize: 12, color: TEXT2, margin: '-10px 0 0' }}>
                      Fidelidade antiga — usada somente quando o Programa de Pontos está desativado.
                    </p>
                    <button
                      onClick={() => setFidelidade(prev => ({ ...prev, ativo: !prev.ativo }))}
                      style={{ width: '100%', background: fidelidade.ativo ? 'color-mix(in srgb, var(--success) 10%, transparent)' : 'rgba(var(--overlay-rgb), 0.04)', border: `1.5px solid ${fidelidade.ativo ? 'color-mix(in srgb, var(--success) 40%, transparent)' : 'var(--border)'}`, borderRadius: 12, padding: '13px 16px', color: fidelidade.ativo ? 'var(--success)' : TEXT2, fontSize: 13, fontWeight: 800, cursor: 'pointer', minHeight: 48, fontFamily: FONT }}
                    >
                      {fidelidade.ativo ? '✅ Fidelidade ativa — toque para desativar' : '⭕ Fidelidade desativada — toque para ativar'}
                    </button>
                    <FieldGroup label="A cada quantas pizzas ganha recompensa">
                      <input
                        type="number"
                        min={1}
                        value={fidelidade.pizzasParaPremio}
                        onChange={e => setFidelidade(prev => ({ ...prev, pizzasParaPremio: Number(e.target.value) }))}
                        style={inputStyle}
                      />
                    </FieldGroup>
                    <FieldGroup label="Tipo de recompensa">
                      <select
                        value={fidelidade.tipoRecompensa}
                        onChange={e => setFidelidade(prev => ({ ...prev, tipoRecompensa: e.target.value as ConfigFidelidade['tipoRecompensa'] }))}
                        style={inputStyle}
                      >
                        <option value="pizza_gratis">Pizza grátis</option>
                        <option value="desconto_fixo">Desconto fixo (R$)</option>
                        <option value="desconto_percentual">Desconto percentual (%)</option>
                      </select>
                    </FieldGroup>
                    <FieldGroup label="Descrição da recompensa">
                      <input
                        type="text"
                        placeholder="Ex: Pizza média grátis"
                        value={fidelidade.descricaoRecompensa}
                        onChange={e => setFidelidade(prev => ({ ...prev, descricaoRecompensa: e.target.value }))}
                        style={inputStyle}
                        maxLength={120}
                      />
                    </FieldGroup>
                    <FieldGroup label="Validade da recompensa (dias, opcional)">
                      <input
                        type="number"
                        min={0}
                        value={fidelidade.validadeDias ?? 0}
                        onChange={e => setFidelidade(prev => ({ ...prev, validadeDias: Number(e.target.value) || undefined }))}
                        style={inputStyle}
                        placeholder="0 = sem validade"
                      />
                    </FieldGroup>
                    <button
                      onClick={salvarFidelidade}
                      disabled={salvandoFidelidade}
                      style={{ width: '100%', height: 48, background: salvandoFidelidade ? 'var(--background)' : `linear-gradient(180deg, ${ACCENT}, var(--primary))`, border: 'none', borderRadius: 12, color: 'var(--primary-foreground)', fontSize: 14, fontWeight: 900, cursor: salvandoFidelidade ? 'not-allowed' : 'pointer', fontFamily: FONT, opacity: salvandoFidelidade ? 0.6 : 1 }}
                    >
                      {salvandoFidelidade ? 'Salvando...' : 'Salvar Fidelidade'}
                    </button>
                    {mensagemFidelidade && (
                      <p style={{ textAlign: 'center', color: mensagemFidelidade.includes('✅') ? 'var(--success)' : 'var(--danger)', fontWeight: 800, fontSize: 13, margin: 0 }}>{mensagemFidelidade}</p>
                    )}
                  </SectionCard>
                )}

                {/* Programa de Pontos — é esta configuração que a área do cliente (/cliente) realmente usa */}
                {isAdmin && (
                  <SectionCard>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: -4, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 16, flexShrink: 0 }}>⭐</span>
                      <span style={{ fontSize: 13, fontWeight: 900, color: TEXT, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Programa de Pontos</span>
                      <span style={{ fontSize: 10, background: 'color-mix(in srgb, var(--primary) 12%, transparent)', color: 'color-mix(in srgb, var(--primary) 80%, transparent)', padding: '2px 8px', borderRadius: 20, fontWeight: 800, whiteSpace: 'nowrap' }}>Somente Admin</span>
                    </div>
                    <p style={{ fontSize: 12, color: TEXT2, margin: '-10px 0 0' }}>
                      Isso é o que aparece para o cliente em &quot;Meus pontos&quot;. Quando ativo, tem prioridade sobre a Fidelidade antiga acima — só um dos dois modelos credita por pedido entregue.
                    </p>
                    <button
                      onClick={() => setPontos(prev => ({ ...prev, ativo: !prev.ativo }))}
                      style={{ width: '100%', background: pontos.ativo ? 'color-mix(in srgb, var(--success) 10%, transparent)' : 'rgba(var(--overlay-rgb), 0.04)', border: `1.5px solid ${pontos.ativo ? 'color-mix(in srgb, var(--success) 40%, transparent)' : 'var(--border)'}`, borderRadius: 12, padding: '13px 16px', color: pontos.ativo ? 'var(--success)' : TEXT2, fontSize: 13, fontWeight: 800, cursor: 'pointer', minHeight: 48, fontFamily: FONT }}
                    >
                      {pontos.ativo ? '✅ Programa de pontos ativo — toque para desativar' : '⭕ Programa de pontos desativado — toque para ativar'}
                    </button>
                    <FieldGroup label="Pontos necessários para a recompensa">
                      <input
                        type="number"
                        min={1}
                        value={pontos.metaPontos}
                        onChange={e => setPontos(prev => ({ ...prev, metaPontos: Number(e.target.value) }))}
                        style={inputStyle}
                      />
                    </FieldGroup>
                    <FieldGroup label="Descrição da recompensa">
                      <input
                        type="text"
                        placeholder="Ex: 1 Pizza Família"
                        value={pontos.descricaoRecompensa}
                        onChange={e => setPontos(prev => ({ ...prev, descricaoRecompensa: e.target.value }))}
                        style={inputStyle}
                        maxLength={120}
                      />
                    </FieldGroup>
                    <p style={{ fontSize: 11.5, color: TEXT2, margin: 0 }}>
                      Regra fixa: a cada R$1 gasto em pedidos (sem contar taxa de entrega), o cliente ganha 1 ponto. Pontos são confirmados quando o pedido é marcado como entregue.
                    </p>
                    <button
                      onClick={salvarPontos}
                      disabled={salvandoPontos}
                      style={{ width: '100%', height: 48, background: salvandoPontos ? 'var(--background)' : `linear-gradient(180deg, ${ACCENT}, var(--primary))`, border: 'none', borderRadius: 12, color: 'var(--primary-foreground)', fontSize: 14, fontWeight: 900, cursor: salvandoPontos ? 'not-allowed' : 'pointer', fontFamily: FONT, opacity: salvandoPontos ? 0.6 : 1 }}
                    >
                      {salvandoPontos ? 'Salvando...' : 'Salvar Programa de Pontos'}
                    </button>
                    {mensagemPontos && (
                      <p style={{ textAlign: 'center', color: mensagemPontos.includes('✅') ? 'var(--success)' : 'var(--danger)', fontWeight: 800, fontSize: 13, margin: 0 }}>{mensagemPontos}</p>
                    )}
                  </SectionCard>
                )}

                {/* Correção operacional pontual (Nível 6.7) — recupera UM pedido cujo
                    crédito automático foi corretamente recusado por ativação não
                    persistida. Nunca aceita quantidade de pontos digitada. */}
                {isAdmin && (
                  <SectionCard>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: -4, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 16, flexShrink: 0 }}>🛠️</span>
                      <span style={{ fontSize: 13, fontWeight: 900, color: TEXT, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Corrigir pontos de um pedido</span>
                      <span style={{ fontSize: 10, background: 'color-mix(in srgb, var(--primary) 12%, transparent)', color: 'color-mix(in srgb, var(--primary) 80%, transparent)', padding: '2px 8px', borderRadius: 20, fontWeight: 800, whiteSpace: 'nowrap' }}>Somente Admin</span>
                    </div>
                    <p style={{ fontSize: 12, color: TEXT2, margin: '-10px 0 0' }}>
                      Uso excepcional: recupera o crédito de um único pedido cujo crédito automático foi recusado apenas por a ativação individual não constar como anterior ao pedido. Os pontos são sempre calculados pelo servidor — nunca informe a quantidade manualmente.
                    </p>
                    <FieldGroup label="ID interno do pedido">
                      <input
                        type="text"
                        placeholder="Ex: 1783967630709"
                        value={recuperarPedidoId}
                        onChange={e => { setRecuperarPedidoId(e.target.value); setRecuperarPrevia(null); setRecuperarResultado(null); setRecuperarErro('') }}
                        style={inputStyle}
                      />
                    </FieldGroup>
                    <FieldGroup label="Motivo da correção">
                      <input
                        type="text"
                        placeholder="Ex: RECUPERACAO_VALIDACAO_ATIVACAO_NAO_PERSISTIDA"
                        value={recuperarMotivo}
                        onChange={e => setRecuperarMotivo(e.target.value)}
                        style={inputStyle}
                        maxLength={200}
                      />
                    </FieldGroup>
                    <button
                      onClick={buscarPreviaRecuperacaoPontos}
                      disabled={recuperarCarregandoPrevia || !recuperarPedidoId.trim()}
                      style={{ width: '100%', height: 44, background: 'rgba(var(--overlay-rgb), 0.04)', border: `1.5px solid ${'var(--border)'}`, borderRadius: 12, color: TEXT, fontSize: 13, fontWeight: 800, cursor: recuperarCarregandoPrevia ? 'not-allowed' : 'pointer', fontFamily: FONT, opacity: recuperarCarregandoPrevia ? 0.6 : 1 }}
                    >
                      {recuperarCarregandoPrevia ? 'Buscando...' : 'Buscar pedido'}
                    </button>

                    {recuperarPrevia && (
                      <div style={{ background: 'rgba(var(--overlay-rgb), 0.04)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <p style={{ margin: 0, fontSize: 13, color: TEXT }}>Pedido nº <strong>{recuperarPrevia.numero ?? '—'}</strong></p>
                        <p style={{ margin: 0, fontSize: 13, color: TEXT }}>Proprietário: <strong>{recuperarPrevia.proprietarioClienteIdMascarado ?? '—'}</strong></p>
                        <p style={{ margin: 0, fontSize: 13, color: TEXT }}>Pontos calculados: <strong>{recuperarPrevia.pontosCalculados ?? 0}</strong></p>
                        <p style={{ margin: 0, fontSize: 13, color: TEXT }}>Motivo da recusa automática: <strong>{recuperarPrevia.motivoRecusaAutomatica ?? '—'}</strong></p>
                        {!recuperarPrevia.elegivelParaRecuperacao && (
                          <p style={{ margin: 0, fontSize: 12, color: 'var(--danger)' }}>Este pedido não é elegível para recuperação administrativa (motivo diferente de ativação não persistida).</p>
                        )}
                        {recuperarPrevia.elegivelParaRecuperacao && (
                          <button
                            onClick={confirmarRecuperacaoPontos}
                            disabled={recuperarProcessando || !recuperarMotivo.trim()}
                            style={{ width: '100%', height: 44, background: recuperarProcessando ? 'var(--background)' : `linear-gradient(180deg, ${ACCENT}, var(--primary))`, border: 'none', borderRadius: 12, color: 'var(--primary-foreground)', fontSize: 13, fontWeight: 900, cursor: recuperarProcessando || !recuperarMotivo.trim() ? 'not-allowed' : 'pointer', fontFamily: FONT, opacity: recuperarProcessando || !recuperarMotivo.trim() ? 0.6 : 1 }}
                          >
                            {recuperarProcessando ? 'Reprocessando...' : 'Reprocessar pontos'}
                          </button>
                        )}
                      </div>
                    )}

                    {recuperarResultado && (
                      <div style={{ background: 'color-mix(in srgb, var(--success) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--success) 40%, transparent)', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <p style={{ margin: 0, fontSize: 13, color: 'var(--success)', fontWeight: 800 }}>
                          {recuperarResultado.jaExistia ? 'Este pedido já tinha crédito registrado — nenhum ponto duplicado.' : `✅ ${recuperarResultado.pontosCreditados ?? 0} pontos creditados.`}
                        </p>
                        <p style={{ margin: 0, fontSize: 12, color: TEXT2 }}>Evento: {recuperarResultado.eventoId}</p>
                        <p style={{ margin: 0, fontSize: 12, color: TEXT2 }}>Horário da auditoria: {new Date().toLocaleString('pt-BR')}</p>
                      </div>
                    )}

                    {recuperarErro && (
                      <p style={{ margin: 0, fontSize: 12, color: 'var(--danger)', fontWeight: 700 }}>{recuperarErro}</p>
                    )}
                  </SectionCard>
                )}

                <button
                  onClick={salvar}
                  disabled={salvando}
                  style={{ width: '100%', height: 56, background: salvando ? 'var(--background)' : `linear-gradient(180deg, ${ACCENT}, var(--primary))`, border: 'none', borderRadius: 14, color: 'var(--primary-foreground)', fontSize: 16, fontWeight: 900, cursor: salvando ? 'not-allowed' : 'pointer', fontFamily: FONT, letterSpacing: '-0.2px', opacity: salvando ? 0.6 : 1 }}
                >
                  {salvando ? 'Salvando...' : 'Salvar Configurações'}
                </button>

                {mensagem && (
                  <div style={{ textAlign: 'center', padding: '12px 16px', background: mensagem.includes('✅') ? 'color-mix(in srgb, var(--success) 10%, transparent)' : 'color-mix(in srgb, var(--danger) 10%, transparent)', border: `1px solid ${mensagem.includes('✅') ? 'color-mix(in srgb, var(--success) 30%, transparent)' : 'color-mix(in srgb, var(--danger) 30%, transparent)'}`, borderRadius: 12 }}>
                    <p style={{ color: mensagem.includes('✅') ? 'var(--success)' : 'var(--danger)', fontWeight: 800, fontSize: 14, margin: 0 }}>{mensagem}</p>
                  </div>
                )}
              </div>
            )}

            {/* ── ABA CARDÁPIO ── */}
            {aba === 'cardapio' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

                {/* Sabores Salgados */}
                <SectionCard>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: -4 }}>
                    <span style={{ fontSize: 16, flexShrink: 0 }}>🧂</span>
                    <span style={{ fontSize: 13, fontWeight: 900, color: TEXT, textTransform: 'uppercase', letterSpacing: '0.8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>Sabores Salgados</span>
                    <span style={{ fontSize: 11, color: TEXT2, fontWeight: 700, flexShrink: 0 }}>{cardapio.saltyFlavors.length}</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                    {cardapio.saltyFlavors.map((s, i) => (
                      <div key={i} style={tagStyle}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>{s}</span>
                        <button onClick={() => removerSabor('saltyFlavors', i)} style={btnRemoveTag}>×</button>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input placeholder="Novo sabor" value={novoItem} onChange={e => setNovoItem(e.target.value)} onKeyDown={e => e.key === 'Enter' && adicionarSabor('saltyFlavors')} style={{ ...inputStyle, flex: 1 }} />
                    <button onClick={() => adicionarSabor('saltyFlavors')} style={btnAdicionar}>+ Add</button>
                  </div>
                </SectionCard>

                {/* Sabores Doces */}
                <SectionCard>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: -4 }}>
                    <span style={{ fontSize: 16, flexShrink: 0 }}>🍬</span>
                    <span style={{ fontSize: 13, fontWeight: 900, color: TEXT, textTransform: 'uppercase', letterSpacing: '0.8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>Sabores Doces</span>
                    <span style={{ fontSize: 11, color: TEXT2, fontWeight: 700, flexShrink: 0 }}>{cardapio.sweetFlavors.length}</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                    {cardapio.sweetFlavors.map((s, i) => (
                      <div key={i} style={tagStyle}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>{s}</span>
                        <button onClick={() => removerSabor('sweetFlavors', i)} style={btnRemoveTag}>×</button>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input placeholder="Novo sabor" value={novoItem} onChange={e => setNovoItem(e.target.value)} onKeyDown={e => e.key === 'Enter' && adicionarSabor('sweetFlavors')} style={{ ...inputStyle, flex: 1 }} />
                    <button onClick={() => adicionarSabor('sweetFlavors')} style={btnAdicionar}>+ Add</button>
                  </div>
                </SectionCard>

                {/* Bebidas */}
                <SectionCard>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: -4 }}>
                    <span style={{ fontSize: 16, flexShrink: 0 }}>🥤</span>
                    <span style={{ fontSize: 13, fontWeight: 900, color: TEXT, textTransform: 'uppercase', letterSpacing: '0.8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Bebidas</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {cardapio.bebidas.map((b, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(var(--overlay-rgb), 0.04)', borderRadius: 10, padding: '10px 12px' }}>
                        <span style={{ color: TEXT, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: 8 }}>{b.name}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                          <span style={{ color: 'var(--success)', fontSize: 13, fontWeight: 800 }}>R$ {b.price.toFixed(2).replace('.', ',')}</span>
                          <button onClick={() => removerBebida('bebidas', i)} style={btnRemoveRow}>×</button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input placeholder="Nome" value={novoItem} onChange={e => setNovoItem(e.target.value)} style={{ ...inputStyle, flex: 2 }} />
                    <input placeholder="R$" value={novoPreco} onChange={e => setNovoPreco(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
                    <button onClick={() => adicionarBebida('bebidas')} style={btnAdicionar}>+ Add</button>
                  </div>
                </SectionCard>

                {/* Sucos */}
                <SectionCard>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: -4 }}>
                    <span style={{ fontSize: 16, flexShrink: 0 }}>🧃</span>
                    <span style={{ fontSize: 13, fontWeight: 900, color: TEXT, textTransform: 'uppercase', letterSpacing: '0.8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Sucos</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {cardapio.sucos.map((s, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(var(--overlay-rgb), 0.04)', borderRadius: 10, padding: '10px 12px' }}>
                        <span style={{ color: TEXT, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: 8 }}>{s.name}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                          <span style={{ color: 'var(--success)', fontSize: 13, fontWeight: 800 }}>R$ {s.price.toFixed(2).replace('.', ',')}</span>
                          <button onClick={() => removerBebida('sucos', i)} style={btnRemoveRow}>×</button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input placeholder="Nome" value={novoItem} onChange={e => setNovoItem(e.target.value)} style={{ ...inputStyle, flex: 2 }} />
                    <input placeholder="R$" value={novoPreco} onChange={e => setNovoPreco(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
                    <button onClick={() => adicionarBebida('sucos')} style={btnAdicionar}>+ Add</button>
                  </div>
                </SectionCard>

                {/* Bairros */}
                <SectionCard>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: -4 }}>
                    <span style={{ fontSize: 16, flexShrink: 0 }}>📍</span>
                    <span style={{ fontSize: 13, fontWeight: 900, color: TEXT, textTransform: 'uppercase', letterSpacing: '0.8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Bairros e Taxas</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {cardapio.neighborhoods.map((n, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(var(--overlay-rgb), 0.04)', borderRadius: 10, padding: '10px 12px' }}>
                        <span style={{ color: TEXT, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: 8 }}>{n.name}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                          <span style={{ color: 'var(--brand-text)', fontSize: 13, fontWeight: 800 }}>R$ {n.fee.toFixed(2).replace('.', ',')}</span>
                          <button onClick={() => removerBairro(i)} style={btnRemoveRow}>×</button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input placeholder="Bairro" value={novoItem} onChange={e => setNovoItem(e.target.value)} style={{ ...inputStyle, flex: 2 }} />
                    <input placeholder="Taxa" value={novoTaxa} onChange={e => setNovoTaxa(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
                    <button onClick={adicionarBairro} style={btnAdicionar}>+ Add</button>
                  </div>
                </SectionCard>

                {/* Tamanhos */}
                <SectionCard>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: -4 }}>
                    <span style={{ fontSize: 16, flexShrink: 0 }}>🍕</span>
                    <span style={{ fontSize: 13, fontWeight: 900, color: TEXT, textTransform: 'uppercase', letterSpacing: '0.8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Preços das Pizzas</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {cardapio.sizes.map((s, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ color: TEXT, fontSize: 13, fontWeight: 800, width: 100, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label} ({s.code})</span>
                        <input
                          type="number"
                          value={s.price}
                          onChange={e => setCardapio(prev => ({ ...prev, sizes: prev.sizes.map((sz, idx) => idx === i ? { ...sz, price: parseFloat(e.target.value) || 0 } : sz) }))}
                          style={{ ...inputStyle, flex: 1 }}
                        />
                      </div>
                    ))}
                  </div>
                </SectionCard>

                {/* Bordas */}
                <SectionCard>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: -4 }}>
                    <span style={{ fontSize: 16, flexShrink: 0 }}>🧀</span>
                    <span style={{ fontSize: 13, fontWeight: 900, color: TEXT, textTransform: 'uppercase', letterSpacing: '0.8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Preços das Bordas</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {cardapio.borders.map((b, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ color: TEXT, fontSize: 13, fontWeight: 800, flex: 1, minWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.label}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <label style={{ ...labelStyle, margin: 0, marginRight: 2 }}>P/M</label>
                          <input type="number" value={b.priceSmall} onChange={e => setCardapio(prev => ({ ...prev, borders: prev.borders.map((bd, idx) => idx === i ? { ...bd, priceSmall: parseFloat(e.target.value) || 0 } : bd) }))} style={{ ...inputStyle, width: 70 }} />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <label style={{ ...labelStyle, margin: 0, marginRight: 2 }}>G/F</label>
                          <input type="number" value={b.priceLarge} onChange={e => setCardapio(prev => ({ ...prev, borders: prev.borders.map((bd, idx) => idx === i ? { ...bd, priceLarge: parseFloat(e.target.value) || 0 } : bd) }))} style={{ ...inputStyle, width: 70 }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </SectionCard>

                <button
                  onClick={salvarCardapio}
                  disabled={salvando}
                  style={{ width: '100%', height: 56, background: salvando ? 'var(--background)' : `linear-gradient(180deg, ${ACCENT}, var(--primary))`, border: 'none', borderRadius: 14, color: 'var(--primary-foreground)', fontSize: 16, fontWeight: 900, cursor: salvando ? 'not-allowed' : 'pointer', fontFamily: FONT, letterSpacing: '-0.2px', opacity: salvando ? 0.6 : 1 }}
                >
                  {salvando ? 'Salvando...' : '💾 Salvar Cardápio'}
                </button>

                {mensagem && (
                  <div style={{ textAlign: 'center', padding: '12px 16px', background: mensagem.includes('✅') ? 'color-mix(in srgb, var(--success) 10%, transparent)' : 'color-mix(in srgb, var(--danger) 10%, transparent)', border: `1px solid ${mensagem.includes('✅') ? 'color-mix(in srgb, var(--success) 30%, transparent)' : 'color-mix(in srgb, var(--danger) 30%, transparent)'}`, borderRadius: 12 }}>
                    <p style={{ color: mensagem.includes('✅') ? 'var(--success)' : 'var(--danger)', fontWeight: 800, fontSize: 14, margin: 0 }}>{mensagem}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </PanelShell>
  )
}
