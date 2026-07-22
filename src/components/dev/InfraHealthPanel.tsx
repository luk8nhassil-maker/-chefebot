'use client'
// Painel "Saúde da Infraestrutura" — seção independente do /dev/mcp.
// Busca /api/dev/infra separadamente (nunca dispara coleta pelo navegador,
// só lê o que já foi persistido) e nunca deve impedir o resto do /dev/mcp
// de aparecer: qualquer erro fica contido no ErrorBoundary local abaixo.

import { Component, type ReactNode, useEffect, useState } from 'react'
import { describeServiceStatusLabel, sortHistoryChronologically } from '@/infra/railway/healthEngine'

const BG_S = 'var(--info-soft)'
const BG_R = 'var(--info-soft)'
const BORDER = '1px solid var(--info-soft)'
const TEXT = 'var(--info)'
const TEXT2 = 'var(--info)'
const TEXT3 = 'var(--info)'
const GREEN = 'var(--success)'
const YELLOW = 'var(--primary)'
const RED = 'var(--danger)'
const ORANGE = 'var(--attention)'

type Severity = 'healthy' | 'attention' | 'critical' | 'emergency' | 'imminent' | 'stale' | 'unavailable' | 'never'

const SEVERITY_LABEL: Record<Severity, string> = {
  healthy: 'Saudável',
  attention: 'Atenção',
  critical: 'Crítico',
  emergency: 'Emergência',
  imminent: 'Risco iminente',
  stale: 'Coleta atrasada',
  unavailable: 'Indisponível',
  never: 'Coletando primeiro histórico',
}

const SEVERITY_COLOR: Record<Severity, string> = {
  healthy: GREEN,
  attention: YELLOW,
  critical: ORANGE,
  emergency: RED,
  imminent: RED,
  stale: YELLOW,
  unavailable: TEXT3,
  never: TEXT3,
}

type ForecastEntry = { threshold: number; status: 'already_reached' | 'estimated'; days: number | null }
type Forecast =
  | { status: 'collecting_history' }
  | { status: 'insufficient_data' }
  | { status: 'no_growth' }
  | { status: 'estimated'; reliable: boolean; distortedByRecentSpike: boolean; entries: ForecastEntry[] }

type HistoryPoint = { ts: number; usedBytes: number; capacityBytes: number; percentUsed: number; origin: 'collector' | 'railway-ui-manual' }

type Alert = { id: string; ts: number; type: string; severity: string; description: string }

type ServiceStatus = 'online' | 'unknown'
type WhatsappState = 'connected' | 'disconnected' | 'unknown'

type InfraSnapshot = {
  configured: boolean
  collector: { status: 'ok' | 'error' | 'stale' | 'never'; lastRunAt: number | null }
  postgresVolume: {
    usedBytes: number | null
    capacityBytes: number | null
    freeBytes: number | null
    percentUsed: number | null
    capacitySource: string | null
    severity: string
    delta24hBytes: number | null
    delta7dBytes: number | null
    delta30dBytes: number | null
    dailyGrowthBytes: number | null
    dailyGrowthConfidence: string | null
    forecast: Forecast
    anomaly: { isAnomaly: boolean; last24hBytes: number | null; normalDailyBaselineBytes: number | null } | null
  }
  services: { postgres: ServiceStatus; evolution: ServiceStatus; redis: ServiceStatus; whatsapp: { connectionState: WhatsappState; checkedAt: number; limitation?: string } }
  history: HistoryPoint[]
  alerts: Alert[]
  redisAvailable: boolean
}

function fmtBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return '—'
  const abs = Math.abs(bytes)
  if (abs >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fmtDelta(bytes: number | null): string {
  if (bytes === null) return 'Sem dado suficiente'
  const sign = bytes > 0 ? '+' : ''
  return `${sign}${fmtBytes(bytes)}`
}

function fmtTs(ts: number | null): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function fmtDays(days: number | null): string {
  if (days === null) return '—'
  if (days <= 0) return 'já atingido'
  if (days < 1) return '< 1 dia'
  if (days < 60) return `~${Math.round(days)} dias`
  return `~${Math.round(days / 30)} meses`
}

function Card({ title, children, accent }: { title: string; children: ReactNode; accent?: string }) {
  return (
    <div style={{ background: BG_S, border: accent ? `1px solid ${accent}` : BORDER, borderRadius: 12, padding: 18 }}>
      <p style={{ color: TEXT3, fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8, margin: '0 0 12px' }}>{title}</p>
      {children}
    </div>
  )
}

function ServiceDot({ label, status }: { label: string; status: ServiceStatus | WhatsappState }) {
  const ok = status === 'online' || status === 'connected'
  const unknown = status === 'unknown'
  // "não monitorado" (unknown) é neutro/cinza — nunca vermelho: ausência de
  // dado não é o mesmo que falha real observada (só "disconnected" é falha real).
  const color = ok ? GREEN : unknown ? TEXT3 : RED
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: BG_R, border: BORDER, borderRadius: 8, padding: '8px 12px' }}>
      <span style={{ width: 9, height: 9, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ color: TEXT2, fontSize: 12, flex: 1 }}>{label}</span>
      <span style={{ color, fontSize: 11, fontWeight: 700 }}>{describeServiceStatusLabel(status)}</span>
    </div>
  )
}

