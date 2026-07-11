'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type Custo = {
  id: string
  descricao: string
  valor: number
  categoria: string
  data: string
  mes: string
}

type Pedido = {
  id: string
  cliente: string
  total: number
  status: string
  horario: string
  itens?: string[]
  data?: string
}

type Periodo = 'hoje' | 'semana' | 'mes'

type Transacao = {
  id: string
  tipo: 'pedido' | 'custo'
  emoji: string
  inicial: string
  descricao: string
  subtitulo: string
  valor: number
  data: string
  horario: string
  custoId?: string
}

const CATEGORIAS = [
  { key: 'ingredientes', emoji: '🧄', label: 'Ingredientes', cor: 'var(--primary)' },
  { key: 'embalagens',   emoji: '📦', label: 'Embalagens',   cor: 'var(--info)' },
  { key: 'energia',      emoji: '💡', label: 'Energia/Gás',  cor: 'var(--primary)' },
  { key: 'funcionarios', emoji: '👥', label: 'Funcionários', cor: 'var(--attention)' },
  { key: 'aluguel',      emoji: '🏠', label: 'Aluguel',      cor: 'var(--attention)' },
  { key: 'marketing',    emoji: '📱', label: 'Marketing',    cor: 'var(--info)' },
  { key: 'manutencao',   emoji: '🔧', label: 'Manutenção',   cor: 'var(--success)' },
  { key: 'outros',       emoji: '📋', label: 'Outros',       cor: 'var(--foreground-muted)' },
]

const FONT   = "'Archivo', sans-serif"
const BG     = 'var(--background)'
const CARD   = 'var(--surface)'
const BORDER = '1px solid var(--surface)'
const TEXT   = 'var(--foreground)'
const TEXT2  = 'var(--foreground-secondary)'
const DIM    = 'var(--foreground-muted)'
const ACCENT = 'var(--primary)'
const GREEN  = 'var(--success)'
const RED    = 'var(--danger)'

const fmt = (v: number) =>
  v.toFixed(2).replace('.', ',')

const hoje = () => new Date().toLocaleDateString('pt-BR')

