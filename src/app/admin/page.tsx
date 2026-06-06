'use client'
import { useEffect, useState } from 'react'
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
}

type Periodo = 'hoje' | 'ontem' | 'semana'

function getUserRole(): string | null {
  if (typeof document === 'undefined') return null
  const cookie = document.cookie.split(';').find(c => c.trim().startsWith('auth-user='))
  if (!cookie) return null
  try {
    const val = decodeURIComponent(cookie.split('=').slice(1).join('='))
    return JSON.parse(val)?.role ?? null
  } catch { return null }
}

function filtraPorPeriodo(pedidos: Pedido[], periodo: Periodo): Pedido[] {
  const agora = new Date()
  const hojeStr = agora.toLocaleDateString('pt-BR')
  const ontem = new Date(agora)
  ontem.setDate(ontem.getDate() - 1)
  const ontemStr = ontem.toLocaleDateString('pt-BR')
  const semanaAtras = new Date(agora)
  semanaAtras.setDate(semanaAtras.getDate() - 7)

  if (periodo === 'hoje') {
    return pedidos.filter(p => {
      const [h, m] = p.horario.split(':').map(Number)
      const d = new Date(); d.setHours(h, m, 0, 0)
      return d.toLocaleDateString('pt-BR') === hojeStr
    })
  }
  if (periodo === 'ontem') {
    return pedidos.filter(p => {
      const [h, m] = p.horario.split(':').map(Number)
      const d = new Date(); d.setHours(h, m, 0, 0)
      return d.toLocaleDateString('pt-BR') === ontemStr
    })
  }
  return pedidos
}

