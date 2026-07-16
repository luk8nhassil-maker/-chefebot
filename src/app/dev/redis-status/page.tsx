'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type HealthStatus = 'ok' | 'degraded' | 'down'
type ComponentHealth = { status: HealthStatus; latencyMs?: number; detail: string; checkedAt: number }
type AggregateHealth = { overall: HealthStatus; redis: ComponentHealth; whatsapp: ComponentHealth; orders: ComponentHealth; checkedAt: number }
type CommandStats = { count: number; errors: number; quotaErrors: number; timeouts: number; totalLatencyMs: number; maxLatencyMs: number }
type TelemetrySnapshot = {
  windowStartedAt: number
  totalCommands: number
  totalErrors: number
  byGroup: Record<string, CommandStats>
  byOperation: Record<string, CommandStats>
  lastError: { group: string; operation: string; type: string; message: string; at: number } | null
}
type StatusResponse = {
  health: AggregateHealth
  memoria: TelemetrySnapshot
  usoEstimado: { mesAtual: Record<string, number>; diaAtual: Record<string, number>; fonte: string }
  alerta: { usoEstimado: number; limite: number; percentual: number; fonte: string; limiaresCruzados: number[]; limiarMaisAlto: number | null }
  configuracao: { limiteComandosMensal: number; avisoFonte: string }
  geradoEm: number
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

const COR_STATUS: Record<HealthStatus, string> = { ok: 'var(--success)', degraded: 'var(--primary)', down: 'var(--danger)' }
const LABEL_STATUS: Record<HealthStatus, string> = { ok: 'Saudável', degraded: 'Degradado', down: 'Indisponível' }

function Badge({ status }: { status: HealthStatus }) {
  const cor = COR_STATUS[status]
  return (
    <span style={{ background: `color-mix(in srgb, ${cor} 15%, transparent)`, color: cor, fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 20, border: `1px solid color-mix(in srgb, ${cor} 35%, transparent)` }}>
      {LABEL_STATUS[status]}
    </span>
  )
}

function ComponentCard({ title, health }: { title: string; health: ComponentHealth }) {
  return (
    <div style={{ background: 'rgba(var(--overlay-rgb), 0.03)', border: '1px solid rgba(var(--overlay-rgb), 0.08)', borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <p style={{ fontSize: 13, fontWeight: 700, margin: 0, color: 'var(--foreground)' }}>{title}</p>
        <Badge status={health.status} />
      </div>
      <p style={{ fontSize: 12, color: 'rgba(var(--overlay-rgb), 0.5)', margin: '0 0 4px' }}>{health.detail}</p>
      {typeof health.latencyMs === 'number' && (
        <p style={{ fontSize: 11, color: 'rgba(var(--overlay-rgb), 0.3)', margin: 0 }}>Latência: {health.latencyMs}ms</p>
      )}
    </div>
  )
}

export default function RedisStatusPage() {
  const router = useRouter()
  const [data, setData] = useState<StatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  // Sem estado de setState síncrono na chamada usada pelo efeito — buscar()
  // só encadeia a promise; quem quer resetar loading/erro antes (o botão
  // "Atualizar") faz isso explicitamente no próprio onClick.
  const buscar = () => {
    fetch('/api/dev/redis-status')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((d) => setData(d))
      .catch((e) => setErro(e instanceof Error ? e.message : 'Erro desconhecido'))
      .finally(() => setLoading(false))
  }

  const atualizar = () => {
    setLoading(true)
    setErro(null)
    buscar()
  }

  useEffect(() => {
    const role = getUserRole()
    if (role !== 'dev' && role !== 'admin') { router.push('/login'); return }
    // Sem polling automático deliberadamente — este painel não deve gerar
    // tráfego adicional de comandos Redis sozinho. Atualização é manual
    // (botão abaixo), a critério de quem está olhando. loading/erro já
    // começam no estado correto (true/null), então a busca inicial não
    // precisa resetá-los.
    buscar()
  }, [router])

  if (loading && !data) return (
    <div style={{ minHeight: '100vh', background: 'var(--info-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: 'rgba(var(--overlay-rgb), 0.3)' }}>Carregando...</p>
    </div>
  )

  const gruposOrdenados = data ? Object.entries(data.memoria.byGroup).sort((a, b) => b[1].count - a[1].count) : []

  return (
    <div style={{ minHeight: '100vh', background: 'var(--info-soft)', padding: '24px 16px', fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <h1 style={{ color: 'var(--attention)', fontSize: 22, fontWeight: 800, margin: 0 }}>Redis — Telemetria &amp; Saúde</h1>
            <p style={{ color: 'rgba(var(--overlay-rgb), 0.3)', fontSize: 13, margin: '4px 0 0' }}>Etapa C do Programa de Saúde de Dados — só leitura</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={atualizar} disabled={loading} style={{ background: 'color-mix(in srgb, var(--info) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--info) 30%, transparent)', color: 'var(--info)', borderRadius: 8, padding: '8px 14px', cursor: loading ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700 }}>
              {loading ? 'Atualizando...' : 'Atualizar'}
            </button>
            <button onClick={() => router.push('/dev')} style={{ background: 'rgba(var(--overlay-rgb), 0.05)', border: '1px solid rgba(var(--overlay-rgb), 0.1)', color: 'rgba(var(--overlay-rgb), 0.5)', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 13 }}>Dev</button>
          </div>
        </div>

        {erro && (
          <div style={{ background: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)', borderRadius: 10, padding: '12px 16px', marginBottom: 20, color: 'var(--danger)', fontSize: 13 }}>
            Falha ao carregar: {erro}
          </div>
        )}

        {data && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'rgba(var(--overlay-rgb), 0.5)', margin: 0, textTransform: 'uppercase', letterSpacing: 0.5 }}>Saúde geral</p>
              <Badge status={data.health.overall} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 24 }}>
              <ComponentCard title="Redis" health={data.health.redis} />
              <ComponentCard title="WhatsApp (config)" health={data.health.whatsapp} />
              <ComponentCard title="Pedidos" health={data.health.orders} />
            </div>

            <div style={{ background: data.alerta.limiarMaisAlto && data.alerta.limiarMaisAlto >= 85 ? 'color-mix(in srgb, var(--danger) 8%, transparent)' : 'color-mix(in srgb, var(--info) 6%, transparent)', border: `1px solid ${data.alerta.limiarMaisAlto && data.alerta.limiarMaisAlto >= 85 ? 'color-mix(in srgb, var(--danger) 25%, transparent)' : 'rgba(var(--overlay-rgb), 0.08)'}`, borderRadius: 12, padding: 18, marginBottom: 24 }}>
              <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 8px', color: 'rgba(var(--overlay-rgb), 0.5)' }}>Uso estimado do mês (fonte: {data.alerta.fonte})</p>
              <p style={{ fontSize: 28, fontWeight: 800, margin: '0 0 4px', color: 'var(--foreground)' }}>
                {data.alerta.usoEstimado.toLocaleString('pt-BR')} <span style={{ fontSize: 16, fontWeight: 500, color: 'rgba(var(--overlay-rgb), 0.4)' }}>/ {data.alerta.limite.toLocaleString('pt-BR')} ({Math.round(data.alerta.percentual)}%)</span>
              </p>
              {data.alerta.limiarMaisAlto && (
                <p style={{ fontSize: 13, color: 'var(--danger)', fontWeight: 700, margin: '4px 0 0' }}>⚠ Limiar de {data.alerta.limiarMaisAlto}% cruzado</p>
              )}
              <p style={{ fontSize: 11, color: 'rgba(var(--overlay-rgb), 0.35)', margin: '10px 0 0', lineHeight: 1.5 }}>{data.configuracao.avisoFonte}</p>
            </div>

            <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 10px', color: 'rgba(var(--overlay-rgb), 0.5)' }}>
              Rotas/grupos com maior consumo (invocação atual do processo)
            </p>
            {gruposOrdenados.length === 0 ? (
              <div style={{ background: 'rgba(var(--overlay-rgb), 0.03)', borderRadius: 12, padding: 20, textAlign: 'center', marginBottom: 24 }}>
                <p style={{ color: 'rgba(var(--overlay-rgb), 0.3)', margin: 0, fontSize: 13 }}>Nenhum comando observado ainda nesta invocação (processo pode ter iniciado a frio).</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 24 }}>
                {gruposOrdenados.map(([grupo, stats]) => (
                  <div key={grupo} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(var(--overlay-rgb), 0.03)', border: '1px solid rgba(var(--overlay-rgb), 0.06)', borderRadius: 10, padding: '10px 14px' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)' }}>{grupo}</span>
                    <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'rgba(var(--overlay-rgb), 0.5)' }}>
                      <span>{stats.count} cmds</span>
                      <span>{stats.errors} erros</span>
                      <span>lat. média {stats.count > 0 ? Math.round(stats.totalLatencyMs / stats.count) : 0}ms</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {data.health.redis.status !== 'ok' && (
              <p style={{ fontSize: 12, color: 'var(--danger)', textAlign: 'center', margin: '0 0 16px' }}>
                Redis indisponível — os números acima podem estar desatualizados ou zerados.
              </p>
            )}

            <p style={{ textAlign: 'center', color: 'rgba(var(--overlay-rgb), 0.15)', fontSize: 11, marginTop: 8 }}>
              Gerado em {new Date(data.geradoEm).toLocaleString('pt-BR')}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