// ── Avatar circular: inicial (pedido) ou emoji (custo) ──────────────────────
function Avatar({ tx }: { tx: Transacao }) {
  if (tx.tipo === 'pedido') {
    return (
      <div style={{ width: 44, height: 44, borderRadius: 22, background: 'color-mix(in srgb, var(--primary) 14%, transparent)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: ACCENT, fontSize: 17, fontWeight: 900, fontFamily: FONT, lineHeight: 1 }}>{tx.inicial}</span>
      </div>
    )
  }
  return (
    <div style={{ width: 44, height: 44, borderRadius: 22, background: 'color-mix(in srgb, var(--danger) 10%, transparent)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
      {tx.emoji}
    </div>
  )
}

export default function FinanceiroPage() {
  const router = useRouter()
  const [custos, setCustos]           = useState<Custo[]>([])
  const [pedidos, setPedidos]         = useState<Pedido[]>([])
  const [loading, setLoading]         = useState(true)
  const [salvando, setSalvando]       = useState(false)
  const [mensagem, setMensagem]       = useState('')
  const [periodo, setPeriodo]         = useState<Periodo>('mes')
  const [modalAberto, setModalAberto] = useState(false)
  const [novoDescricao, setNovoDescricao] = useState('')
  const [novoValor, setNovoValor]         = useState('')
  const [novaCategoria, setNovaCategoria] = useState('ingredientes')
  const [mesAtual] = useState(new Date().toISOString().slice(0, 7))
  const [mesLabel] = useState(new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }))

  useEffect(() => {
    Promise.all([
      fetch(`/api/financeiro?mes=${mesAtual}`).then(r => r.json()),
      fetch('/api/orders').then(r => r.json()),
    ]).then(([cs, pds]) => {
      setCustos(Array.isArray(cs) ? cs : [])
      setPedidos(Array.isArray(pds) ? pds.filter((p: Pedido) => p.status === 'entregue') : [])
      setLoading(false)
    })
  }, [mesAtual])

  const msg = (m: string) => { setMensagem(m); setTimeout(() => setMensagem(''), 3000) }

  const adicionarCusto = async () => {
    if (!novoDescricao.trim() || !novoValor.trim()) return
    setSalvando(true)
    try {
      const res = await fetch('/api/financeiro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ descricao: novoDescricao.trim(), valor: parseFloat(novoValor.replace(',', '.')), categoria: novaCategoria }),
      })
      const d = await res.json()
      if (d.ok) {
        setCustos(prev => [...prev, d.custo])
        setNovoDescricao(''); setNovoValor('')
        setModalAberto(false)
        msg('✅ Custo registrado!')
      }
    } catch { msg('❌ Erro ao salvar.') }
    setSalvando(false)
  }

  const removerCusto = async (id: string) => {
    try {
      await fetch('/api/financeiro', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, mes: mesAtual }) })
      setCustos(prev => prev.filter(c => c.id !== id))
      msg('✅ Removido!')
    } catch { msg('❌ Erro.') }
  }

  // ── Filtros de período ──────────────────────────────────────────────────────
  const now      = new Date()
  const dataHoje = hoje()

  const isNoPeriodo = (dataStr: string | undefined): boolean => {
    if (!dataStr) return true
    const [d, m, y] = dataStr.split('/').map(Number)
    const data = new Date(y, m - 1, d)
    const diff = Math.floor((now.getTime() - data.getTime()) / 86400000)
    if (periodo === 'hoje')   return dataStr === dataHoje
    if (periodo === 'semana') return diff <= 6
    return true
  }

  const custosFiltrados  = custos.filter(c => isNoPeriodo(c.data))
  const pedidosFiltrados = pedidos.filter(p => isNoPeriodo(p.data ?? dataHoje))

  const faturamento = pedidosFiltrados.reduce((s, p) => s + (Number(p.total) || 0), 0)
  const totalCustos = custosFiltrados.reduce((s, c) => s + c.valor, 0)
  const lucro       = faturamento - totalCustos

  const fatHoje = pedidos
    .filter(p => (p.data ?? dataHoje) === dataHoje)
    .reduce((s, p) => s + (Number(p.total) || 0), 0)

  // ── Extrato unificado ────────────────────────────────────────────────────────
  const transacoes: Transacao[] = [
    ...pedidosFiltrados.map(p => ({
      id:        'p_' + p.id,
      tipo:      'pedido' as const,
      emoji:     '🍕',
      inicial:   (p.cliente || 'P')[0].toUpperCase(),
      descricao: p.cliente || 'Pedido',
      subtitulo: p.horario ? `Pedido · ${p.horario}` : 'Pedido',
      valor:     Number(p.total) || 0,
      data:      p.data ?? dataHoje,
      horario:   p.horario ?? '',
    })),
    ...custosFiltrados.map(c => {
      const cat = CATEGORIAS.find(x => x.key === c.categoria)
      return {
        id:        'c_' + c.id,
        tipo:      'custo' as const,
        emoji:     cat?.emoji ?? '💸',
        inicial:   '',
        descricao: c.descricao,
        subtitulo: (cat?.label ?? 'Custo') + (c.data ? ` · ${c.data}` : ''),
        valor:     c.valor,
        data:      c.data ?? dataHoje,
        horario:   '',
        custoId:   c.id,
      }
    }),
  ].sort((a, b) => {
    const parseBR = (s: string) => {
      const [d, m, y] = s.split('/').map(Number)
      return new Date(y, m - 1, d).getTime()
    }
    const dd = parseBR(b.data) - parseBR(a.data)
    return dd !== 0 ? dd : b.horario.localeCompare(a.horario)
  })

  const labelData = (dateStr: string) => {
    if (dateStr === dataHoje) return 'Hoje'
    const ontem = new Date(now); ontem.setDate(ontem.getDate() - 1)
    if (dateStr === ontem.toLocaleDateString('pt-BR')) return 'Ontem'
    return dateStr.slice(0, 5)
  }

  const grupos: { label: string; items: Transacao[] }[] = []
  for (const tx of transacoes) {
    const label = labelData(tx.data)
    const g = grupos.find(x => x.label === label)
    if (g) g.items.push(tx); else grupos.push({ label, items: [tx] })
  }

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ minHeight: '100svh', background: BG, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 52, height: 52, borderRadius: 26, background: 'color-mix(in srgb, var(--primary) 12%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, margin: '0 auto 14px' }}>💰</div>
        <p style={{ color: DIM, fontSize: 13, margin: 0, fontWeight: 600 }}>Carregando...</p>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight: '100svh', background: BG, fontFamily: FONT, overflowX: 'hidden', paddingBottom: 'calc(env(safe-area-inset-bottom) + 100px)' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&display=swap');
        @keyframes slideUp { from { opacity:0; transform:translateY(16px) } to { opacity:1; transform:translateY(0) } }
        @keyframes fadeIn  { from { opacity:0 } to { opacity:1 } }
      `}</style>

      {/* ── Toast ────────────────────────────────────────────────────────────── */}
      {mensagem && (
        <div style={{ position: 'fixed', top: 'calc(env(safe-area-inset-top) + 16px)', left: '50%', transform: 'translateX(-50%)', zIndex: 300, background: mensagem.includes('✅') ? 'var(--success-soft)' : 'var(--danger)', borderRadius: 12, padding: '10px 20px', color: mensagem.includes('✅') ? 'var(--success)' : 'var(--danger)', fontWeight: 700, fontSize: 13, animation: 'slideUp 0.2s ease', whiteSpace: 'nowrap', boxShadow: '0 8px 40px rgba(0,0,0,0.6)' }}>
          {mensagem}
        </div>
      )}

      {/* ── Header sticky ────────────────────────────────────────────────────── */}
      <div style={{ position: 'sticky', top: 0, zIndex: 100, background: 'color-mix(in srgb, var(--background) 97%, transparent)', borderBottom: '1px solid var(--surface)', paddingTop: 'calc(env(safe-area-inset-top) + 12px)', paddingBottom: 12, paddingLeft: 20, paddingRight: 20 }}>
        <div style={{ maxWidth: 375, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button onClick={() => router.push('/admin')} style={{ background: 'rgba(var(--overlay-rgb), 0.05)', border: '1px solid rgba(var(--overlay-rgb), 0.08)', color: DIM, borderRadius: 10, padding: '8px 14px', cursor: 'pointer', fontSize: 14, minHeight: 44, fontFamily: FONT, fontWeight: 700, flexShrink: 0 }}>←</button>
          <div style={{ textAlign: 'center', flex: 1, margin: '0 12px', minWidth: 0 }}>
            <p style={{ color: TEXT, fontSize: 14, fontWeight: 800, margin: 0 }}>Financeiro</p>
            <p style={{ color: DIM, fontSize: 10, margin: 0, textTransform: 'uppercase', letterSpacing: '0.7px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mesLabel}</p>
          </div>
          <button onClick={() => fetch('/api/auth/logout', { method: 'POST' }).then(() => router.push('/login'))} style={{ background: 'rgba(var(--overlay-rgb), 0.05)', border: '1px solid rgba(var(--overlay-rgb), 0.08)', color: DIM, borderRadius: 10, padding: '8px 14px', cursor: 'pointer', fontSize: 12, minHeight: 44, fontFamily: FONT, flexShrink: 0 }}>Sair</button>
        </div>
      </div>

      {/* ── Hero — saldo com gradiente radial e glow ─────────────────────────── */}
      <div style={{ position: 'relative', overflow: 'hidden', background: 'radial-gradient(ellipse 120% 140% at 50% -10%, var(--danger-soft) 0%, var(--background) 40%, var(--background) 75%)', padding: '40px 20px 32px', textAlign: 'center' }}>
        {/* Glow blob laranja */}
        <div style={{ position: 'absolute', top: '-10px', left: '50%', transform: 'translateX(-50%)', width: 220, height: 110, borderRadius: '50%', background: 'color-mix(in srgb, var(--primary) 18%, transparent)', filter: 'blur(55px)', pointerEvents: 'none' }} />

        <p style={{ color: TEXT2, fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '2px', margin: '0 0 14px', position: 'relative' }}>
          {periodo === 'hoje' ? 'Faturamento de Hoje' : periodo === 'semana' ? 'Faturamento da Semana' : 'Faturamento do Mês'}
        </p>

        <p style={{ color: ACCENT, fontSize: 52, fontWeight: 900, letterSpacing: '-2px', lineHeight: 1, margin: '0 0 16px', fontVariantNumeric: 'tabular-nums', position: 'relative' }}>
          R$ {fmt(faturamento)}
        </p>

        {fatHoje > 0 && periodo !== 'hoje' && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'color-mix(in srgb, var(--success) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--success) 30%, transparent)', borderRadius: 20, padding: '5px 16px', position: 'relative' }}>
            <span style={{ color: GREEN, fontSize: 12, fontWeight: 800 }}>↑ +R$ {fmt(fatHoje)} hoje</span>
          </div>
        )}

        {/* 3 mini cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 28, position: 'relative' }}>
          {[
            { label: 'Fat.',   valor: faturamento, cor: ACCENT },
            { label: 'Custos', valor: totalCustos,  cor: RED },
            { label: 'Lucro',  valor: lucro,        cor: lucro >= 0 ? GREEN : RED },
          ].map(m => (
            <div key={m.label} style={{ background: 'rgba(var(--overlay-rgb), 0.05)', border: '1px solid rgba(var(--overlay-rgb), 0.08)', borderRadius: 16, padding: '12px 10px', textAlign: 'center' }}>
              <p style={{ color: DIM, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', margin: '0 0 6px' }}>{m.label}</p>
              <p style={{ color: m.cor, fontSize: 13, fontWeight: 900, margin: 0, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.3px' }}>R${fmt(m.valor)}</p>
            </div>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 375, margin: '0 auto', padding: '0 20px' }}>

        {/* ── Filtro de período estilo trading ──────────────────────────────── */}
        <div style={{ display: 'flex', gap: 4, marginTop: 24, marginBottom: 28, background: 'rgba(var(--overlay-rgb), 0.04)', border: '1px solid rgba(var(--overlay-rgb), 0.07)', borderRadius: 12, padding: 4 }}>
          {([['hoje', '1D'], ['semana', '1S'], ['mes', '1M']] as [Periodo, string][]).map(([p, label]) => (
            <button
              key={p}
              onClick={() => setPeriodo(p)}
              style={{ flex: 1, padding: '9px 0', minHeight: 42, borderRadius: 9, border: 'none', cursor: 'pointer', fontWeight: 800, fontSize: 13, fontFamily: FONT, transition: 'all .15s', background: periodo === p ? ACCENT : 'transparent', color: periodo === p ? 'var(--foreground)' : DIM, letterSpacing: '0.5px' }}
            >{label}</button>
          ))}
        </div>

        {/* ── Transações ────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <p style={{ color: TEXT, fontSize: 16, fontWeight: 800, margin: 0, letterSpacing: '-0.3px' }}>Transações</p>
          <p style={{ color: DIM, fontSize: 12, fontWeight: 600, margin: 0 }}>
            {transacoes.length} {transacoes.length === 1 ? 'item' : 'itens'}
          </p>
        </div>

        {grupos.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '56px 20px', color: DIM }}>
            <p style={{ fontSize: 40, margin: '0 0 16px' }}>📊</p>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: TEXT2 }}>Sem transações neste período</p>
            <p style={{ margin: '6px 0 0', fontSize: 12 }}>Toque em + para registrar um custo</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
            {grupos.map(grupo => (
              <div key={grupo.label}>
                {/* Separador de data */}
                <p style={{ color: DIM, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 14px' }}>{grupo.label}</p>

                {/* Itens — sem card, só espaçamento */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {grupo.items.map(tx => (
                    <div key={tx.id} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '10px 0' }}>
                      <Avatar tx={tx} />

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ color: TEXT, fontSize: 14, fontWeight: 700, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.descricao}</p>
                        <p style={{ color: DIM, fontSize: 11, margin: '3px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.subtitulo}</p>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                        <p style={{ color: tx.tipo === 'pedido' ? GREEN : RED, fontSize: 15, fontWeight: 800, margin: 0, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.4px' }}>
                          {tx.tipo === 'pedido' ? '+' : '−'}R$ {fmt(tx.valor)}
                        </p>
                        {tx.custoId && (
                          <button onClick={() => removerCusto(tx.custoId!)} style={{ background: 'none', border: 'none', color: 'var(--surface-secondary)', cursor: 'pointer', fontSize: 17, padding: 0, minHeight: 26, minWidth: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>×</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Divisor sutil entre grupos */}
                <div style={{ height: 1, background: 'var(--surface)', marginTop: 10 }} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── FAB "+" ──────────────────────────────────────────────────────────── */}
      <button
        onClick={() => setModalAberto(true)}
        aria-label="Adicionar custo"
        style={{ position: 'fixed', bottom: 'calc(env(safe-area-inset-bottom) + 24px)', right: 20, width: 56, height: 56, borderRadius: 28, background: `linear-gradient(135deg, var(--primary) 0%, var(--primary) 100%)`, border: 'none', color: 'var(--primary-foreground)', fontSize: 28, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 30px color-mix(in srgb, var(--primary) 55%, transparent), 0 2px 8px rgba(0,0,0,0.4)', zIndex: 90, lineHeight: 1, fontFamily: FONT }}
      >+</button>

      {/* ── Bottom sheet — registrar custo ───────────────────────────────────── */}
      {modalAberto && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setModalAberto(false) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 200, display: 'flex', alignItems: 'flex-end', animation: 'fadeIn 0.18s ease' }}
        >
          <div style={{ background: 'var(--surface)', borderRadius: '22px 22px 0 0', padding: '0 20px', paddingBottom: 'calc(env(safe-area-inset-bottom) + 28px)', width: '100%', maxWidth: 375, margin: '0 auto', animation: 'slideUp 0.25s ease', borderTop: '1px solid var(--surface-secondary)' }}>
            <div style={{ width: 36, height: 4, background: 'var(--surface-secondary)', borderRadius: 2, margin: '14px auto 24px' }} />
            <p style={{ color: TEXT, fontSize: 18, fontWeight: 900, margin: '0 0 22px', letterSpacing: '-0.5px' }}>Registrar Custo</p>

            <input
              placeholder="Descrição"
              value={novoDescricao}
              onChange={e => setNovoDescricao(e.target.value)}
              style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--surface-secondary)', borderRadius: 12, padding: '14px 16px', color: TEXT, fontSize: 16, outline: 'none', boxSizing: 'border-box', minHeight: 52, fontFamily: FONT, marginBottom: 10 }}
            />
            <input
              placeholder="Valor (R$)"
              value={novoValor}
              onChange={e => setNovoValor(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && adicionarCusto()}
              inputMode="decimal"
              style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--surface-secondary)', borderRadius: 12, padding: '14px 16px', color: TEXT, fontSize: 16, outline: 'none', boxSizing: 'border-box', minHeight: 52, fontFamily: FONT, marginBottom: 18 }}
            />

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 24 }}>
              {CATEGORIAS.map(cat => (
                <button
                  key={cat.key}
                  onClick={() => setNovaCategoria(cat.key)}
                  style={{ padding: '8px 14px', minHeight: 40, borderRadius: 20, border: novaCategoria === cat.key ? 'none' : '1px solid var(--surface-secondary)', cursor: 'pointer', fontSize: 12, fontWeight: 700, background: novaCategoria === cat.key ? cat.cor : 'var(--surface)', color: novaCategoria === cat.key ? 'var(--foreground)' : DIM, fontFamily: FONT, whiteSpace: 'nowrap', transition: 'all .12s' }}
                >{cat.emoji} {cat.label}</button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setModalAberto(false)} style={{ flex: 1, height: 54, background: 'var(--surface)', border: '1px solid var(--surface-secondary)', borderRadius: 14, color: DIM, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>Cancelar</button>
              <button onClick={adicionarCusto} disabled={salvando} style={{ flex: 2, height: 54, background: salvando ? 'var(--background)' : `linear-gradient(135deg, var(--primary), var(--primary))`, border: 'none', borderRadius: 14, color: 'var(--primary-foreground)', fontSize: 15, fontWeight: 800, cursor: salvando ? 'not-allowed' : 'pointer', fontFamily: FONT, opacity: salvando ? 0.7 : 1 }}>
                {salvando ? 'Salvando...' : '+ Registrar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
