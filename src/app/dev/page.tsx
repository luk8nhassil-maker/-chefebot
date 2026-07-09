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

function ClientesAcesso({ senhasCriadas }: { senhasCriadas: Record<string, string> }) {
  const [clientes, setClientes] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/funcionarios')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          setClientes(data.filter((f: any) => f.role === 'admin'))
        }
        setLoading(false)
      }).catch(() => setLoading(false))
  }, [])

  if (loading) return null
  if (clientes.length === 0) return null

  return (
    <div style={{ background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.2)', borderRadius: 14, padding: 20, marginTop: 24 }}>
      <p style={{ color: '#60a5fa', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 4px' }}>Acessos criados</p>
      <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, margin: '0 0 14px' }}>{clientes.length} pizzaria{clientes.length > 1 ? 's' : ''} com acesso ao sistema</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {clientes.map((c, i) => (
          <div key={i} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{ color: '#fff', fontSize: 13, fontWeight: 700, margin: 0 }}>{c.name}</p>
              <p style={{ color: '#444', fontSize: 11, margin: '2px 0 0' }}>@{c.username} · Admin</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ background: c.ativo ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)', color: c.ativo ? '#4ade80' : '#f87171', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, border: `1px solid ${c.ativo ? '#16a34a40' : '#dc262640'}` }}>
                {c.ativo ? 'Ativo' : 'Inativo'}
              </span>
              <button onClick={() => {
                const senha = senhasCriadas[c.username] || '(senha definida no cadastro)'
                const msg = `*ChefeBot — Acesso de Teste* 🍕\n\n*Pizzaria:* ${c.name}\n*Link:* https://chefebot-pjif.vercel.app/login\n*Usuario:* ${c.username}\n*Senha:* ${senha}\n\nExplore o painel, teste o cardapio e veja como funciona. Qualquer duvida e so chamar! 😊`
                window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank')
              }} style={{ background: 'rgba(37,211,102,0.1)', border: '1px solid rgba(37,211,102,0.3)', color: '#25d366', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
                Enviar
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function NovoClienteDevForm({ onCriado }: { onCriado: (username: string, senha: string) => void }) {
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
      if (res.ok) { onCriado(usuario, senha); setResultado('Acesso criado! Login: ' + usuario + ' / Senha: ' + senha); setNome(''); setUsuario(''); setSenha('') }
      else setResultado('Erro ao criar.')
    } catch { setResultado('Erro.') }
    setCriando(false)
  }
  return (
    <div>
      <input placeholder="Nome da pizzaria (ex: Magda Pizza)" value={nome} onChange={e => setNome(e.target.value)} style={inp2} />
      <input placeholder="@usuario (ex: magda)" value={usuario} onChange={e => setUsuario(e.target.value)} style={inp2} />
      <input placeholder="Senha" type="password" value={senha} onChange={e => setSenha(e.target.value)} style={inp2} />
      <button onClick={criar} disabled={criando} style={{ width: '100%', background: criando ? 'rgba(255,255,255,0.05)' : '#ff6b00', border: 'none', borderRadius: 10, padding: '12px', color: '#fff', fontSize: 14, fontWeight: 700, cursor: criando ? 'not-allowed' : 'pointer' }}>
        {criando ? 'Criando...' : '+ Criar acesso admin'}
      </button>
      {resultado && (
        <div style={{ marginTop: 12 }}>
          <p style={{ color: '#4ade80', fontSize: 12, margin: '0 0 10px', background: 'rgba(74,222,128,0.1)', borderRadius: 8, padding: '8px 12px' }}>{resultado}</p>
          <button onClick={() => {
            const mensagem = `Ola! Aqui e a Ominix IA. 👋\n\nSeu acesso ao *ChefeBot* esta pronto para teste!\n\n🍕 *O que e o ChefeBot?*\nUm sistema completo de pedidos via WhatsApp para sua pizzaria. Seu cliente faz o pedido direto pelo WhatsApp — sem app, sem complicacao.\n\n🔗 *Link de acesso:*\nhttps://chefebot-pjif.vercel.app/login\n\n👤 *Usuario:* ${usuario || 'seu-usuario'}\n🔑 *Senha:* (a que voce definiu)\n\n📱 *O que explorar:*\n• Painel de pedidos em tempo real\n• Dashboard com faturamento\n• Cardapio dinamico\n• Configuracoes da pizzaria\n\nQualquer duvida e so chamar! 😊`
            window.open('https://wa.me/?text=' + encodeURIComponent(mensagem), '_blank')
          }} style={{ width: '100%', background: '#0d1a0d', border: '1px solid #16a34a40', borderRadius: 10, padding: '12px', color: '#4ade80', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
            Compartilhar acesso no WhatsApp
          </button>
        </div>
      )}
    </div>
  )
}

function ResetOperacional() {
  const [senha, setSenha] = useState('')
  const [frase, setFrase] = useState('')
  const [resetando, setResetando] = useState(false)
  const [resultado, setResultado] = useState<{ ok: boolean; msg: string } | null>(null)
  const FRASE = 'RESETAR CHEFEBOT'

  const executarReset = async () => {
    if (frase !== FRASE) { setResultado({ ok: false, msg: 'Frase incorreta. Digite exatamente: RESETAR CHEFEBOT' }); return }
    setResetando(true)
    try {
      const r = await fetch('/api/dev/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ senha, frase }) })
      const d = await r.json()
      if (d.ok) {
        setResultado({ ok: true, msg: `Sistema resetado com sucesso. Pedidos e conversas foram limpos. (Sessões: ${d.detalhes?.sessoes ?? 0})` })
        setSenha(''); setFrase('')
      } else {
        setResultado({ ok: false, msg: d.error || 'Não foi possível resetar o sistema. Verifique a senha.' })
      }
    } catch { setResultado({ ok: false, msg: 'Erro de conexão.' }) }
    setResetando(false)
  }

  const inp = { width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 14px', color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box' as const, marginBottom: 10, fontFamily: 'inherit' }

  return (
    <div style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 14, padding: 20, marginBottom: 24 }}>
      <p style={{ color: '#f87171', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 4px' }}>Reset Operacional</p>
      <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, margin: '0 0 16px', lineHeight: 1.5 }}>
        Limpa pedidos, conversas e sessões do bot. Não afeta cardápio, configurações nem credenciais.
      </p>
      <input type="password" placeholder="Senha de reset" value={senha} onChange={e => setSenha(e.target.value)} style={inp} />
      <input type="text" placeholder={`Digite: ${FRASE}`} value={frase} onChange={e => setFrase(e.target.value)} style={{ ...inp, fontWeight: frase === FRASE ? 700 : 400, color: frase === FRASE ? '#f87171' : '#fff' }} />
      <button
        onClick={executarReset}
        disabled={resetando || !senha || frase !== FRASE}
        style={{ width: '100%', background: frase === FRASE && senha ? 'rgba(239,68,68,0.9)' : 'rgba(255,255,255,0.05)', border: 'none', borderRadius: 10, padding: '12px', color: frase === FRASE && senha ? '#fff' : 'rgba(255,255,255,0.2)', fontSize: 14, fontWeight: 700, cursor: frase === FRASE && senha ? 'pointer' : 'not-allowed' }}
      >
        {resetando ? 'Resetando...' : 'Resetar sistema'}
      </button>
      {resultado && (
        <p style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, background: resultado.ok ? 'rgba(74,222,128,0.1)' : 'rgba(252,129,129,0.1)', color: resultado.ok ? '#4ade80' : '#fc8181', fontSize: 12, fontWeight: 600, margin: '12px 0 0' }}>{resultado.msg}</p>
      )}
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
  const [senhasCriadas, setSenhasCriadas] = useState<Record<string, string>>({})

  useEffect(() => {
    const role = getUserRole()
    if (role !== 'dev') { router.push('/login'); return }
    setChecking(false)
    Promise.all([
      fetch('/api/padroes').then(r => r.json()).catch(() => []),
      fetch('/api/logs').then(r => r.json()).catch(() => []),
    ]).then(([p, l]) => {
      setPadroes(Array.isArray(p) ? p : [])
      setLogs(Array.isArray(l) ? l : [])
      setLoading(false)
    })
  }, [router])

  const salvarPadrao = async (original: string) => {
    try {
      await fetch('/api/padroes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ original, interpretado: novoValor }) })
      setPadroes(prev => prev.map(p => p.original === original ? { ...p, interpretado: novoValor } : p))
      setEditando(null); setMensagem('Padrao salvo!')
      setTimeout(() => setMensagem(''), 3000)
    } catch { setMensagem('Erro ao salvar.') }
  }

  const limparLogs = async () => {
    setLimpandoLogs(true)
    try {
      await fetch('/api/logs', { method: 'DELETE' })
      setLogs([])
      setMensagem('Logs limpos!')
      setTimeout(() => setMensagem(''), 3000)
    } catch { setMensagem('Erro.') }
    setLimpandoLogs(false)
  }

  const corNivel = (nivel: string) => {
    if (nivel === 'erro') return { bg: 'rgba(252,129,129,0.08)', border: 'rgba(252,129,129,0.25)', text: '#fc8181', icon: '[ERRO]' }
    if (nivel === 'aviso') return { bg: 'rgba(251,191,36,0.08)', border: 'rgba(251,191,36,0.25)', text: '#fbbf24', icon: '[AVISO]' }
    return { bg: 'rgba(96,165,250,0.08)', border: 'rgba(96,165,250,0.25)', text: '#60a5fa', icon: '[INFO]' }
  }

  const padroesFiltrados = padroes.filter(p => !busca || p.original.toLowerCase().includes(busca.toLowerCase()) || p.interpretado.toLowerCase().includes(busca.toLowerCase()))

  if (checking || loading) return (
    <div style={{ minHeight: '100vh', background: '#0a0a1a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: 'rgba(255,255,255,0.3)' }}>Carregando...</p>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a1a', padding: '24px 16px', fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
          <div>
            <h1 style={{ color: '#7c3aed', fontSize: 22, fontWeight: 800, margin: 0 }}>Painel Dev — Ominix</h1>
            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, margin: '4px 0 0' }}>Controle exclusivo do criador do sistema</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => router.push('/admin')} style={{ background: 'rgba(255,215,0,0.1)', border: '1px solid rgba(255,215,0,0.3)', color: '#ffd700', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>Admin</button>
            <button onClick={() => router.push('/dev/mcp')} style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.4)', color: '#a78bfa', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>IA / MCP</button>
            <button onClick={() => fetch('/api/auth/logout', { method: 'POST' }).then(() => router.push('/login'))} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 13 }}>Sair</button>
          </div>
        </div>

        {mensagem && (
          <div style={{ background: mensagem.includes('salvo') || mensagem.includes('criado') || mensagem.includes('limpos') ? 'rgba(104,211,145,0.1)' : 'rgba(252,129,129,0.1)', border: `1px solid ${mensagem.includes('salvo') || mensagem.includes('criado') || mensagem.includes('limpos') ? 'rgba(104,211,145,0.3)' : 'rgba(252,129,129,0.3)'}`, borderRadius: 10, padding: '10px 14px', marginBottom: 16, color: mensagem.includes('salvo') || mensagem.includes('criado') || mensagem.includes('limpos') ? '#68d391' : '#fc8181', fontWeight: 600, fontSize: 14 }}>
            {mensagem}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 24 }}>
          <div style={{ background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.25)', borderRadius: 12, padding: 16 }}>
            <p style={{ color: 'rgba(124,58,237,0.7)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', margin: '0 0 6px', letterSpacing: 1 }}>Padroes</p>
            <p style={{ color: '#a78bfa', fontSize: 28, fontWeight: 800, margin: 0 }}>{padroes.length}</p>
          </div>
          <div style={{ background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.25)', borderRadius: 12, padding: 16 }}>
            <p style={{ color: 'rgba(96,165,250,0.7)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', margin: '0 0 6px', letterSpacing: 1 }}>Usos</p>
            <p style={{ color: '#60a5fa', fontSize: 28, fontWeight: 800, margin: 0 }}>{padroes.reduce((s, p) => s + p.vezes, 0)}</p>
          </div>
          <div style={{ background: 'rgba(252,129,129,0.1)', border: '1px solid rgba(252,129,129,0.25)', borderRadius: 12, padding: 16 }}>
            <p style={{ color: 'rgba(252,129,129,0.7)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', margin: '0 0 6px', letterSpacing: 1 }}>Erros</p>
            <p style={{ color: '#fc8181', fontSize: 28, fontWeight: 800, margin: 0 }}>{logs.filter(l => l.nivel === 'erro').length}</p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          <button onClick={() => setAba('padroes')} style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: aba === 'padroes' ? '#7c3aed' : 'rgba(255,255,255,0.05)', color: '#fff' }}>
            Padroes Aprendidos
          </button>
          <button onClick={() => setAba('logs')} style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: aba === 'logs' ? '#7c3aed' : 'rgba(255,255,255,0.05)', color: '#fff' }}>
            Logs do Sistema
          </button>
        </div>

        {aba === 'padroes' && (
          <div>
            <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar padrao..." style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 14px', color: '#fff', fontSize: 14, outline: 'none', marginBottom: 12, boxSizing: 'border-box' }} />
            <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11, fontWeight: 700, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
              Biblioteca — {padroesFiltrados.length} resultados
            </p>
            {padroesFiltrados.length === 0 ? (
              <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 12, padding: 32, textAlign: 'center' }}>
                <p style={{ color: 'rgba(255,255,255,0.2)', margin: 0, fontSize: 15 }}>Nenhum padrao aprendido ainda.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {padroesFiltrados.map((p, i) => (
                  <div key={i} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '12px 14px' }}>
                    {editando === p.original ? (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input value={novoValor} onChange={e => setNovoValor(e.target.value)} style={{ flex: 1, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '8px 12px', color: '#fff', fontSize: 13, outline: 'none' }} />
                        <button onClick={() => salvarPadrao(p.original)} style={{ background: '#7c3aed', border: 'none', color: '#fff', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>Salvar</button>
                        <button onClick={() => setEditando(null)} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', fontSize: 13 }}>x</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                        <div style={{ flex: 1 }}>
                          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, margin: '0 0 4px' }}>Original</p>
                          <p style={{ color: '#fff', fontSize: 13, margin: '0 0 6px', fontWeight: 500 }}>{p.original}</p>
                          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, margin: '0 0 4px' }}>Interpretado como</p>
                          <p style={{ color: '#a78bfa', fontSize: 13, margin: 0 }}>{p.interpretado}</p>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                          <span style={{ background: 'rgba(124,58,237,0.2)', color: '#a78bfa', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20 }}>{p.vezes}x</span>
                          <button onClick={() => { setEditando(p.original); setNovoValor(p.interpretado) }} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 11 }}>Editar</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {aba === 'logs' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: 700, margin: 0, textTransform: 'uppercase', letterSpacing: 1 }}>
                Ultimos 50 eventos
              </h2>
              <button onClick={limparLogs} disabled={limpandoLogs} style={{ background: 'rgba(252,129,129,0.1)', border: '1px solid rgba(252,129,129,0.3)', color: '#fc8181', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                Limpar logs
              </button>
            </div>
            {logs.length === 0 ? (
              <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 12, padding: 32, textAlign: 'center' }}>
                <p style={{ color: 'rgba(255,255,255,0.2)', margin: 0, fontSize: 15 }}>Nenhum log registrado. Sistema saudavel!</p>
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

        {/* Reset operacional */}
        <ResetOperacional />

        {/* Clientes com acesso */}
        <ClientesAcesso senhasCriadas={senhasCriadas} />

        {/* Criar acesso admin */}
        <div style={{ background: 'rgba(255,107,0,0.08)', border: '1px solid rgba(255,107,0,0.2)', borderRadius: 14, padding: 20, marginTop: 24 }}>
          <p style={{ color: '#ff6b00', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 4px' }}>Liberar acesso de teste</p>
          <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, margin: '0 0 14px' }}>Cria um admin para uma pizzaria testar o sistema.</p>
          <NovoClienteDevForm onCriado={(username, senha) => setSenhasCriadas(prev => ({ ...prev, [username]: senha }))} />
        </div>

        <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.1)', fontSize: 11, marginTop: 32 }}>
          Ominix Dev Console · Acesso restrito
        </p>
      </div>
    </div>
  )
}