/** Nudge de rótulos que colidiriam verticalmente (nunca muda a posição da linha-guia, só do texto). */
function declutterLabelYs(sortedYsTopToBottom: number[], minGapPx: number): number[] {
  const out: number[] = []
  let last = -Infinity
  for (const rawY of sortedYsTopToBottom) {
    const labelY = Math.max(rawY, last + minGapPx)
    out.push(labelY)
    last = labelY
  }
  return out
}

function HistoryChart({ history }: { history: HistoryPoint[] }) {
  // Nunca confia que `history` já chega ordenado (mistura baselines manuais
  // com coleta automática) — reordena sempre antes de desenhar.
  const ordenado = sortHistoryChronologically(history)
  if (ordenado.length < 2) {
    return <p style={{ color: TEXT3, fontSize: 12 }}>Histórico insuficiente para o gráfico ainda.</p>
  }
  const W = 640
  const H = 200
  const PAD_X = 24
  const PAD_Y = 28
  const minTs = ordenado[0].ts
  const maxTs = ordenado[ordenado.length - 1].ts
  const spanTs = Math.max(1, maxTs - minTs)
  const x = (ts: number) => PAD_X + ((ts - minTs) / spanTs) * (W - PAD_X * 2)
  // percentUsed já está na escala 0–100 para as duas origens (coletor e
  // baseline manual) — nunca multiplicar de novo aqui (ver
  // src/infra/railway/types.ts:HistoryPoint e verifiedBaselines.ts).
  const y = (pct: number) => H - PAD_Y - (Math.min(pct, 100) / 100) * (H - PAD_Y * 2)

  const linePoints = ordenado.map((h) => `${x(h.ts)},${y(h.percentUsed)}`).join(' ')
  const refsAltoParaBaixo = [95, 90, 80, 70]
  const labelYs = declutterLabelYs(refsAltoParaBaixo.map((r) => y(r) - 3), 11)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Histórico de uso do volume Postgres" style={{ width: '100%', height: 'auto', display: 'block' }}>
      {refsAltoParaBaixo.map((r, i) => (
        <g key={r}>
          <line x1={PAD_X} x2={W - PAD_X} y1={y(r)} y2={y(r)} stroke="var(--info-soft)" strokeDasharray="4 4" />
          <text x={W - PAD_X} y={labelYs[i]} fontSize={9} fill={TEXT3} textAnchor="end">{r}%</text>
        </g>
      ))}
      <polyline points={linePoints} fill="none" stroke={YELLOW} strokeWidth={2} />
      {ordenado.map((h, i) => (
        <circle key={i} cx={x(h.ts)} cy={y(h.percentUsed)} r={h.origin === 'railway-ui-manual' ? 4 : 2.5}
          fill={h.origin === 'railway-ui-manual' ? ORANGE : YELLOW}
          stroke={h.origin === 'railway-ui-manual' ? 'var(--background)' : 'none'} strokeWidth={h.origin === 'railway-ui-manual' ? 1 : 0}>
          <title>{`${new Date(h.ts).toLocaleString('pt-BR')} · ${h.percentUsed.toFixed(1)}% · ${fmtBytes(h.usedBytes)}${h.origin === 'railway-ui-manual' ? ' (medição manual verificada)' : ''}`}</title>
        </circle>
      ))}
    </svg>
  )
}

