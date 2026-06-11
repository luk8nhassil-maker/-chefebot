'use client'
import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'

type Custo = {
  id: string
  descricao: string
  valor: number
  categoria: string
  data: string
  mes: string
}

type Mensagem = {
  role: 'user' | 'assistant'
  content: string
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

export default function ContadorPage() {
  const router = useRouter()
  const [aba, setAba] = useState<'resumo' | 'chat'>('resumo')
  const [custos, setCustos] = useState<Custo[]>([])
  const [faturamento, setFaturamento] = useState(0)
  const [mesFechado, setMesFechado] = useState(false)
  const [fechandoMes, setFechandoMes] = useState(false)
  const [loading, setLoading] = useState(true)
  const [mensagem, setMensagem] = useState('')
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [input, setInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const mesAtual = new Date().toISOString().slice(0, 7)
  const mesLabel = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    Promise.all([
      fetch(`/api/financeiro?mes=${mesAtual}`).then(r => r.json()),
      fetch('/api/orders').then(r => r.json()),
    ]).then(([fin, pedidos]) => {
      if (fin?.custos) { setCustos(fin.custos); setMesFechado(fin.status?.fechado || false) }
      if (Array.isArray(pedidos)) {
        const fat = pedidos.filter((p: any) => p.status === 'entregue').reduce((s: number, p: any) => s + (Number(p.total) || 0), 0)
        setFaturamento(fat)
      }
      setLoading(false)
    })

    setMensagens([{
      role: 'assistant',
      content: `Olá! 👋 Sou o assistente contábil.\n\nEstou pronto para ajudar com as informações fiscais da pizzaria. O que precisa saber?`
    }])
  }, [mesAtual])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [mensagens])

  const msg = (m: string) => { setMensagem(m); setTimeout(() => setMensagem(''), 3000) }

  const fecharMes = async () => {
    if (!confirm(`Tem certeza que deseja fechar ${mesLabel}? Após fechar, nenhum lançamento poderá ser editado.`)) return
    setFechandoMes(true)
    try {
      const res = await fetch('/api/financeiro', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mes: mesAtual, fechadoPor: 'contador' }) })
      if (res.ok) { setMesFechado(true); msg('✅ Mês fechado com sucesso!') }
    } catch { msg('❌ Erro ao fechar mês.') }
    setFechandoMes(false)
  }

  const enviarChat = async () => {
    if (!input.trim() || chatLoading) return
    const novaMsg: Mensagem = { role: 'user', content: input.trim() }
    const novasMensagens = [...mensagens, novaMsg]
    setMensagens(novasMensagens)
    setInput('')
    setChatLoading(true)
    try {
      const totalCustos = custos.reduce((s, c) => s + c.valor, 0)
      const lucro = faturamento - totalCustos
      const res = await fetch('/api/anthropic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: `Você é um assistente contábil especializado em pequenas empresas brasileiras.\n\nDados financeiros de ${mesLabel}:\n- Faturamento: R$ ${faturamento.toFixed(2)}\n- Total de custos: R$ ${totalCustos.toFixed(2)}\n- Lucro líquido: R$ ${lucro.toFixed(2)}\n- Status do mês: ${mesFechado ? 'FECHADO' : 'Em aberto'}\n\nCustos lançados:\n${custos.map(c => `- ${c.descricao}: R$ ${c.valor.toFixed(2)} (${c.categoria})`).join('\n')}\n\nSeja direto e objetivo. Use linguagem simples.`,
          messages: novasMensagens.map(m => ({ role: m.role, content: m.content }))
        })
      })
      const data = await res.json()
      const resposta = data.content?.[0]?.text || 'Erro ao processar.'
      setMensagens(prev => [...prev, { role: 'assistant', content: resposta }])
    } catch { setMensagens(prev => [...prev, { role: 'assistant', content: 'Erro ao conectar.' }]) }
    setChatLoading(false)
  }

  const totalCustos = custos.reduce((s, c) => s + c.valor, 0)
  const lucro = faturamento - totalCustos
  const custosPorCategoria = CATEGORIAS.map(cat => ({ ...cat, total: custos.filter(c => c.categoria === cat.key).reduce((s, c) => s + c.valor, 0) })).filter(c => c.total > 0)

  const inp = { width: '100%', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 10, padding: '11px 14px', color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box' as const }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#080808', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#333' }}>Carregando...</p>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#080808', fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", paddingBottom: 80 }}>
      <style>{`@keyframes slideUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } } @keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }`}</style>

      {/* Header */}
      <div style={{ background: '#0d0d0d', borderBottom: '1px solid #161616', padding: '14px 16px', position: 'sticky', top: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: '#1a3a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>📊</div>
          <div>
            <p style={{ color: '#fff', fontSize: 15, fontWeight: 700, margin: 0 }}>Painel do Contador</p>
            <p style={{ color: '#444', fontSize: 10, margin: 0 }}>{mesLabel} {mesFechado ? '· 🔒 Fechado' : '· Em aberto'}</p>
          </div>
        </div>
        <button onClick={() => fetch('/api/auth/logout', { method: 'POST' }).then(() => router.push('/login'))} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#555', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12 }}>Sair</button>
      </div>

      {mensagem && (
        <div style={{ background: mensagem.includes('✅') ? '#14532d' : '#7f1d1d', margin: '12px 16px 0', borderRadius: 10, padding: '10px 14px', color: mensagem.includes('✅') ? '#4ade80' : '#f87171', fontWeight: 600, fontSize: 13, animation: 'slideUp 0.2s ease' }}>
          {mensagem}
        </div>
      )}

      {/* Abas */}
      <div style={{ display: 'flex', gap: 6, padding: '12px 16px 0' }}>
        {[{ key: 'resumo', label: '📋 Resumo' }, { key: 'chat', label: '🤖 Assistente' }].map(a => (
          <button key={a.key} onClick={() => setAba(a.key as any)} style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: aba === a.key ? '#16a34a' : '#1a1a1a', color: '#fff' }}>
            {a.label}
          </button>
        ))}
      </div>

      <div style={{ padding: '16px' }}>

        {/* ABA RESUMO */}
        {aba === 'resumo' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Métricas */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <div style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: 14, padding: 14 }}>
                <p style={{ color: '#555', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', margin: '0 0 6px', letterSpacing: 0.5 }}>Faturamento</p>
                <p style={{ color: '#4ade80', fontSize: 15, fontWeight: 800, margin: 0 }}>R$ {faturamento.toFixed(2).replace('.', ',')}</p>
              </div>
              <div style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: 14, padding: 14 }}>
                <p style={{ color: '#555', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', margin: '0 0 6px', letterSpacing: 0.5 }}>Custos</p>
                <p style={{ color: '#f87171', fontSize: 15, fontWeight: 800, margin: 0 }}>R$ {totalCustos.toFixed(2).replace('.', ',')}</p>
              </div>
              <div style={{ background: '#111', border: `1px solid ${lucro >= 0 ? '#16a34a30' : '#dc262630'}`, borderRadius: 14, padding: 14 }}>
                <p style={{ color: '#555', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', margin: '0 0 6px', letterSpacing: 0.5 }}>Lucro</p>
                <p style={{ color: lucro >= 0 ? '#4ade80' : '#f87171', fontSize: 15, fontWeight: 800, margin: 0 }}>R$ {lucro.toFixed(2).replace('.', ',')}</p>
              </div>
            </div>

            {/* Por categoria */}
            {custosPorCategoria.length > 0 && (
              <div style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: 14, padding: 16 }}>
                <p style={{ color: '#555', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 12px' }}>Custos por categoria</p>
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
              <div style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: 14, padding: 16 }}>
                <p style={{ color: '#555', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 12px' }}>Todos os lançamentos</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {custos.slice().reverse().map(c => {
                    const cat = CATEGORIAS.find(cat => cat.key === c.categoria)
                    return (
                      <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0d0d0d', borderRadius: 8, padding: '8px 12px' }}>
                        <div>
                          <p style={{ color: '#e0e0e0', fontSize: 13, fontWeight: 600, margin: 0 }}>{c.descricao}</p>
                          <p style={{ color: '#444', fontSize: 11, margin: '2px 0 0' }}>{cat?.label} · {c.data}</p>
                        </div>
                        <span style={{ color: '#f87171', fontSize: 13, fontWeight: 700 }}>R$ {c.valor.toFixed(2).replace('.', ',')}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Botão fechar mês */}
            {!mesFechado ? (
              <button onClick={fecharMes} disabled={fechandoMes} style={{ width: '100%', background: fechandoMes ? '#1a1a1a' : '#16a34a', border: 'none', borderRadius: 14, padding: '16px', color: '#fff', fontSize: 15, fontWeight: 700, cursor: fechandoMes ? 'not-allowed' : 'pointer' }}>
                {fechandoMes ? 'Fechando...' : `🔒 Fechar ${mesLabel}`}
              </button>
            ) : (
              <div style={{ background: '#14532d20', border: '1px solid #16a34a30', borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 20 }}>🔒</span>
                <p style={{ color: '#4ade80', fontSize: 13, fontWeight: 700, margin: 0 }}>Mês fechado — dados protegidos</p>
              </div>
            )}
          </div>
        )}

        {/* ABA CHAT */}
        {aba === 'chat' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 80 }}>
            {mensagens.map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', animation: 'fadeIn 0.2s ease' }}>
                {m.role === 'assistant' && (
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: '#1a3a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, marginRight: 8, flexShrink: 0, marginTop: 2 }}>📊</div>
                )}
                <div style={{ maxWidth: '80%', background: m.role === 'user' ? '#1a3a2a' : '#111', border: `1px solid ${m.role === 'user' ? '#16a34a30' : '#1e1e1e'}`, borderRadius: m.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px', padding: '12px 16px' }}>
                  <p style={{ color: '#e0e0e0', fontSize: 14, margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{m.content}</p>
                </div>
              </div>
            ))}
            {chatLoading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: '#1a3a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>📊</div>
                <div style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: '18px 18px 18px 4px', padding: '12px 16px' }}>
                  <p style={{ color: '#444', fontSize: 14, margin: 0 }}>Analisando...</p>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input chat */}
      {aba === 'chat' && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#0d0d0d', borderTop: '1px solid #1a1a1a', padding: '12px 16px' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && enviarChat()} placeholder="Pergunte algo sobre os dados..." style={{ ...inp, flex: 1 }} />
            <button onClick={enviarChat} disabled={chatLoading || !input.trim()} style={{ background: chatLoading ? '#1a1a1a' : '#16a34a', border: 'none', color: '#fff', borderRadius: 12, padding: '12px 20px', cursor: chatLoading ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 700 }}>
              {chatLoading ? '...' : '➤'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}