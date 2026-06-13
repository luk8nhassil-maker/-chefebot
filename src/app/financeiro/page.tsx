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
  descricao: string
  subtitulo: string
  valor: number
  data: string
  horario: string
  custoId?: string
}

const CATEGORIAS = [
  { key: 'ingredientes', emoji: '🧄', label: 'Ingredientes', cor: '#f97316' },
  { key: 'embalagens',   emoji: '📦', label: 'Embalagens',   cor: '#3b82f6' },
  { key: 'energia',      emoji: '💡', label: 'Energia/Gás',  cor: '#eab308' },
  { key: 'funcionarios', emoji: '👥', label: 'Funcionários', cor: '#8b5cf6' },
  { key: 'aluguel',      emoji: '🏠', label: 'Aluguel',      cor: '#ec4899' },
  { key: 'marketing',    emoji: '📱', label: 'Marketing',    cor: '#06b6d4' },
  { key: 'manutencao',   emoji: '🔧', label: 'Manutenção',   cor: '#84cc16' },
  { key: 'outros',       emoji: '📋', label: 'Outros',       cor: '#6b7280' },
]

const FONT   = "'Archivo', sans-serif"
const BG     = '#060606'
const CARD   = '#101010'
const BORDER = '1px solid #1f1d1a'
const TEXT   = '#f4f1ec'
const TEXT2  = '#a39b8b'
const ACCENT = '#ff6b00'
const GREEN  = '#22c55e'
const RED    = '#ef4444'

const fmt = (v: number) => v.toFixed(2).replace('.', ',')