function ForecastCard({ forecast }: { forecast: Forecast }) {
  if (forecast.status === 'collecting_history') {
    return <Card title="Previsão de capacidade"><p style={{ color: TEXT3, fontSize: 12 }}>Coletando histórico — previsão disponível após 24h de amostras.</p></Card>
  }
  if (forecast.status === 'insufficient_data') {
    return <Card title="Previsão de capacidade"><p style={{ color: TEXT3, fontSize: 12 }}>Dados insuficientes para estimar.</p></Card>
  }
  if (forecast.status === 'no_growth') {
    return <Card title="Previsão de capacidade"><p style={{ color: GREEN, fontSize: 12 }}>Sem crescimento detectável no período.</p></Card>
  }
  return (
    <Card title="Previsão de capacidade (estimativa, não certeza)">
      {forecast.distortedByRecentSpike && (
        <p style={{ color: ORANGE, fontSize: 11, marginBottom: 8 }}>⚠ Projeção pode estar distorcida por um salto recente.</p>
      )}
      {!forecast.reliable && (
        <p style={{ color: TEXT3, fontSize: 11, marginBottom: 8 }}>Confiança baixa — menos de 7 dias de histórico ainda.</p>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {forecast.entries.map((e) => (
          <div key={e.threshold} style={{ background: BG_R, border: BORDER, borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
            <p style={{ color: TEXT3, fontSize: 9, fontWeight: 800, margin: '0 0 4px' }}>{e.threshold}%</p>
            <p style={{ color: TEXT2, fontSize: 12, fontWeight: 700, margin: 0 }}>{e.status === 'already_reached' ? 'já atingido' : fmtDays(e.days)}</p>
          </div>
        ))}
      </div>
    </Card>
  )
}

function InfraHealthPanelInner() {
  const [dados, setDados] = useState<InfraSnapshot | null>(null)
  const [erro, setErro] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelado = false
    async function carregar() {
      try {
        const r = await fetch('/api/dev/infra')
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const d = (await r.json()) as InfraSnapshot
        if (!cancelado) { setDados(d); setErro(''); setLoading(false) }
      } catch (e) {
        if (!cancelado) { setErro(String(e)); setLoading(false) }
      }
    }
    carregar()
    const interval = setInterval(carregar, 60_000)
    return () => { cancelado = true; clearInterval(interval) }
  }, [])

  if (loading) {
    return <Card title="Saúde da Infraestrutura"><p style={{ color: TEXT3, fontSize: 12 }}>Carregando...</p></Card>
  }
  if (erro || !dados) {
    return <Card title="Saúde da Infraestrutura" accent="color-mix(in srgb, var(--danger) 30%, transparent)"><p style={{ color: RED, fontSize: 12 }}>Falha ao carregar monitor de infraestrutura: {erro || 'resposta inválida'}</p></Card>
  }
  if (!dados.configured) {
    return <Card title="Saúde da Infraestrutura"><p style={{ color: TEXT3, fontSize: 12 }}>Monitor ainda não ativado (DEV_INFRA_MONITOR_ENABLED).</p></Card>
  }

  const pv = dados.postgresVolume
  // Esta severidade descreve SÓ o volume Postgres — nunca a infraestrutura
  // como um todo. Os serviços (Postgres/Evolution/Redis/WhatsApp) têm seu
  // próprio card, com seu próprio estado, para nunca sugerir uma conclusão
  // geral que os dados ainda não sustentam.
  const severity = (dados.collector.status === 'never' ? 'never' : pv.severity) as Severity
  const color = SEVERITY_COLOR[severity] ?? TEXT3
  const label = SEVERITY_LABEL[severity] ?? severity
  // percentUsed já vem em escala 0–100 (ver src/infra/railway/types.ts) —
  // nunca multiplicar de novo por 100 aqui.
  const pctDisplay = pv.percentUsed

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h2 style={{ color: TEXT, fontSize: 16, fontWeight: 900, margin: 0 }}>Saúde da Infraestrutura</h2>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}` }} />
        <span style={{ color: TEXT3, fontSize: 11 }}>Volume Postgres:</span>
        <span style={{ color, fontSize: 12, fontWeight: 700 }}>{label}</span>
      </div>

      {!dados.redisAvailable && (
        <p style={{ color: YELLOW, fontSize: 11 }}>Redis indisponível no momento — mostrando último estado seguro conhecido.</p>
      )}

      <Card title="Postgres Volume (Evolution)" accent={color}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 220px' }}>
            <p style={{ color: TEXT, fontSize: 22, fontWeight: 900, margin: 0 }}>{fmtBytes(pv.usedBytes)} <span style={{ color: TEXT3, fontSize: 13, fontWeight: 600 }}>/ {fmtBytes(pv.capacityBytes)}</span></p>
            <div style={{ height: 8, background: 'var(--info-soft)', borderRadius: 4, overflow: 'hidden', margin: '8px 0' }}>
              <div style={{ height: '100%', width: `${Math.min(100, pctDisplay ?? 0)}%`, background: color, borderRadius: 4 }} />
            </div>
            <p style={{ color: TEXT3, fontSize: 11, margin: 0 }}>{pctDisplay !== null ? `${pctDisplay.toFixed(1)}%` : '—'} usado · {fmtBytes(pv.freeBytes)} livre</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <p style={{ color: TEXT3, fontSize: 10, margin: 0 }}>Última coleta: <span style={{ color: TEXT2 }}>{fmtTs(dados.collector.lastRunAt)}</span></p>
            <p style={{ color: TEXT3, fontSize: 10, margin: 0 }}>Fonte da capacidade: <span style={{ color: TEXT2 }}>{pv.capacitySource ?? '—'}</span></p>
          </div>
        </div>
      </Card>

      <div className="infra-grid-3col">
        <Card title="Últimas 24h"><p style={{ color: TEXT2, fontSize: 14, fontWeight: 700, margin: 0 }}>{fmtDelta(pv.delta24hBytes)}</p></Card>
        <Card title="Últimos 7 dias"><p style={{ color: TEXT2, fontSize: 14, fontWeight: 700, margin: 0 }}>{fmtDelta(pv.delta7dBytes)}</p></Card>
        <Card title="Últimos 30 dias"><p style={{ color: TEXT2, fontSize: 14, fontWeight: 700, margin: 0 }}>{fmtDelta(pv.delta30dBytes)}</p></Card>
      </div>
      <Card title="Crescimento diário médio">
        <p style={{ color: TEXT2, fontSize: 14, fontWeight: 700, margin: 0 }}>{fmtDelta(pv.dailyGrowthBytes)}/dia</p>
        <p style={{ color: TEXT3, fontSize: 10, margin: '4px 0 0' }}>Confiança: {pv.dailyGrowthConfidence ?? '—'}</p>
      </Card>

      <ForecastCard forecast={pv.forecast} />

      {pv.anomaly?.isAnomaly && (
        <Card title="Salto anormal detectado" accent="color-mix(in srgb, var(--danger) 30%, transparent)">
          <p style={{ color: RED, fontSize: 12, margin: 0 }}>Crescimento das últimas 24h muito acima do padrão recente ({fmtBytes(pv.anomaly.last24hBytes)} vs. baseline {fmtBytes(pv.anomaly.normalDailyBaselineBytes)}/dia).</p>
        </Card>
      )}

      <Card title="Histórico (até 180 dias)">
        <HistoryChart history={dados.history} />
        <p style={{ color: TEXT3, fontSize: 10, margin: '8px 0 0' }}>● coleta automática &nbsp; ◆ medição manual verificada</p>
      </Card>

      <Card title="Serviços — conectividade (separado da saúde do volume acima)">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <ServiceDot label="Postgres" status={dados.services.postgres} />
          <ServiceDot label="Evolution API" status={dados.services.evolution} />
          <ServiceDot label="Redis" status={dados.services.redis} />
          <ServiceDot label="WhatsApp" status={dados.services.whatsapp.connectionState} />
        </div>
        <p style={{ color: TEXT3, fontSize: 10, margin: '8px 0 0' }}>&quot;Não monitorado&quot; significa que ainda não há coleta real desse serviço — não é o mesmo que uma falha observada.</p>
        {dados.services.whatsapp.limitation && (
          <p style={{ color: TEXT3, fontSize: 10, margin: '4px 0 0' }}>{dados.services.whatsapp.limitation}</p>
        )}
      </Card>

      <Card title="Alertas recentes">
        {dados.alerts.length === 0 ? (
          <p style={{ color: GREEN, fontSize: 12 }}>✓ Nenhum alerta recente.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {dados.alerts.slice(0, 20).map((a) => (
              <div key={a.id} style={{ background: BG_R, border: BORDER, borderRadius: 8, padding: '8px 10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: TEXT2, fontSize: 11, fontWeight: 700 }}>{a.type}</span>
                  <span style={{ color: TEXT3, fontSize: 10 }}>{fmtTs(a.ts)}</span>
                </div>
                <p style={{ color: TEXT3, fontSize: 11, margin: '3px 0 0' }}>{a.description}</p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

type BoundaryState = { hasError: boolean }

class InfraErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { hasError: false }
  static getDerivedStateFromError(): BoundaryState { return { hasError: true } }
  componentDidCatch(error: unknown) {
    console.error('[InfraHealthPanel] erro isolado, resto do /dev/mcp segue funcionando:', error)
  }
  render() {
    if (this.state.hasError) {
      return <Card title="Saúde da Infraestrutura" accent="color-mix(in srgb, var(--danger) 30%, transparent)"><p style={{ color: RED, fontSize: 12 }}>Falha ao renderizar o monitor de infraestrutura. O restante do painel segue disponível.</p></Card>
    }
    return this.props.children
  }
}

export default function InfraHealthPanel() {
  return (
    <InfraErrorBoundary>
      <style>{`
        .infra-grid-3col { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
        @media (max-width: 600px) { .infra-grid-3col { grid-template-columns: 1fr; } }
      `}</style>
      <InfraHealthPanelInner />
    </InfraErrorBoundary>
  )
}
