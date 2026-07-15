'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type PontoSerie = { rotulo: string; valor: number }
type SerieMetrica = { nome: string; horas: PontoSerie[]; dias: PontoSerie[]; temDados: boolean }
type UltimoEvento = { tipo: string; ts: number } | null

type PainelPix = {
  geradoEm: string
  metricasTemporaisDesde: string
  resumo: { encontrados: number; confirmados: number; pendentes: number; expirados: number; taxaConfirmacao: number | null }
  origem: Record<string, number> & { identificadasPeloSentinelaUltimos30Dias: number }
  latencia: {
    amostras: number
    mediaMs: number | null
    p50Ms: number | null
    p95Ms: number | null
    p99Ms: number | null
    faixas: { ate5s: number; de5a10s: number; de10a30s: number; de30sa2min: number; acimaDe2min: number }
  }
  eficiencia: {
    mensagensQstashPublicadas: number
    consultasRealizadas: number
    consultasEvitadas: number
    mensagensAntigasIgnoradas: number
    mensagensDuplicadasIgnoradas: number
    consultasCoalescidas: number
    bloqueiosCooldownUltimos30Dias: number
    bloqueiosRateLimitUltimos30Dias: number
    bloqueiosProximaConsultaUltimos30Dias: number
    bloqueiosLockUltimos30Dias: number
    proporcaoConsultaPorMensagem: number | null
  }
  saude: {
    timeout: number
    rateLimited: number
    locksRecuperados: number
    ultimoEvento: UltimoEvento
    ultimaConfirmacaoAutomatica: UltimoEvento
  }
  series: SerieMetrica[]
}

const BG = 'var(--info-soft)'
const BORDER = '1px solid var(--info-soft)'
const TEXT = 'var(--info)'
const TEXT3 = 'var(--info)'
const PURPLE = 'var(--attention)'
const PURPLE_L = 'var(--attention)'
const GREEN = 'var(--success)'
const YELLOW = 'var(--primary)'
const RED = 'var(--danger)'
const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif"

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

function pct(n: number | null): string {
  if (n === null) return '—'
  return `${Math.round(n * 100)}%`
}

function formatTs(ts: number | null | undefined): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  })
}

const NOME_EVENTO_LABEL: Record<string, string> = {
  sentinela_confirmou: 'Confirmadas pelo Sentinela',
  sentinela_bloqueio_cooldown: 'Bloqueios · cooldown',
  sentinela_bloqueio_rate_limit: 'Bloqueios · rate limit',
  sentinela_bloqueio_proxima_consulta: 'Bloqueios · próxima consulta',
  sentinela_bloqueio_lock: 'Bloqueios · lock',
}

function Card({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--surface-secondary)', border: BORDER, borderRadius: 12, padding: 18 }}>
      <p style={{ color: TEXT3, fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8, margin: '0 0 12px' }}>{titulo}</p>
      {children}
    </div>
  )
}

