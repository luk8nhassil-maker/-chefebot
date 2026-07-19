'use client'

import { useEffect, useMemo, useState } from 'react'
import PanelShell from '@/components/PanelShell'

type TipoRecompensa = 'bebida_sobremesa' | 'pizza' | 'presente_especial'
type CategoriaItem = 'bebida' | 'suco' | 'lanche' | 'macarronada'

type ItemCatalogo = { produtoId: string; produtoNome: string; categoria: CategoriaItem; esgotado: boolean; preco: number }
type Catalogo = {
  sizes: { code: string; label?: string; price: number }[]
  saltyFlavors: string[]
  sweetFlavors: string[]
  itensIndividuais: ItemCatalogo[]
}

type ItemComposicao = { item: { produtoId: string; produtoNome: string; categoria: CategoriaItem }; quantidade: number }

type RecompensaConfig = {
  id: string
  tipo: TipoRecompensa
  ativo: boolean
  produtoNome: string
  item?: { produtoId: string; produtoNome: string; categoria: CategoriaItem }
  pizza?: { tamanho: string; sabores: string[] }
  composicao?: ItemComposicao[]
}

type ModoRollout = 'off' | 'canary' | 'on'

type ConfigJornada = {
  modoRollout: ModoRollout
  metaPizzas: number
  limitePizzasPorPedido: number
  validadeRecompensaDias: number
  mensagensWhatsappAtivas: boolean
  canaryCount: number
  sequenciaRecompensas: RecompensaConfig[]
}

type RecompensaAdmin = {
  recompensaId: string
  ciclo: number
  status: string
  tipo: string | null
  produtoNome: string | null
  codigoMascarado?: string
  pedidoOrigemId: string
  reservaPedidoId?: string
  criadaEm: string
  abertaEm?: string
  validaAte?: string
  resgatadaEm?: string
  motivoSuspensao?: string
  valorReferencia?: number
}

type ProgressoAdmin = {
  modoRollout: ModoRollout
  ativoParaEsteCliente: boolean
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
const botaoIcone: React.CSSProperties = { ...botaoSecundario, padding: '6px 10px', fontSize: 12 }
const titulo: React.CSSProperties = { fontSize: 15, fontWeight: 800, margin: '0 0 12px' }
const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--foreground-muted)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4, display: 'block' }

function gerarIdLocal(): string {
  // Zero Math.random em toda a Jornada do Chef — mesmo aqui, onde é só um id
  // local de UI (nunca decide prêmio), usamos crypto.randomUUID().
  return `cfg_${crypto.randomUUID()}`
}

function resumoLocal(r: RecompensaConfig): string {
  if (r.tipo === 'bebida_sobremesa') return r.item?.produtoNome ?? '(produto não selecionado)'
  if (r.tipo === 'pizza') return r.pizza ? `Pizza ${r.pizza.tamanho} — ${r.pizza.sabores.join(' / ') || '(sem sabor)'}` : '(pizza não configurada)'
  if (r.tipo === 'presente_especial') {
    if (!r.composicao || r.composicao.length === 0) return '(composição vazia)'
    return r.composicao.map((c) => (c.quantidade > 1 ? `${c.quantidade}x ${c.item.produtoNome}` : c.item.produtoNome)).join(' + ')
  }
  return '(tipo desconhecido)'
}

