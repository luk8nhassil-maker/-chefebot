'use client'

import { useEffect, useState } from 'react'
import PanelShell from '@/components/PanelShell'

type ConfigJornada = {
  ativo: boolean
  metaPizzas: number
  limitePizzasPorPedido: number
  validadeRecompensaDias: number
  mensagensWhatsappAtivas: boolean
  sequenciaRecompensas: { tipo: string; produtoId: string; produtoNome: string; ativo: boolean }[]
}

type RecompensaAdmin = {
  recompensaId: string
  ciclo: number
  status: string
  tipo: string | null
  produtoNome: string | null
  codigoPublico?: string
  pedidoOrigemId: string
  reservaPedidoId?: string
  criadaEm: string
  abertaEm?: string
  validaAte?: string
  resgatadaEm?: string
  motivoSuspensao?: string
}

type ProgressoAdmin = {
  ativo: boolean
  metaPizzas: number
  cicloAtual: number
  pizzasNoCiclo: number
  faseAtual: number
  totalJornadasConcluidas: number
  recompensas: RecompensaAdmin[]
}

type Pendencia = {
  pendenciaId: string
  clienteId: string
  pedidoId?: string
  recompensaId?: string
  tipo: string
  motivo: string
  criadaEm: string
}

const cardStyle: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18 }
const inputStyle: React.CSSProperties = { padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', fontSize: 14, fontFamily: 'Archivo, sans-serif' }
const botaoPrimario: React.CSSProperties = { padding: '10px 16px', borderRadius: 10, background: 'var(--primary)', color: 'var(--primary-foreground)', fontWeight: 700, fontSize: 13, border: 'none', cursor: 'pointer', fontFamily: 'Archivo, sans-serif' }
const botaoSecundario: React.CSSProperties = { ...botaoPrimario, background: 'transparent', color: 'var(--foreground-secondary)', border: '1px solid var(--border)' }
const titulo: React.CSSProperties = { fontSize: 15, fontWeight: 800, margin: '0 0 12px' }
const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4, display: 'block' }

