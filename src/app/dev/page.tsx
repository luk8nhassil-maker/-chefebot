'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type Padrao = {
  original: string
  interpretado: string
  vezes: number
  criadoEm: string
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
        if (decoded.startsWith('%7B')) try { decoded = decodeURIComponent(decoded) } catch {}
        const user = JSON.parse(decoded)
        return user?.role ?? null
      }
    }
  } catch { return null }
  return null
}

export default function DevPage() {
  const router = useRouter()
  const [padroes, setPadroes] = useState<Padrao[]>([])
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(true)
  const [editando, setEditando] = useState<string | null>(null)
  const [novoValor, setNovoValor] = useState('')
  const [mensagem, setMensagem] = useState('')
  const [busca, setBusca] = useState('')

  useEffect(() => {
    const role = getUserRole()
    if (role !== 'dev') {
      router.push('/login?callbackUrl=/dev')
      return
    }
    setChecking(false)
    carregarPadroes()
  }, [router])

  const carregarPadroes = async () => {
    try {
      const res = await fetch('/api/padroes')
      if (res.ok) {
        const data = await res.json()
        setPadroes(Array.isArray(data) ? data : [])
      }
    } catch {}
    setLoading(false)
  }

  const excluirPadrao = async (original: string) => {
    if (!confirm(`Excluir padrão "${original}"?`)) return
    try {
      await fetch('/api/padroes', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ original }),
      })
      setPadroes(prev => prev.filter(p => p.original !== original))
      setMensagem('✅ Padrão excluído!')
      setTimeout(() => setMensagem(''), 3000)
    } catch {
      setMensagem('❌ Erro ao excluir.')
      setTimeout(() => setMensagem(''), 3000)
    }
  }

  const salvarEdicao = async (original: string) => {
    try {
      await fetch('/api/padroes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ original, interpretado: novoValor }),
      })
      setPadroes(prev => prev.map(p => p.original === original ? { ...p, interpretado: novoValor } : p))
      setEditando(null)
      setNovoValor('')
      setMensagem('✅ Padrão atualizado!')
      setTimeout(() => setMensagem(''), 3000)
    } catch {
      setMensagem('❌ Erro ao salvar.')
      setTimeout(() => setMensagem(''), 3000)
    }
  }

  const padroesFiltrados = padroes.filter(p =>
    p.original.includes(busca.toLowerCase()) ||
    p.interpretado.toLowerCase().includes(busca.toLowerCase())
  )

  if (checking || loading) return (
    <div style={{ minHeight: '100vh', background: '#050510', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#fff' }}>Carregando...</p>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #050510 0%, #0a0520 100%)', padding: '24px 16px', paddingBottom: 40 }}>
      <div style={{ maxWidth: 700, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
          <div>
            <h1 style={{ color: '#a78bfa', fontSize: 22, fontWeight: 800, margin: 0 }}>⚡ Painel Dev — Ominix</h1>
            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, margin: '4px 0 0' }}>Controle exclusivo do criador do sistema</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => router.push('/admin')} style={{ background: 'rgba(255,215,0,0.1)', border: '1px solid rgba(255,215,0,0.3)', color: '#ffd700', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
              👑 Admin
            </button>
            <button onClick={() => fetch('/api/auth/logout', { method: 'POST' }).then(() => router.push('/login'))} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', fontSize: 13 }}>
              Sair
            </button>
          </div>
        </div>

        {/* Cards de métricas */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 28 }}>
          <div style={{ background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.25)', borderRadius: 14, padding: 18 }}>
            <p style={{ color: 'rgba(167,139,250,0.6)', fontSize: 11, margin: '0 0 6px', fontWeight: 700, textTransform: 'uppercase' }}>🧠 Padrões Aprendidos</p>
            <p style={{ color: '#a78bfa', fontSize: 28, fontWeight: 800, margin: 0 }}>{padroes.length}</p>
          </div>
          <div style={{ background: 'rgba(99,179,237,0.08)', border: '1px solid rgba(99,179,237,0.25)', borderRadius: 14, padding: 18 }}>
            <p style={{ color: 'rgba(99,179,237,0.6)', fontSize: 11, margin: '0 0 6px', fontWeight: 700, textTransform: 'uppercase' }}>🔄 Total de Usos</p>
            <p style={{ color: '#63b3ed', fontSize: 28, fontWeight: 800, margin: 0 }}>{padroes.reduce((s, p) => s + p.vezes, 0)}</p>
          </div>
        </div>

        {/* Busca */}
        <div style={{ marginBottom: 20 }}>
          <input
            type="text"
            placeholder="Buscar padrão..."
            value={busca}
            onChange={e => setBusca(e.target.value)}
            style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '11px 14px', color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
          />
        </div>

        {mensagem && (
          <div style={{ background: mensagem.includes('✅') ? 'rgba(104,211,145,0.1)' : 'rgba(252,129,129,0.1)', border: `1px solid ${mensagem.includes('✅') ? 'rgba(104,211,145,0.3)' : 'rgba(252,129,129,0.3)'}`, borderRadius: 10, padding: '10px 14px', marginBottom: 16, color: mensagem.includes('✅') ? '#68d391' : '#fc8181', fontWeight: 600, fontSize: 14 }}>
            {mensagem}
          </div>
        )}

        {/* Lista de padrões */}
        <div>
          <h2 style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: 700, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
            Biblioteca de Padrões — {padroesFiltrados.length} resultado{padroesFiltrados.length !== 1 ? 's' : ''}
          </h2>

          {padroesFiltrados.length === 0 ? (
            <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 12, padding: 32, textAlign: 'center' }}>
              <p style={{ color: 'rgba(255,255,255,0.2)', margin: 0, fontSize: 15 }}>
                {padroes.length === 0 ? 'Nenhum padrão aprendido ainda. O bot aprende conforme os clientes interagem.' : 'Nenhum padrão encontrado para essa busca.'}
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {padroesFiltrados.map(p => (
                <div key={p.original} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                        <span style={{ background: 'rgba(252,129,129,0.1)', border: '1px solid rgba(252,129,129,0.3)', color: '#fc8181', fontSize: 12, padding: '3px 10px', borderRadius: 20 }}>
                          Cliente digitou: "{p.original}"
                        </span>
                        <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>→</span>
                        <span style={{ background: 'rgba(104,211,145,0.1)', border: '1px solid rgba(104,211,145,0.3)', color: '#68d391', fontSize: 12, padding: '3px 10px', borderRadius: 20 }}>
                          Bot entendeu: "{p.interpretado}"
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 12 }}>
                        <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11, margin: 0 }}>
                          🔄 Usado {p.vezes} vez{p.vezes !== 1 ? 'es' : ''}
                        </p>
                        <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11, margin: 0 }}>
                          📅 {new Date(p.criadoEm).toLocaleDateString('pt-BR')}
                        </p>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginLeft: 8 }}>
                      <button
                        onClick={() => { setEditando(p.original); setNovoValor(p.interpretado) }}
                        style={{ background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.3)', color: '#a78bfa', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => excluirPadrao(p.original)}
                        style={{ background: 'rgba(252,129,129,0.1)', border: '1px solid rgba(252,129,129,0.3)', color: '#fc8181', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
                      >
                        🗑️
                      </button>
                    </div>
                  </div>

                  {editando === p.original && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <input
                        type="text"
                        value={novoValor}
                        onChange={e => setNovoValor(e.target.value)}
                        placeholder="Novo valor interpretado..."
                        style={{ flex: 1, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(167,139,250,0.3)', borderRadius: 8, padding: '8px 12px', color: '#fff', fontSize: 13, outline: 'none' }}
                      />
                      <button onClick={() => salvarEdicao(p.original)} style={{ background: 'rgba(104,211,145,0.15)', border: '1px solid rgba(104,211,145,0.4)', color: '#68d391', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                        ✅
                      </button>
                      <button onClick={() => setEditando(null)} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', fontSize: 13 }}>
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.1)', fontSize: 11, marginTop: 32 }}>
          Ominix Dev Console · Acesso restrito
        </p>
      </div>
    </div>
  )
}