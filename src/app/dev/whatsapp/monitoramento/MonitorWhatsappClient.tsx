'use client'

import { useCallback, useEffect, useState } from 'react'

type Check = { text: string; ok: boolean | null }
type Stage = { step: number; title: string; passed: boolean; checks: Check[] }
type Incident = { state: string; at: number; reason: string; statusHttp: number | null }
type Snapshot = {
  checkedAt: number; stage: number; mode: string; since: number | null
  metrics: null | {
    pending: number; inFlight: number; ambiguous: number; unresolved: number
    queued: number | null; accepted: number | null; failed: number | null
    recovered: number | null; closedCanaryNoRetry?: number | null; oldestWaitingMs: number | null
  }
  canary: { state: string | null; testedAt: number | null }
  diagnostics?: { acceptedCounter: string; canaryOutbox: string }
  incidents: Incident[]
  health: { redis: string; evolution: string; qstash: string; qstashMissing: string[]; qstashScheduleVerified: boolean; lastSignedWorkerSuccessAt: number | null }
  stages: Stage[]
  recommendation: string
  limits: { actualServiceUsage: number | null; actualServiceCost: number | null; qstashRecoveryScheduleCallsPerDayIfActive: number; note: string }
  glossary: { accepted: string; recovered: string; counters: string }
}

const bg = 'var(--info-soft)'
const foreground = 'var(--foreground)'
const muted = 'var(--foreground-muted)'
const border = '1px solid rgba(var(--overlay-rgb), .12)'
const panel: React.CSSProperties = { border, background: 'rgba(var(--overlay-rgb), .035)', borderRadius: 14, padding: 18 }
const dt = (v: number | null | undefined) => v ? new Date(v).toLocaleString('pt-BR') : 'Sem evidência'
const count = (n: number | null | undefined) => n == null ? '—' : n.toLocaleString('pt-BR')
const duration = (ms: number | null | undefined) => ms == null ? 'Sem medida' : ms < 60000 ? Math.ceil(ms / 1000) + ' s' : Math.ceil(ms / 60000) + ' min'
const evidenceLabels: Record<string, string> = {
  not_recorded: 'Contador ainda não registrado; não comprova ausência de envios.',
  read_failed: 'Leitura indisponível; não é confirmação de falha de envio.',
  not_linked: 'Canário sem vínculo com job da outbox; HTTP isolado não comprova passagem pela fila.',
  job_missing: 'Job vinculado não encontrado; confirmação da outbox não disponível.',
  invalid_state: 'Estado do job inconsistente; exige investigação, sem reenvio.',
  pending: 'Job aguardando processamento.',
  leased: 'Job reservado para processamento.',
  delivered: 'Job aceito pela Evolution; não equivale a entrega no aparelho.',
  failed: 'Job com falha definitiva.',
  ambiguous: 'Resultado incerto em quarentena; não reenviar automaticamente.',
  suppressed: 'Job suprimido pela política de envio.',
  expired: 'Job expirado sem envio.',
}