function Stat({ label, valor, cor }: { label: string; valor: string | number; cor?: string }) {
  return (
    <div style={{ background: 'var(--surface)', border: BORDER, borderRadius: 8, padding: '10px 12px' }}>
      <p style={{ color: TEXT3, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', margin: '0 0 4px' }}>{label}</p>
      <p style={{ color: cor || TEXT, fontSize: 18, fontWeight: 900, margin: 0 }}>{valor}</p>
    </div>
  )
}

function ResumoCard({ dados }: { dados: PainelPix }) {
  const r = dados.resumo
  return (
    <Card titulo="Resumo atual — Pix Mercado Pago">
      <div className="pixdev-grid-5">
        <Stat label="Encontrados" valor={r.encontrados} />
        <Stat label="Confirmados" valor={r.confirmados} cor={GREEN} />
        <Stat label="Pendentes" valor={r.pendentes} cor={YELLOW} />
        <Stat label="Expirados" valor={r.expirados} cor={RED} />
        <Stat label="Taxa de confirmação" valor={pct(r.taxaConfirmacao)} />
      </div>
    </Card>
  )
}

function OrigemCard({ dados }: { dados: PainelPix }) {
  const o = dados.origem
  return (
    <Card titulo="Origem da confirmação">
      <div className="pixdev-grid-4">
        <Stat label="Webhook" valor={o.webhook || 0} />
        <Stat label="Confirmação manual" valor={o.manual || 0} />
        <Stat label="Conciliador Mercado Pago" valor={o.conciliador_mercadopago || 0} />
        <Stat label="Identificadas pelo Sentinela (últimos 30 dias)" valor={o.identificadasPeloSentinelaUltimos30Dias} cor={PURPLE_L} />
      </div>
    </Card>
  )
}

function LatenciaCard({ dados }: { dados: PainelPix }) {
  const l = dados.latencia
  return (
    <Card titulo="Latência de confirmação">
      <div className="pixdev-grid-4" style={{ marginBottom: 12 }}>
        <Stat label="Amostras" valor={l.amostras} />
        <Stat label="Média" valor={l.mediaMs !== null ? `${(l.mediaMs / 1000).toFixed(1)}s` : '—'} />
        <Stat label="p50" valor={l.p50Ms !== null ? `${(l.p50Ms / 1000).toFixed(1)}s` : '—'} />
        <Stat label="p95" valor={l.p95Ms !== null ? `${(l.p95Ms / 1000).toFixed(1)}s` : '—'} />
      </div>
      <p style={{ color: TEXT3, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', margin: '0 0 8px' }}>Faixas</p>
      <div className="pixdev-grid-5">
        <Stat label="Até 5s" valor={l.faixas.ate5s} cor={GREEN} />
        <Stat label="5–10s" valor={l.faixas.de5a10s} cor={GREEN} />
        <Stat label="10–30s" valor={l.faixas.de10a30s} cor={YELLOW} />
        <Stat label="30s–2min" valor={l.faixas.de30sa2min} cor={YELLOW} />
        <Stat label="Acima de 2min" valor={l.faixas.acimaDe2min} cor={RED} />
      </div>
    </Card>
  )
}

function EficienciaCard({ dados }: { dados: PainelPix }) {
  const e = dados.eficiencia
  return (
    <Card titulo="Eficiência do Sentinela / QStash">
      <div className="pixdev-grid-4">
        <Stat label="Mensagens QStash publicadas" valor={e.mensagensQstashPublicadas} />
        <Stat label="Consultas realizadas" valor={e.consultasRealizadas} />
        <Stat label="Consultas evitadas" valor={e.consultasEvitadas} cor={GREEN} />
        <Stat label="Consultas coalescidas" valor={e.consultasCoalescidas} cor={GREEN} />
        <Stat label="Mensagens antigas ignoradas" valor={e.mensagensAntigasIgnoradas} />
        <Stat label="Mensagens duplicadas ignoradas" valor={e.mensagensDuplicadasIgnoradas} />
        <Stat label="Bloqueios · cooldown (últimos 30 dias)" valor={e.bloqueiosCooldownUltimos30Dias} />
        <Stat label="Bloqueios · rate limit (últimos 30 dias)" valor={e.bloqueiosRateLimitUltimos30Dias} />
        <Stat label="Bloqueios · próxima consulta (últimos 30 dias)" valor={e.bloqueiosProximaConsultaUltimos30Dias} />
        <Stat label="Bloqueios · lock (últimos 30 dias)" valor={e.bloqueiosLockUltimos30Dias} />
        <Stat label="Proporção consultas/mensagens" valor={e.proporcaoConsultaPorMensagem === null ? '—' : e.proporcaoConsultaPorMensagem} cor={PURPLE_L} />
      </div>
    </Card>
  )
}

function SaudeCard({ dados }: { dados: PainelPix }) {
  const s = dados.saude
  return (
    <Card titulo="Saúde">
      <div className="pixdev-grid-4">
        <Stat label="Timeout" valor={s.timeout} cor={s.timeout > 0 ? YELLOW : GREEN} />
        <Stat label="Rate limited" valor={s.rateLimited} cor={s.rateLimited > 0 ? YELLOW : GREEN} />
        <Stat label="Locks recuperados" valor={s.locksRecuperados} />
        <div />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
          <span style={{ color: TEXT3 }}>Último evento técnico</span>
          <span style={{ color: TEXT, fontFamily: 'monospace' }}>
            {s.ultimoEvento ? `${s.ultimoEvento.tipo} · ${formatTs(s.ultimoEvento.ts)}` : 'Nenhum ainda'}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
          <span style={{ color: TEXT3 }}>Última confirmação pelo Sentinela</span>
          <span style={{ color: TEXT, fontFamily: 'monospace' }}>
            {s.ultimaConfirmacaoAutomatica ? formatTs(s.ultimaConfirmacaoAutomatica.ts) : 'Nenhuma ainda'}
          </span>
        </div>
      </div>
    </Card>
  )
}

function MiniBarra({ pontos, cor }: { pontos: PontoSerie[]; cor: string }) {
  const max = Math.max(1, ...pontos.map((p) => p.valor))
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 48 }}>
      {pontos.map((p, i) => (
        <div key={i} title={`${p.rotulo}: ${p.valor}`} style={{ flex: 1, height: `${Math.max(2, (p.valor / max) * 48)}px`, background: p.valor > 0 ? cor : 'var(--info-soft)', borderRadius: 2 }} />
      ))}
    </div>
  )
}

function SeriesCard({ dados }: { dados: PainelPix }) {
  if (dados.series.length === 0) {
    return (
      <Card titulo="Série recente (buckets)">
        <p style={{ color: TEXT3, fontSize: 12 }}>Nenhum bucket com dados ainda — as métricas temporais só existem a partir desta versão.</p>
      </Card>
    )
  }
  return (
    <Card titulo="Série recente (buckets)">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {dados.series.map((s) => (
          <div key={s.nome}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ color: TEXT, fontSize: 12, fontWeight: 700 }}>{NOME_EVENTO_LABEL[s.nome] || s.nome}</span>
              <span style={{ color: TEXT3, fontSize: 10 }}>últimas 24h</span>
            </div>
            <MiniBarra pontos={s.horas} cor={PURPLE} />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, marginBottom: 6 }}>
              <span style={{ color: TEXT3, fontSize: 10 }}>últimos 30 dias</span>
            </div>
            <MiniBarra pontos={s.dias} cor={PURPLE_L} />
          </div>
        ))}
      </div>
    </Card>
  )
}

