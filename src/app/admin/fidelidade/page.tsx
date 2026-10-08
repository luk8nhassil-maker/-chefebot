'use client'
import { useEffect, useState } from 'react'
import PanelShell from '@/components/PanelShell'
import FidelidadeAnalyticsDashboard from '@/components/FidelidadeAnalyticsDashboard'
import GamificacaoConfigPanel from './GamificacaoConfigPanel'

type EstrelasStatus = {
  ativa: boolean
  regraVersao: string | null
  metaEstrelas: number
}

type TemporadaAtiva = {
  temporadaId: string
  nome: string | null
  ativadaEm: string | null
  fimEm: string | null
  duracaoDias: number | null
  metaCompras: number | null
  metaIndicacoes: number | null
}

type TemporadaStatus = {
  ativa: TemporadaAtiva | null
  total: number
  encerradas: number
  ultimaEncerradaId: string | null
  ultimaEncerradaNome: string | null
}

type IdentidadeResultado = {
  participaCampanha: boolean
  nomePublico: string | null
  telefoneMascarado: null
  fotoPerfilUrl: string | null
  codinomeSecreto: string
  revelado: boolean
}

type ResultadoTemporada = {
  encerradaEm: string
  premioDescricao: string | null
  premioQuantidadePremiados: number | null
  premioAprovado: boolean
  vencedorDeclarado: boolean
  revelacaoAte?: string | null
  vencedores: Array<{ posicao: number; score: number; identidade: IdentidadeResultado }>
  participantesTopo: Array<{ posicao: number; score: number; identidade: IdentidadeResultado }>
}

type RankingEntry = { posicao: number; score: number }

type RankingStatus = {
  configurado: boolean
  temporadaId: string | null
  top5: RankingEntry[]
  nota: string
}

type AuditoriaGrupo5Mais = {
  totalClientesGrupo: number
  totalNoTop10: number
  posicoes: number[]
  posicoesForaDoTop10: number[]
}

type MissoesStatus = {
  configuradas: boolean
  nota: string
}

type StatusData = {
  tenantId: string
  estrelas: EstrelasStatus
  temporada: TemporadaStatus
  ranking: RankingStatus
  missoes: MissoesStatus
}

type AnalyticsData = {
  metricas?: {
    pedidosValidos: number
    pedidosSemClienteIdentificado: number
    pedidosComClienteIdentificado: number
    receitaElegivelClientesIdentificadosCents: number
    receitaElegivelCents: number
    ticketMedioCents: number
    clientesUnicos: number
    clientesNovos: number
    clientesRecorrentes: number
    percentualClientesRecorrentes: number
    clientesComSegundoPedido: number
    percentualClientesComSegundoPedido: number
    pedidosMediosPorCliente: number
    receitaMediaPorClienteCents: number
    serieDiaria: Array<{ data: string; pedidos: number; receitaCents: number; clientesUnicos: number }>
    porCanal: Record<string, { pedidos: number; receitaCents: number; pedidoIds?: string[] }>
    cohortePorPedidos: Record<string, number>
    percentualReceitaRecorrentes: number
    estrelasDistribuidas: number | null
    pedidosComEstrelasRegistradas?: number | null
  }
  periodosDias?: PeriodoAnalytics | null
  totalEventosNoIndice?: number
  totalEventosConsiderados?: number
  fonteDados?: {
    origem?: 'analytics' | 'analytics+pedidos' | 'pedidos'
    eventosIndice?: number
    eventosFallbackAdicionados?: number
  }
  historicoAnteriorParcial?: boolean
  cobertura?: {
    janelaSolicitadaDias: number | null
    historicoEncontradoDesdeIso: string | null
    diasHistoricoEncontrado: number
    possuiDadosAntesDaJanela: boolean
    recorrenciaAnteriorDisponivel?: boolean
    ancoradaNoInicioCampanha?: boolean
    janelaInicioIso?: string
    janelaFimIso?: string
    diasCorridosDisponiveis?: number
  }
  error?: string
}

type PeriodoAnalytics = 7 | 30 | 60 | 90 | 'historico'

type AutopilotFase = {
  id: string
  titulo: string
  peso: number
  estado: 'concluida' | 'em_andamento' | 'bloqueada'
  detalhe: string
  desbloqueios: string[]
}

type AutopilotPlano = {
  estado: 'bloqueado' | 'observando' | 'pronto'
  percentual: number
  fases: AutopilotFase[]
  podeExecutar: boolean
  acao: string
  motivo: string
  limiteSeguroSemanalCents: number
  gastoEstimadoCents: number
}

type AutopilotData = {
  ok: boolean
  plano: AutopilotPlano
}

function formatarData(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch { return iso }
}

