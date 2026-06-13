'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type Config = {
  nomePizzaria: string
  horaAbertura: number
  horaFechamento: number
  chavePix: string
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
const BG = '#060606'
const CARD_BG = '#101010'
const BORDER = '1px solid #1f1d1a'
const TEXT = '#f4f1ec'
const TEXT2 = '#a39b8b'

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#1a1208',
  border: '1px solid #1f1d1a',
  borderRadius: 10,
  padding: '14px 14px',
  color: TEXT,
  fontSize: 16,
  outline: 'none',
  boxSizing: 'border-box',
  minHeight: 52,
  fontFamily: FONT,
}

const btnAdicionar: React.CSSProperties = {
  background: '#e53e3e',
  border: 'none',
  color: '#fff',
  borderRadius: 8,
  padding: '14px 16px',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 700,
  whiteSpace: 'nowrap',
  minHeight: 48,
  fontFamily: FONT,
}

const tagStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid #1f1d1a',
  borderRadius: 20,
  padding: '6px 12px',
  fontSize: 13,
  color: TEXT,
  maxWidth: '100%',
  overflow: 'hidden',
}

export default function ConfiguracoesPage() {
  const router = useRouter()
  const [aba, setAba] = useState<'geral' | 'cardapio'>('geral')
  const [config, setConfig] = useState<Config>({ nomePizzaria: 'Chefe da Pizza', horaAbertura: 18, horaFechamento: 23, chavePix: '' })
  const [cardapio, setCardapio] = useState<Cardapio>({ saltyFlavors: [], sweetFlavors: [], bebidas: [], sucos: [], neighborhoods: [], sizes: [], borders: [] })
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [mensagem, setMensagem] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [novoItem, setNovoItem] = useState('')
  const [novoPreco, setNovoPreco] = useState('')
  const [novoTaxa, setNovoTaxa] = useState('')
  const is24h = config.horaAbertura === 0 && config.horaFechamento === 24

  useEffect(() => {
    const role = getUserRole()
    setIsAdmin(role === 'admin')
    setChecking(false)
    fetch('/api/configuracoes')
      .then(r => { if (r.status === 401) { router.push('/login?callbackUrl=/configuracoes'); return null } return r.json() })
      .then(data => { if (data) { setConfig(data); setLoading(false) } })
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
  }, [router])

  const toggle24h = async () => {
    const novaConfig = is24h ? { ...config, horaAbertura: 18, horaFechamento: 23 } : { ...config, horaAbertura: 0, horaFechamento: 24 }
    setConfig(novaConfig)
    setSalvando(true)
    try {
      const res = await fetch('/api/configuracoes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(novaConfig) })
      if (res.ok) { setMensagem(is24h ? '✅ Horário padrão restaurado!' : '✅ Aberto 24h!'); setTimeout(() => setMensagem(''), 3000) }
    } catch { setMensagem('❌ Erro ao salvar.'); setTimeout(() => setMensagem(''), 3000) }
    setSalvando(false)
  }

  const salvar = async () => {
    setSalvando(true)
    try {
      const res = await fetch('/api/configuracoes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) })
      if (res.ok) { setMensagem('✅ Configurações salvas!'); setTimeout(() => setMensagem(''), 3000) }
    } catch { setMensagem('❌ Erro ao salvar.'); setTimeout(() => setMensagem(''), 3000) }
    setSalvando(false)
  }

  const salvarCardapio = async () => {
    setSalvando(true)
    try {
      const res = await fetch('/api/cardapio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cardapio) })
      if (res.ok) { setMensagem('✅ Cardápio salvo!'); setTimeout(() => setMensagem(''), 3000) }
    } catch { setMensagem('❌ Erro ao salvar.'); setTimeout(() => setMensagem(''), 3000) }
    setSalvando(false)
  }

  const removerSabor = (tipo: 'saltyFlavors' | 'sweetFlavors', idx: number) => {
    setCardapio(prev => ({ ...prev, [tipo]: prev[tipo].filter((_, i) => i !== idx) }))
  }

  const adicionarSabor = (tipo: 'saltyFlavors' | 'sweetFlavors') => {
    if (!novoItem.trim()) return
    setCardapio(prev => ({ ...prev, [tipo]: [...prev[tipo], novoItem.trim()] }))
    setNovoItem('')
  }

  const removerBebida = (tipo: 'bebidas' | 'sucos', idx: number) => {
    setCardapio(prev => ({ ...prev, [tipo]: prev[tipo].filter((_, i) => i !== idx) }))
  }

  const adicionarBebida = (tipo: 'bebidas' | 'sucos') => {
    if (!novoItem.trim() || !novoPreco.trim()) return
    setCardapio(prev => ({ ...prev, [tipo]: [...prev[tipo], { name: novoItem.trim(), price: parseFloat(novoPreco) }] }))
    setNovoItem(''); setNovoPreco('')
  }

  const removerBairro = (idx: number) => {
    setCardapio(prev => ({ ...prev, neighborhoods: prev.neighborhoods.filter((_, i) => i !== idx) }))
  }

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
    <div style={{
      minHeight: '100svh',
      background: BG,
      paddingTop: 'calc(env(safe-area-inset-top) + 18px)',
      paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)',
      paddingLeft: 16,
      paddingRight: 16,
      fontFamily: FONT,
      overflowX: 'hidden',
    }}>
      <div style={{ maxWidth: 375, margin: '0 auto' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <button
            onClick={() => { window.location.href = '/admin' }}
            style={{ background: 'rgba(255,255,255,0.07)', border: BORDER, color: TEXT, borderRadius: 8, padding: '10px 14px', cursor: 'pointer', fontSize: 14, minHeight: 44, fontFamily: FONT }}
          >← Voltar</button>
          <h1 style={{ color: TEXT, fontSize: 22, fontWeight: 700, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>⚙️ Configurações</h1>
        </div>

        {/* Abas */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          {(['geral', 'cardapio'] as const).map(a => (
            <button
              key={a}
              onClick={() => setAba(a)}
              style={{ flex: 1, padding: '0 0', minHeight: 48, borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 14, background: aba === a ? '#e53e3e' : CARD_BG, color: TEXT, fontFamily: FONT }}
            >
              {a === 'geral' ? '⚙️ Geral' : '🍕 Cardápio'}
            </button>
          ))}
        </div>

        {/* Aba Geral */}
        {aba === 'geral' && (
          <div style={{ background: CARD_BG, border: BORDER, borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <label style={{ color: TEXT2, fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 8 }}>🍕 Nome da Pizzaria</label>
              <input type="text" value={config.nomePizzaria} onChange={e => setConfig(prev => ({ ...prev, nomePizzaria: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label style={{ color: TEXT2, fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 8 }}>⏰ Horário de Funcionamento</label>
              <button
                onClick={toggle24h}
                disabled={salvando}
                style={{ width: '100%', background: is24h ? 'linear-gradient(135deg, #38a169, #276749)' : 'rgba(255,255,255,0.05)', border: is24h ? '2px solid #38a169' : BORDER, borderRadius: 10, padding: '14px', color: TEXT, fontSize: 14, fontWeight: 700, cursor: salvando ? 'not-allowed' : 'pointer', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48, fontFamily: FONT }}
              >
                {is24h ? '✅ Aberto 24 horas (ativo) — clique para desativar' : '🕐 Ativar funcionamento 24 horas'}
              </button>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ color: TEXT2, fontSize: 12, display: 'block', marginBottom: 4 }}>Abre às</label>
                  <input type="number" min={0} max={23} value={config.horaAbertura} onChange={e => setConfig(prev => ({ ...prev, horaAbertura: Number(e.target.value) }))} style={inputStyle} />
                </div>
                <span style={{ color: TEXT2, fontSize: 20, paddingTop: 20 }}>→</span>
                <div style={{ flex: 1 }}>
                  <label style={{ color: TEXT2, fontSize: 12, display: 'block', marginBottom: 4 }}>Fecha às</label>
                  <input type="number" min={0} max={24} value={config.horaFechamento} onChange={e => setConfig(prev => ({ ...prev, horaFechamento: Number(e.target.value) }))} style={inputStyle} />
                </div>
              </div>
            </div>
            {isAdmin && (
              <div style={{ background: 'rgba(255,215,0,0.04)', border: '1px solid rgba(255,215,0,0.15)', borderRadius: 12, padding: 16 }}>
                <label style={{ color: 'rgba(255,220,100,0.9)', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  💸 Chave Pix <span style={{ fontSize: 11, background: 'rgba(255,200,0,0.1)', padding: '2px 8px', borderRadius: 20 }}>Somente Admin</span>
                </label>
                <input type="text" placeholder="Ex: 11999999999 ou email@email.com" value={config.chavePix} onChange={e => setConfig(prev => ({ ...prev, chavePix: e.target.value }))} style={{ ...inputStyle, border: '1px solid rgba(255,200,0,0.2)' }} />
              </div>
            )}
            <button
              onClick={salvar}
              disabled={salvando}
              style={{ background: salvando ? 'rgba(255,255,255,0.1)' : 'linear-gradient(135deg, #e53e3e, #c53030)', border: 'none', borderRadius: 12, padding: '14px 0', color: '#fff', fontSize: 16, fontWeight: 700, cursor: salvando ? 'not-allowed' : 'pointer', minHeight: 52, fontFamily: FONT }}
            >
              {salvando ? 'Salvando...' : 'Salvar Configurações'}
            </button>
            {mensagem && <p style={{ textAlign: 'center', color: mensagem.includes('✅') ? '#68d391' : '#fc8181', fontWeight: 600 }}>{mensagem}</p>}
          </div>
        )}

        {/* Aba Cardápio */}
        {aba === 'cardapio' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Sabores Salgados */}
            <div style={{ background: CARD_BG, border: BORDER, borderRadius: 16, padding: 20 }}>
              <p style={{ color: TEXT, fontWeight: 700, fontSize: 15, margin: '0 0 12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>🧂 Sabores Salgados</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                {cardapio.saltyFlavors.map((s, i) => (
                  <div key={i} style={tagStyle}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>{s}</span>
                    <button onClick={() => removerSabor('saltyFlavors', i)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 16, padding: 0, lineHeight: 1, flexShrink: 0 }}>×</button>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input placeholder="Novo sabor" value={novoItem} onChange={e => setNovoItem(e.target.value)} onKeyDown={e => e.key === 'Enter' && adicionarSabor('saltyFlavors')} style={{ ...inputStyle, flex: 1 }} />
                <button onClick={() => adicionarSabor('saltyFlavors')} style={btnAdicionar}>+ Add</button>
              </div>
            </div>

            {/* Sabores Doces */}
            <div style={{ background: CARD_BG, border: BORDER, borderRadius: 16, padding: 20 }}>
              <p style={{ color: TEXT, fontWeight: 700, fontSize: 15, margin: '0 0 12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>🍬 Sabores Doces</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                {cardapio.sweetFlavors.map((s, i) => (
                  <div key={i} style={tagStyle}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>{s}</span>
                    <button onClick={() => removerSabor('sweetFlavors', i)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 16, padding: 0, lineHeight: 1, flexShrink: 0 }}>×</button>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input placeholder="Novo sabor" value={novoItem} onChange={e => setNovoItem(e.target.value)} onKeyDown={e => e.key === 'Enter' && adicionarSabor('sweetFlavors')} style={{ ...inputStyle, flex: 1 }} />
                <button onClick={() => adicionarSabor('sweetFlavors')} style={btnAdicionar}>+ Add</button>
              </div>
            </div>

            {/* Bebidas */}
            <div style={{ background: CARD_BG, border: BORDER, borderRadius: 16, padding: 20 }}>
              <p style={{ color: TEXT, fontWeight: 700, fontSize: 15, margin: '0 0 12px' }}>🥤 Bebidas</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                {cardapio.bebidas.map((b, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '10px 12px' }}>
                    <span style={{ color: TEXT, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: 8 }}>{b.name}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <span style={{ color: '#4ade80', fontSize: 13, fontWeight: 700 }}>R$ {b.price.toFixed(2).replace('.', ',')}</span>
                      <button onClick={() => removerBebida('bebidas', i)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 18, padding: '0 4px' }}>×</button>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input placeholder="Nome" value={novoItem} onChange={e => setNovoItem(e.target.value)} style={{ ...inputStyle, flex: 2 }} />
                <input placeholder="R$" value={novoPreco} onChange={e => setNovoPreco(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
                <button onClick={() => adicionarBebida('bebidas')} style={btnAdicionar}>+ Add</button>
              </div>
            </div>

            {/* Sucos */}
            <div style={{ background: CARD_BG, border: BORDER, borderRadius: 16, padding: 20 }}>
              <p style={{ color: TEXT, fontWeight: 700, fontSize: 15, margin: '0 0 12px' }}>🧃 Sucos</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                {cardapio.sucos.map((s, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '10px 12px' }}>
                    <span style={{ color: TEXT, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: 8 }}>{s.name}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <span style={{ color: '#4ade80', fontSize: 13, fontWeight: 700 }}>R$ {s.price.toFixed(2).replace('.', ',')}</span>
                      <button onClick={() => removerBebida('sucos', i)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 18, padding: '0 4px' }}>×</button>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input placeholder="Nome" value={novoItem} onChange={e => setNovoItem(e.target.value)} style={{ ...inputStyle, flex: 2 }} />
                <input placeholder="R$" value={novoPreco} onChange={e => setNovoPreco(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
                <button onClick={() => adicionarBebida('sucos')} style={btnAdicionar}>+ Add</button>
              </div>
            </div>

            {/* Bairros */}
            <div style={{ background: CARD_BG, border: BORDER, borderRadius: 16, padding: 20 }}>
              <p style={{ color: TEXT, fontWeight: 700, fontSize: 15, margin: '0 0 12px' }}>📍 Bairros e Taxas</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                {cardapio.neighborhoods.map((n, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '10px 12px' }}>
                    <span style={{ color: TEXT, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: 8 }}>{n.name}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <span style={{ color: '#fbbf24', fontSize: 13, fontWeight: 700 }}>R$ {n.fee.toFixed(2).replace('.', ',')}</span>
                      <button onClick={() => removerBairro(i)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 18, padding: '0 4px' }}>×</button>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input placeholder="Bairro" value={novoItem} onChange={e => setNovoItem(e.target.value)} style={{ ...inputStyle, flex: 2 }} />
                <input placeholder="Taxa" value={novoTaxa} onChange={e => setNovoTaxa(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
                <button onClick={adicionarBairro} style={btnAdicionar}>+ Add</button>
              </div>
            </div>

            {/* Tamanhos de Pizza */}
            <div style={{ background: CARD_BG, border: BORDER, borderRadius: 16, padding: 20 }}>
              <p style={{ color: TEXT, fontWeight: 700, fontSize: 15, margin: '0 0 12px' }}>🍕 Preços das Pizzas</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {cardapio.sizes.map((s, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: TEXT, fontSize: 13, fontWeight: 700, width: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>{s.label} ({s.code})</span>
                    <input
                      type="number"
                      value={s.price}
                      onChange={e => setCardapio(prev => ({ ...prev, sizes: prev.sizes.map((sz, idx) => idx === i ? { ...sz, price: parseFloat(e.target.value) || 0 } : sz) }))}
                      style={{ ...inputStyle, width: 100, flex: 1 }}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Bordas */}
            <div style={{ background: CARD_BG, border: BORDER, borderRadius: 16, padding: 20 }}>
              <p style={{ color: TEXT, fontWeight: 700, fontSize: 15, margin: '0 0 12px' }}>🧀 Preços das Bordas</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {cardapio.borders.map((b, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ color: TEXT, fontSize: 13, fontWeight: 700, flex: 1, minWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.label}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <label style={{ color: TEXT2, fontSize: 11 }}>P/M</label>
                      <input type="number" value={b.priceSmall} onChange={e => setCardapio(prev => ({ ...prev, borders: prev.borders.map((bd, idx) => idx === i ? { ...bd, priceSmall: parseFloat(e.target.value) || 0 } : bd) }))} style={{ ...inputStyle, width: 70 }} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <label style={{ color: TEXT2, fontSize: 11 }}>G/F</label>
                      <input type="number" value={b.priceLarge} onChange={e => setCardapio(prev => ({ ...prev, borders: prev.borders.map((bd, idx) => idx === i ? { ...bd, priceLarge: parseFloat(e.target.value) || 0 } : bd) }))} style={{ ...inputStyle, width: 70 }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={salvarCardapio}
              disabled={salvando}
              style={{ background: salvando ? 'rgba(255,255,255,0.1)' : 'linear-gradient(135deg, #e53e3e, #c53030)', border: 'none', borderRadius: 12, padding: '14px 0', color: '#fff', fontSize: 16, fontWeight: 700, cursor: salvando ? 'not-allowed' : 'pointer', minHeight: 52, fontFamily: FONT }}
            >
              {salvando ? 'Salvando...' : '💾 Salvar Cardápio'}
            </button>

            {mensagem && <p style={{ textAlign: 'center', color: mensagem.includes('✅') ? '#68d391' : '#fc8181', fontWeight: 600 }}>{mensagem}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