export default function AdminJornadaChefPage() {
  const [config, setConfig] = useState<ConfigJornada | null>(null)
  const [salvandoConfig, setSalvandoConfig] = useState(false)
  const [telefone, setTelefone] = useState('')
  const [progresso, setProgresso] = useState<ProgressoAdmin | null>(null)
  const [buscaErro, setBuscaErro] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [codigoManual, setCodigoManual] = useState('')
  const [msgAcao, setMsgAcao] = useState('')
  const [pendencias, setPendencias] = useState<Pendencia[]>([])

  async function carregarConfig() {
    const res = await fetch('/api/jornada-chef/config', { cache: 'no-store' })
    if (res.ok) setConfig(await res.json())
  }

  async function carregarPendencias() {
    const res = await fetch('/api/admin/jornada-chef/pendencias', { cache: 'no-store' })
    if (res.ok) setPendencias((await res.json()).pendencias ?? [])
  }

  useEffect(() => { carregarConfig(); carregarPendencias() }, [])

  async function salvarConfig() {
    if (!config) return
    setSalvandoConfig(true)
    try {
      const res = await fetch('/api/jornada-chef/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.config) setConfig(data.config)
    } catch {}
    setSalvandoConfig(false)
  }

  async function buscarCliente() {
    setBuscaErro('')
    setBuscando(true)
    setProgresso(null)
    try {
      const res = await fetch(`/api/admin/jornada-chef?telefone=${encodeURIComponent(telefone)}`, { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) { setBuscaErro(data.error || 'Não foi possível buscar este cliente'); setBuscando(false); return }
      setProgresso(data)
    } catch {
      setBuscaErro('Erro de conexão')
    }
    setBuscando(false)
  }

  async function acaoManual(body: Record<string, unknown>) {
    setMsgAcao('')
    try {
      const res = await fetch('/api/admin/jornada-chef/resgate-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      setMsgAcao(res.ok ? 'Ação aplicada com sucesso.' : data.error || 'Não foi possível aplicar')
      if (res.ok && telefone) await buscarCliente()
    } catch {
      setMsgAcao('Erro de conexão')
    }
  }

  async function resolverPendencia(pendenciaId: string) {
    await fetch('/api/admin/jornada-chef/pendencias', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pendenciaId, nota: 'Revisado no painel' }),
    })
    carregarPendencias()
  }

  return (
    <PanelShell showGestaoNav>
      <div style={{ padding: 20, maxWidth: 1400, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <h1 style={{ fontSize: 19, fontWeight: 800, margin: 0 }}>Jornada do Chef</h1>

        {/* Configuração / feature flag */}
        <div style={cardStyle}>
          <p style={titulo}>Configuração</p>
          {!config && <p style={{ fontSize: 13, color: 'var(--foreground-secondary)' }}>Carregando...</p>}
          {config && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700 }}>
                <input type="checkbox" checked={config.ativo} onChange={(e) => setConfig({ ...config, ativo: e.target.checked })} />
                Jornada do Chef ativa
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                <div>
                  <span style={label}>Meta (pizzas)</span>
                  <input type="number" style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} value={config.metaPizzas} onChange={(e) => setConfig({ ...config, metaPizzas: Number(e.target.value) })} />
                </div>
                <div>
                  <span style={label}>Limite por pedido</span>
                  <input type="number" style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} value={config.limitePizzasPorPedido} onChange={(e) => setConfig({ ...config, limitePizzasPorPedido: Number(e.target.value) })} />
                </div>
                <div>
                  <span style={label}>Validade do presente (dias)</span>
                  <input type="number" style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} value={config.validadeRecompensaDias} onChange={(e) => setConfig({ ...config, validadeRecompensaDias: Number(e.target.value) })} />
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <input type="checkbox" checked={config.mensagensWhatsappAtivas} onChange={(e) => setConfig({ ...config, mensagensWhatsappAtivas: e.target.checked })} />
                Enviar mensagens de progresso pelo WhatsApp
              </label>
              <p style={{ fontSize: 12, color: 'var(--foreground-muted)', margin: 0 }}>
                {config.sequenciaRecompensas.length === 0
                  ? 'Nenhum produto elegível configurado ainda — caixas ficarão fechadas até definir os produtos que podem ser presente.'
                  : `${config.sequenciaRecompensas.length} produto(s) configurado(s) na sequência de presentes.`}
              </p>
              <button onClick={salvarConfig} disabled={salvandoConfig} style={{ ...botaoPrimario, width: 'fit-content', opacity: salvandoConfig ? 0.6 : 1 }}>
                {salvandoConfig ? 'Salvando...' : 'Salvar configuração'}
              </button>
            </div>
          )}
        </div>

        {/* Pendências de revisão */}
        <div style={cardStyle}>
          <p style={titulo}>Pendências de revisão ({pendencias.length})</p>
          {pendencias.length === 0 && <p style={{ fontSize: 13, color: 'var(--foreground-secondary)' }}>Nenhuma pendência no momento.</p>}
          {pendencias.map((p) => (
            <div key={p.pendenciaId} style={{ borderTop: '1px solid var(--border)', padding: '10px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{p.tipo}</div>
                <div style={{ fontSize: 12.5, color: 'var(--foreground-secondary)' }}>{p.motivo}</div>
              </div>
              <button onClick={() => resolverPendencia(p.pendenciaId)} style={botaoSecundario}>Marcar como revisado</button>
            </div>
          ))}
        </div>

        {/* Busca por cliente + resgate manual */}
        <div style={cardStyle}>
          <p style={titulo}>Consultar cliente</p>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <input placeholder="Telefone do cliente" value={telefone} onChange={(e) => setTelefone(e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: 200 }} />
            <button onClick={buscarCliente} disabled={buscando} style={{ ...botaoPrimario, opacity: buscando ? 0.6 : 1 }}>{buscando ? 'Buscando...' : 'Buscar'}</button>
          </div>
          {buscaErro && <p style={{ color: 'var(--danger-text)', fontSize: 13 }}>{buscaErro}</p>}

          {progresso && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 13 }}>
                <span><strong>Ciclo:</strong> {progresso.cicloAtual}</span>
                <span><strong>Pizzas na trilha:</strong> {progresso.pizzasNoCiclo} de {progresso.metaPizzas}</span>
                <span><strong>Fase:</strong> {progresso.faseAtual}</span>
                <span><strong>Jornadas concluídas:</strong> {progresso.totalJornadasConcluidas}</span>
              </div>

              <div>
                <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--foreground-muted)', textTransform: 'uppercase', margin: '0 0 8px' }}>Recompensas</p>
                {progresso.recompensas.length === 0 && <p style={{ fontSize: 13, color: 'var(--foreground-secondary)' }}>Nenhuma recompensa ainda.</p>}
                {progresso.recompensas.map((r) => (
                  <div key={r.recompensaId} style={{ borderTop: '1px solid var(--border)', padding: '10px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>Ciclo {r.ciclo} · {r.status}{r.produtoNome ? ` · ${r.produtoNome}` : ''}</div>
                      <div style={{ fontSize: 12, color: 'var(--foreground-muted)' }}>
                        {r.codigoPublico ? `Código: ${r.codigoPublico}` : 'Sem código ativo'}
                        {r.validaAte ? ` · válido até ${new Date(r.validaAte).toLocaleDateString('pt-BR')}` : ''}
                        {r.motivoSuspensao ? ` · ${r.motivoSuspensao}` : ''}
                      </div>
                    </div>
                    {r.codigoPublico && (r.status === 'disponivel' || r.status === 'reservada') && (
                      <button onClick={() => acaoManual({ acao: 'revogar_codigo', recompensaId: r.recompensaId })} style={botaoSecundario}>Revogar código</button>
                    )}
                  </div>
                ))}
              </div>

              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <input placeholder="Código de resgate (JC-XXXXXXXXXX)" value={codigoManual} onChange={(e) => setCodigoManual(e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: 200 }} />
                <button onClick={() => acaoManual({ acao: 'aplicar', codigoPublico: codigoManual })} style={botaoPrimario}>Aplicar resgate manual</button>
              </div>
              {msgAcao && <p style={{ fontSize: 13, color: 'var(--foreground-secondary)' }}>{msgAcao}</p>}
            </div>
          )}
        </div>
      </div>
    </PanelShell>
  )
}
