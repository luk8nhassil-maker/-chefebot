'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type Padrao = {
  original: string
  interpretado: string
  vezes: number
  criadoEm: string
}

type LogEntry = {
  nivel: 'erro' | 'aviso' | 'info'
  mensagem: string
  detalhe?: string
  data: string
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

function NovoClienteDevForm() {
  const [nome, setNome] = useState('')
  const [usuario, setUsuario] = useState('')
  const [senha, setSenha] = useState('')
  const [criando, setCriando] = useState(false)
  const [resultado, setResultado] = useState('')
  const inp2 = { width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 14px', color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box' as const, marginBottom: 8 }
  const criar = async () => {
    if (!nome || !usuario || !senha) return
    setCriando(true)
    try {
      const res = await fetch('/api/funcionarios', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nome, username: usuario, password: senha, role: 'admin' }) })
      if (res.ok) { setResultado('Acesso criado! Login: ' + usuario + ' / Senha: ' + senha); setNome(''); setUsuario(''); setSenha('') }
      else setResultado('Erro ao criar.')
    } catch { setResultado('Erro.') }
    setCriando(false)
  }
  return (
    <div>
      <input placeholder="Nome da pizzaria" value={nome} onChange={e => setNome(e.target.value)} style={inp2} />
      <input placeholder="@usuario" value={usuario} onChange={e => setUsuario(e.target.value)} style={inp2} />
      <input placeholder="Senha" type="password" value={senha} onChange={e => setSenha(e.target.value)} style={inp2} />
      <button onClick={criar} disabled={criando} style={{ width: '100%', background: criando ? 'rgba(255,255,255,0.05)' : '#ff6b00', border: 'none', borderRadius: 10, padding: '12px', color: '#fff', fontSize: 14, fontWeight: 700, cursor: criando ? 'not-allowed' : 'pointer' }}>
        {criando ? 'Criando...' : '+ Criar acesso admin'}
      </button>
      {resultado && <p style={{ color: '#4ade80', fontSize: 12, margin: '10px 0 0', background: 'rgba(74,222,128,0.1)', borderRadius: 8, padding: '8px 12px' }}>{resultado}</p>}
    </div>
  )
}
export default function DevPage() {
  const router = useRouter()
  const [padroes, setPadroes] = useState<Padrao[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(true)
  const [editando, setEditando] = useState<string | null>(null)
  const [novoValor, setNovoValor] = useState('')
  const [mensagem, setMensagem] = useState('')
  const [busca, setBusca] = useState('')
  const [aba, setAba] = useState<'padroes' | 'logs'>('padroes')
  const [limpandoLogs, setLimpandoLogs] = useState(false)

  useEffect(() => {
    const role = getUserRole()
    if (role !== 'dev') {
      router.push('/login?callbackUrl=/dev')
      return
    }
    setChecking(false)
    carregarDados()
  }, [router])

  const carregarDados = async () => {
    try {
      const [resPadroes, resLogs] = await Promise.all([
        fetch('/api/padroes'),
        fetch('/api/logs'),
      ])
      if (resPadroes.ok) setPadroes(await resPadroes.json())
      if (resLogs.ok) setLogs(await resLogs.json())
    } catch {}
    setLoading(false)
  }

  const excluirPadrao = async (original: string) => {
    if (!confirm(`Excluir padrÃ£o "${original}"?`)) return
    try {
      await fetch('/api/padroes', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ original }),
      })
      setPadroes(prev => prev.filter(p => p.original !== original))
      setMensagem('âœ… PadrÃ£o excluÃ­do!'); setTimeout(() => setMensagem(''), 3000)
    } catch {
      setMensagem('âŒ Erro ao excluir.'); setTimeout(() => setMensagem(''), 3000)
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
      setMensagem('âœ… PadrÃ£o atualizado!'); setTimeout(() => setMensagem(''), 3000)
    } catch {
      setMensagem('âŒ Erro ao salvar.'); setTimeout(() => setMensagem(''), 3000)
    }
  }

  const limparLogs = async () => {
    if (!confirm('Limpar todos os logs?')) return
    setLimpandoLogs(true)
    try {
      await fetch('/api/logs', { method: 'DELETE' })
      setLogs([])
      setMensagem('âœ… Logs limpos!'); setTimeout(() => setMensagem(''), 3000)
    } catch {
      setMensagem('âŒ Erro.'); setTimeout(() => setMensagem(''), 3000)
    }
    setLimpandoLogs(false)
  }

  const padroesFiltrados = padroes.filter(p =>
    p.original.includes(busca.toLowerCase()) ||
    p.interpretado.toLowerCase().includes(busca.toLowerCase())
  )

  const corNivel = (nivel: string) => {
    if (nivel === 'erro') return { bg: 'rgba(252,129,129,0.1)', border: 'rgba(252,129,129,0.3)', text: '#fc8181', icon: 'âŒ' }
    if (nivel === 'aviso') return { bg: 'rgba(246,173,85,0.1)', border: 'rgba(246,173,85,0.3)', text: '#f6ad55', icon: 'âš ï¸' }
    return { bg: 'rgba(99,179,237,0.1)', border: 'rgba(99,179,237,0.3)', text: '#63b3ed', icon: 'â„¹ï¸' }
  }

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
            <h1 style={{ color: '#a78bfa', fontSize: 22, fontWeight: 800, margin: 0 }}>âš¡ Painel Dev â€” Ominix</h1>
            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, margin: '4px 0 0' }}>Controle exclusivo do criador do sistema</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => router.push('/admin')} style={{ background: 'rgba(255,215,0,0.1)', border: '1px solid rgba(255,215,0,0.3)', color: '#ffd700', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
              ðŸ‘‘ Admin
            </button>
            <button onClick={() => fetch('/api/auth/logout', { method: 'POST' }).then(() => router.push('/login'))} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', fontSize: 13 }}>
              Sair
            </button>
          </div>
        </div>

        {/* Cards de mÃ©tricas */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 28 }}>
          <div style={{ background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.25)', borderRadius: 14, padding: 18 }}>
            <p style={{ color: 'rgba(167,139,250,0.6)', fontSize: 11, margin: '0 0 6px', fontWeight: 700, textTransform: 'uppercase' }}>ðŸ§  PadrÃµes</p>
            <p style={{ color: '#a78bfa', fontSize: 28, fontWeight: 800, margin: 0 }}>{padroes.length}</p>
          </div>
          <div style={{ background: 'rgba(99,179,237,0.08)', border: '1px solid rgba(99,179,237,0.25)', borderRadius: 14, padding: 18 }}>
            <p style={{ color: 'rgba(99,179,237,0.6)', fontSize: 11, margin: '0 0 6px', fontWeight: 700, textTransform: 'uppercase' }}>ðŸ”„ Usos</p>
            <p style={{ color: '#63b3ed', fontSize: 28, fontWeight: 800, margin: 0 }}>{padroes.reduce((s, p) => s + p.vezes, 0)}</p>
          </div>
          <div style={{ background: logs.some(l => l.nivel === 'erro') ? 'rgba(252,129,129,0.08)' : 'rgba(104,211,145,0.08)', border: `1px solid ${logs.some(l => l.nivel === 'erro') ? 'rgba(252,129,129,0.25)' : 'rgba(104,211,145,0.25)'}`, borderRadius: 14, padding: 18 }}>
            <p style={{ color: logs.some(l => l.nivel === 'erro') ? 'rgba(252,129,129,0.6)' : 'rgba(104,211,145,0.6)', fontSize: 11, margin: '0 0 6px', fontWeight: 700, textTransform: 'uppercase' }}>ðŸ”´ Erros</p>
            <p style={{ color: logs.some(l => l.nivel === 'erro') ? '#fc8181' : '#68d391', fontSize: 28, fontWeight: 800, margin: 0 }}>{logs.filter(l => l.nivel === 'erro').length}</p>
          </div>
        </div>

        {mensagem && (
          <div style={{ background: mensagem.includes('âœ…') ? 'rgba(104,211,145,0.1)' : 'rgba(252,129,129,0.1)', border: `1px solid ${mensagem.includes('âœ…') ? 'rgba(104,211,145,0.3)' : 'rgba(252,129,129,0.3)'}`, borderRadius: 10, padding: '10px 14px', marginBottom: 16, color: mensagem.includes('âœ…') ? '#68d391' : '#fc8181', fontWeight: 600, fontSize: 14 }}>
            {mensagem}
          </div>
        )}

        {/* Abas */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          <button onClick={() => setAba('padroes')} style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: aba === 'padroes' ? 'rgba(167,139,250,0.2)' : 'rgba(255,255,255,0.05)', color: aba === 'padroes' ? '#a78bfa' : 'rgba(255,255,255,0.4)' }}>
            ðŸ§  PadrÃµes Aprendidos
          </button>
          <button onClick={() => setAba('logs')} style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: aba === 'logs' ? 'rgba(252,129,129,0.2)' : 'rgba(255,255,255,0.05)', color: aba === 'logs' ? '#fc8181' : 'rgba(255,255,255,0.4)', position: 'relative' }}>
            ðŸ”´ Logs do Sistema
            {logs.filter(l => l.nivel === 'erro').length > 0 && (
              <span style={{ position: 'absolute', top: -4, right: -4, background: '#fc8181', color: '#fff', fontSize: 10, fontWeight: 800, padding: '1px 5px', borderRadius: 10 }}>
                {logs.filter(l => l.nivel === 'erro').length}
              </span>
            )}
          </button>
        </div>

        {/* Aba PadrÃµes */}
        {aba === 'padroes' && (
          <div>
            <div style={{ marginBottom: 20 }}>
              <input type="text" placeholder="Buscar padrÃ£o..." value={busca} onChange={e => setBusca(e.target.value)}
                style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '11px 14px', color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <h2 style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: 700, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
              Biblioteca â€” {padroesFiltrados.length} resultado{padroesFiltrados.length !== 1 ? 's' : ''}
            </h2>
            {padroesFiltrados.length === 0 ? (
              <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 12, padding: 32, textAlign: 'center' }}>
                <p style={{ color: 'rgba(255,255,255,0.2)', margin: 0, fontSize: 15 }}>
                  {padroes.length === 0 ? 'Nenhum padrÃ£o aprendido ainda.' : 'Nenhum padrÃ£o encontrado.'}
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
                            "{p.original}"
                          </span>
                          <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>â†’</span>
                          <span style={{ background: 'rgba(104,211,145,0.1)', border: '1px solid rgba(104,211,145,0.3)', color: '#68d391', fontSize: 12, padding: '3px 10px', borderRadius: 20 }}>
                            "{p.interpretado}"
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: 12 }}>
                          <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11, margin: 0 }}>ðŸ”„ {p.vezes}x</p>
                          <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11, margin: 0 }}>ðŸ“… {new Date(p.criadoEm).toLocaleDateString('pt-BR')}</p>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginLeft: 8 }}>
                        <button onClick={() => { setEditando(p.original); setNovoValor(p.interpretado) }} style={{ background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.3)', color: '#a78bfa', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontSize: 12 }}>âœï¸</button>
                        <button onClick={() => excluirPadrao(p.original)} style={{ background: 'rgba(252,129,129,0.1)', border: '1px solid rgba(252,129,129,0.3)', color: '#fc8181', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontSize: 12 }}>ðŸ—‘ï¸</button>
                      </div>
                    </div>
                    {editando === p.original && (
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <input type="text" value={novoValor} onChange={e => setNovoValor(e.target.value)} placeholder="Novo valor..."
                          style={{ flex: 1, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(167,139,250,0.3)', borderRadius: 8, padding: '8px 12px', color: '#fff', fontSize: 13, outline: 'none' }} />
                        <button onClick={() => salvarEdicao(p.original)} style={{ background: 'rgba(104,211,145,0.15)', border: '1px solid rgba(104,211,145,0.4)', color: '#68d391', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>âœ…</button>
                        <button onClick={() => setEditando(null)} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', fontSize: 13 }}>âœ•</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Aba Logs */}
        {aba === 'logs' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: 700, margin: 0, textTransform: 'uppercase', letterSpacing: 1 }}>
                Ãšltimos 50 eventos
              </h2>
              <button onClick={limparLogs} disabled={limpandoLogs} style={{ background: 'rgba(252,129,129,0.1)', border: '1px solid rgba(252,129,129,0.3)', color: '#fc8181', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                ðŸ—‘ï¸ Limpar logs
              </button>
            </div>
            {logs.length === 0 ? (
              <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 12, padding: 32, textAlign: 'center' }}>
                <p style={{ color: 'rgba(255,255,255,0.2)', margin: 0, fontSize: 15 }}>Nenhum log registrado. Sistema saudÃ¡vel! âœ…</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {logs.map((log, i) => {
                  const cor = corNivel(log.nivel)
                  return (
                    <div key={i} style={{ background: cor.bg, border: `1px solid ${cor.border}`, borderRadius: 10, padding: '12px 14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                        <div style={{ flex: 1 }}>
                          <p style={{ color: cor.text, fontSize: 13, fontWeight: 700, margin: '0 0 4px' }}>
                            {cor.icon} {log.mensagem}
                          </p>
                          {log.detalhe && (
                            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, margin: 0, fontFamily: 'monospace', wordBreak: 'break-all' }}>
                              {log.detalhe}
                            </p>
                          )}
                        </div>
                        <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11, margin: 0, whiteSpace: 'nowrap' }}>
                          {new Date(log.data).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.1)', fontSize: 11, marginTop: 32 }}>
          Ominix Dev Console Â· Acesso restrito
        </p>
      </div>
    </div>
  )
}