export default function DevPixPage() {
  const router = useRouter()
  const [dados, setDados] = useState<PainelPix | null>(null)
  const [loading, setLoading] = useState(true)
  const [atualizando, setAtualizando] = useState(false)
  const [erro, setErro] = useState('')

  const carregar = (mostrarSpinner: boolean) => {
    if (mostrarSpinner) setAtualizando(true)
    fetch('/api/dev/pix')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<PainelPix>
      })
      .then((d) => { setDados(d); setLoading(false); setErro('') })
      .catch((e) => { setErro(String(e)); setLoading(false) })
      .finally(() => setAtualizando(false))
  }

  useEffect(() => {
    const role = getUserRole()
    if (role !== 'dev') { router.push('/login'); return }
    fetch('/api/dev/pix')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<PainelPix>
      })
      .then((d) => { setDados(d); setLoading(false); setErro('') })
      .catch((e) => { setErro(String(e)); setLoading(false) })
  }, [router])

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: BG, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT }}>
        <p style={{ color: TEXT3 }}>Carregando...</p>
      </div>
    )
  }

  if (erro || !dados) {
    return (
      <div style={{ minHeight: '100vh', background: BG, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: RED, fontSize: 14, fontWeight: 700 }}>Erro ao carregar dados do Sentinela Pix</p>
          <p style={{ color: TEXT3, fontSize: 12, marginTop: 6 }}>{erro || 'Resposta inválida'}</p>
          <button onClick={() => carregar(false)} style={{ marginTop: 16, background: PURPLE, border: 'none', color: 'var(--foreground)', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>Tentar novamente</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: BG, padding: '24px 16px', fontFamily: FONT }}>
      <style>{`
        .pixdev-grid-5 { display: grid; grid-template-columns: repeat(5, minmax(0,1fr)); gap: 8px; }
        .pixdev-grid-4 { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 8px; }
        @media (max-width: 700px) {
          .pixdev-grid-5 { grid-template-columns: repeat(2, minmax(0,1fr)); }
          .pixdev-grid-4 { grid-template-columns: repeat(2, minmax(0,1fr)); }
        }
      `}</style>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <p style={{ color: PURPLE_L, fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2, margin: '0 0 4px' }}>Sentinela Pix · Observabilidade</p>
            <h1 style={{ color: TEXT, fontSize: 22, fontWeight: 900, margin: 0 }}>Painel Dev — Pix</h1>
            <p style={{ color: TEXT3, fontSize: 12, margin: '4px 0 0' }}>Somente leitura · Nenhuma ação financeira disponível aqui</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => router.push('/dev')} style={{ background: 'color-mix(in srgb, var(--attention) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--attention) 30%, transparent)', color: PURPLE_L, borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
              ← Dev
            </button>
            <button onClick={() => carregar(true)} disabled={atualizando} style={{ background: 'rgba(var(--overlay-rgb), 0.05)', border: BORDER, color: TEXT3, borderRadius: 8, padding: '8px 14px', cursor: atualizando ? 'not-allowed' : 'pointer', fontSize: 12 }}>
              {atualizando ? 'Atualizando...' : 'Atualizar dados'}
            </button>
          </div>
        </div>

        <div style={{ background: 'color-mix(in srgb, var(--attention) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--attention) 25%, transparent)', borderRadius: 10, padding: '10px 14px', marginBottom: 20 }}>
          <p style={{ color: PURPLE_L, fontSize: 12, margin: 0, lineHeight: 1.5 }}>{dados.metricasTemporaisDesde}</p>
          <p style={{ color: TEXT3, fontSize: 10, margin: '4px 0 0' }}>Gerado em {formatTs(new Date(dados.geradoEm).getTime())}</p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <ResumoCard dados={dados} />
          <OrigemCard dados={dados} />
          <LatenciaCard dados={dados} />
          <EficienciaCard dados={dados} />
          <SaudeCard dados={dados} />
          <SeriesCard dados={dados} />
        </div>

      </div>
    </div>
  )
}
