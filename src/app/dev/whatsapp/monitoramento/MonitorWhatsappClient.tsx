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
    recovered: number | null; oldestWaitingMs: number | null
  }
  canary: { state: string | null; testedAt: number | null }
  incidents: Incident[]
  health: { redis: string; evolution: string; qstash: string; qstashMissing: string[]; qstashScheduleVerified: boolean; lastSignedWorkerSuccessAt: number | null }
  stages: Stage[]
  recommendation: string
  limits: { actualServiceUsage: number | null; actualServiceCost: number | null; qstashRecoveryScheduleCallsPerDayIfActive: number; note: string }
  glossary: { accepted: string; recovered: string; counters: string }
}

const bg = 'var(--info-soft)'
const foreground = 'var(--foreground)'
const muted = 'var(--border-strong)'
const border = '1px solid rgba(var(--overlay-rgb), .12)'
const panel: React.CSSProperties = { border, background: 'rgba(var(--overlay-rgb), .035)', borderRadius: 14, padding: 18 }
const dt = (v: number | null | undefined) => v ? new Date(v).toLocaleString('pt-BR') : 'Sem evidência'
const count = (n: number | null | undefined) => n == null ? '—' : n.toLocaleString('pt-BR')
const duration = (ms: number | null | undefined) => ms == null ? 'Sem medida' : ms < 60000 ? Math.ceil(ms / 1000) + ' s' : Math.ceil(ms / 60000) + ' min'

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
          <h1 style={{ fontSize: 25, margin: '9px 0 4px', fontWeight: 800 }}>Centro de Monitoramento do WhatsApp</h1>
          <p style={{ margin: 0, color: muted, fontSize: 13 }}>Acompanhamento somente leitura da fila. Nenhum envio ou mudança de fase é feito aqui.</p>
        </div>
        <button onClick={() => { setLoading(true); void refresh() }} disabled={loading}
          style={{ cursor: loading ? 'wait' : 'pointer', padding: '10px 16px', borderRadius: 10, background: 'var(--attention)', border: 0, color: '#181818', fontWeight: 700 }}>
          {loading ? 'Consultando…' : 'Atualizar agora'}
        </button>
      </header>

      {error && <section role="alert" style={{ ...panel, marginBottom: 16, color: 'var(--danger)' }}>Não foi possível atualizar: {error}. {snapshot ? 'Os últimos dados podem estar desatualizados.' : 'Não há dados disponíveis.'}</section>}
      {!snapshot ? <div style={panel}> {loading ? 'Consultando integrações e dados da fila…' : 'Sem evidências disponíveis. Verifique a conexão e o acesso DEV.'} </div> : <>
        <p style={{ color: muted, fontSize: 12, margin: '0 0 16px' }}>
          Última verificação: {dt(snapshot.checkedAt)} · Atualização a cada 2 minutos com a aba aberta
          {stale && <strong style={{ color: 'var(--danger)' }}> · Dados antigos</strong>}
          {snapshot.since && <> · Contadores desde {dt(snapshot.since)}</>}
        </p>

        <section style={{ ...panel, marginBottom: 16, borderLeft: '4px solid var(--attention)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <div>
              <div style={{ color: muted, fontSize: 12 }}>Etapa configurada: {snapshot.stage} de 4 · modo de envio: {snapshot.mode}</div>
              <h2 style={{ margin: '6px 0 4px', fontSize: 20 }}>{current?.title ?? 'Aguardando evidências'}</h2>
              <p style={{ fontSize: 13, color: muted, margin: 0 }}>Avanço sempre manual, após verificação e aprovação. A configuração não prova aprovação anterior.</p>
            </div>
            <Status kind={current?.passed ? 'ok' : 'unknown'} label={current?.passed ? 'Critérios visíveis atendidos — exige aprovação' : 'Não aprovado para avançar'} />
          </div>
          <p style={{ margin: '14px 0 0', fontSize: 13 }}><strong>Próxima ação:</strong> {snapshot.recommendation}</p>
        </section>

        <section aria-label="Métricas da fila" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(155px,1fr))', gap: 10, marginBottom: 20 }}>
          <Metric label="Enfileiradas" value={count(m?.queued)} detail="Desde o início da medição" />
          <Metric label="Aceitas pela Evolution" value={count(m?.accepted)} detail="HTTP confirmado; entrega no telefone não medida" />
          <Metric label="Pendentes" value={count(m?.pending)} detail="Aguardando envio" />
          <Metric label="Em processamento" value={count(m?.inFlight)} />
          <Metric label="Falhas definitivas" value={count(m?.failed)} />
          <Metric label="Leases recuperados" value={count(m?.recovered)} detail="Reclassificados para revisão; não reenviados" />
          <Metric label="Intervenções" value={m ? count(m.ambiguous + m.unresolved) : '—'} detail="Ambíguas + inconsistências" />
          <Metric label="Maior espera observada" value={duration(m?.oldestWaitingMs)} detail="Amostra das primeiras posições por prioridade" />
        </section>

        <h2 style={{ fontSize: 17, margin: '24px 0 12px' }}>Saúde das integrações</h2>
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10, marginBottom: 22 }}>
          <div style={panel}><strong>Evolution</strong><div style={{ margin: '12px 0 7px' }}><Status kind={snapshot.health.evolution === 'connected' ? 'ok' : snapshot.health.evolution === 'unverified' ? 'unknown' : 'bad'} label={snapshot.health.evolution === 'connected' ? 'Conectada' : snapshot.health.evolution === 'unverified' ? 'Não verificada' : 'Desconectada'} /></div><small style={{ color: muted }}>Conexão consultada sem enviar mensagens.</small></div>
          <div style={panel}><strong>Redis</strong><div style={{ margin: '12px 0 7px' }}><Status kind={snapshot.health.redis === 'ok' ? 'ok' : 'bad'} label={snapshot.health.redis === 'ok' ? 'Leitura disponível' : 'Leitura indisponível'} /></div><small style={{ color: muted }}>Dados e contadores reais, quando acessíveis.</small></div>
          <div style={panel}><strong>QStash</strong><div style={{ margin: '12px 0 7px' }}><Status kind={snapshot.health.qstash === 'configured_not_verified' ? 'unknown' : 'bad'} label={snapshot.health.qstash === 'configured_not_verified' ? 'Configurado, agenda não comprovada' : 'Configuração incompleta'} /></div><small style={{ color: muted }}>{snapshot.health.qstashMissing.length ? 'Faltando: ' + snapshot.health.qstashMissing.join(', ') : snapshot.health.lastSignedWorkerSuccessAt ? 'Último callback assinado concluído: ' + dt(snapshot.health.lastSignedWorkerSuccessAt) + '. Não confirma a agenda periódica.' : 'Sem evidência registrada de callback concluído.'}</small></div>
        </section>

        <h2 style={{ fontSize: 17, margin: '24px 0 12px' }}>Quatro etapas de liberação</h2>
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 10, marginBottom: 24 }}>
          {snapshot.stages.map((stage) => <article key={stage.step} style={{ ...panel, border: stage.step === snapshot.stage ? '1px solid var(--attention)' : border }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: muted }}>ETAPA {stage.step} {stage.step === snapshot.stage && '· ATUAL'}</div>
            <h3 style={{ fontSize: 15, margin: '8px 0 12px' }}>{stage.title}</h3>
            {stage.checks.map((c, i) => <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 11, fontSize: 12, lineHeight: 1.5 }}>
              <span aria-hidden="true" style={{ color: c.ok === true ? 'var(--success)' : c.ok === false ? 'var(--danger)' : 'var(--attention)' }}>{c.ok === true ? '✓' : c.ok === false ? '×' : '•'}</span>
              <span>{c.text} {c.ok === null && <em style={{ color: muted }}>(sem prova)</em>}</span>
            </div>)}
            <Status kind={stage.passed ? 'ok' : 'unknown'} label={stage.passed ? 'Critérios observáveis completos' : 'Evidências insuficientes'} />
          </article>)}
        </section>

        <h2 style={{ fontSize: 17, margin: '24px 0 12px' }}>Histórico técnico de falhas</h2>
        <section style={{ ...panel, marginBottom: 22, overflowX: 'auto' }}>
          <p style={{ color: muted, fontSize: 12, marginTop: 0 }}>Somente eventos após a instrumentação, até 15 registros recentes. Nenhum telefone, nome ou conteúdo é exibido.</p>
          {!snapshot.incidents.length ? <p style={{ margin: 0, color: muted, fontSize: 13 }}>Nenhum evento registrado neste histórico. Isso não comprova ausência de falhas anteriores.</p> :
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, textAlign: 'left' }}>
            <thead><tr>{['Horário', 'Estado', 'Motivo técnico', 'HTTP'].map(h => <th key={h} style={{ padding: 9, borderBottom: border, color: muted }}>{h}</th>)}</tr></thead>
            <tbody>{snapshot.incidents.map((inc, i) => <tr key={i}>
              <td style={{ padding: 9, borderBottom: border }}>{dt(inc.at)}</td>
              <td style={{ padding: 9, borderBottom: border }}>{inc.state === 'ambiguous' ? 'Resultado incerto — revisar' : 'Falha definitiva'}</td>
              <td style={{ padding: 9, borderBottom: border }}>{inc.reason.replaceAll('_', ' ')}</td>
              <td style={{ padding: 9, borderBottom: border }}>{inc.statusHttp ?? '—'}</td>
            </tr>)}</tbody>
          </table>}
        </section>
        <section style={{ ...panel, marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Consumo e possíveis custos</h2>
          <p style={{ fontSize: 13, margin: '0 0 8px' }}>Uso faturável de Redis, Evolution, QStash e Vercel: <strong>não disponível nesta leitura</strong>. Nenhum preço ou valor estimado foi inventado.</p>
          <p style={{ fontSize: 12, margin: 0, color: muted }}>{snapshot.limits.note} Despertares adicionais dependem do tráfego; verificar o painel oficial de cada serviço antes de liberar geral.</p>
        </section>
        <footer style={{ fontSize: 12, color: muted, paddingBottom: 24, lineHeight: 1.6 }}>
          <strong>Precisão:</strong> {snapshot.glossary.accepted} {snapshot.glossary.recovered} {snapshot.glossary.counters}
          <p>Para iniciar o canário autorizado, use o diagnóstico já existente em <a href="/dev/whatsapp" style={{ color: 'var(--attention)' }}>Diagnóstico WhatsApp</a>. Este Centro não envia nenhuma mensagem.</p>
        </footer>
      </>}
    </div>
  </main>
}
