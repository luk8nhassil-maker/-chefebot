'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import PanelShell from '@/components/PanelShell'

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
}

type RankingEntry = { posicao: number; score: number }

type RankingStatus = {
  configurado: boolean
  temporadaId: string | null
  top5: RankingEntry[]
  nota: string
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
    receitaElegivelCents: number
    ticketMedioCents: number
    clientesUnicos: number
  }
  periodosDias?: PeriodoAnalytics
  totalEventosNoIndice?: number
  error?: string
}

type PeriodoAnalytics = 7 | 30 | 60 | 90

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

function formatarReais(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// Gera identificador anonimizado para exibição no ranking
function labelAnonimo(posicao: number): string {
  return `Cliente #${posicao}`
}

export default function FidelidadePage() {
  const router = useRouter()
  const [status, setStatus] = useState<StatusData | null>(null)
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null)
  const [periodo, setPeriodo] = useState<PeriodoAnalytics>(30)
  const [loadingStatus, setLoadingStatus] = useState(true)  // começa true — efeito carrega na montagem
  const [erroStatus, setErroStatus] = useState<string | null>(null)
  const [erroAnalytics, setErroAnalytics] = useState<string | null>(null)
  const [analyticsCarregado, setAnalyticsCarregado] = useState(false)
  const [acaoEmCurso, setAcaoEmCurso] = useState(false)
  const [mensagemAcao, setMensagemAcao] = useState<string | null>(null)

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
    try {
      const r = await fetch(`/api/admin/analytics/pedidos?periodo=${p}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setAnalytics(await r.json())
    } catch {
      setErroAnalytics('Erro ao carregar analytics.')
    } finally {
      setAnalyticsCarregado(true)
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
    let cancelled = false
    fetch(`/api/admin/analytics/pedidos?periodo=${periodo}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(data => { if (!cancelled) { setAnalytics(data); setErroAnalytics(null); setAnalyticsCarregado(true) } })
      .catch(() => { if (!cancelled) { setErroAnalytics('Erro ao carregar analytics.'); setAnalyticsCarregado(true) } })
    return () => { cancelled = true }
  }, [periodo])

  async function criarTemporada30d() {
    if (acaoEmCurso) return
    setAcaoEmCurso(true)
    setMensagemAcao(null)
    try {
      const temporadaId = `t-${Date.now()}`
      const r = await fetch('/api/admin/fidelidade/temporadas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acao: 'criar',
          temporadaId,
          nome: 'Temporada 30 dias',
          duracaoDias: 30,
        }),
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
      await carregarStatus()
    } catch (e: unknown) {
      setMensagemAcao(`Falha: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setAcaoEmCurso(false)
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
                <div style={{ marginTop: 12, fontSize: 12, color: 'var(--foreground-muted)', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  Configuração de estrelas em{' '}
                  <button onClick={() => router.push('/admin/jornada-chef')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--primary-text, var(--primary))', fontWeight: 600, fontSize: 12, textDecoration: 'underline' }}>
                    Jornada do Chef
                  </button>
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
                  <div style={{ fontSize: 13, color: 'var(--foreground-muted)', fontStyle: 'italic' }}>
                    Sem dados de ranking ainda para esta temporada.
                  </div>
                ) : (
                  <div>
                    {status.ranking.top5.map((e) => (
                      <div key={e.posicao} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                        <span style={{ color: 'var(--foreground-muted)' }}>
                          <span style={{ fontWeight: 700, marginRight: 6 }}>#{e.posicao}</span>
                          {labelAnonimo(e.posicao)}
                        </span>
                        <span style={{ fontWeight: 700 }}>{e.score} pts</span>
                      </div>
                    ))}
                    <div style={{ marginTop: 8, fontSize: 11, color: 'var(--foreground-muted)' }}>
                      {status.ranking.nota}
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

            {/* Módulo Analytics (linha completa) */}
            <div style={cardEstilo}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
                <div style={tituloCard}>Analytics de Pedidos</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {([7, 30, 60, 90] as PeriodoAnalytics[]).map((p) => (
                    <button
                      key={p}
                      onClick={() => setPeriodo(p)}
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
                      {p}d
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ color: 'var(--foreground-muted)', fontSize: 12, lineHeight: 1.45, marginBottom: 12 }}>
                Considera pedidos entregues no período selecionado. Cada cliente é contado uma única vez.
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
                (analytics.totalEventosNoIndice ?? analytics.metricas?.pedidosValidos ?? 0) === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--foreground-muted)', fontStyle: 'italic', padding: '8px 0' }}>
                    Histórico insuficiente para o período de {periodo} dias. Os dados aparecerão aqui conforme os pedidos forem registrados.
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                    {[
                      { label: 'Pedidos', valor: String(analytics.metricas?.pedidosValidos ?? 0) },
                      { label: 'Receita', valor: formatarReais(analytics.metricas?.receitaElegivelCents ?? 0) },
                      { label: 'Ticket médio', valor: formatarReais(analytics.metricas?.ticketMedioCents ?? 0) },
                      { label: 'Clientes únicos', valor: String(analytics.metricas?.clientesUnicos ?? 0) },
                    ].map(({ label, valor }) => (
                      <div key={label} style={{ padding: '12px 14px', borderRadius: 8, background: 'var(--background)', border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.4px', textTransform: 'uppercase', color: 'var(--foreground-muted)', marginBottom: 4 }}>{label}</div>
                        <div style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>

          </div>
        )}
      </div>
    </PanelShell>
  )
}