export default function AdminPage() {
  const router = useRouter()
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [config, setConfig] = useState<Config>({ nomePizzaria: '', horaAbertura: 18, horaFechamento: 23, chavePix: '' })
  const [loading, setLoading] = useState(true)
  const [periodo, setPeriodo] = useState<Periodo>('hoje')
  const [salvando, setSalvando] = useState(false)
  const [mensagem, setMensagem] = useState('')
  const is24h = config.horaAbertura === 0 && config.horaFechamento === 24

  useEffect(() => {
    const role = getUserRole()
    if (role !== 'admin') {
      router.push('/login?callbackUrl=/admin')
      return
    }
    Promise.all([
      fetch('/api/orders').then(r => r.json()),
      fetch('/api/configuracoes').then(r => r.json()),
    ]).then(([ped, cfg]) => {
      setPedidos(Array.isArray(ped) ? ped : [])
      setConfig(cfg)
      setLoading(false)
    })
  }, [router])

  const pedidosFiltrados = filtraPorPeriodo(pedidos, periodo).filter(p => !p.escalonado)
  const faturamento = pedidosFiltrados.reduce((s, p) => s + (p.total || 0), 0)
  const ticketMedio = pedidosFiltrados.length > 0 ? faturamento / pedidosFiltrados.length : 0

  const telefonesTotal = pedidos.filter(p => !p.escalonado).reduce((acc: Record<string, number>, p) => {
    acc[p.telefone] = (acc[p.telefone] || 0) + 1
    return acc
  }, {})
  const recorrentes = Object.values(telefonesTotal).filter(v => v > 1).length

  const salvarConfig = async () => {
    setSalvando(true)
    try {
      const res = await fetch('/api/configuracoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (res.ok) {
        setMensagem('✅ Configurações salvas!')
        setTimeout(() => setMensagem(''), 3000)
      }
    } catch {
      setMensagem('❌ Erro ao salvar.')
      setTimeout(() => setMensagem(''), 3000)
    }
    setSalvando(false)
  }

  const ativar24h = async () => {
    const nova = { ...config, horaAbertura: 0, horaFechamento: 24 }
    setConfig(nova)
    setSalvando(true)
    await fetch('/api/configuracoes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(nova) })
    setMensagem('✅ Aberto 24 horas!')
    setTimeout(() => setMensagem(''), 3000)
    setSalvando(false)
  }

  const statusColor: Record<string, string> = {
    novo: '#f6ad55',
    em_preparo: '#63b3ed',
    saiu_entrega: '#9f7aea',
    entregue: '#68d391',
    cancelado: '#fc8181',
  }
  const statusLabel: Record<string, string> = {
    novo: 'Novo',
    em_preparo: 'Em preparo',
    saiu_entrega: 'Saiu p/ entrega',
    entregue: 'Entregue',
    cancelado: 'Cancelado',
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0a0a1a 0%, #1a1000 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#fff' }}>Carregando...</p>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0a0a1a 0%, #1a1000 100%)', padding: '24px 16px' }}>
      <div style={{ maxWidth: 600, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
          <div>
            <h1 style={{ color: '#ffd700', fontSize: 22, fontWeight: 800, margin: 0 }}>👑 Painel do Dono</h1>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, margin: '4px 0 0' }}>{config.nomePizzaria}</p>
          </div>
          <button onClick={() => router.push('/pedidos')} style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', fontSize: 13 }}>
            📋 Pedidos
          </button>
        </div>

        {/* Filtro período */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          {(['hoje', 'ontem', 'semana'] as Periodo[]).map(p => (
            <button key={p} onClick={() => setPeriodo(p)} style={{
              flex: 1, padding: '10px 0', borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13,
              background: periodo === p ? 'linear-gradient(135deg, #b7950b, #ffd700)' : 'rgba(255,255,255,0.07)',
              color: periodo === p ? '#000' : 'rgba(255,255,255,0.6)',
            }}>
              {p === 'hoje' ? 'Hoje' : p === 'ontem' ? 'Ontem' : 'Semana'}
            </button>
          ))}
        </div>

        {/* Métricas */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
          <div style={{ background: 'rgba(255,215,0,0.08)', border: '1px solid rgba(255,215,0,0.25)', borderRadius: 14, padding: 18 }}>
            <p style={{ color: 'rgba(255,215,0,0.6)', fontSize: 11, margin: '0 0 6px', fontWeight: 700, textTransform: 'uppercase' }}>💰 Faturamento</p>
            <p style={{ color: '#ffd700', fontSize: 22, fontWeight: 800, margin: 0 }}>R$ {faturamento.toFixed(2).replace('.', ',')}</p>
          </div>
          <div style={{ background: 'rgba(99,179,237,0.08)', border: '1px solid rgba(99,179,237,0.25)', borderRadius: 14, padding: 18 }}>
            <p style={{ color: 'rgba(99,179,237,0.6)', fontSize: 11, margin: '0 0 6px', fontWeight: 700, textTransform: 'uppercase' }}>📦 Pedidos</p>
            <p style={{ color: '#63b3ed', fontSize: 22, fontWeight: 800, margin: 0 }}>{pedidosFiltrados.length}</p>
          </div>
          <div style={{ background: 'rgba(159,122,234,0.08)', border: '1px solid rgba(159,122,234,0.25)', borderRadius: 14, padding: 18 }}>
            <p style={{ color: 'rgba(159,122,234,0.6)', fontSize: 11, margin: '0 0 6px', fontWeight: 700, textTransform: 'uppercase' }}>🎯 Ticket Médio</p>
            <p style={{ color: '#9f7aea', fontSize: 22, fontWeight: 800, margin: 0 }}>R$ {ticketMedio.toFixed(2).replace('.', ',')}</p>
          </div>
          <div style={{ background: 'rgba(104,211,145,0.08)', border: '1px solid rgba(104,211,145,0.25)', borderRadius: 14, padding: 18 }}>
            <p style={{ color: 'rgba(104,211,145,0.6)', fontSize: 11, margin: '0 0 6px', fontWeight: 700, textTransform: 'uppercase' }}>👥 Recorrentes</p>
            <p style={{ color: '#68d391', fontSize: 22, fontWeight: 800, margin: 0 }}>{recorrentes} <span style={{ fontSize: 12, fontWeight: 400 }}>clientes</span></p>
          </div>
        </div>

        {/* Lista de pedidos */}
        <div style={{ marginBottom: 28 }}>
          <h2 style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 700, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
            Pedidos — {periodo === 'hoje' ? 'Hoje' : periodo === 'ontem' ? 'Ontem' : 'Esta semana'}
          </h2>
          {pedidosFiltrados.length === 0 ? (
            <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 12, padding: 24, textAlign: 'center' }}>
              <p style={{ color: 'rgba(255,255,255,0.25)', margin: 0 }}>Nenhum pedido neste período.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[...pedidosFiltrados].reverse().map(p => (
                <div key={p.id} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <div>
                      <p style={{ color: '#fff', fontWeight: 700, margin: 0, fontSize: 14 }}>{p.cliente}</p>
                      <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, margin: '2px 0 0' }}>{p.horario} · {p.endereco}</p>
                    </div>
                    <span style={{ background: statusColor[p.status] + '22', color: statusColor[p.status], fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap', marginLeft: 8 }}>
                      {statusLabel[p.status] || p.status}
                    </span>
                  </div>
                  <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, margin: '0 0 6px' }}>{p.itens.join(', ')}</p>
                  {p.observacao && <p style={{ color: '#f6e05e', fontSize: 12, margin: '0 0 6px' }}>✏️ {p.observacao}</p>}
                  {p.cancelamentoSolicitado && <p style={{ color: '#fc8181', fontSize: 12, margin: '0 0 6px' }}>⚠️ Cancelamento solicitado</p>}
                  <p style={{ color: '#ffd700', fontWeight: 800, fontSize: 15, margin: 0 }}>R$ {(p.total || 0).toFixed(2).replace('.', ',')}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Configurações admin */}
        <div style={{ background: 'rgba(255,215,0,0.03)', border: '1px solid rgba(255,215,0,0.12)', borderRadius: 16, padding: 24, marginBottom: 24 }}>
          <h2 style={{ color: '#ffd700', fontSize: 14, fontWeight: 700, margin: '0 0 20px', display: 'flex', alignItems: 'center', gap: 8 }}>
            ⚙️ Configurações
            <span style={{ fontSize: 11, background: 'rgba(255,215,0,0.12)', padding: '2px 8px', borderRadius: 20, color: 'rgba(255,215,0,0.6)' }}>Somente Admin</span>
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>🍕 Nome da Pizzaria</label>
              <input type="text" value={config.nomePizzaria} onChange={e => setConfig(p => ({ ...p, nomePizzaria: e.target.value }))}
                style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '11px 14px', color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>💸 Chave Pix</label>
              <input type="text" placeholder="Ex: 11999999999 ou email@email.com" value={config.chavePix} onChange={e => setConfig(p => ({ ...p, chavePix: e.target.value }))}
                style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,215,0,0.2)', borderRadius: 10, padding: '11px 14px', color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
              <p style={{ color: 'rgba(255,215,0,0.35)', fontSize: 11, margin: '5px 0 0' }}>Aparece no WhatsApp quando cliente escolher Pix.</p>
            </div>
            <div>
              <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>⏰ Horário de Funcionamento</label>
              <button onClick={ativar24h} disabled={salvando} style={{
                width: '100%', background: is24h ? 'linear-gradient(135deg, #38a169, #276749)' : 'rgba(255,255,255,0.06)',
                border: is24h ? '2px solid #38a169' : '2px solid rgba(255,255,255,0.1)', borderRadius: 10,
                padding: '11px 14px', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', marginBottom: 10,
              }}>
                {is24h ? '✅ Aberto 24 horas (ativo)' : '🕐 Ativar 24 horas'}
              </button>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, display: 'block', marginBottom: 4 }}>Abre às</label>
                  <input type="number" min={0} max={23} value={config.horaAbertura} onChange={e => setConfig(p => ({ ...p, horaAbertura: Number(e.target.value) }))}
                    style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '11px 14px', color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
                </div>
                <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 18, paddingTop: 18 }}>→</span>
                <div style={{ flex: 1 }}>
                  <label style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, display: 'block', marginBottom: 4 }}>Fecha às</label>
                  <input type="number" min={0} max={24} value={config.horaFechamento} onChange={e => setConfig(p => ({ ...p, horaFechamento: Number(e.target.value) }))}
                    style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '11px 14px', color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
                </div>
              </div>
            </div>
            <button onClick={salvarConfig} disabled={salvando} style={{
              background: salvando ? 'rgba(255,255,255,0.1)' : 'linear-gradient(135deg, #b7950b, #ffd700)',
              border: 'none', borderRadius: 12, padding: '14px 0',
              color: salvando ? '#fff' : '#000', fontSize: 15, fontWeight: 800,
              cursor: salvando ? 'not-allowed' : 'pointer',
              boxShadow: salvando ? 'none' : '0 4px 15px rgba(255,215,0,0.25)',
            }}>
              {salvando ? 'Salvando...' : '💾 Salvar Configurações'}
            </button>
            {mensagem && <p style={{ textAlign: 'center', color: mensagem.includes('✅') ? '#68d391' : '#fc8181', fontWeight: 600, margin: 0 }}>{mensagem}</p>}
          </div>
        </div>

        <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.15)', fontSize: 11, marginTop: 8 }}>
          ChefeBot · Painel Admin
        </p>
      </div>
    </div>
  )
}