'use client'
import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'

type Pedido = {
  id: string
  cliente: string
  telefone: string
  itens: string[]
  total: number
  status: string
  horario: string
  endereco: string
  escalonado?: boolean
  observacao?: string
  cancelamentoSolicitado?: boolean
}

type Config = {
  nomePizzaria: string
  horaAbertura: number
  horaFechamento: number
  chavePix: string
  limitePico?: number
}

type Funcionario = {
  username: string
  name: string
  password: string
  ativo: boolean
}

type ImagensCardapio = {
  pizza?: string
  lanche?: string
  bebida?: string
  suco?: string
  ativo: boolean
}

type Avaliacao = {
  phone: string
  nota: number
  data: string
}

type AvaliacoesData = {
  total: number
  media: number
  ultimas: Avaliacao[]
}

type Periodo = 'hoje' | 'ontem' | 'semana'

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

function getUserName(): string | null {
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
        return user?.name ?? null
      }
    }
  } catch { return null }
  return null
}

function filtraPorPeriodo(pedidos: Pedido[], periodo: Periodo): Pedido[] {
  const agora = new Date()
  const hojeStr = agora.toLocaleDateString('pt-BR')
  const ontem = new Date(agora)
  ontem.setDate(ontem.getDate() - 1)
  const ontemStr = ontem.toLocaleDateString('pt-BR')
  if (periodo === 'hoje') {
    return pedidos.filter(p => {
      if ((p as any).data) return (p as any).data === hojeStr
      const [h, m] = p.horario.split(':').map(Number)
      const d = new Date(); d.setHours(h, m, 0, 0)
      return d.toLocaleDateString('pt-BR') === hojeStr
    })
  }
  if (periodo === 'ontem') {
    return pedidos.filter(p => {
      if ((p as any).data) return (p as any).data === ontemStr
      const [h, m] = p.horario.split(':').map(Number)
      const d = new Date(); d.setHours(h, m, 0, 0)
      return d.toLocaleDateString('pt-BR') === ontemStr
    })
  }
  return pedidos
}

function calcularGraficoPico(pedidos: Pedido[]): { hora: string; total: number }[] {
  const contagem: Record<number, number> = {}
  for (const p of pedidos) {
    if (p.status === 'cancelado' || p.escalonado) continue
    const hora = parseInt(p.horario.split(':')[0])
    if (!isNaN(hora)) contagem[hora] = (contagem[hora] || 0) + 1
  }
  const horas = Object.keys(contagem).map(Number).sort((a, b) => a - b)
  if (horas.length === 0) return []
  const min = Math.min(...horas)
  const max = Math.max(...horas)
  const resultado = []
  for (let h = min; h <= max; h++) {
    resultado.push({ hora: `${String(h).padStart(2, '0')}h`, total: contagem[h] || 0 })
  }
  return resultado
}

