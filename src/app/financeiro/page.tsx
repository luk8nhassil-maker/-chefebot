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

const CATEGORIAS = [
  { key: 'ingredientes', label: '🧄 Ingredientes', cor: '#f97316' },
  { key: 'embalagens', label: '📦 Embalagens', cor: '#3b82f6' },
  { key: 'energia', label: '💡 Energia/Gás', cor: '#eab308' },
  { key: 'funcionarios', label: '👥 Funcionários', cor: '#8b5cf6' },
  { key: 'aluguel', label: '🏠 Aluguel', cor: '#ec4899' },
  { key: 'marketing', label: '📱 Marketing', cor: '#06b6d4' },
  { key: 'manutencao', label: '🔧 Manutenção', cor: '#84cc16' },
  { key: 'outros', label: '📋 Outros', cor: '#6b7280' },
]

export default function FinanceiroPage() {
  const router = useRouter()
  const [custos, setCustos] = useState<Custo[]>([])
  const [faturamento, setFaturamento] = useState(0)
  const [loading, setLoading] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [mensagem, setMensagem] = useState('')
  const [novoDescricao, setNovoDescricao] = useState('')
  const [novoValor, setNovoValor] = useState('')
  const [novaCategoria, setNovaCategoria] = useState('ingredientes')
  const [mesAtual] = useState(new Date().toISOString().slice(0, 7))
  const [mesLabel] = useState(new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }))

  useEffect(() => {
    Promise.all([
      fetch(`/api/financeiro?mes=${mesAtual}`).then(r => r.json()),
      fetch('/api/orders').then(r => r.json()),
    ]).then(([cs, pedidos]) => {
      setCustos(Array.isArray(cs) ? cs : [])
      if (Array.isArray(pedidos)) {
        const entregues = pedidos.filter((p: any) => p.status === 'entregue' && (p.data === new Date().toLocaleDateString('pt-BR') || true))
        const fat = entregues.reduce((s: number, p: any) => s + (Number(p.total) || 0), 0)
        setFaturamento(fat)
      }
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
        body: JSON.stringify({ descricao: novoDescricao.trim(), valor: parseFloat(novoValor.replace(',', '.')), categoria: novaCategoria })
      })
      const d = await res.json()
      if (d.ok) {
        setCustos(prev => [...prev, d.custo])
        setNovoDescricao('')
        setNovoValor('')
        msg('✅ Custo adicionado!')
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

  const totalCustos = custos.reduce((s, c) => s + c.valor, 0)
  const lucro = faturamento - totalCustos
  const custosPorCategoria = CATEGORIAS.map(cat => ({
    ...cat,
    total: custos.filter(c => c.categoria === cat.key).reduce((s, c) => s + c.valor, 0)
  })).filter(c => c.total > 0)

  const inp = { width: '100%', background: '#101010', border: '1px solid #1f1d1a', borderRadius: 10, padding: '14px', color: '#f4f1ec', fontSize: 16, outline: 'none', boxSizing: 'border-box' as const, minHeight: 52, fontFamily: "'Archivo', sans-serif" }

  if (loading) return (
    <div style={{ minHeight: '100svh', background: '#060606', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Archivo', sans-serif" }}>
      <p style={{ color: '#a39b8b' }}>Carregando...</p>
    </div>
  )

  return (
    <div style={{ minHeight: '100svh', background: '#060606', fontFamily: "'Archivo', sans-serif", paddingBottom: 'calc(env(safe-area-inset-bottom) + 40px)', overflowX: 'hidden' }}>
      <style>{`@keyframes slideUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }`}</style>

      {/* Header */}
      <div style={{ background: '#0a0a0a', borderBottom: '1px solid #1f1d1a', padding: '18px 16px', paddingTop: 'calc(env(safe-area-inset-top) + 18px)', position: 'sticky', top: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: '#0d1f0d', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>💰</div>
          <div style={{ minWidth: 0 }}>
            <p style={{ color: '#f4f1ec', fontSize: 15, fontWeight: 700, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Financeiro</p>
            <p style={{ color: '#a39b8b', fontSize: 10, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mesLabel}</p>
          </div>
        </div>
        <button onClick={() => fetch('/api/auth/logout', { method: 'POST' }).then(() => router.push('/login'))} style={{ background: '#101010', border: '1px solid #1f1d1a', color: '#a39b8b', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 12, minHeight: 40, flexShrink: 0, fontFamily: "'Archivo', sans-serif" }}>Sair</button>
      </div>

      {mensagem && (
        <div style={{ background: mensagem.includes('✅') ? '#14532d' : '#7f1d1d', margin: '12px 16px 0', borderRadius: 10, padding: '10px 14px', color: mensagem.includes('✅') ? '#4ade80' : '#f87171', fontWeight: 600, fontSize: 13, animation: 'slideUp 0.2s ease' }}>
          {mensagem}
        </div>
      )}

      <div style={{ padding: '16px', maxWidth: 375, margin: '0 auto', width: '100%' }}>

        {/* Resumo do mês */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
          <div style={{ background: '#101010', border: '1px solid #1f1d1a', borderRadius: 14, padding: 14 }}>
            <p style={{ color: '#555', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', margin: '0 0 6px', letterSpacing: 0.5 }}>Faturamento</p>
            <p style={{ color: '#4ade80', fontSize: 16, fontWeight: 800, margin: 0 }}>R$ {faturamento.toFixed(2).replace('.', ',')}</p>
          </div>
          <div style={{ background: '#101010', border: '1px solid #1f1d1a', borderRadius: 14, padding: 14 }}>
            <p style={{ color: '#555', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', margin: '0 0 6px', letterSpacing: 0.5 }}>Custos</p>
            <p style={{ color: '#f87171', fontSize: 16, fontWeight: 800, margin: 0 }}>R$ {totalCustos.toFixed(2).replace('.', ',')}</p>
          </div>
          <div style={{ background: '#111', border: `1px solid ${lucro >= 0 ? '#16a34a30' : '#dc262630'}`, borderRadius: 14, padding: 14 }}>
            <p style={{ color: '#555', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', margin: '0 0 6px', letterSpacing: 0.5 }}>Lucro</p>
            <p style={{ color: lucro >= 0 ? '#4ade80' : '#f87171', fontSize: 16, fontWeight: 800, margin: 0 }}>R$ {lucro.toFixed(2).replace('.', ',')}</p>
          </div>
        </div>

        {/* Adicionar custo */}
        <div style={{ background: '#101010', border: '1px solid #1f1d1a', borderRadius: 14, padding: 16, marginBottom: 16 }}>
          <p style={{ color: '#555', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 12px' }}>+ Adicionar custo</p>
          <input placeholder="Descrição (ex: Farinha de trigo 10kg)" value={novoDescricao} onChange={e => setNovoDescricao(e.target.value)} style={{ ...inp, marginBottom: 8 }} />
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input placeholder="Valor (R$)" value={novoValor} onChange={e => setNovoValor(e.target.value)} onKeyDown={e => e.key === 'Enter' && adicionarCusto()} style={{ ...inp, flex: 1 }} />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {CATEGORIAS.map(cat => (
              <button key={cat.key} onClick={() => setNovaCategoria(cat.key)} style={{ padding: '5px 10px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, background: novaCategoria === cat.key ? cat.cor : '#1a1a1a', color: novaCategoria === cat.key ? '#fff' : '#555' }}>
                {cat.label}
              </button>
            ))}
          </div>
          <button onClick={adicionarCusto} disabled={salvando} style={{ width: '100%', background: salvando ? '#101010' : '#16a34a', border: 'none', borderRadius: 10, padding: '12px', color: '#fff', fontSize: 15, fontWeight: 700, cursor: salvando ? 'not-allowed' : 'pointer', minHeight: 52, fontFamily: "'Archivo', sans-serif" }}>
            {salvando ? 'Salvando...' : '+ Adicionar'}
          </button>
        </div>

        {/* Por categoria */}
        {custosPorCategoria.length > 0 && (
          <div style={{ background: '#101010', border: '1px solid #1f1d1a', borderRadius: 14, padding: 16, marginBottom: 16 }}>
            <p style={{ color: '#555', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 12px' }}>Por categoria</p>
            {custosPorCategoria.map(cat => (
              <div key={cat.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ color: '#e0e0e0', fontSize: 13 }}>{cat.label}</span>
                <span style={{ color: cat.cor, fontSize: 13, fontWeight: 700 }}>R$ {cat.total.toFixed(2).replace('.', ',')}</span>
              </div>
            ))}
          </div>
        )}

        {/* Lista de custos */}
        {custos.length > 0 && (
          <div style={{ background: '#101010', border: '1px solid #1f1d1a', borderRadius: 14, padding: 16 }}>
            <p style={{ color: '#555', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 12px' }}>Todos os custos</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {custos.slice().reverse().map(c => {
                const cat = CATEGORIAS.find(cat => cat.key === c.categoria)
                return (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#0a0a0a', borderRadius: 10, padding: '10px 12px' }}>
                    <div>
                      <p style={{ color: '#f4f1ec', fontSize: 13, fontWeight: 600, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{c.descricao}</p>
                      <p style={{ color: '#a39b8b', fontSize: 11, margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat?.label} · {c.data}</p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: '#f87171', fontSize: 14, fontWeight: 700 }}>R$ {c.valor.toFixed(2).replace('.', ',')}</span>
                      <button onClick={() => removerCusto(c.id)} style={{ background: 'none', border: 'none', color: '#333', cursor: 'pointer', fontSize: 16, padding: 0 }}>×</button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}