export default function AdminJornadaChefPage() {
  const [config, setConfig] = useState<ConfigJornada | null>(null)
  const [salvandoConfig, setSalvandoConfig] = useState(false)
  const [erroConfig, setErroConfig] = useState('')
  const [detalhesErro, setDetalhesErro] = useState<{ indice: number; mensagens: string[] }[]>([])
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null)

  const [telefone, setTelefone] = useState('')
  const [progresso, setProgresso] = useState<ProgressoAdmin | null>(null)
  const [buscaErro, setBuscaErro] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [codigoManual, setCodigoManual] = useState('')
  const [msgAcao, setMsgAcao] = useState('')
  const [pendencias, setPendencias] = useState<Pendencia[]>([])

  const [clientesCanario, setClientesCanario] = useState<{ idPublico: string; labelMascarado: string }[]>([])
  const [telefoneCanario, setTelefoneCanario] = useState('')
  const [erroCanario, setErroCanario] = useState('')
  const [salvandoCanario, setSalvandoCanario] = useState(false)

  // Formulário de nova recompensa
  const [novoTipo, setNovoTipo] = useState<TipoRecompensa>('bebida_sobremesa')
  const [novoItemId, setNovoItemId] = useState('')
  const [novoTamanho, setNovoTamanho] = useState('')
  const [novosSabores, setNovosSabores] = useState<string[]>([])
  const [composicaoRascunho, setComposicaoRascunho] = useState<ItemComposicao[]>([])
  const [composicaoItemId, setComposicaoItemId] = useState('')
  const [composicaoQty, setComposicaoQty] = useState(1)

  // Formulário de substituição estruturada de uma recompensa (rule 8) — nunca
  // aceita produtoId/produtoNome livres, sempre um produto real do catálogo.
  const [substituindoId, setSubstituindoId] = useState<string | null>(null)
  const [substTipo, setSubstTipo] = useState<TipoRecompensa>('bebida_sobremesa')
  const [substItemId, setSubstItemId] = useState('')
  const [substTamanho, setSubstTamanho] = useState('')
  const [substSabores, setSubstSabores] = useState<string[]>([])
  const [substComposicao, setSubstComposicao] = useState<ItemComposicao[]>([])
  const [substComposicaoItemId, setSubstComposicaoItemId] = useState('')
  const [substComposicaoQty, setSubstComposicaoQty] = useState(1)
  const [substMotivo, setSubstMotivo] = useState('')
  const [substErro, setSubstErro] = useState('')
  const [substSalvando, setSubstSalvando] = useState(false)

  async function carregarConfig() {
    const res = await fetch('/api/jornada-chef/config', { cache: 'no-store' })
    if (res.ok) setConfig(await res.json())
  }

  async function carregarCatalogo() {
    const res = await fetch('/api/admin/jornada-chef/catalogo', { cache: 'no-store' })
    if (res.ok) setCatalogo(await res.json())
  }

  async function carregarPendencias() {
    const res = await fetch('/api/admin/jornada-chef/pendencias', { cache: 'no-store' })
    if (res.ok) setPendencias((await res.json()).pendencias ?? [])
  }

  async function carregarCanario() {
    const res = await fetch('/api/admin/jornada-chef/canario', { cache: 'no-store' })
    if (res.ok) setClientesCanario((await res.json()).clientes ?? [])
  }

  useEffect(() => { carregarConfig(); carregarCatalogo(); carregarPendencias(); carregarCanario() }, [])

  async function adicionarCanario() {
    setErroCanario('')
    setSalvandoCanario(true)
    try {
      const res = await fetch('/api/admin/jornada-chef/canario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefone: telefoneCanario }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok) {
        setTelefoneCanario('')
        await carregarCanario()
      } else {
        setErroCanario(data?.error || 'Não foi possível adicionar este cliente.')
      }
    } catch {
      setErroCanario('Erro de conexão.')
    }
    setSalvandoCanario(false)
  }

  async function removerCanario(idPublico: string) {
    await fetch(`/api/admin/jornada-chef/canario?idPublico=${encodeURIComponent(idPublico)}`, { method: 'DELETE' })
    carregarCanario()
  }

  const itensDisponiveis = useMemo(() => (catalogo?.itensIndividuais ?? []).filter((i) => !i.esgotado), [catalogo])
  const todosSabores = useMemo(() => [...(catalogo?.saltyFlavors ?? []), ...(catalogo?.sweetFlavors ?? [])], [catalogo])

  function limparFormularioNovaRecompensa() {
    setNovoItemId('')
    setNovoTamanho('')
    setNovosSabores([])
    setComposicaoRascunho([])
    setComposicaoItemId('')
    setComposicaoQty(1)
  }

  function adicionarItemComposicao() {
    const item = itensDisponiveis.find((i) => i.produtoId === composicaoItemId)
    if (!item) return
    setComposicaoRascunho((atual) => [...atual, { item: { produtoId: item.produtoId, produtoNome: item.produtoNome, categoria: item.categoria }, quantidade: Math.max(1, composicaoQty) }])
    setComposicaoItemId('')
    setComposicaoQty(1)
  }

  function adicionarRecompensa() {
    if (!config) return
    let nova: RecompensaConfig
    if (novoTipo === 'bebida_sobremesa') {
      const item = itensDisponiveis.find((i) => i.produtoId === novoItemId)
      if (!item) return
      nova = { id: gerarIdLocal(), tipo: 'bebida_sobremesa', ativo: true, produtoNome: '', item: { produtoId: item.produtoId, produtoNome: item.produtoNome, categoria: item.categoria } }
    } else if (novoTipo === 'pizza') {
      if (!novoTamanho || novosSabores.length === 0) return
      nova = { id: gerarIdLocal(), tipo: 'pizza', ativo: true, produtoNome: '', pizza: { tamanho: novoTamanho, sabores: novosSabores } }
    } else {
      if (composicaoRascunho.length === 0) return
      nova = { id: gerarIdLocal(), tipo: 'presente_especial', ativo: true, produtoNome: '', composicao: composicaoRascunho }
    }
    nova.produtoNome = resumoLocal(nova)
    setConfig({ ...config, sequenciaRecompensas: [...config.sequenciaRecompensas, nova] })
    limparFormularioNovaRecompensa()
  }

  function removerRecompensa(id: string) {
    if (!config) return
    setConfig({ ...config, sequenciaRecompensas: config.sequenciaRecompensas.filter((r) => r.id !== id) })
  }

  function alternarAtivoRecompensa(id: string) {
    if (!config) return
    setConfig({ ...config, sequenciaRecompensas: config.sequenciaRecompensas.map((r) => (r.id === id ? { ...r, ativo: !r.ativo } : r)) })
  }

  function moverRecompensa(id: string, direcao: -1 | 1) {
    if (!config) return
    const lista = [...config.sequenciaRecompensas]
    const indice = lista.findIndex((r) => r.id === id)
    const novoIndice = indice + direcao
    if (indice === -1 || novoIndice < 0 || novoIndice >= lista.length) return
    ;[lista[indice], lista[novoIndice]] = [lista[novoIndice], lista[indice]]
    setConfig({ ...config, sequenciaRecompensas: lista })
  }

  async function salvarConfig() {
    if (!config) return
    setSalvandoConfig(true)
    setErroConfig('')
    setDetalhesErro([])
    try {
      const res = await fetch('/api/jornada-chef/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.config) {
        setConfig(data.config)
      } else {
        setErroConfig(data?.error || 'Não foi possível salvar a configuração.')
        setDetalhesErro(Array.isArray(data?.detalhes) ? data.detalhes : [])
      }
    } catch {
      setErroConfig('Erro de conexão.')
    }
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

  function iniciarSubstituicao(r: RecompensaAdmin) {
    setSubstituindoId(r.recompensaId)
    setSubstTipo((r.tipo as TipoRecompensa) || 'bebida_sobremesa')
    setSubstItemId('')
    setSubstTamanho('')
    setSubstSabores([])
    setSubstComposicao([])
    setSubstComposicaoItemId('')
    setSubstComposicaoQty(1)
    setSubstMotivo('')
    setSubstErro('')
  }

  function cancelarSubstituicao() {
    setSubstituindoId(null)
    setSubstErro('')
  }

  function adicionarItemComposicaoSubstituicao() {
    const item = itensDisponiveis.find((i) => i.produtoId === substComposicaoItemId)
    if (!item) return
    setSubstComposicao((atual) => [...atual, { item: { produtoId: item.produtoId, produtoNome: item.produtoNome, categoria: item.categoria }, quantidade: Math.max(1, substComposicaoQty) }])
    setSubstComposicaoItemId('')
    setSubstComposicaoQty(1)
  }

  // Estimativa só para exibição no painel — o valor que realmente vale é
  // sempre recalculado no servidor a partir do catálogo real (rule 9); esta
  // conta local nunca é enviada nem é a fonte de verdade da comparação.
  function previaValorNovo(): number | null {
    if (!catalogo) return null
    if (substTipo === 'bebida_sobremesa') {
      const item = catalogo.itensIndividuais.find((i) => i.produtoId === substItemId)
      return item?.preco ?? null
    }
    if (substTipo === 'pizza') {
      const size = catalogo.sizes.find((s) => s.code === substTamanho)
      return size?.price ?? null
    }
    if (substTipo === 'presente_especial') {
      return substComposicao.reduce((soma, c) => {
        const item = catalogo.itensIndividuais.find((i) => i.produtoId === c.item.produtoId)
        return soma + (item?.preco ?? 0) * c.quantidade
      }, 0)
    }
    return null
  }

  async function confirmarSubstituicao(recompensaId: string) {
    setSubstErro('')
    if (!substMotivo.trim()) { setSubstErro('Informe o motivo da substituição.'); return }
    let novaEspecificacao: Record<string, unknown> | null = null
    if (substTipo === 'bebida_sobremesa') {
      const item = itensDisponiveis.find((i) => i.produtoId === substItemId)
      if (!item) { setSubstErro('Selecione um produto.'); return }
      novaEspecificacao = { tipo: substTipo, item: { produtoId: item.produtoId, produtoNome: item.produtoNome, categoria: item.categoria } }
    } else if (substTipo === 'pizza') {
      if (!substTamanho || substSabores.length === 0) { setSubstErro('Selecione tamanho e ao menos um sabor.'); return }
      novaEspecificacao = { tipo: substTipo, pizza: { tamanho: substTamanho, sabores: substSabores } }
    } else {
      if (substComposicao.length === 0) { setSubstErro('Adicione ao menos um item à composição.'); return }
      novaEspecificacao = { tipo: substTipo, composicao: substComposicao }
    }

    setSubstSalvando(true)
    try {
      const res = await fetch('/api/admin/jornada-chef/resgate-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'substituir', recompensaId, novaEspecificacao, motivo: substMotivo.trim() }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok) {
        setSubstituindoId(null)
        if (telefone) await buscarCliente()
      } else {
        setSubstErro(data?.error || 'Não foi possível substituir.')
      }
    } catch {
      setSubstErro('Erro de conexão.')
    }
    setSubstSalvando(false)
  }

  async function resolverPendencia(pendenciaId: string) {
    await fetch('/api/admin/jornada-chef/pendencias', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pendenciaId, nota: 'Revisado no painel' }),
    })
    carregarPendencias()
  }

  const sequenciaAtiva = (config?.sequenciaRecompensas ?? []).filter((r) => r.ativo)

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
              <div>
                <span style={label}>Modo de rollout</span>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {([
                    { valor: 'off' as ModoRollout, texto: 'Desligada' },
                    { valor: 'canary' as ModoRollout, texto: `Canário (${config.canaryCount} cliente${config.canaryCount === 1 ? '' : 's'})` },
                    { valor: 'on' as ModoRollout, texto: 'Ligada para todos' },
                  ]).map((opcao) => (
                    <button
                      key={opcao.valor}
                      onClick={() => setConfig({ ...config, modoRollout: opcao.valor })}
                      style={config.modoRollout === opcao.valor ? botaoPrimario : botaoSecundario}
                    >
                      {opcao.texto}
                    </button>
                  ))}
                </div>
                <p style={{ fontSize: 11.5, color: 'var(--foreground-muted)', margin: '6px 0 0' }}>
                  No modo canário, só os clientes da lista abaixo veem a Jornada, acumulam progresso e recebem mensagens — os demais continuam como se a feature estivesse desligada.
                </p>
              </div>
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

              {erroConfig && (
                <div style={{ background: 'color-mix(in srgb, var(--danger) 10%, transparent)', borderRadius: 10, padding: '10px 12px' }}>
                  <p style={{ color: 'var(--danger-text)', fontSize: 13, fontWeight: 700, margin: 0 }}>{erroConfig}</p>
                  {detalhesErro.map((d) => (
                    <p key={d.indice} style={{ color: 'var(--danger-text)', fontSize: 12.5, margin: '4px 0 0' }}>
                      Item {d.indice + 1}: {d.mensagens.join(' ')}
                    </p>
                  ))}
                </div>
              )}

              <button onClick={salvarConfig} disabled={salvandoConfig} style={{ ...botaoPrimario, width: 'fit-content', opacity: salvandoConfig ? 0.6 : 1 }}>
                {salvandoConfig ? 'Salvando...' : 'Salvar configuração'}
              </button>
            </div>
          )}
        </div>

        {/* Clientes canário */}
        <div style={cardStyle}>
          <p style={titulo}>Clientes canário</p>
          <p style={{ fontSize: 12.5, color: 'var(--foreground-muted)', margin: '0 0 12px' }}>
            Só precisa disso enquanto o modo de rollout estiver em &quot;Canário&quot;. O telefone nunca fica salvo — só um identificador interno derivado dele.
          </p>
          <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <input placeholder="Telefone do cliente de teste" value={telefoneCanario} onChange={(e) => setTelefoneCanario(e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: 200 }} />
            <button onClick={adicionarCanario} disabled={salvandoCanario || !telefoneCanario.trim()} style={{ ...botaoPrimario, opacity: salvandoCanario || !telefoneCanario.trim() ? 0.6 : 1 }}>
              {salvandoCanario ? 'Adicionando...' : 'Adicionar'}
            </button>
          </div>
          {erroCanario && <p style={{ color: 'var(--danger-text)', fontSize: 13 }}>{erroCanario}</p>}
          {clientesCanario.length === 0 && <p style={{ fontSize: 13, color: 'var(--foreground-secondary)' }}>Nenhum cliente canário configurado.</p>}
          {clientesCanario.map((c) => (
            <div key={c.idPublico} style={{ borderTop: '1px solid var(--border)', padding: '8px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontFamily: 'monospace' }}>{c.labelMascarado}</span>
              <button onClick={() => removerCanario(c.idPublico)} style={botaoIcone}>Remover</button>
            </div>
          ))}
        </div>

        {/* Sequência de presentes */}
        <div style={cardStyle}>
          <p style={titulo}>Sequência de presentes</p>
          {!catalogo && <p style={{ fontSize: 13, color: 'var(--foreground-secondary)' }}>Carregando cardápio...</p>}
          {config && catalogo && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <p style={{ fontSize: 12.5, color: 'var(--foreground-muted)', margin: 0 }}>
                {config.sequenciaRecompensas.length === 0
                  ? 'Nenhum presente configurado ainda — a Jornada do Chef não pode ser ativada sem ao menos um presente ativo.'
                  : 'A ordem abaixo é a ordem determinística dos ciclos (ciclo 1 → primeiro presente ativo, ciclo 2 → segundo, e assim por diante, repetindo).'}
              </p>

              {config.sequenciaRecompensas.map((r, i) => (
                <div key={r.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>
                      {r.ativo
                        ? `Ciclo ${sequenciaAtiva.findIndex((s) => s.id === r.id) + 1} (e múltiplos de ${sequenciaAtiva.length}) · `
                        : '(inativo) · '}
                      {r.tipo === 'bebida_sobremesa' ? 'Bebida/item individual' : r.tipo === 'pizza' ? 'Pizza' : 'Presente especial'}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--foreground-secondary)' }}>{resumoLocal(r)}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button onClick={() => moverRecompensa(r.id, -1)} disabled={i === 0} style={{ ...botaoIcone, opacity: i === 0 ? 0.4 : 1 }} aria-label="Mover para cima">↑</button>
                    <button onClick={() => moverRecompensa(r.id, 1)} disabled={i === config.sequenciaRecompensas.length - 1} style={{ ...botaoIcone, opacity: i === config.sequenciaRecompensas.length - 1 ? 0.4 : 1 }} aria-label="Mover para baixo">↓</button>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <input type="checkbox" checked={r.ativo} onChange={() => alternarAtivoRecompensa(r.id)} /> Ativo
                    </label>
                    <button onClick={() => removerRecompensa(r.id)} style={botaoIcone}>Remover</button>
                  </div>
                </div>
              ))}

              {/* Formulário de nova recompensa */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--foreground-muted)', textTransform: 'uppercase', margin: '0 0 10px' }}>Adicionar presente</p>
                <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                  {(['bebida_sobremesa', 'pizza', 'presente_especial'] as TipoRecompensa[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => { setNovoTipo(t); limparFormularioNovaRecompensa() }}
                      style={{ ...(novoTipo === t ? botaoPrimario : botaoSecundario), padding: '8px 14px' }}
                    >
                      {t === 'bebida_sobremesa' ? 'Bebida/item individual' : t === 'pizza' ? 'Pizza' : 'Presente especial'}
                    </button>
                  ))}
                </div>

                {novoTipo === 'bebida_sobremesa' && (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <select value={novoItemId} onChange={(e) => setNovoItemId(e.target.value)} style={{ ...inputStyle, minWidth: 240 }}>
                      <option value="">Selecione um produto...</option>
                      {itensDisponiveis.map((i) => (
                        <option key={i.produtoId} value={i.produtoId}>{i.produtoNome} ({i.categoria})</option>
                      ))}
                    </select>
                    <button onClick={adicionarRecompensa} disabled={!novoItemId} style={{ ...botaoPrimario, opacity: !novoItemId ? 0.6 : 1 }}>Adicionar</button>
                  </div>
                )}

                {novoTipo === 'pizza' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={label}>Tamanho</span>
                      <select value={novoTamanho} onChange={(e) => setNovoTamanho(e.target.value)} style={inputStyle}>
                        <option value="">Selecione...</option>
                        {catalogo.sizes.map((s) => (
                          <option key={s.code} value={s.code}>{s.label ? `${s.label} (${s.code})` : s.code}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <span style={label}>Sabores permitidos</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxWidth: 640 }}>
                        {todosSabores.map((s) => (
                          <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, border: '1px solid var(--border)', borderRadius: 8, padding: '4px 8px' }}>
                            <input
                              type="checkbox"
                              checked={novosSabores.includes(s)}
                              onChange={(e) => setNovosSabores((atual) => (e.target.checked ? [...atual, s] : atual.filter((x) => x !== s)))}
                            />
                            {s}
                          </label>
                        ))}
                      </div>
                    </div>
                    <button onClick={adicionarRecompensa} disabled={!novoTamanho || novosSabores.length === 0} style={{ ...botaoPrimario, width: 'fit-content', opacity: !novoTamanho || novosSabores.length === 0 ? 0.6 : 1 }}>
                      Adicionar
                    </button>
                    <p style={{ fontSize: 11.5, color: 'var(--foreground-muted)', margin: 0 }}>Borda e adicionais não estão incluídos no presente.</p>
                  </div>
                )}

                {novoTipo === 'presente_especial' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <select value={composicaoItemId} onChange={(e) => setComposicaoItemId(e.target.value)} style={{ ...inputStyle, minWidth: 220 }}>
                        <option value="">Selecione um item...</option>
                        {itensDisponiveis.map((i) => (
                          <option key={i.produtoId} value={i.produtoId}>{i.produtoNome} ({i.categoria})</option>
                        ))}
                      </select>
                      <input type="number" min={1} value={composicaoQty} onChange={(e) => setComposicaoQty(Math.max(1, Number(e.target.value)))} style={{ ...inputStyle, width: 70 }} />
                      <button onClick={adicionarItemComposicao} disabled={!composicaoItemId} style={{ ...botaoSecundario, opacity: !composicaoItemId ? 0.6 : 1 }}>+ Item</button>
                    </div>
                    {composicaoRascunho.length > 0 && (
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                        {composicaoRascunho.map((c, idx) => (
                          <li key={idx}>{c.quantidade}x {c.item.produtoNome}</li>
                        ))}
                      </ul>
                    )}
                    <button onClick={adicionarRecompensa} disabled={composicaoRascunho.length === 0} style={{ ...botaoPrimario, width: 'fit-content', opacity: composicaoRascunho.length === 0 ? 0.6 : 1 }}>
                      Adicionar presente especial
                    </button>
                  </div>
                )}
              </div>
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
              <p style={{ fontSize: 12.5, margin: 0, color: progresso.ativoParaEsteCliente ? 'var(--success-text)' : 'var(--foreground-muted)' }}>
                {progresso.ativoParaEsteCliente ? '✓ Este cliente participa da Jornada agora' : `Este cliente NÃO participa agora (rollout: ${progresso.modoRollout})`}
              </p>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 13 }}>
                <span><strong>Ciclo:</strong> {progresso.cicloAtual}</span>
                <span><strong>Pizzas na trilha:</strong> {progresso.pizzasNoCiclo} de {progresso.metaPizzas}</span>
                <span><strong>Fase:</strong> {progresso.faseAtual}</span>
                <span><strong>Jornadas concluídas:</strong> {progresso.totalJornadasConcluidas}</span>
              </div>

              <div>
                <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--foreground-muted)', textTransform: 'uppercase', margin: '0 0 8px' }}>Recompensas</p>
                {progresso.recompensas.length === 0 && <p style={{ fontSize: 13, color: 'var(--foreground-secondary)' }}>Nenhuma recompensa ainda.</p>}
                {progresso.recompensas.map((r) => {
                  const elegivelParaSubstituir = !['resgatada', 'cancelada', 'expirada'].includes(r.status)
                  return (
                    <div key={r.recompensaId} style={{ borderTop: '1px solid var(--border)', padding: '10px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700 }}>Ciclo {r.ciclo} · {r.status}{r.produtoNome ? ` · ${r.produtoNome}` : ''}</div>
                          <div style={{ fontSize: 12, color: 'var(--foreground-muted)' }}>
                            {r.codigoMascarado ? `Código: ${r.codigoMascarado}` : 'Sem código ativo'}
                            {r.validaAte ? ` · válido até ${new Date(r.validaAte).toLocaleDateString('pt-BR')}` : ''}
                            {r.motivoSuspensao ? ` · ${r.motivoSuspensao}` : ''}
                            {typeof r.valorReferencia === 'number' ? ` · valor de referência: R$ ${r.valorReferencia.toFixed(2)}` : ''}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {r.codigoMascarado && (r.status === 'disponivel' || r.status === 'reservada') && (
                            <button onClick={() => acaoManual({ acao: 'revogar_codigo', recompensaId: r.recompensaId })} style={botaoSecundario}>Revogar código</button>
                          )}
                          {elegivelParaSubstituir && substituindoId !== r.recompensaId && (
                            <button onClick={() => iniciarSubstituicao(r)} style={botaoSecundario}>Substituir presente</button>
                          )}
                        </div>
                      </div>

                      {substituindoId === r.recompensaId && catalogo && (
                        <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <p style={{ fontSize: 12, fontWeight: 700, margin: 0 }}>Novo presente (substitui &quot;{r.produtoNome ?? '(sem produto)'}&quot;)</p>
                          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                            {(['bebida_sobremesa', 'pizza', 'presente_especial'] as TipoRecompensa[]).map((t) => (
                              <button key={t} onClick={() => setSubstTipo(t)} style={{ ...(substTipo === t ? botaoPrimario : botaoSecundario), padding: '8px 14px' }}>
                                {t === 'bebida_sobremesa' ? 'Bebida/item individual' : t === 'pizza' ? 'Pizza' : 'Presente especial'}
                              </button>
                            ))}
                          </div>

                          {substTipo === 'bebida_sobremesa' && (
                            <select value={substItemId} onChange={(e) => setSubstItemId(e.target.value)} style={{ ...inputStyle, minWidth: 240 }}>
                              <option value="">Selecione um produto...</option>
                              {itensDisponiveis.map((i) => (
                                <option key={i.produtoId} value={i.produtoId}>{i.produtoNome} ({i.categoria})</option>
                              ))}
                            </select>
                          )}

                          {substTipo === 'pizza' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                                <span style={label}>Tamanho</span>
                                <select value={substTamanho} onChange={(e) => setSubstTamanho(e.target.value)} style={inputStyle}>
                                  <option value="">Selecione...</option>
                                  {catalogo.sizes.map((s) => (
                                    <option key={s.code} value={s.code}>{s.label ? `${s.label} (${s.code})` : s.code}</option>
                                  ))}
                                </select>
                              </div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxWidth: 640 }}>
                                {todosSabores.map((s) => (
                                  <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, border: '1px solid var(--border)', borderRadius: 8, padding: '4px 8px' }}>
                                    <input type="checkbox" checked={substSabores.includes(s)} onChange={(e) => setSubstSabores((atual) => (e.target.checked ? [...atual, s] : atual.filter((x) => x !== s)))} />
                                    {s}
                                  </label>
                                ))}
                              </div>
                            </div>
                          )}

                          {substTipo === 'presente_especial' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                                <select value={substComposicaoItemId} onChange={(e) => setSubstComposicaoItemId(e.target.value)} style={{ ...inputStyle, minWidth: 220 }}>
                                  <option value="">Selecione um item...</option>
                                  {itensDisponiveis.map((i) => (
                                    <option key={i.produtoId} value={i.produtoId}>{i.produtoNome} ({i.categoria})</option>
                                  ))}
                                </select>
                                <input type="number" min={1} value={substComposicaoQty} onChange={(e) => setSubstComposicaoQty(Math.max(1, Number(e.target.value)))} style={{ ...inputStyle, width: 70 }} />
                                <button onClick={adicionarItemComposicaoSubstituicao} disabled={!substComposicaoItemId} style={{ ...botaoSecundario, opacity: !substComposicaoItemId ? 0.6 : 1 }}>+ Item</button>
                              </div>
                              {substComposicao.length > 0 && (
                                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                                  {substComposicao.map((c, idx) => (<li key={idx}>{c.quantidade}x {c.item.produtoNome}</li>))}
                                </ul>
                              )}
                            </div>
                          )}

                          <div style={{ fontSize: 12.5, color: 'var(--foreground-muted)' }}>
                            {typeof r.valorReferencia === 'number' && <span>Valor atual: R$ {r.valorReferencia.toFixed(2)} · </span>}
                            {previaValorNovo() !== null ? <span>Novo valor estimado: R$ {previaValorNovo()!.toFixed(2)}</span> : <span>Selecione o novo presente para ver o valor estimado.</span>}
                          </div>

                          <input placeholder="Motivo da substituição (obrigatório)" value={substMotivo} onChange={(e) => setSubstMotivo(e.target.value)} style={inputStyle} />
                          {substErro && <p style={{ color: 'var(--danger-text)', fontSize: 12.5, margin: 0 }}>{substErro}</p>}
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={() => confirmarSubstituicao(r.recompensaId)} disabled={substSalvando} style={{ ...botaoPrimario, opacity: substSalvando ? 0.6 : 1 }}>
                              {substSalvando ? 'Aplicando...' : 'Confirmar substituição'}
                            </button>
                            <button onClick={cancelarSubstituicao} style={botaoSecundario}>Cancelar</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
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