export default function AdminPage() {
  const router = useRouter()
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [config, setConfig] = useState<Config>({ nomePizzaria: '', horaAbertura: 18, horaFechamento: 23, chavePix: '' })
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([])
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(true)
  const [periodo, setPeriodo] = useState<Periodo>('hoje')
  const [showConfig, setShowConfig] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [salvandoFunc, setSalvandoFunc] = useState<string | null>(null)
  const [mensagem, setMensagem] = useState('')
  const [senhas, setSenhas] = useState<Record<string, string>>({})
  const [nomes, setNomes] = useState<Record<string, string>>({})
  const [showNovoFunc, setShowNovoFunc] = useState(false)
  const [novoFunc, setNovoFunc] = useState({ name: '', username: '', password: '' })
  const [criando, setCriando] = useState(false)
  const [nomeUsuario, setNomeUsuario] = useState('')
  const [imagens, setImagens] = useState<ImagensCardapio>({ ativo: true })
  const [avaliacoes, setAvaliacoes] = useState<AvaliacoesData>({ total: 0, media: 0, ultimas: [] })
  const [ranking, setRanking] = useState<Array<{ nome: string; total: number }>>([])
  const [limitePico, setLimitePico] = useState(0)
  const [uploadando, setUploadando] = useState<string | null>(null)
  const inputPizzaRef = useRef<HTMLInputElement>(null)
  const inputLancheRef = useRef<HTMLInputElement>(null)
  const inputBebidaRef = useRef<HTMLInputElement>(null)
  const inputSucoRef = useRef<HTMLInputElement>(null)
  const is24h = config.horaAbertura === 0 && config.horaFechamento === 24

  useEffect(() => {
    const role = getUserRole()
    if (role !== 'admin' && role !== 'dev') { router.push('/login?callbackUrl=/admin'); return }
    const nome = getUserName()
    if (nome) setNomeUsuario(nome)
    setChecking(false)
    Promise.all([
      fetch('/api/orders').then(r => r.json()),
      fetch('/api/configuracoes').then(r => r.json()),
      fetch('/api/funcionarios').then(r => r.json()),
      fetch('/api/cardapio-imagens').then(r => r.json()).catch(() => ({ ativo: true })),
      fetch('/api/avaliacoes').then(r => r.json()).catch(() => ({ total: 0, media: 0, ultimas: [] })),
      fetch('/api/ranking').then(r => r.json()).catch(() => []),
    ]).then(([ped, cfg, funcs, imgs, avals, rank]) => {
      setPedidos(Array.isArray(ped) ? ped : [])
      setConfig(cfg)
      setLimitePico(cfg.limitePico || 0)
      setImagens(imgs || { ativo: true })
      setAvaliacoes(avals || { total: 0, media: 0, ultimas: [] })
      setRanking(Array.isArray(rank) ? rank : [])
      if (Array.isArray(funcs)) {
        setFuncionarios(funcs)
        const s: Record<string, string> = {}
        const n: Record<string, string> = {}
        funcs.forEach((f: Funcionario) => { s[f.username] = ''; n[f.username] = f.name })
        setSenhas(s)
        setNomes(n)
      }
      setLoading(false)
    })
  }, [router])

  const pedidosFiltrados = filtraPorPeriodo(pedidos, periodo).filter(p => !p.escalonado && p.status !== 'cancelado')
  const pedidosEntregues = pedidosFiltrados.filter(p => p.status === 'entregue')
  const faturamento = pedidosEntregues.reduce((s, p) => s + (Number(p.total) || 0), 0)
  const totalEntregues = pedidosEntregues.length
  const ticketMedio = totalEntregues > 0 ? faturamento / totalEntregues : 0
  const telefonesTotal = pedidosEntregues.reduce((acc: Record<string, number>, p) => {
    acc[p.telefone] = (acc[p.telefone] || 0) + 1
    return acc
  }, {})
  const recorrentes = Object.values(telefonesTotal).filter(v => v > 1).length
  const graficoPico = calcularGraficoPico(pedidosFiltrados)
  const maxPico = graficoPico.length > 0 ? Math.max(...graficoPico.map(g => g.total)) : 1

  const toggle24h = async () => {
    const novaConfig = is24h ? { ...config, horaAbertura: 18, horaFechamento: 23 } : { ...config, horaAbertura: 0, horaFechamento: 24 }
    setConfig(novaConfig)
    setSalvando(true)
    try {
      const res = await fetch('/api/configuracoes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...novaConfig, limitePico }) })
      if (res.ok) { setMensagem(is24h ? '✅ Horario padrao restaurado!' : '✅ Aberto 24 horas!'); setTimeout(() => setMensagem(''), 3000) }
    } catch { setMensagem('❌ Erro ao salvar.'); setTimeout(() => setMensagem(''), 3000) }
    finally { setSalvando(false) }
  }

  const salvarConfig = async () => {
    setSalvando(true)
    try {
      const res = await fetch('/api/configuracoes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...config, limitePico }) })
      if (res.ok) { setMensagem('✅ Configuracoes salvas!'); setTimeout(() => setMensagem(''), 3000) }
    } catch { setMensagem('❌ Erro ao salvar.'); setTimeout(() => setMensagem(''), 3000) }
    finally { setSalvando(false) }
  }

  const salvarFuncionario = async (username: string) => {
    setSalvandoFunc(username)
    try {
      const nome = nomes[username]
      const senha = senhas[username]
      const res = await fetch('/api/funcionarios', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, name: nome, password: senha || undefined }) })
      if (res.ok) { setMensagem('✅ Funcionario atualizado!'); setTimeout(() => setMensagem(''), 3000) }
    } catch { setMensagem('❌ Erro ao salvar.'); setTimeout(() => setMensagem(''), 3000) }
    finally { setSalvandoFunc(null) }
  }

  const bloquearFuncionario = async (username: string, ativo: boolean) => {
    try {
      await fetch('/api/funcionarios', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, ativo: !ativo }) })
      setFuncionarios(prev => prev.map(f => f.username === username ? { ...f, ativo: !ativo } : f))
      setMensagem(!ativo ? '✅ Acesso liberado!' : '🔒 Acesso bloqueado!'); setTimeout(() => setMensagem(''), 3000)
    } catch { setMensagem('❌ Erro.'); setTimeout(() => setMensagem(''), 3000) }
  }

  const excluirFuncionario = async (username: string) => {
    if (!confirm(`Excluir funcionario ${username}?`)) return
    try {
      await fetch('/api/funcionarios', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username }) })
      setFuncionarios(prev => prev.filter(f => f.username !== username))
      setMensagem('✅ Funcionario removido!'); setTimeout(() => setMensagem(''), 3000)
    } catch { setMensagem('❌ Erro.'); setTimeout(() => setMensagem(''), 3000) }
  }

  const criarFuncionario = async () => {
    if (!novoFunc.name || !novoFunc.username || !novoFunc.password) { setMensagem('❌ Preencha todos os campos.'); setTimeout(() => setMensagem(''), 3000); return }
    setCriando(true)
    try {
      const res = await fetch('/api/funcionarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(novoFunc) })
      if (res.ok) {
        const novo = await res.json()
        setFuncionarios(prev => [...prev, novo])
        setNovoFunc({ name: '', username: '', password: '' })
        setShowNovoFunc(false)
        setMensagem('✅ Funcionario criado!'); setTimeout(() => setMensagem(''), 3000)
      }
    } catch { setMensagem('❌ Erro ao criar.'); setTimeout(() => setMensagem(''), 3000) }
    finally { setCriando(false) }
  }

  const uploadImagem = async (categoria: string, arquivo: File) => {
    setUploadando(categoria)
    try {
      const formData = new FormData()
      formData.append('file', arquivo)
      formData.append('categoria', categoria)
      const res = await fetch('/api/cardapio-imagens', { method: 'POST', body: formData })
      if (res.ok) {
        const data = await res.json()
        setImagens(prev => ({ ...prev, [categoria]: data.url }))
        setMensagem(`✅ Imagem de ${categoria} atualizada!`); setTimeout(() => setMensagem(''), 3000)
      } else {
        setMensagem('❌ Erro ao fazer upload.'); setTimeout(() => setMensagem(''), 3000)
      }
    } catch { setMensagem('❌ Erro ao fazer upload.'); setTimeout(() => setMensagem(''), 3000) }
    finally { setUploadando(null) }
  }

  const toggleImagens = async () => {
    const novo = { ...imagens, ativo: !imagens.ativo }
    setImagens(novo)
    try {
      await fetch('/api/cardapio-imagens', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ativo: novo.ativo }) })
      setMensagem(novo.ativo ? '✅ Imagens ativadas!' : '✅ Imagens desativadas!'); setTimeout(() => setMensagem(''), 3000)
    } catch { setMensagem('❌ Erro.'); setTimeout(() => setMensagem(''), 3000) }
  }

  if (checking) return null

  const categorias = [
    { key: 'pizza', label: '🍕 Pizzas', ref: inputPizzaRef },
    { key: 'lanche', label: '🥪 Lanches', ref: inputLancheRef },
    { key: 'bebida', label: '🥤 Bebidas', ref: inputBebidaRef },
    { key: 'suco', label: '🧃 Sucos', ref: inputSucoRef },
  ]

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #1a0a00 0%, #0d0d1a 100%)', padding: '20px 16px', fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", paddingBottom: 40 }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h1 style={{ color: '#ffd700', fontSize: 20, fontWeight: 800, margin: 0 }}>👑 Bem-vindo, {nomeUsuario || 'Admin'}</h1>
            <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, margin: '2px 0 0' }}>Pizzaria</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => router.push('/pedidos')} style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', borderRadius: 10, padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
              📋 Pedidos
            </button>
            <button onClick={() => setShowConfig(true)} style={{ background: 'linear-gradient(135deg, #b7950b, #ffd700)', border: 'none', color: '#000', borderRadius: 10, padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
              ⚙️ Config
            </button>
          </div>
        </div>

        {mensagem && (
          <div style={{ background: mensagem.includes('✅') ? 'rgba(104,211,145,0.1)' : 'rgba(252,129,129,0.1)', border: `1px solid ${mensagem.includes('✅') ? 'rgba(104,211,145,0.3)' : 'rgba(252,129,129,0.3)'}`, borderRadius: 10, padding: '10px 14px', marginBottom: 16, color: mensagem.includes('✅') ? '#68d391' : '#fc8181', fontWeight: 600, fontSize: 14 }}>
            {mensagem}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          {(['hoje', 'ontem', 'semana'] as Periodo[]).map(p => (
            <button key={p} onClick={() => setPeriodo(p)} style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: periodo === p ? 'linear-gradient(135deg, #b7950b, #ffd700)' : 'rgba(255,255,255,0.07)', color: periodo === p ? '#000' : 'rgba(255,255,255,0.6)' }}>
              {p === 'hoje' ? 'Hoje' : p === 'ontem' ? 'Ontem' : 'Semana'}
            </button>
          ))}
        </div>

        {/* Métricas */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
          <div style={{ background: 'rgba(255,215,0,0.08)', border: '1px solid rgba(255,215,0,0.25)', borderRadius: 14, padding: 18 }}>
            <p style={{ color: 'rgba(255,215,0,0.6)', fontSize: 11, margin: '0 0 6px', fontWeight: 700, textTransform: 'uppercase' }}>💰 Voce ganhou</p>
            <p style={{ color: '#ffd700', fontSize: 22, fontWeight: 800, margin: 0 }}>R$ {faturamento.toFixed(2).replace('.', ',')}</p>
          </div>
          <div style={{ background: 'rgba(99,179,237,0.08)', border: '1px solid rgba(99,179,237,0.25)', borderRadius: 14, padding: 18 }}>
            <p style={{ color: 'rgba(99,179,237,0.6)', fontSize: 11, margin: '0 0 6px', fontWeight: 700, textTransform: 'uppercase' }}>🍕 Pizzas entregues</p>
            <p style={{ color: '#63b3ed', fontSize: 22, fontWeight: 800, margin: 0 }}>{totalEntregues}</p>
          </div>
          <div style={{ background: 'rgba(159,122,234,0.08)', border: '1px solid rgba(159,122,234,0.25)', borderRadius: 14, padding: 18 }}>
            <p style={{ color: 'rgba(159,122,234,0.6)', fontSize: 11, margin: '0 0 6px', fontWeight: 700, textTransform: 'uppercase' }}>🎯 Ticket medio</p>
            <p style={{ color: '#9f7aea', fontSize: 22, fontWeight: 800, margin: 0 }}>R$ {ticketMedio.toFixed(2).replace('.', ',')}</p>
          </div>
          <div style={{ background: 'rgba(104,211,145,0.08)', border: '1px solid rgba(104,211,145,0.25)', borderRadius: 14, padding: 18 }}>
            <p style={{ color: 'rgba(104,211,145,0.6)', fontSize: 11, margin: '0 0 6px', fontWeight: 700, textTransform: 'uppercase' }}>❤️ Clientes fieis</p>
            <p style={{ color: '#68d391', fontSize: 22, fontWeight: 800, margin: 0 }}>{recorrentes} <span style={{ fontSize: 12, fontWeight: 400 }}>clientes</span></p>
          </div>
          <div style={{ background: 'rgba(252,129,129,0.08)', border: '1px solid rgba(252,129,129,0.25)', borderRadius: 14, padding: 18, gridColumn: 'span 2' }}>
            <p style={{ color: 'rgba(252,129,129,0.6)', fontSize: 11, margin: '0 0 10px', fontWeight: 700, textTransform: 'uppercase' }}>⭐ Avaliacao dos Clientes</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div>
                <p style={{ color: '#fc8181', fontSize: 28, fontWeight: 800, margin: 0 }}>{avaliacoes.media > 0 ? avaliacoes.media.toFixed(1) : '--'}</p>
                <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, margin: '2px 0 0' }}>{avaliacoes.total} avaliacoes</p>
              </div>
              <div style={{ flex: 1 }}>
                {avaliacoes.media > 0 && (
                  <p style={{ color: '#ffd700', fontSize: 18, margin: '0 0 6px' }}>{'⭐'.repeat(Math.round(avaliacoes.media))}</p>
                )}
                {avaliacoes.ultimas.slice(0, 3).map((a, i) => (
                  <p key={i} style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, margin: '2px 0' }}>
                    {'⭐'.repeat(a.nota)} · {new Date(a.data).toLocaleDateString('pt-BR')}
                  </p>
                ))}
                {avaliacoes.total === 0 && (
                  <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: 12, margin: 0 }}>Nenhuma avaliacao ainda</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Ranking */}
        {ranking.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 700, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>🏆 Mais Pedidos</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ranking.slice(0, 5).map((item, i) => (
                <div key={i} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 18, fontWeight: 800, color: i === 0 ? '#ffd700' : i === 1 ? '#c0c0c0' : i === 2 ? '#cd7f32' : 'rgba(255,255,255,0.3)', minWidth: 28 }}>
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`}
                  </span>
                  <p style={{ color: '#fff', fontSize: 13, fontWeight: 600, margin: 0, flex: 1 }}>{item.nome}</p>
                  <span style={{ background: 'rgba(255,215,0,0.1)', border: '1px solid rgba(255,215,0,0.3)', color: '#ffd700', fontSize: 12, fontWeight: 800, padding: '3px 10px', borderRadius: 20 }}>
                    {item.total}x
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Grafico de pico */}
        {graficoPico.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 700, marginBottom: 16, textTransform: 'uppercase', letterSpacing: 1 }}>📊 Horário de Pico</h2>
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '16px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 80, justifyContent: 'space-between' }}>
                {graficoPico.map((item, i) => {
                  const altura = maxPico > 0 ? Math.max((item.total / maxPico) * 100, 8) : 8
                  const isPico = item.total === maxPico && maxPico > 0
                  return (
                    <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      <p style={{ color: isPico ? '#ffd700' : 'rgba(255,255,255,0.3)', fontSize: 9, margin: 0, fontWeight: isPico ? 800 : 400 }}>
                        {item.total > 0 ? item.total : ''}
                      </p>
                      <div style={{ width: '100%', height: `${altura}%`, background: isPico ? 'linear-gradient(180deg, #ffd700, #b7950b)' : 'rgba(255,255,255,0.15)', borderRadius: '4px 4px 0 0', minHeight: 4, transition: 'height 0.3s' }} />
                    </div>
                  )
                })}
              </div>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'space-between', marginTop: 6 }}>
                {graficoPico.map((item, i) => (
                  <p key={i} style={{ flex: 1, color: 'rgba(255,255,255,0.3)', fontSize: 9, margin: 0, textAlign: 'center' }}>{item.hora}</p>
                ))}
              </div>
              {maxPico > 0 && (
                <p style={{ color: 'rgba(255,215,0,0.5)', fontSize: 11, margin: '10px 0 0', textAlign: 'center' }}>
                  🔥 Pico às {graficoPico.find(g => g.total === maxPico)?.hora} com {maxPico} pedido{maxPico > 1 ? 's' : ''}
                </p>
              )}
            </div>
          </div>
        )}

        <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.15)', fontSize: 11, marginTop: 8, marginBottom: 24 }}>ChefeBot · Painel Admin</p>
      </div>

      {showConfig && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }}>
          <div onClick={() => setShowConfig(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} />
          <div style={{ position: 'relative', width: '100%', maxWidth: 420, background: 'linear-gradient(180deg, #1a1000 0%, #0a0a1a 100%)', borderLeft: '1px solid rgba(255,215,0,0.15)', padding: '24px 20px', overflowY: 'auto', zIndex: 1001 }}>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
              <h2 style={{ color: '#ffd700', fontSize: 18, fontWeight: 800, margin: 0 }}>⚙️ Configuracoes</h2>
              <button onClick={() => setShowConfig(false)} style={{ background: 'rgba(255,255,255,0.08)', border: 'none', color: '#fff', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>

            {mensagem && (
              <div style={{ background: mensagem.includes('✅') ? 'rgba(104,211,145,0.1)' : 'rgba(252,129,129,0.1)', border: `1px solid ${mensagem.includes('✅') ? 'rgba(104,211,145,0.3)' : 'rgba(252,129,129,0.3)'}`, borderRadius: 10, padding: '10px 14px', marginBottom: 16, color: mensagem.includes('✅') ? '#68d391' : '#fc8181', fontWeight: 600, fontSize: 14 }}>
                {mensagem}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div>
                <label style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 8 }}>🍕 Nome da Pizzaria</label>
                <input type="text" value={config.nomePizzaria} onChange={e => setConfig(p => ({ ...p, nomePizzaria: e.target.value }))}
                  style={{ width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '11px 14px', color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
              </div>

              <div style={{ background: 'rgba(255,215,0,0.04)', border: '1px solid rgba(255,215,0,0.15)', borderRadius: 12, padding: 14 }}>
                <label style={{ color: 'rgba(255,220,100,0.9)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 8 }}>💸 Chave Pix</label>
                <input type="text" placeholder="Ex: 11999999999 ou email@email.com" value={config.chavePix} onChange={e => setConfig(p => ({ ...p, chavePix: e.target.value }))}
                  style={{ width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,215,0,0.2)', borderRadius: 10, padding: '11px 14px', color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box', marginBottom: 8 }} />
                <label style={{ color: 'rgba(255,220,100,0.9)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 8 }}>👤 Nome do Titular da Conta</label>
                <input type="text" placeholder="Ex: João Silva" value={(config as any).nomeTitularPix || ''} onChange={e => setConfig(p => ({ ...p, nomeTitularPix: e.target.value } as any))}
                  style={{ width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,215,0,0.2)', borderRadius: 10, padding: '11px 14px', color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
                <p style={{ color: 'rgba(255,215,0,0.4)', fontSize: 11, margin: '6px 0 0' }}>Usado para validar comprovantes de Pix automaticamente.</p>
              </div>

              <div>
                <label style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 8 }}>⏰ Horario de Funcionamento</label>
                <button onClick={toggle24h} disabled={salvando} style={{ width: '100%', background: is24h ? 'linear-gradient(135deg, #38a169, #276749)' : 'rgba(255,255,255,0.07)', border: is24h ? '2px solid #38a169' : '2px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '11px 14px', color: '#fff', fontSize: 13, fontWeight: 700, cursor: salvando ? 'not-allowed' : 'pointer', marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  {is24h ? '✅ Aberto 24h (ativo) - toque para desativar' : '🕐 Ativar modo 24 horas'}
                </button>
                {!is24h && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div>
                      <label style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, display: 'block', marginBottom: 4 }}>Abre as</label>
                      <input type="number" min={0} max={23} value={config.horaAbertura} onChange={e => setConfig(p => ({ ...p, horaAbertura: Number(e.target.value) }))}
                        style={{ width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '10px 12px', color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <label style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, display: 'block', marginBottom: 4 }}>Fecha as</label>
                      <input type="number" min={0} max={24} value={config.horaFechamento} onChange={e => setConfig(p => ({ ...p, horaFechamento: Number(e.target.value) }))}
                        style={{ width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '10px 12px', color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                  </div>
                )}
              </div>

              <div style={{ background: 'rgba(255,100,0,0.04)', border: '1px solid rgba(255,100,0,0.15)', borderRadius: 12, padding: 14 }}>
                <label style={{ color: 'rgba(255,150,50,0.9)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 8 }}>🔥 Alerta de Horario de Pico</label>
                <input type="number" min={0} max={100} value={limitePico} onChange={e => setLimitePico(Number(e.target.value))}
                  placeholder="0 = desativado"
                  style={{ width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,100,0,0.2)', borderRadius: 10, padding: '11px 14px', color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
                <p style={{ color: 'rgba(255,150,50,0.4)', fontSize: 11, margin: '6px 0 0' }}>
                  {limitePico > 0 ? `Cliente sera avisado quando houver ${limitePico} ou mais pedidos em preparo.` : 'Digite um numero para ativar o aviso de pico. 0 = desativado.'}
                </p>
              </div>

              <button onClick={salvarConfig} disabled={salvando} style={{ width: '100%', background: 'linear-gradient(135deg, #b7950b, #ffd700)', border: 'none', borderRadius: 10, padding: '13px', color: '#000', fontSize: 14, fontWeight: 700, cursor: salvando ? 'not-allowed' : 'pointer' }}>
                {salvando ? 'Salvando...' : '💾 Salvar Configuracoes'}
              </button>

              <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <div>
                    <p style={{ color: '#fff', fontWeight: 700, fontSize: 14, margin: 0 }}>📸 Cardapio por Imagem</p>
                    <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, margin: '2px 0 0' }}>Bot envia a foto ao cliente</p>
                  </div>
                  <button onClick={toggleImagens} style={{ background: imagens.ativo ? 'linear-gradient(135deg, #38a169, #276749)' : 'rgba(255,255,255,0.07)', border: 'none', borderRadius: 20, padding: '6px 14px', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                    {imagens.ativo ? '✅ Ativo' : '⏸️ Inativo'}
                  </button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {categorias.map(cat => (
                    <div key={cat.key}>
                      <input type="file" accept="image/*" ref={cat.ref} style={{ display: 'none' }}
                        onChange={e => { const file = e.target.files?.[0]; if (file) uploadImagem(cat.key, file) }} />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {imagens[cat.key as keyof ImagensCardapio] && typeof imagens[cat.key as keyof ImagensCardapio] === 'string' ? (
                          <img src={imagens[cat.key as keyof ImagensCardapio] as string} alt={cat.label} style={{ width: 52, height: 52, borderRadius: 8, objectFit: 'cover', border: '1px solid rgba(255,255,255,0.1)' }} />
                        ) : (
                          <div style={{ width: 52, height: 52, borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px dashed rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
                            {cat.label.split(' ')[0]}
                          </div>
                        )}
                        <div style={{ flex: 1 }}>
                          <p style={{ color: '#fff', fontSize: 13, fontWeight: 600, margin: '0 0 4px' }}>{cat.label}</p>
                          <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, margin: 0 }}>
                            {imagens[cat.key as keyof ImagensCardapio] ? 'Imagem carregada ✅' : 'Sem imagem - vai usar texto'}
                          </p>
                        </div>
                        <button onClick={() => cat.ref.current?.click()} disabled={uploadando === cat.key}
                          style={{ background: 'rgba(255,215,0,0.1)', border: '1px solid rgba(255,215,0,0.3)', color: '#ffd700', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {uploadando === cat.key ? '⏳' : '📤 Upload'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <label style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: 600 }}>👥 Funcionarios</label>
                  <button onClick={() => setShowNovoFunc(!showNovoFunc)} style={{ background: 'rgba(104,211,145,0.1)', border: '1px solid rgba(104,211,145,0.3)', color: '#68d391', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                    + Novo
                  </button>
                </div>
                {showNovoFunc && (
                  <div style={{ background: 'rgba(104,211,145,0.05)', border: '1px solid rgba(104,211,145,0.15)', borderRadius: 10, padding: 12, marginBottom: 12 }}>
                    <input type="text" placeholder="Nome completo" value={novoFunc.name} onChange={e => setNovoFunc(p => ({ ...p, name: e.target.value }))}
                      style={{ width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '8px 10px', color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box', marginBottom: 8 }} />
                    <input type="text" placeholder="Usuario (sem espacos)" value={novoFunc.username} onChange={e => setNovoFunc(p => ({ ...p, username: e.target.value.toLowerCase().replace(/\s/g, '') }))}
                      style={{ width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '8px 10px', color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box', marginBottom: 8 }} />
                    <input type="password" placeholder="Senha" value={novoFunc.password} onChange={e => setNovoFunc(p => ({ ...p, password: e.target.value }))}
                      style={{ width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '8px 10px', color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box', marginBottom: 8 }} />
                    <button onClick={criarFuncionario} disabled={criando} style={{ width: '100%', background: 'linear-gradient(135deg, #276749, #38a169)', border: 'none', borderRadius: 8, padding: '10px', color: '#fff', fontSize: 13, fontWeight: 700, cursor: criando ? 'not-allowed' : 'pointer' }}>
                      {criando ? 'Criando...' : 'Criar funcionario'}
                    </button>
                  </div>
                )}
                {funcionarios.map(f => (
                  <div key={f.username} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 12, marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div>
                        <p style={{ color: '#fff', fontWeight: 700, fontSize: 13, margin: 0 }}>{f.name}</p>
                        <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, margin: '2px 0 0' }}>@{f.username}</p>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => bloquearFuncionario(f.username, f.ativo)} style={{ background: f.ativo ? 'rgba(252,129,129,0.1)' : 'rgba(104,211,145,0.1)', border: `1px solid ${f.ativo ? 'rgba(252,129,129,0.3)' : 'rgba(104,211,145,0.3)'}`, color: f.ativo ? '#fc8181' : '#68d391', borderRadius: 8, padding: '4px 8px', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
                          {f.ativo ? '🔒' : '🔓'}
                        </button>
                        <button onClick={() => excluirFuncionario(f.username)} style={{ background: 'rgba(252,129,129,0.1)', border: '1px solid rgba(252,129,129,0.3)', color: '#fc8181', borderRadius: 8, padding: '4px 8px', cursor: 'pointer', fontSize: 11 }}>
                          🗑️
                        </button>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input type="text" placeholder="Nome" value={nomes[f.username] ?? f.name} onChange={e => setNomes(prev => ({ ...prev, [f.username]: e.target.value }))}
                        style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '8px 10px', color: '#fff', fontSize: 13, outline: 'none' }} />
                      <input type="password" placeholder="Nova senha" value={senhas[f.username] ?? ''} onChange={e => setSenhas(prev => ({ ...prev, [f.username]: e.target.value }))}
                        style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '8px 10px', color: '#fff', fontSize: 13, outline: 'none' }} />
                      <button onClick={() => salvarFuncionario(f.username)} disabled={salvandoFunc === f.username} style={{ background: 'rgba(255,215,0,0.12)', border: '1px solid rgba(255,215,0,0.3)', color: '#ffd700', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                        💾
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}