function Status({ label, kind }: { label: string; kind: 'ok' | 'bad' | 'unknown' }) {
  const colors = { ok: 'var(--success)', bad: 'var(--danger)', unknown: 'var(--attention)' }
  const c = colors[kind]
  return <span style={{ display: 'inline-block', border: `1px solid color-mix(in srgb, ${c} 35%, transparent)`, borderRadius: 30, padding: '4px 10px', fontSize: 12, fontWeight: 700, color: c, background: `color-mix(in srgb, ${c} 8%, transparent)` }}>{label}</span>
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div style={panel}>
    <div style={{ fontSize: 12, color: muted, marginBottom: 8 }}>{label}</div>
    <div style={{ color: foreground, fontSize: 28, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    {detail && <div style={{ fontSize: 11, color: muted, marginTop: 5, lineHeight: 1.5 }}>{detail}</div>}
  </div>
}

export default function MonitorWhatsappClient() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch('/api/dev/whatsapp/monitoramento', { cache: 'no-store', credentials: 'same-origin', signal })
      if (!response.ok) throw new Error(response.status === 403 || response.status === 401 ? 'Acesso exclusivo aos desenvolvedores.' : 'Falha HTTP ' + response.status)
      const data = await response.json() as Snapshot
      if (signal?.aborted) return
      setSnapshot(data)
      setError(null)
    } catch (err) {
      if (signal?.aborted) return
      setError(err instanceof Error ? err.message : 'Não foi possível carregar dados atuais')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void refresh(controller.signal)
    // Intervalo econômico: leitura automática a cada 2 minutos só com a aba visível.
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh(controller.signal)
    }, 120000)
    return () => { controller.abort(); window.clearInterval(interval) }
  }, [refresh])

  const m = snapshot?.metrics
  const current = snapshot?.stages.find(s => s.step === snapshot.stage)
  const stale = snapshot ? Date.now() - snapshot.checkedAt > 300000 : false

  return <main style={{ minHeight: '100vh', background: bg, color: foreground, padding: '28px 16px', fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
    <div style={{ maxWidth: 1140, margin: '0 auto' }}>
      <header style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 14, marginBottom: 22 }}>
        <div>
          <a href="/dev" style={{ color: muted, textDecoration: 'none', fontSize: 12 }}>← Área DEV</a>
          <h1 style={{ fontSize: 25, margin: '9px 0 4px', fontWeight: 800 }}>Monitoramento do WhatsApp</h1>
          <p style={{ margin: 0, color: muted, fontSize: 13 }}>Visão exclusiva DEV · Somente leitura</p>
        </div>
        <button onClick={() => { setLoading(true); void refresh() }} disabled={loading}
          style={{ cursor: loading ? 'wait' : 'pointer', padding: '10px 16px', borderRadius: 10, background: 'var(--attention)', border: 0, color: '#fff', fontWeight: 700 }}>
          {loading ? 'Consultando…' : 'Atualizar agora'}
        </button>
      </header>

      {error && <section role="alert" style={{ ...panel, marginBottom: 16, color: 'var(--danger)' }}>Não foi possível atualizar: {error}. {snapshot ? 'Os últimos dados podem estar desatualizados.' : 'Não há dados disponíveis.'}</section>}
      {!snapshot ? <div style={panel}> {loading ? 'Consultando integrações e dados da fila…' : 'Sem evidências disponíveis. Verifique a conexão e o acesso DEV.'} </div> : <>
        <p style={{ color: muted, fontSize: 12, margin: '0 0 16px' }}>
          Atualizado em {dt(snapshot.checkedAt)} · a cada 2 minutos com a aba aberta
          {stale && <strong style={{ color: 'var(--danger)' }}> · Dados antigos</strong>}
          {snapshot.since && <> · Contadores desde {dt(snapshot.since)}</>}
        </p>

        <section style={{ ...panel, marginBottom: 16, borderLeft: '4px solid var(--attention)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <div>
              <div style={{ color: muted, fontSize: 12 }}>Etapa {snapshot.stage} de 4 · modo: {snapshot.mode}</div>
              <h2 style={{ margin: '6px 0 4px', fontSize: 20 }}>{current?.title ?? 'Aguardando evidências'}</h2>
              <p style={{ fontSize: 13, color: muted, margin: 0 }}>O monitor não autoriza nem altera a liberação.</p>
            </div>
            <Status kind={current?.passed ? 'ok' : 'unknown'} label={current?.passed ? 'Critérios visíveis atendidos — exige aprovação' : 'Não aprovado para avançar'} />
          </div>
          <p style={{ margin: '14px 0 0', fontSize: 13, lineHeight: 1.6 }}><strong>O que fazer agora:</strong> {snapshot.recommendation}</p>
        </section>

        <h2 style={{ fontSize: 17, margin: '20px 0 12px' }}>Resumo da fila</h2>
        <section aria-label="Indicadores principais" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(145px,1fr))', gap: 10, marginBottom: 12 }}>
          <Metric label="Pendentes" value={count(m?.pending)} detail="Aguardando envio" />
          <Metric label="Aceitas pela Evolution" value={count(m?.accepted)} detail={evidenceLabels[snapshot.diagnostics?.acceptedCounter ?? ''] ?? 'Confirmação HTTP; não é entrega no aparelho'} />
          <Metric label="Falhas definitivas" value={count(m?.failed)} detail="Acumuladas desde o início da medição" />
          <Metric label="Precisam de revisão" value={m ? count(m.ambiguous + m.unresolved) : '—'} detail="Resultados incertos e inconsistências" />
        </section>
        {snapshot.diagnostics && <p style={{ color: muted, fontSize: 12 }}><strong>Evidência do canário na fila:</strong> {evidenceLabels[snapshot.diagnostics.canaryOutbox] ?? 'Estado não verificado.'}</p>}
        <details style={{ ...panel, marginBottom: 20, padding: '12px 16px' }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>Ver outros indicadores da fila</summary>
          <section aria-label="Indicadores adicionais" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(145px,1fr))', gap: 10, marginTop: 14 }}>
            <Metric label="Enfileiradas" value={count(m?.queued)} detail="Desde o início da medição" />
            <Metric label="Em processamento" value={count(m?.inFlight)} />
            <Metric label="Leases recuperados" value={count(m?.recovered)} detail="Movidos para revisão; sem reenvio" />
            <Metric label="Testes antigos encerrados" value={count(m?.closedCanaryNoRetry)} detail="Encerrados sem reenvio, não comprovados como entregues" />
            <Metric label="Maior espera observada" value={duration(m?.oldestWaitingMs)} detail="Amostra por prioridade" />
          </section>
        </details>

        <h2 style={{ fontSize: 17, margin: '24px 0 12px' }}>Saúde das integrações</h2>
        <section aria-label="Saúde das integrações" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 10, marginBottom: 12 }}>
          <div style={{ ...panel, padding: 14 }}><strong>Evolution</strong><div style={{ marginTop: 8 }}><Status kind={snapshot.health.evolution === 'connected' ? 'ok' : snapshot.health.evolution === 'unverified' ? 'unknown' : 'bad'} label={snapshot.health.evolution === 'connected' ? 'Conectada' : snapshot.health.evolution === 'unverified' ? 'Não verificada' : 'Desconectada'} /></div></div>
          <div style={{ ...panel, padding: 14 }}><strong>Redis</strong><div style={{ marginTop: 8 }}><Status kind={snapshot.health.redis === 'ok' ? 'ok' : 'bad'} label={snapshot.health.redis === 'ok' ? 'Disponível' : 'Indisponível'} /></div></div>
          <div style={{ ...panel, padding: 14 }}><strong>QStash</strong><div style={{ marginTop: 8 }}><Status kind="unknown" label={snapshot.health.qstash === 'configured_not_verified' ? 'Agenda não verificada' : 'Configuração incompleta'} /></div></div>
        </section>
        <details style={{ ...panel, marginBottom: 20, padding: '12px 16px' }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>Ver detalhes das conexões</summary>
          <div style={{ color: muted, fontSize: 12, lineHeight: 1.7, marginTop: 12 }}>
            <p style={{ margin: '0 0 8px' }}><strong>Evolution:</strong> estado consultado sem enviar mensagens.</p>
            <p style={{ margin: '0 0 8px' }}><strong>Redis:</strong> dados e contadores reais somente quando a leitura está disponível.</p>
            <p style={{ margin: 0 }}><strong>QStash:</strong> {snapshot.health.qstashMissing.length ? 'Configuração pendente: ' + snapshot.health.qstashMissing.join(', ') + '. ' : ''}
              {snapshot.health.lastSignedWorkerSuccessAt ? 'Último callback assinado concluído: ' + dt(snapshot.health.lastSignedWorkerSuccessAt) + '. ' : 'Sem callback concluído comprovado. '}
              A agenda periódica não foi comprovada.</p>
          </div>
        </details>

        <h2 style={{ fontSize: 17, margin: '24px 0 12px' }}>Etapas de liberação</h2>
        <section aria-label="Etapas de liberação" style={{ ...panel, padding: '4px 16px', marginBottom: 22 }}>
          {snapshot.stages.map(stage => <details key={stage.step} style={{ borderBottom: stage.step === 4 ? 'none' : border, padding: '12px 0' }}>
            <summary style={{ cursor: 'pointer', fontSize: 13, lineHeight: 1.6 }}>
              <strong>Etapa {stage.step} · {stage.title}</strong>
              {stage.step === snapshot.stage && <span style={{ marginLeft: 8, color: 'var(--attention)', fontWeight: 700 }}>Atual</span>}
              <span style={{ display: 'block', color: muted, fontSize: 12 }}>{stage.passed ? 'Critérios observáveis atendidos — requer aprovação' : 'Evidências insuficientes'}</span>
            </summary>
            <div style={{ padding: '12px 0 0 18px' }}>
              {stage.checks.map((c, i) => <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 10, fontSize: 12, lineHeight: 1.5 }}>
                <span aria-hidden="true" style={{ color: c.ok === true ? 'var(--success)' : c.ok === false ? 'var(--danger)' : 'var(--attention)' }}>{c.ok === true ? '✓' : c.ok === false ? '×' : '•'}</span>
                <span>{c.text} {c.ok === null && <em style={{ color: muted }}>(sem prova)</em>}</span>
              </div>)}
            </div>
          </details>)}
        </section>

        <details style={{ ...panel, marginBottom: 12, padding: '12px 16px' }}>
          <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>
            Histórico de incidentes · {snapshot.incidents.length} {snapshot.incidents.length === 1 ? 'registro recente' : 'registros recentes'}
          </summary>
          <div style={{ marginTop: 14, overflowX: 'auto' }}>
            <p style={{ color: muted, fontSize: 12, marginTop: 0 }}>Até 15 eventos após a instrumentação. Sem telefone, nome ou conteúdo de mensagem.</p>
            {!snapshot.incidents.length ? <p style={{ margin: 0, color: muted, fontSize: 13 }}>Sem eventos neste histórico. Isso não comprova ausência de falhas anteriores.</p> :
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, textAlign: 'left' }}>
              <thead><tr>{['Horário', 'Estado', 'Motivo técnico', 'HTTP'].map(h => <th key={h} style={{ padding: 9, borderBottom: border, color: muted }}>{h}</th>)}</tr></thead>
              <tbody>{snapshot.incidents.map((inc, i) => <tr key={i}>
                <td style={{ padding: 9, borderBottom: border }}>{dt(inc.at)}</td>
                <td style={{ padding: 9, borderBottom: border }}>{inc.state === 'ambiguous' ? 'Resultado incerto — revisar' : 'Falha definitiva'}</td>
                <td style={{ padding: 9, borderBottom: border }}>{inc.reason.replaceAll('_', ' ')}</td>
                <td style={{ padding: 9, borderBottom: border }}>{inc.statusHttp ?? '—'}</td>
              </tr>)}</tbody>
            </table>}
          </div>
        </details>
        <details style={{ ...panel, marginBottom: 20, padding: '12px 16px' }}>
          <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>Consumo e custos</summary>
          <p style={{ fontSize: 13, margin: '12px 0 8px' }}>Uso faturável de Redis, Evolution, QStash e Vercel: <strong>não disponível nesta leitura</strong>. Nenhum preço foi estimado.</p>
          <p style={{ fontSize: 12, margin: 0, color: muted }}>{snapshot.limits.note} Verificar os painéis oficiais antes de liberar geral.</p>
        </details>
        <footer style={{ fontSize: 12, color: muted, paddingBottom: 24, lineHeight: 1.6 }}>
          <p>O Centro não envia mensagens nem altera a etapa. O canário autorizado fica no <a href="/dev/whatsapp" style={{ color: 'var(--attention)' }}>Diagnóstico WhatsApp</a>.</p>
          <details><summary style={{ cursor: 'pointer' }}>Como interpretar os números</summary>
            <p>{snapshot.glossary.accepted} {snapshot.glossary.recovered} {snapshot.glossary.counters}</p>
          </details>
        </footer>
      </>}
    </div>
  </main>
}
