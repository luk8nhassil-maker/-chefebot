'use client'
import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'

type Mensagem = {
  role: 'user' | 'assistant'
  content: string
}

export default function ContadorPage() {
  const router = useRouter()
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [dadosPizzaria, setDadosPizzaria] = useState<any>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Carrega dados financeiros da pizzaria
    fetch('/api/orders').then(r => r.json()).then(pedidos => {
      if (Array.isArray(pedidos)) {
        const entregues = pedidos.filter((p: any) => p.status === 'entregue')
        const faturamento = entregues.reduce((s: number, p: any) => s + (Number(p.total) || 0), 0)
        const totalPedidos = entregues.length
        const ticketMedio = totalPedidos > 0 ? faturamento / totalPedidos : 0
        setDadosPizzaria({ faturamento, totalPedidos, ticketMedio })
      }
    }).catch(() => {})

    // Mensagem inicial do agente
    setMensagens([{
      role: 'assistant',
      content: `Olá! 👋 Sou o assistente contábil do ChefeBot.\n\nEstou aqui para ajudar você a organizar as informações fiscais da pizzaria de forma simples e rápida.\n\nPara começar, me conta: **qual o regime tributário da pizzaria?**\n\n  1. MEI (Microempreendedor Individual)\n  2. Simples Nacional\n  3. Lucro Presumido\n  4. Ainda não sei`
    }])
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [mensagens])

  const enviar = async () => {
    if (!input.trim() || loading) return
    const novaMsg: Mensagem = { role: 'user', content: input.trim() }
    const novasMensagens = [...mensagens, novaMsg]
    setMensagens(novasMensagens)
    setInput('')
    setLoading(true)

    try {
      const sistemaPrompt = `Você é um assistente contábil especializado em pequenas empresas brasileiras, especialmente pizzarias e restaurantes.

Dados financeiros atuais da pizzaria:
- Faturamento total: R$ ${dadosPizzaria?.faturamento?.toFixed(2) || '0,00'}
- Total de pedidos entregues: ${dadosPizzaria?.totalPedidos || 0}
- Ticket médio: R$ ${dadosPizzaria?.ticketMedio?.toFixed(2) || '0,00'}

Sua missão é:
1. Entender o regime tributário da pizzaria
2. Coletar informações necessárias para obrigações fiscais
3. Calcular impostos estimados (DAS, ICMS, ISS conforme regime)
4. Alertar sobre limites de faturamento
5. Gerar resumos que o contador possa usar

Seja direto, objetivo e use linguagem simples. Quando tiver dados suficientes, gere relatórios claros.
Sempre pergunte uma coisa por vez. Não use termos técnicos sem explicar.`

      const res = await fetch('/api/anthropic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: sistemaPrompt,
          messages: novasMensagens.map(m => ({ role: m.role, content: m.content }))
        })
      })

      const data = await res.json()
      const resposta = data.content?.[0]?.text || 'Desculpe, não consegui processar sua mensagem.'
      setMensagens(prev => [...prev, { role: 'assistant', content: resposta }])
    } catch {
      setMensagens(prev => [...prev, { role: 'assistant', content: 'Erro ao conectar. Tente novamente.' }])
    }
    setLoading(false)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#080808', fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", display: 'flex', flexDirection: 'column' }}>
      <style>{`@keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }`}</style>

      {/* Header */}
      <div style={{ background: '#0d0d0d', borderBottom: '1px solid #1a1a1a', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: '#1a3a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>📊</div>
          <div>
            <p style={{ color: '#fff', fontSize: 15, fontWeight: 700, margin: 0 }}>Assistente Contábil</p>
            <p style={{ color: '#444', fontSize: 10, margin: 0 }}>ChefeBot · Ominix IA</p>
          </div>
        </div>
        <button onClick={() => fetch('/api/auth/logout', { method: 'POST' }).then(() => router.push('/login'))} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#555', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12 }}>Sair</button>
      </div>

      {/* Dashboard rápido */}
      {dadosPizzaria && (
        <div style={{ padding: '12px 16px 0', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          <div style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: 12, padding: '10px 12px' }}>
            <p style={{ color: '#444', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', margin: '0 0 4px', letterSpacing: 0.5 }}>Faturamento</p>
            <p style={{ color: '#4ade80', fontSize: 14, fontWeight: 800, margin: 0 }}>R$ {dadosPizzaria.faturamento.toFixed(2).replace('.', ',')}</p>
          </div>
          <div style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: 12, padding: '10px 12px' }}>
            <p style={{ color: '#444', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', margin: '0 0 4px', letterSpacing: 0.5 }}>Pedidos</p>
            <p style={{ color: '#fbbf24', fontSize: 14, fontWeight: 800, margin: 0 }}>{dadosPizzaria.totalPedidos}</p>
          </div>
          <div style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: 12, padding: '10px 12px' }}>
            <p style={{ color: '#444', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', margin: '0 0 4px', letterSpacing: 0.5 }}>Ticket médio</p>
            <p style={{ color: '#60a5fa', fontSize: 14, fontWeight: 800, margin: 0 }}>R$ {dadosPizzaria.ticketMedio.toFixed(2).replace('.', ',')}</p>
          </div>
        </div>
      )}

      {/* Chat */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 100 }}>
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
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: '#1a3a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>📊</div>
            <div style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: '18px 18px 18px 4px', padding: '12px 16px' }}>
              <p style={{ color: '#444', fontSize: 14, margin: 0 }}>Analisando...</p>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#0d0d0d', borderTop: '1px solid #1a1a1a', padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: 8, maxWidth: 600, margin: '0 auto' }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && enviar()}
            placeholder="Digite sua dúvida ou informação..."
            style={{ flex: 1, background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 12, padding: '12px 16px', color: '#fff', fontSize: 14, outline: 'none' }}
          />
          <button onClick={enviar} disabled={loading || !input.trim()} style={{ background: loading ? '#1a1a1a' : '#16a34a', border: 'none', color: '#fff', borderRadius: 12, padding: '12px 20px', cursor: loading ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 700 }}>
            {loading ? '...' : '➤'}
          </button>
        </div>
      </div>
    </div>
  )
}