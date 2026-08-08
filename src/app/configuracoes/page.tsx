'use client'
import { useEffect, useState, useRef } from 'react'
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
  // Correção da regra comercial do Calzone: `true` = "Reaproveitar sabores
  // da Pizza" (modo padrão/aprovado), `false` = usa a lista própria
  // calzoneFlavors. Espelha exatamente `flavorsMode` de
  // menu.lanches[Calzone] (ausente = "pizza") — ver GET /api/cardapio.
  const [calzoneModoPizza, setCalzoneModoPizza] = useState(true)
  const [salvandoCalzoneModo, setSalvandoCalzoneModo] = useState(false)
  const [mensagemCalzoneModo, setMensagemCalzoneModo] = useState('')
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
        const lanchesData: Array<{ flavorsKey?: string; flavorsMode?: string }> = Array.isArray(data?.lanches) ? data.lanches : []
        const calzone = lanchesData.find(l => l.flavorsKey === 'calzoneFlavors')
        setCalzoneModoPizza(!calzone || calzone.flavorsMode !== 'own')
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

  const alternarCalzoneModo = async () => {
    const novoModo = calzoneModoPizza ? 'own' : 'pizza'
    setSalvandoCalzoneModo(true)
    setMensagemCalzoneModo('')
    try {
      const res = await fetch('/api/cardapio/calzone-flavors-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modo: novoModo }),
      })
      if (res.ok) {
        setCalzoneModoPizza(novoModo === 'pizza')
        setMensagemCalzoneModo('✅ Configuração do Calzone salva!')
      } else {
        setMensagemCalzoneModo('❌ Erro ao salvar.')
      }
    } catch {
      setMensagemCalzoneModo('❌ Erro ao salvar.')
    }
    setSalvandoCalzoneModo(false)
    setTimeout(() => setMensagemCalzoneModo(''), 3000)
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

  // Trava síncrona (ref, não state): dois cliques rápidos no mesmo "+ Add"
  // usam o mesmo closure de novoItem/novoPreco, então sem essa trava os dois
  // passariam pelo `if` e cada um chamaria setCardapio, adicionando o mesmo
  // item duas vezes a partir de um único clique duplo.
  const adicionandoBebidaRef = useRef(false)

  const adicionarBebida = (tipo: 'bebidas' | 'sucos') => {
    if (adicionandoBebidaRef.current) return
    if (!novoItem.trim() || !novoPreco.trim()) return
    adicionandoBebidaRef.current = true
    setCardapio(prev => ({ ...prev, [tipo]: [...prev[tipo], { name: novoItem.trim(), price: parseFloat(novoPreco) }] }))
    setNovoItem(''); setNovoPreco('')
    setTimeout(() => { adicionandoBebidaRef.current = false }, 400)
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

                {/* Fidelidade */}
                {isAdmin && (
                  <SectionCard>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: -4, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 16, flexShrink: 0 }}>🎁</span>
                      <span style={{ fontSize: 13, fontWeight: 900, color: TEXT, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Fidelidade</span>
                      <span style={{ fontSize: 10, background: 'color-mix(in srgb, var(--primary) 12%, transparent)', color: 'color-mix(in srgb, var(--primary) 80%, transparent)', padding: '2px 8px', borderRadius: 20, fontWeight: 800, whiteSpace: 'nowrap' }}>Somente Admin</span>
                    </div>
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

                {/* Calzone — regra comercial dos sabores */}
                <SectionCard>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: -4 }}>
                    <span style={{ fontSize: 16, flexShrink: 0 }}>🥟</span>
                    <span style={{ fontSize: 13, fontWeight: 900, color: TEXT, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Calzone</span>
                  </div>
                  <button
                    onClick={alternarCalzoneModo}
                    disabled={salvandoCalzoneModo}
                    style={{ width: '100%', background: calzoneModoPizza ? 'color-mix(in srgb, var(--success) 10%, transparent)' : 'rgba(var(--overlay-rgb), 0.04)', border: `1.5px solid ${calzoneModoPizza ? 'color-mix(in srgb, var(--success) 40%, transparent)' : 'var(--border)'}`, borderRadius: 12, padding: '13px 16px', color: calzoneModoPizza ? 'var(--success)' : TEXT2, fontSize: 13, fontWeight: 800, cursor: salvandoCalzoneModo ? 'not-allowed' : 'pointer', minHeight: 48, fontFamily: FONT, opacity: salvandoCalzoneModo ? 0.6 : 1 }}
                  >
                    {calzoneModoPizza ? '✅ Reaproveitar sabores da Pizza' : '⭕ Usar lista própria do Calzone'}
                  </button>
                  <p style={{ fontSize: 12, color: TEXT2, margin: 0, lineHeight: 1.5 }}>
                    {calzoneModoPizza
                      ? 'Padrão: o Calzone aceita os mesmos sabores disponíveis da Pizza (mesmos IDs, sem lista separada). Desmarque para usar a lista própria "Sabores do Calzone".'
                      : 'O Calzone usa sua própria lista de sabores, independente da Pizza — mudanças na Pizza não afetam o Calzone.'}
                  </p>
                  {mensagemCalzoneModo && (
                    <p style={{ textAlign: 'center', color: mensagemCalzoneModo.includes('✅') ? 'var(--success)' : 'var(--danger)', fontWeight: 800, fontSize: 13, margin: 0 }}>{mensagemCalzoneModo}</p>
                  )}
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