const hoje = () => new Date().toLocaleDateString('pt-BR')

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
  const now       = new Date()
  const dataHoje  = hoje()

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

  const faturamento  = pedidosFiltrados.reduce((s, p) => s + (Number(p.total) || 0), 0)
  const totalCustos  = custosFiltrados.reduce((s, c) => s + c.valor, 0)
  const lucro        = faturamento - totalCustos

  const fatHoje = pedidos
    .filter(p => (p.data ?? dataHoje) === dataHoje)
    .reduce((s, p) => s + (Number(p.total) || 0), 0)

  // ── Extrato unificado ────────────────────────────────────────────────────────
  const transacoes: Transacao[] = [
    ...pedidosFiltrados.map(p => ({
      id:        'p_' + p.id,
      tipo:      'pedido' as const,
      emoji:     '🍕',
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
        descricao: c.descricao,
        subtitulo: (cat ? cat.label : 'Custo') + (c.data ? ` · ${c.data}` : ''),
        valor:     c.valor,
        data:      c.data ?? dataHoje,
        horario:   '',
        custoId:   c.id,
      }
    }),
  ].sort((a, b) => {
    const parseBR = (s: string) => { const [d, m, y] = s.split('/').map(Number); return new Date(y, m - 1, d).getTime() }
    const dDiff = parseBR(b.data) - parseBR(a.data)
    if (dDiff !== 0) return dDiff
    return b.horario.localeCompare(a.horario)
  })

  // Agrupar por data com labels humanizados
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
        <p style={{ color: ACCENT, fontSize: 28, margin: '0 0 12px' }}>💰</p>
        <p style={{ color: TEXT2, fontSize: 14, margin: 0 }}>Carregando...</p>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight: '100svh', background: BG, fontFamily: FONT, overflowX: 'hidden', paddingBottom: 'calc(env(safe-area-inset-bottom) + 100px)' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&display=swap');
        @keyframes slideUp  { from { opacity:0; transform:translateY(14px) } to { opacity:1; transform:translateY(0) } }
        @keyframes fadeIn   { from { opacity:0 } to { opacity:1 } }
        .hscroll { display:flex; gap:10px; overflow-x:auto; padding-bottom:4px; scrollbar-width:none; -webkit-overflow-scrolling:touch }
        .hscroll::-webkit-scrollbar { display:none }
      `}</style>

      {/* Toast flutuante */}
      {mensagem && (
        <div style={{ position: 'fixed', top: 'calc(env(safe-area-inset-top) + 16px)', left: '50%', transform: 'translateX(-50%)', zIndex: 300, background: mensagem.includes('✅') ? '#14532d' : '#7f1d1d', borderRadius: 12, padding: '10px 20px', color: mensagem.includes('✅') ? '#4ade80' : '#f87171', fontWeight: 700, fontSize: 13, animation: 'slideUp 0.2s ease', whiteSpace: 'nowrap', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
          {mensagem}
        </div>
      )}

      {/* ── Header sticky ────────────────────────────────────────────────────── */}
      <div style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(6,6,6,0.96)', borderBottom: BORDER, paddingTop: 'calc(env(safe-area-inset-top) + 12px)', paddingBottom: 12, paddingLeft: 16, paddingRight: 16 }}>
        <div style={{ maxWidth: 375, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button
            onClick={() => router.push('/admin')}
            style={{ background: 'rgba(255,255,255,0.06)', border: BORDER, color: TEXT2, borderRadius: 10, padding: '8px 14px', cursor: 'pointer', fontSize: 14, minHeight: 44, fontFamily: FONT, fontWeight: 700, flexShrink: 0 }}
          >←</button>
          <div style={{ textAlign: 'center', minWidth: 0, flex: 1, margin: '0 12px' }}>
            <p style={{ color: TEXT, fontSize: 14, fontWeight: 800, margin: 0, letterSpacing: '-0.2px' }}>Financeiro</p>
            <p style={{ color: TEXT2, fontSize: 10, margin: 0, textTransform: 'uppercase', letterSpacing: '0.6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mesLabel}</p>
          </div>
          <button
            onClick={() => fetch('/api/auth/logout', { method: 'POST' }).then(() => router.push('/login'))}
            style={{ background: 'rgba(255,255,255,0.06)', border: BORDER, color: TEXT2, borderRadius: 10, padding: '8px 14px', cursor: 'pointer', fontSize: 12, minHeight: 44, fontFamily: FONT, flexShrink: 0 }}
          >Sair</button>
        </div>
      </div>

      {/* ── Hero: saldo em destaque ────────────────────────────────────────────── */}
      <div style={{ background: 'linear-gradient(180deg, #100800 0%, #060606 100%)', padding: '32px 16px 28px', textAlign: 'center' }}>
        <p style={{ color: TEXT2, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.2px', margin: '0 0 10px' }}>
          Faturamento {periodo === 'hoje' ? 'de Hoje' : periodo === 'semana' ? 'da Semana' : 'do Mês'}
        </p>
        <p style={{ color: ACCENT, fontSize: 40, fontWeight: 900, margin: '0 0 10px', letterSpacing: '-1.5px', lineHeight: 1 }}>
          R$ {fmt(faturamento)}
        </p>
        {periodo !== 'hoje' && fatHoje > 0 && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 20, padding: '5px 14px' }}>
            <span style={{ color: GREEN, fontSize: 12, fontWeight: 700 }}>↑ +R$ {fmt(fatHoje)} hoje</span>
          </div>
        )}
      </div>

      <div style={{ maxWidth: 375, margin: '0 auto', padding: '0 16px' }}>

        {/* ── Cards de métricas (scroll horizontal) ──────────────────────────── */}
        <div className="hscroll" style={{ marginBottom: 20 }}>
          {[
            { label: 'Faturamento', valor: faturamento, cor: ACCENT, bg: 'rgba(255,107,0,0.08)', bord: 'rgba(255,107,0,0.2)',  emoji: '📈' },
            { label: 'Custos',      valor: totalCustos,  cor: RED,    bg: 'rgba(239,68,68,0.08)',  bord: 'rgba(239,68,68,0.2)',   emoji: '📉' },
            { label: 'Lucro',       valor: lucro,        cor: lucro >= 0 ? GREEN : RED, bg: lucro >= 0 ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)', bord: lucro >= 0 ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)', emoji: '💰' },
          ].map(m => (
            <div key={m.label} style={{ background: m.bg, border: `1px solid ${m.bord}`, borderRadius: 16, padding: '14px 16px', minWidth: 130, flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 15 }}>{m.emoji}</span>
                <span style={{ color: TEXT2, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px' }}>{m.label}</span>
              </div>
              <p style={{ color: m.cor, fontSize: 17, fontWeight: 900, margin: 0, letterSpacing: '-0.5px' }}>R$ {fmt(m.valor)}</p>
            </div>
          ))}
        </div>

        {/* ── Filtro de período ──────────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
          {(['hoje', 'semana', 'mes'] as Periodo[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriodo(p)}
              style={{ flex: 1, padding: '10px 0', minHeight: 44, borderRadius: 10, border: periodo === p ? 'none' : BORDER, cursor: 'pointer', fontWeight: 700, fontSize: 13, fontFamily: FONT, background: periodo === p ? ACCENT : CARD, color: periodo === p ? '#fff' : TEXT2, transition: 'all .15s' }}
            >
              {p === 'hoje' ? 'Hoje' : p === 'semana' ? 'Semana' : 'Mês'}
            </button>
          ))}
        </div>

        {/* ── Extrato de transações ──────────────────────────────────────────── */}
        {grupos.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 20px', color: TEXT2 }}>
            <p style={{ fontSize: 36, margin: '0 0 14px' }}>📊</p>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>Nenhuma transação neste período</p>
            <p style={{ margin: '6px 0 0', fontSize: 12 }}>Toque em + para registrar um custo</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {grupos.map(grupo => (
              <div key={grupo.label}>
                {/* Separador de data */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <span style={{ color: TEXT2, fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.8px', whiteSpace: 'nowrap' }}>{grupo.label}</span>
                  <div style={{ flex: 1, height: 1, background: '#1a1a1a' }} />
                  <span style={{ color: '#333', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {grupo.items.length} item{grupo.items.length !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* Itens do grupo */}
                <div style={{ background: CARD, border: BORDER, borderRadius: 16, overflow: 'hidden' }}>
                  {grupo.items.map((tx, idx) => (
                    <div
                      key={tx.id}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px', borderBottom: idx < grupo.items.length - 1 ? '1px solid #141414' : 'none' }}
                    >
                      {/* Ícone colorido */}
                      <div style={{ width: 42, height: 42, borderRadius: 13, background: tx.tipo === 'pedido' ? 'rgba(255,107,0,0.12)' : 'rgba(239,68,68,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19, flexShrink: 0 }}>
                        {tx.emoji}
                      </div>

                      {/* Descrição */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ color: TEXT, fontSize: 14, fontWeight: 600, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.descricao}</p>
                        <p style={{ color: TEXT2, fontSize: 11, margin: '3px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.subtitulo}</p>
                      </div>

                      {/* Valor + delete */}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                        <p style={{ color: tx.tipo === 'pedido' ? GREEN : RED, fontSize: 15, fontWeight: 800, margin: 0, letterSpacing: '-0.4px' }}>
                          {tx.tipo === 'pedido' ? '+' : '−'}R$ {fmt(tx.valor)}
                        </p>
                        {tx.custoId && (
                          <button
                            onClick={() => removerCusto(tx.custoId!)}
                            style={{ background: 'none', border: 'none', color: '#2a2a2a', cursor: 'pointer', fontSize: 17, padding: 0, minHeight: 28, minWidth: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}
                          >×</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── FAB "+" ────────────────────────────────────────────────────────────── */}
      <button
        onClick={() => setModalAberto(true)}
        aria-label="Adicionar custo"
        style={{ position: 'fixed', bottom: 'calc(env(safe-area-inset-bottom) + 24px)', right: 20, width: 58, height: 58, borderRadius: 29, background: `linear-gradient(135deg, ${ACCENT} 0%, #c95200 100%)`, border: 'none', color: '#fff', fontSize: 28, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 28px rgba(255,107,0,0.5)', zIndex: 90, lineHeight: 1 }}
      >+</button>

      {/* ── Modal bottom sheet ──────────────────────────────────────────────── */}
      {modalAberto && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setModalAberto(false) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 200, display: 'flex', alignItems: 'flex-end', animation: 'fadeIn 0.2s ease' }}
        >
          <div style={{ background: '#0d0d0d', borderRadius: '20px 20px 0 0', padding: '0 20px 0', paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)', width: '100%', maxWidth: 375, margin: '0 auto', animation: 'slideUp 0.25s ease' }}>
            {/* Drag handle */}
            <div style={{ width: 36, height: 4, background: '#242424', borderRadius: 2, margin: '14px auto 22px' }} />
            <p style={{ color: TEXT, fontSize: 18, fontWeight: 900, margin: '0 0 20px', letterSpacing: '-0.4px' }}>Registrar Custo</p>

            <input
              placeholder="Descrição (ex: Farinha 10kg)"
              value={novoDescricao}
              onChange={e => setNovoDescricao(e.target.value)}
              style={{ width: '100%', background: '#181818', border: '1px solid #222', borderRadius: 12, padding: '14px', color: TEXT, fontSize: 16, outline: 'none', boxSizing: 'border-box', minHeight: 52, fontFamily: FONT, marginBottom: 10 }}
            />
            <input
              placeholder="Valor (R$)"
              value={novoValor}
              onChange={e => setNovoValor(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && adicionarCusto()}
              inputMode="decimal"
              style={{ width: '100%', background: '#181818', border: '1px solid #222', borderRadius: 12, padding: '14px', color: TEXT, fontSize: 16, outline: 'none', boxSizing: 'border-box', minHeight: 52, fontFamily: FONT, marginBottom: 16 }}
            />

            {/* Categorias */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 22 }}>
              {CATEGORIAS.map(cat => (
                <button
                  key={cat.key}
                  onClick={() => setNovaCategoria(cat.key)}
                  style={{ padding: '8px 14px', minHeight: 40, borderRadius: 20, border: novaCategoria === cat.key ? 'none' : '1px solid #222', cursor: 'pointer', fontSize: 12, fontWeight: 700, background: novaCategoria === cat.key ? cat.cor : '#181818', color: novaCategoria === cat.key ? '#fff' : '#666', fontFamily: FONT, whiteSpace: 'nowrap', transition: 'all .12s' }}
                >
                  {cat.emoji} {cat.label}
                </button>
              ))}
            </div>

            {/* Ações */}
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setModalAberto(false)}
                style={{ flex: 1, height: 54, background: '#181818', border: '1px solid #222', borderRadius: 14, color: TEXT2, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}
              >Cancelar</button>
              <button
                onClick={adicionarCusto}
                disabled={salvando}
                style={{ flex: 2, height: 54, background: salvando ? '#1a1208' : `linear-gradient(135deg, ${ACCENT}, #c95200)`, border: 'none', borderRadius: 14, color: '#fff', fontSize: 15, fontWeight: 800, cursor: salvando ? 'not-allowed' : 'pointer', fontFamily: FONT, opacity: salvando ? 0.7 : 1 }}
              >{salvando ? 'Salvando...' : '+ Registrar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