function diasRestantes(fimEm: string | null): number | null {
  if (!fimEm) return null
  const diff = new Date(fimEm).getTime() - Date.now()
  return Math.max(0, Math.ceil(diff / 86400000))
}

// Gera identificador anonimizado para exibição no ranking
function labelAnonimo(posicao: number): string {
  return `Cliente #${posicao}`
}

export default function FidelidadePage() {
  const [status, setStatus] = useState<StatusData | null>(null)
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null)
  const [periodo, setPeriodo] = useState<PeriodoAnalytics>(30)
  const [loadingStatus, setLoadingStatus] = useState(true)  // começa true — efeito carrega na montagem
  const [erroStatus, setErroStatus] = useState<string | null>(null)
  const [erroAnalytics, setErroAnalytics] = useState<string | null>(null)
  const [analyticsCarregado, setAnalyticsCarregado] = useState(false)
  const [autopilot, setAutopilot] = useState<AutopilotData | null>(null)
  const [loadingAutopilot, setLoadingAutopilot] = useState(true)
  const [erroAutopilot, setErroAutopilot] = useState<string | null>(null)
  const [acaoEmCurso, setAcaoEmCurso] = useState(false)
  const [mensagemAcao, setMensagemAcao] = useState<string | null>(null)
  // Prêmio da temporada é opcional e nunca tem valor padrão — em branco, a
  // temporada é criada sem prêmio (fail-closed) e o encerramento arquiva só
  // o ranking, sem declarar vencedor.
  const [premioDescricaoInput, setPremioDescricaoInput] = useState('')
  const [premioQuantidadeInput, setPremioQuantidadeInput] = useState('')
  const [premioAprovadoInput, setPremioAprovadoInput] = useState(false)
  const [resultadoTemporada, setResultadoTemporada] = useState<ResultadoTemporada | null>(null)
  const [carregandoResultado, setCarregandoResultado] = useState(false)
  const [erroResultado, setErroResultado] = useState<string | null>(null)
  const [auditoriaGrupo5Mais, setAuditoriaGrupo5Mais] = useState<AuditoriaGrupo5Mais | null>(null)
  const [carregandoAuditoriaGrupo5Mais, setCarregandoAuditoriaGrupo5Mais] = useState(false)
  const [erroAuditoriaGrupo5Mais, setErroAuditoriaGrupo5Mais] = useState<string | null>(null)

  async function carregarStatus() {
    setLoadingStatus(true)
    setErroStatus(null)
    try {
      const r = await fetch('/api/admin/fidelidade/status')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setStatus(await r.json())
    } catch {
      setErroStatus('Erro ao carregar status de fidelidade.')
    } finally {
      setLoadingStatus(false)
    }
  }

  async function carregarAnalytics(p: PeriodoAnalytics) {
    setErroAnalytics(null)
    setAnalyticsCarregado(false)
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 10000)
    try {
      const r = await fetch(`/api/admin/analytics/pedidos?periodo=${p}`, { cache: 'no-store', signal: controller.signal })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setAnalytics(await r.json())
    } catch (erro) {
      setErroAnalytics(erro instanceof DOMException && erro.name === 'AbortError'
        ? 'O Analytics demorou demais para responder. Tente novamente.'
        : 'Erro ao carregar analytics.')
    } finally {
      window.clearTimeout(timeout)
      setAnalyticsCarregado(true)
    }
  }

  async function consultarAuditoriaGrupo5Mais() {
    setCarregandoAuditoriaGrupo5Mais(true)
    setErroAuditoriaGrupo5Mais(null)
    try {
      const r = await fetch('/api/admin/fidelidade/auditoria/grupo-5mais-top10', { cache: 'no-store' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json() as AuditoriaGrupo5Mais & { ok?: boolean }
      if (!data.ok) throw new Error('auditoria_indisponivel')
      setAuditoriaGrupo5Mais(data)
    } catch {
      setErroAuditoriaGrupo5Mais('Não foi possível consultar esse grupo agora.')
    } finally {
      setCarregandoAuditoriaGrupo5Mais(false)
    }
  }

  async function carregarAutopilot() {
    setLoadingAutopilot(true)
    setErroAutopilot(null)
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 10000)
    try {
      const r = await fetch('/api/admin/ranking/autopilot/simulacao', { cache: 'no-store', signal: controller.signal })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json() as AutopilotData
      if (!data.ok || !data.plano) throw new Error('plano_indisponivel')
      setAutopilot(data)
    } catch (erro) {
      setErroAutopilot(erro instanceof DOMException && erro.name === 'AbortError'
        ? 'A leitura do robô demorou demais. Tente novamente.'
        : 'Não foi possível ler o estado do robô.')
    } finally {
      window.clearTimeout(timeout)
      setLoadingAutopilot(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/fidelidade/status')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(data => { if (!cancelled) { setStatus(data); setLoadingStatus(false) } })
      .catch(() => { if (!cancelled) { setErroStatus('Erro ao carregar status de fidelidade.'); setLoadingStatus(false) } })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { void carregarAutopilot() }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 10000)
    fetch(`/api/admin/analytics/pedidos?periodo=${periodo}`, { cache: 'no-store', signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(data => { if (!cancelled) setAnalytics(data) })
      .catch((erro) => {
        if (!cancelled) {
          setErroAnalytics(erro instanceof DOMException && erro.name === 'AbortError'
            ? 'O Analytics demorou demais para responder. Tente novamente.'
            : 'Erro ao carregar analytics.')
        }
      })
      .finally(() => {
        window.clearTimeout(timeout)
        if (!cancelled) setAnalyticsCarregado(true)
      })

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [periodo])

  async function criarTemporada30d() {
    if (acaoEmCurso) return
    setAcaoEmCurso(true)
    setMensagemAcao(null)
    try {
      const temporadaId = `t-${Date.now()}`
      const quantidade = Number(premioQuantidadeInput)
      const corpo: Record<string, unknown> = {
        acao: 'criar',
        temporadaId,
        nome: 'Temporada 30 dias',
        duracaoDias: 30,
      }
      // Só envia o prêmio se a descrição foi preenchida — em branco, a
      // temporada nasce sem prêmio (fail-closed), sem inventar nenhum valor.
      if (premioDescricaoInput.trim()) {
        corpo.premioDescricao = premioDescricaoInput.trim()
        if (Number.isFinite(quantidade) && quantidade > 0) corpo.premioQuantidadePremiados = Math.round(quantidade)
        corpo.premioAprovado = premioAprovadoInput
      }
      const r = await fetch('/api/admin/fidelidade/temporadas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
      })
      const data = await r.json()
      if (!r.ok || !data.ok) throw new Error(data.erro ?? data.error ?? 'Erro ao criar')
      // Ativar logo após criar
      const r2 = await fetch('/api/admin/fidelidade/temporadas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'ativar', temporadaId }),
      })
      const data2 = await r2.json()
      if (!r2.ok || !data2.ok) throw new Error(data2.erro ?? data2.error ?? 'Erro ao ativar')
      setMensagemAcao('Temporada de 30 dias criada e ativada.')
      setPremioDescricaoInput('')
      setPremioQuantidadeInput('')
      setPremioAprovadoInput(false)
      await carregarStatus()
    } catch (e: unknown) {
      setMensagemAcao(`Falha: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setAcaoEmCurso(false)
    }
  }

  async function verResultadoTemporada(temporadaId: string) {
    setCarregandoResultado(true)
    setErroResultado(null)
    setResultadoTemporada(null)
    try {
      const r = await fetch(`/api/admin/fidelidade/temporadas?resultado=${encodeURIComponent(temporadaId)}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      setResultadoTemporada(data.resultado ?? null)
    } catch {
      setErroResultado('Erro ao carregar resultado da temporada.')
    } finally {
      setCarregandoResultado(false)
    }
  }

  async function encerrarTemporadaAtiva() {
    if (!status?.temporada.ativa || acaoEmCurso) return
    if (!confirm('Encerrar a temporada ativa? Essa ação não pode ser desfeita.')) return
    setAcaoEmCurso(true)
    setMensagemAcao(null)
    try {
      const r = await fetch('/api/admin/fidelidade/temporadas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'encerrar', temporadaId: status.temporada.ativa.temporadaId }),
      })
      const data = await r.json()
      if (!r.ok || !data.ok) throw new Error(data.erro ?? data.error ?? 'Erro ao encerrar')
      setMensagemAcao('Temporada encerrada.')
      await carregarStatus()
    } catch (e: unknown) {
      setMensagemAcao(`Falha: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setAcaoEmCurso(false)
    }
  }

  async function reconstruirRanking() {
    if (acaoEmCurso || !status?.ranking.configurado) return
    setAcaoEmCurso(true)
    setMensagemAcao(null)
    try {
      const r = await fetch('/api/admin/fidelidade/ranking/reconstruir', { method: 'POST' })
      const data = await r.json()
      if (!r.ok || !data.ok) throw new Error(data.error ?? 'Erro ao reconstruir ranking')
      setMensagemAcao(`Ranking atualizado com ${data.clientesProcessados} clientes da temporada.`)
      await carregarStatus()
    } catch (e: unknown) {
      setMensagemAcao(`Falha: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setAcaoEmCurso(false)
    }
  }

  const badgeEstilo = (on: boolean) => ({
    display: 'inline-flex' as const,
    alignItems: 'center' as const,
    gap: 5,
    padding: '3px 10px',
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 700,
    background: on ? 'var(--success-soft, #d1fae5)' : 'var(--surface)',
    color: on ? 'var(--success, #059669)' : 'var(--foreground-muted)',
    border: `1px solid ${on ? 'var(--success, #059669)' : 'var(--border)'}`,
  })

  const cardEstilo = {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: '20px 20px 16px',
  }

  const tituloCard = {
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: '0.5px',
    textTransform: 'uppercase' as const,
    color: 'var(--foreground-muted)',
    marginBottom: 12,
  }

  const faseAtualAutopilot = autopilot?.plano.fases.find((fase) => fase.estado !== 'concluida') ?? null
  const statusAutopilot = autopilot?.plano.estado === 'pronto'
    ? { label: 'Pronto para agir', cor: 'var(--success, #059669)', fundo: 'var(--success-soft, #d1fae5)' }
    : autopilot?.plano.estado === 'observando'
      ? { label: 'Observando com segurança', cor: 'var(--attention, #9a6700)', fundo: 'var(--attention-soft, #fff7d6)' }
      : { label: 'Aguardando dados', cor: 'var(--foreground-muted)', fundo: 'var(--surface)' }

  return (
    <PanelShell pedidosCount={0} conversasCount={0} conversasUrgent={false} showGestaoNav>
      <div style={{ padding: '20px 20px 40px', maxWidth: 900 }}>

        {/* Cabeçalho */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Fidelidade</h1>
          <p style={{ fontSize: 13, color: 'var(--foreground-muted)', margin: '4px 0 0' }}>
            Temporada, estrelas, indicações, ranking, missões e analytics.
          </p>
        </div>

        {mensagemAcao && (
          <div style={{
            marginBottom: 16,
            padding: '10px 14px',
            borderRadius: 8,
            background: mensagemAcao.startsWith('Falha') ? 'var(--danger-soft, #fee2e2)' : 'var(--success-soft, #d1fae5)',
            color: mensagemAcao.startsWith('Falha') ? 'var(--danger, #dc2626)' : 'var(--success, #059669)',
            fontSize: 13,
            fontWeight: 600,
          }}>
            {mensagemAcao}
          </div>
        )}

        {erroStatus && (
          <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: 'var(--danger-soft, #fee2e2)', color: 'var(--danger, #dc2626)', fontSize: 13 }}>
            {erroStatus}
            <button onClick={carregarStatus} style={{ marginLeft: 10, textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 13 }}>
              Tentar novamente
            </button>
          </div>
        )}

        {loadingAutopilot ? (
          <div style={{ ...cardEstilo, marginBottom: 16, color: 'var(--foreground-muted)', fontSize: 13 }}>
            Lendo o estado do robô…
          </div>
        ) : erroAutopilot ? (
          <div style={{ ...cardEstilo, marginBottom: 16, color: 'var(--danger, #dc2626)', fontSize: 13 }}>
            {erroAutopilot}
            <button type="button" onClick={() => void carregarAutopilot()} style={{ marginLeft: 10, textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 13 }}>
              Tentar novamente
            </button>
          </div>
        ) : autopilot && (
          <section aria-labelledby="autopilot-prontidao" style={{ ...cardEstilo, marginBottom: 16 }}>
            <style>{`\n              .cf-autopilot-track { height: 10px; overflow: hidden; border-radius: 999px; background: var(--border, #e5e7eb); }\n              .cf-autopilot-fill { height: 100%; border-radius: inherit; background: linear-gradient(90deg, #f2c000, #26a269); transition: width .7s ease; transform-origin: left center; }\n              .cf-autopilot-fases { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 6px; margin-top: 14px; }\n              .cf-autopilot-fase { min-width: 0; color: var(--foreground-muted); font-size: 10px; line-height: 1.2; text-align: center; }\n              .cf-autopilot-fase-dot { display: grid; place-items: center; width: 22px; height: 22px; margin: 0 auto 5px; border: 2px solid var(--border, #d1d5db); border-radius: 50%; color: var(--foreground-muted); font-size: 10px; font-weight: 800; background: var(--surface); }\n              .cf-autopilot-fase.concluida { color: var(--success, #059669); }\n              .cf-autopilot-fase.concluida .cf-autopilot-fase-dot { border-color: var(--success, #059669); background: var(--success-soft, #d1fae5); color: var(--success, #059669); }\n              .cf-autopilot-fase.em_andamento { color: var(--attention, #9a6700); }\n              .cf-autopilot-fase.em_andamento .cf-autopilot-fase-dot { border-color: var(--attention, #d6a700); background: var(--attention-soft, #fff7d6); }\n              .cf-autopilot-fase.bloqueada .cf-autopilot-fase-dot { border-color: var(--danger, #dc2626); color: var(--danger, #dc2626); }\n              @media (max-width: 620px) { .cf-autopilot-fases { grid-template-columns: repeat(3, minmax(0, 1fr)); row-gap: 12px; } }\n              @media (prefers-reduced-motion: reduce) { .cf-autopilot-fill { transition: none; } }\n            `}</style>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
              <div>
                <div id="autopilot-prontidao" style={tituloCard}>Prontidão do robô</div>
                <div style={{ fontSize: 19, fontWeight: 800, marginBottom: 4 }}>O robô está {statusAutopilot.label.toLowerCase()}</div>
                <div style={{ color: 'var(--foreground-secondary)', fontSize: 12, lineHeight: 1.45 }}>
                  O percentual é calculado pelos dados reais. Você não precisa preencher as fases.
                </div>
              </div>
              <div style={{ flex: 'none', padding: '5px 10px', borderRadius: 999, background: statusAutopilot.fundo, color: statusAutopilot.cor, fontWeight: 800, fontSize: 18 }}>
                {autopilot.plano.percentual}%
              </div>
            </div>
            <div className="cf-autopilot-track" role="progressbar" aria-label="Prontidão do robô" aria-valuemin={0} aria-valuemax={100} aria-valuenow={autopilot.plano.percentual} style={{ marginTop: 16 }}>
              <div key={autopilot.plano.percentual} className="cf-autopilot-fill" style={{ width: `${Math.max(0, Math.min(100, autopilot.plano.percentual))}%` }} />
            </div>
            <div className="cf-autopilot-fases">
              {autopilot.plano.fases.map((fase, index) => (
                <div key={fase.id} className={`cf-autopilot-fase ${fase.estado}`} title={fase.detalhe}>
                  <span className="cf-autopilot-fase-dot">{fase.estado === 'concluida' ? '✓' : index + 1}</span>
                  <span>{fase.titulo}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 14, padding: '9px 11px', borderRadius: 8, background: 'var(--background-secondary, #f8fafc)', color: 'var(--foreground-secondary)', fontSize: 12, lineHeight: 1.45 }}>
              <strong>{faseAtualAutopilot ? `Próximo ponto: ${faseAtualAutopilot.titulo}.` : 'Todas as fases estão prontas.'}</strong>{' '}
              {faseAtualAutopilot?.detalhe ?? autopilot.plano.motivo}
            </div>
          </section>
        )}

        {loadingStatus ? (
          <div style={{ color: 'var(--foreground-muted)', fontSize: 14, padding: '32px 0', textAlign: 'center' }}>
            Carregando…
          </div>
        ) : status && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Row 1: Estrelas + Temporada */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>

              {/* Módulo Estrelas */}
              <div style={cardEstilo}>
                <div style={tituloCard}>Estrelas V1</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span style={badgeEstilo(status.estrelas.ativa)}>
                    {status.estrelas.ativa ? '● Ativa' : '○ Inativa'}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--foreground-secondary)', lineHeight: 1.6 }}>
                  <div>Regra: <strong>{status.estrelas.regraVersao ?? '—'}</strong></div>
                  <div>Meta: <strong>{status.estrelas.metaEstrelas} estrelas</strong></div>
                </div>
              </div>

              {/* Módulo Temporada */}
              <div style={cardEstilo}>
                <div style={tituloCard}>Temporada</div>
                {status.temporada.ativa ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                      <span style={badgeEstilo(true)}>● Ativa</span>
                      <span style={{ fontSize: 13, fontWeight: 700 }}>{status.temporada.ativa.nome ?? status.temporada.ativa.temporadaId}</span>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--foreground-secondary)', lineHeight: 1.8 }}>
                      <div>Início: <strong>{formatarData(status.temporada.ativa.ativadaEm)}</strong></div>
                      {status.temporada.ativa.fimEm && (
                        <div>
                          Fim: <strong>{formatarData(status.temporada.ativa.fimEm)}</strong>
                          {diasRestantes(status.temporada.ativa.fimEm) !== null && (
                            <span style={{ marginLeft: 6, color: 'var(--attention)', fontWeight: 600 }}>
                              ({diasRestantes(status.temporada.ativa.fimEm)}d restantes)
                            </span>
                          )}
                        </div>
                      )}
                      {status.temporada.ativa.duracaoDias && (
                        <div>Duração: <strong>{status.temporada.ativa.duracaoDias} dias</strong></div>
                      )}
                    </div>
                    <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', gap: 8 }}>
                      <button
                        onClick={encerrarTemporadaAtiva}
                        disabled={acaoEmCurso}
                        style={{ fontSize: 12, padding: '6px 12px', borderRadius: 6, border: '1px solid var(--danger)', background: 'none', color: 'var(--danger)', cursor: acaoEmCurso ? 'not-allowed' : 'pointer', fontWeight: 600 }}
                      >
                        Encerrar temporada
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ marginBottom: 12 }}>
                      <span style={badgeEstilo(false)}>○ Nenhuma ativa</span>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--foreground-secondary)', marginBottom: 12 }}>
                      Total de temporadas: <strong>{status.temporada.total}</strong>
                      {status.temporada.encerradas > 0 && ` (${status.temporada.encerradas} encerrada${status.temporada.encerradas > 1 ? 's' : ''})`}
                    </div>
                    <div style={{ marginBottom: 12, padding: 10, border: '1px dashed var(--border)', borderRadius: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Prêmio da temporada (opcional)</div>
                      <div style={{ fontSize: 11, color: 'var(--foreground-muted)', marginBottom: 8 }}>
                        Em branco, a temporada é criada sem prêmio — o encerramento arquiva o ranking mas nunca declara vencedor.
                      </div>
                      <input
                        type="text"
                        placeholder="Descrição do prêmio (ex.: 1 Pizza Família)"
                        value={premioDescricaoInput}
                        onChange={(e) => setPremioDescricaoInput(e.target.value)}
                        style={{ width: '100%', fontSize: 12, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', marginBottom: 6 }}
                      />
                      <input
                        type="number"
                        min={1}
                        placeholder="Quantidade de premiados"
                        value={premioQuantidadeInput}
                        onChange={(e) => setPremioQuantidadeInput(e.target.value)}
                        style={{ width: '100%', fontSize: 12, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', marginBottom: 6 }}
                      />
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                        <input type="checkbox" checked={premioAprovadoInput} onChange={(e) => setPremioAprovadoInput(e.target.checked)} />
                        Prêmio aprovado — só assim o encerramento declara vencedor
                      </label>
                    </div>
                    <button
                      onClick={criarTemporada30d}
                      disabled={acaoEmCurso}
                      style={{
                        fontSize: 13,
                        padding: '8px 16px',
                        borderRadius: 8,
                        border: 'none',
                        background: 'var(--primary)',
                        color: 'var(--primary-foreground, #000)',
                        cursor: acaoEmCurso ? 'not-allowed' : 'pointer',
                        fontWeight: 700,
                        opacity: acaoEmCurso ? 0.6 : 1,
                      }}
                    >
                      {acaoEmCurso ? 'Aguarde…' : 'Criar temporada de 30 dias'}
                    </button>
                    {status.temporada.ultimaEncerradaId && (
                      <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                        <button
                          onClick={() => verResultadoTemporada(status.temporada.ultimaEncerradaId!)}
                          disabled={carregandoResultado}
                          style={{ fontSize: 12, padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'none', cursor: carregandoResultado ? 'not-allowed' : 'pointer', fontWeight: 600 }}
                        >
                          {carregandoResultado ? 'Carregando…' : `Ver resultado — ${status.temporada.ultimaEncerradaNome ?? status.temporada.ultimaEncerradaId}`}
                        </button>
                        {erroResultado && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>{erroResultado}</div>}
                        {resultadoTemporada && (
                          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--foreground-secondary)', lineHeight: 1.7 }}>
                            <div>Encerrada em: <strong>{formatarData(resultadoTemporada.encerradaEm)}</strong></div>
                            {resultadoTemporada.premioDescricao && <div>Prêmio: <strong>{resultadoTemporada.premioDescricao}</strong></div>}
                            {resultadoTemporada.revelacaoAte && <div>Revelação de perfis até: <strong>{formatarData(resultadoTemporada.revelacaoAte)}</strong></div>}
                            {!resultadoTemporada.vencedorDeclarado ? (
                              <div style={{ fontStyle: 'italic', marginTop: 4 }}>
                                Sem vencedor declarado {resultadoTemporada.premioAprovado ? '(ranking sem participantes)' : '(prêmio não foi aprovado antes do encerramento)'}.
                              </div>
                            ) : (
                              <div style={{ marginTop: 4 }}>
                                <strong>Vencedores:</strong>
                                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                                  {resultadoTemporada.vencedores.map((v) => (
                                    <li key={v.posicao}>
                                      {v.posicao}º — {v.identidade.participaCampanha
                                        ? (v.identidade.nomePublico ?? v.identidade.codinomeSecreto)
                                        : 'Fora da exibição pública (saiu do jogo)'} · {v.score} estrelas
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Row 2: Indicação + Ranking */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>

              {/* Módulo Indicação */}
              <div style={cardEstilo}>
                <div style={tituloCard}>Indicação</div>
                <div style={{ fontSize: 13, color: 'var(--foreground-secondary)', lineHeight: 1.8 }}>
                  <div>+6 estrelas na 1ª indicação válida</div>
                  <div>+1 estrela nas indicações recorrentes</div>
                  <div>Token com validade de 90 dias</div>
                  <div style={{ marginTop: 6, color: 'var(--foreground-muted)', fontSize: 12 }}>
                    Auto-indicação bloqueada. Somente indicações validadas pelo servidor.
                  </div>
                </div>
              </div>

              {/* Módulo Ranking */}
              <div style={cardEstilo}>
                <div style={tituloCard}>Ranking</div>
                {!status.ranking.configurado ? (
                  <div style={{ fontSize: 13, color: 'var(--foreground-muted)', fontStyle: 'italic' }}>
                    Aguardando configuração — nenhuma temporada ativa.
                  </div>
                ) : status.ranking.top5.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--foreground-muted)' }}>
                    <div style={{ fontStyle: 'italic', marginBottom: 10 }}>
                      O ranking ainda não foi carregado para os pedidos já entregues desta temporada.
                    </div>
                    <button type="button" onClick={reconstruirRanking} disabled={acaoEmCurso} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 700, cursor: acaoEmCurso ? 'wait' : 'pointer' }}>
                      {acaoEmCurso ? 'Atualizando…' : 'Atualizar ranking'}
                    </button>
                  </div>
                ) : (
                  <div>
                    {status.ranking.top5.map((e) => (
                      <div key={e.posicao} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                        <span style={{ color: 'var(--foreground-muted)' }}>
                          <span style={{ fontWeight: 700, marginRight: 6 }}>#{e.posicao}</span>
                          {labelAnonimo(e.posicao)}
                        </span>
                        <span style={{ fontWeight: 700 }}>{e.score} Estrelas</span>
                      </div>
                    ))}
                    <div style={{ marginTop: 8, fontSize: 11, color: 'var(--foreground-muted)' }}>
                      {status.ranking.nota}
                    </div>
                    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                      <button
                        type="button"
                        onClick={consultarAuditoriaGrupo5Mais}
                        disabled={carregandoAuditoriaGrupo5Mais}
                        style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 700, cursor: carregandoAuditoriaGrupo5Mais ? 'wait' : 'pointer' }}
                      >
                        {carregandoAuditoriaGrupo5Mais ? 'Conferindo…' : 'Conferir clientes com 5+ pedidos'}
                      </button>
                      {erroAuditoriaGrupo5Mais && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--danger, #b42318)' }}>{erroAuditoriaGrupo5Mais}</div>}
                      {auditoriaGrupo5Mais && (
                        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--foreground-secondary)', lineHeight: 1.6 }}>
                          <div><strong>{auditoriaGrupo5Mais.totalNoTop10}</strong> de <strong>{auditoriaGrupo5Mais.totalClientesGrupo}</strong> estão no Top 10.</div>
                          <div>Posições encontradas: {auditoriaGrupo5Mais.posicoes.length > 0 ? auditoriaGrupo5Mais.posicoes.map((posicao) => `#${posicao}`).join(', ') : 'nenhuma'}.</div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Row 3: Missões + Carteira */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>

              {/* Módulo Missões */}
              <div style={cardEstilo}>
                <div style={tituloCard}>Missões</div>
                {!status.missoes.configuradas ? (
                  <>
                    <div style={{ marginBottom: 10 }}>
                      <span style={badgeEstilo(false)}>○ Não configuradas</span>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--foreground-muted)', lineHeight: 1.6 }}>
                      {status.missoes.nota}
                    </div>
                    <div style={{ marginTop: 8, fontSize: 12, color: 'var(--foreground-muted)' }}>
                      Motor de missões implementado e fail-closed. Ativará quando os limiares forem aprovados.
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 13, color: 'var(--foreground-secondary)' }}>
                    Missões configuradas e ativas.
                  </div>
                )}
              </div>

              {/* Módulo Carteira */}
              <div style={cardEstilo}>
                <div style={tituloCard}>Carteira de Presentes</div>
                <div style={{ fontSize: 13, color: 'var(--foreground-secondary)', lineHeight: 1.8 }}>
                  <div>Presentes desbloqueados ficam na carteira do cliente.</div>
                  <div>Direitos conquistados não são apagados ao encerrar temporada.</div>
                  <div style={{ marginTop: 6, padding: '8px 10px', borderRadius: 6, background: 'var(--attention-soft, #f5f3ff)', border: '1px solid var(--attention, #7c3aed)', fontSize: 12, color: 'var(--attention, #7c3aed)', fontWeight: 600 }}>
                    Liberação de presentes requer cobertura econômica aprovada — desabilitada intencionalmente.
                  </div>
                </div>
              </div>
            </div>

            <GamificacaoConfigPanel />

            {/* Módulo Analytics (linha completa) */}
            <div style={cardEstilo}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
                <div style={tituloCard}>Analytics de Pedidos</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {([7, 30, 60, 90, 'historico'] as PeriodoAnalytics[]).map((p) => (
                    <button
                      key={p}
                      onClick={() => {
                        setAnalyticsCarregado(false)
                        setErroAnalytics(null)
                        setPeriodo(p)
                      }}
                      style={{
                        fontSize: 12,
                        padding: '4px 10px',
                        borderRadius: 6,
                        border: `1px solid ${periodo === p ? 'var(--primary)' : 'var(--border)'}`,
                        background: periodo === p ? 'var(--primary)' : 'none',
                        color: periodo === p ? 'var(--primary-foreground, #000)' : 'var(--foreground-secondary)',
                        cursor: 'pointer',
                        fontWeight: periodo === p ? 700 : 400,
                      }}
                    >
                      {p === 'historico' ? 'Tudo' : `${p}d`}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ color: 'var(--foreground-muted)', fontSize: 12, lineHeight: 1.45, marginBottom: 12 }}>
                Conta pedidos entregues e receita elegível. “Tudo” consulta todo o histórico disponível; as outras opções mostram a janela escolhida. Cada cliente é contado uma única vez quando o telefone ou ID permite identificá-lo.
              </div>

              {erroAnalytics && (
                <div style={{ color: 'var(--danger)', fontSize: 13 }}>
                  {erroAnalytics}
                  <button onClick={() => carregarAnalytics(periodo)} style={{ marginLeft: 8, textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 13 }}>
                    Tentar novamente
                  </button>
                </div>
              )}

              {!analyticsCarregado ? (
                <div style={{ color: 'var(--foreground-muted)', fontSize: 13, padding: '16px 0', textAlign: 'center' }}>Carregando…</div>
              ) : analytics && !erroAnalytics && (
                (analytics.totalEventosConsiderados ?? analytics.metricas?.pedidosValidos ?? 0) === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--foreground-muted)', fontStyle: 'italic', padding: '8px 0' }}>
                    Nenhum pedido entregue foi encontrado {periodo === 'historico' ? 'no histórico disponível' : `nesta janela de ${periodo} dias`}.
                  </div>
                ) : analytics.metricas ? (
                  <>
                    <div style={{ fontSize: 11, color: 'var(--foreground-muted)', marginBottom: 10, lineHeight: 1.5 }}>
                      <div>
                        Fonte: {analytics.fonteDados?.origem === 'pedidos' ? 'histórico real de pedidos' : analytics.fonteDados?.origem === 'analytics+pedidos' ? 'índice analítico + histórico de pedidos' : 'índice analítico'}
                        {analytics.historicoAnteriorParcial ? ' · histórico anterior insuficiente para classificar novos e recorrentes' : ''}
                      </div>
                      {analytics.cobertura && (
                        <div>
                          Janela escolhida: <strong>{periodo === 'historico'
                            ? 'todo o histórico disponível até hoje'
                            : analytics.cobertura.ancoradaNoInicioCampanha
                              ? `primeiros ${periodo} dias da campanha`
                              : `${periodo} dias`}</strong>
                          {periodo !== 'historico' && analytics.cobertura.ancoradaNoInicioCampanha && typeof analytics.cobertura.diasCorridosDisponiveis === 'number' && analytics.cobertura.diasCorridosDisponiveis < periodo
                            ? <> · <strong>{analytics.cobertura.diasCorridosDisponiveis} dias</strong> já disponíveis</>
                            : null}
                          {analytics.cobertura.janelaInicioIso && analytics.cobertura.janelaFimIso
                            ? <> · de <strong>{formatarData(analytics.cobertura.janelaInicioIso)}</strong> até <strong>{formatarData(analytics.cobertura.janelaFimIso)}</strong></>
                            : null}
                          {analytics.cobertura.historicoEncontradoDesdeIso
                            ? <> · histórico encontrado desde <strong>{formatarData(analytics.cobertura.historicoEncontradoDesdeIso)}</strong>
                              {periodo !== 'historico' && !analytics.cobertura.possuiDadosAntesDaJanela && analytics.cobertura.diasHistoricoEncontrado < periodo
                                ? <> · usando os <strong>{analytics.cobertura.diasHistoricoEncontrado} dias</strong> de dados encontrados até agora</>
                                : null}
                              </>
                            : ' · nenhum pedido encontrado nesta fonte'}
                        </div>
                      )}
                    </div>
                    <FidelidadeAnalyticsDashboard metricas={analytics.metricas} periodo={periodo} cobertura={analytics.cobertura} />
                  </>
                ) : null
              )}
            </div>

          </div>
        )}
      </div>
    </PanelShell>
  )
}
