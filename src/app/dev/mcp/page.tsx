'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { DadosMcp } from '@/mcp/lib/mcpReader'
import type { PadraoObservado } from '@/mcp/types'
import InfraHealthPanel from '@/components/dev/InfraHealthPanel'

const BG = 'var(--info-soft)'
const BG_S = 'var(--info-soft)'
const BG_R = 'var(--info-soft)'
const BORDER = '1px solid var(--info-soft)'

const TEXT = 'var(--info)'
const TEXT2 = 'var(--info)'
const TEXT3 = 'var(--info)'
const PURPLE = 'var(--attention)'
const PURPLE_L = 'var(--attention)'
const GREEN = 'var(--success)'
const YELLOW = 'var(--primary)'
const RED = 'var(--danger)'
const ORANGE = 'var(--primary)'
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

const PADRAO_COR: Record<PadraoObservado, string> = {
  avanco_normal: 'var(--attention)',
  interpretacao_ok: 'var(--info)',
  sem_mudanca: 'var(--info)',
  confusao_simples: 'var(--primary)',
  confusao_com_escalacao: 'var(--danger)',
  escalacao_direta: 'var(--danger)',
  desconhecido: 'var(--info)',
}

const PADRAO_LABEL: Record<PadraoObservado, string> = {
  avanco_normal: 'Avanço normal',
  interpretacao_ok: 'IA auxiliou',
  sem_mudanca: 'Sem mudança',
  confusao_simples: 'Confusão simples',
  confusao_com_escalacao: 'Confusão+escalação',
  escalacao_direta: 'Escalação direta',
  desconhecido: 'Desconhecido',
}

const PADROES_ORDENADOS: PadraoObservado[] = [
  'avanco_normal', 'interpretacao_ok', 'sem_mudanca',
  'confusao_simples', 'confusao_com_escalacao', 'escalacao_direta', 'desconhecido',
]

function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}

function formatTs(ts: number): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  })
}

function ScoreRing({ score }: { score: number }) {
  const deg = Math.min(360, (score / 100) * 360)
  const color = score >= 70 ? GREEN : score >= 40 ? YELLOW : RED
  return (
    <div style={{ width: 88, height: 88, borderRadius: '50%', background: `conic-gradient(${color} 0deg ${deg}deg, var(--info-soft) ${deg}deg 360deg)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <div style={{ width: 66, height: 66, borderRadius: '50%', background: BG_R, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 900, color }}>
        {score}%
      </div>
    </div>
  )
}

function StatusMcp({ dados }: { dados: DadosMcp }) {
  const modo = dados.cronMeta?.mode ?? 'off'
  const ativo = modo === 'observador' || modo === 'copiloto' || modo === 'automatico'
  const statusColor = ativo ? GREEN : YELLOW
  return (
    <div style={{ background: BG_S, border: BORDER, borderRadius: 12, padding: 18 }}>
      <p style={{ color: TEXT3, fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8, margin: '0 0 12px' }}>Status MCP</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: statusColor, flexShrink: 0, boxShadow: `0 0 6px ${statusColor}` }} />
        <span style={{ color: statusColor, fontSize: 14, fontWeight: 800 }}>MCP_MODE = {modo}</span>
      </div>
      <div className="mcp-status-3col">
        <div style={{ background: BG_R, border: BORDER, borderRadius: 8, padding: '10px 12px' }}>
          <p style={{ color: TEXT3, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', margin: '0 0 4px' }}>Fila</p>
          <p style={{ color: dados.filaCount > 0 ? ORANGE : GREEN, fontSize: 20, fontWeight: 900, margin: 0 }}>{dados.filaCount}</p>
          <p style={{ color: TEXT3, fontSize: 9, margin: '2px 0 0' }}>eventos pendentes</p>
        </div>
        <div style={{ background: BG_R, border: BORDER, borderRadius: 8, padding: '10px 12px' }}>
          <p style={{ color: TEXT3, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', margin: '0 0 4px' }}>Obs. logs</p>
          <p style={{ color: PURPLE_L, fontSize: 20, fontWeight: 900, margin: 0 }}>{dados.obsCount}</p>
          <p style={{ color: TEXT3, fontSize: 9, margin: '2px 0 0' }}>processadas</p>
        </div>
        <div style={{ background: BG_R, border: BORDER, borderRadius: 8, padding: '10px 12px' }}>
          <p style={{ color: TEXT3, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', margin: '0 0 4px' }}>Erros</p>
          <p style={{ color: dados.errosCount > 0 ? RED : GREEN, fontSize: 20, fontWeight: 900, margin: 0 }}>{dados.errosCount}</p>
          <p style={{ color: TEXT3, fontSize: 9, margin: '2px 0 0' }}>capturados</p>
        </div>
      </div>
    </div>
  )
}

function ScorePanel({ dados }: { dados: DadosMcp }) {
  const s = dados.scoreMaturidade
  const pronto = dados.prontoParaFase2
  return (
    <div style={{ background: BG_S, border: BORDER, borderRadius: 12, padding: 18 }}>
      <p style={{ color: TEXT3, fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8, margin: '0 0 14px' }}>Score de maturidade</p>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 14 }}>
        <ScoreRing score={s.total} />
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ color: TEXT2, fontSize: 11 }}>Volume</span>
            <span style={{ color: TEXT, fontSize: 11, fontWeight: 700 }}>{s.volume}/30</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ color: TEXT2, fontSize: 11 }}>Qualidade</span>
            <span style={{ color: TEXT, fontSize: 11, fontWeight: 700 }}>{s.qualidade}/30</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ color: TEXT2, fontSize: 11 }}>Diversidade</span>
            <span style={{ color: TEXT, fontSize: 11, fontWeight: 700 }}>{s.diversidade}/20</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: TEXT2, fontSize: 11 }}>Saúde</span>
            <span style={{ color: TEXT, fontSize: 11, fontWeight: 700 }}>{s.saude}/20</span>
          </div>
        </div>
      </div>
      <div style={{ background: pronto ? 'color-mix(in srgb, var(--success) 8%, transparent)' : 'color-mix(in srgb, var(--primary) 7%, transparent)', border: `1px solid ${pronto ? 'color-mix(in srgb, var(--success) 25%, transparent)' : 'color-mix(in srgb, var(--primary) 20%, transparent)'}`, borderRadius: 8, padding: '8px 12px' }}>
        <p style={{ color: pronto ? GREEN : YELLOW, fontSize: 11, fontWeight: 700, margin: 0 }}>
          {pronto ? '✓ Pronto para avaliar Fase 2A' : '◌ Aguardando volume e qualidade suficientes'}
        </p>
        <p style={{ color: TEXT3, fontSize: 10, margin: '3px 0 0', lineHeight: 1.4 }}>
          100% = pronto para avaliar Fase 2 — não significa IA autônoma respondendo ao cliente.
        </p>
      </div>
    </div>
  )
}

function CronPanel({ dados }: { dados: DadosMcp }) {
  const m = dados.cronMeta
  return (
    <div style={{ background: BG_S, border: BORDER, borderRadius: 12, padding: 18 }}>
      <p style={{ color: TEXT3, fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8, margin: '0 0 12px' }}>Última execução do cron</p>
      {!m ? (
        <p style={{ color: TEXT3, fontSize: 12 }}>Nenhuma execução registrada ainda.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div style={{ background: BG_R, border: BORDER, borderRadius: 7, padding: '8px 10px' }}>
              <p style={{ color: TEXT3, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', margin: '0 0 2px' }}>Início</p>
              <p style={{ color: TEXT2, fontSize: 11, margin: 0, fontFamily: 'monospace' }}>{formatTs(m.startedAt)}</p>
            </div>
            <div style={{ background: BG_R, border: BORDER, borderRadius: 7, padding: '8px 10px' }}>
              <p style={{ color: TEXT3, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', margin: '0 0 2px' }}>Duração</p>
              <p style={{ color: TEXT2, fontSize: 11, margin: 0, fontFamily: 'monospace' }}>{m.durationMs}ms</p>
            </div>
          </div>
          <div className="mcp-status-3col">
            <div style={{ background: BG_R, border: BORDER, borderRadius: 7, padding: '8px 10px' }}>
              <p style={{ color: TEXT3, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', margin: '0 0 2px' }}>Processados</p>
              <p style={{ color: GREEN, fontSize: 16, fontWeight: 800, margin: 0 }}>{m.processed}</p>
            </div>
            <div style={{ background: BG_R, border: BORDER, borderRadius: 7, padding: '8px 10px' }}>
              <p style={{ color: TEXT3, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', margin: '0 0 2px' }}>Erros</p>
              <p style={{ color: m.errors > 0 ? RED : GREEN, fontSize: 16, fontWeight: 800, margin: 0 }}>{m.errors}</p>
            </div>
            <div style={{ background: BG_R, border: BORDER, borderRadius: 7, padding: '8px 10px' }}>
              <p style={{ color: TEXT3, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', margin: '0 0 2px' }}>Mode</p>
              <p style={{ color: PURPLE_L, fontSize: 11, fontWeight: 700, margin: 0, fontFamily: 'monospace' }}>{m.mode}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PiiPanel({ dados }: { dados: DadosMcp }) {
  const p = dados.piiCheck
  const checks = [
    { label: 'phoneHash no formato ***XXXX', ok: p.phoneHashOk },
    { label: 'Sem dados crus em steps/erros', ok: p.semDadosCrus },
    { label: 'Sem valores monetários nos logs', ok: p.semValorMonetario },
  ]
  return (
    <div style={{ background: BG_S, border: `1px solid ${p.ok ? 'color-mix(in srgb, var(--success) 20%, transparent)' : 'color-mix(in srgb, var(--danger) 30%, transparent)'}`, borderRadius: 12, padding: 18 }}>
      <p style={{ color: TEXT3, fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8, margin: '0 0 12px' }}>
        Segurança / PII
        {!p.ok && <span style={{ marginLeft: 8, background: 'color-mix(in srgb, var(--danger) 15%, transparent)', color: RED, fontSize: 10, padding: '2px 8px', borderRadius: 4, fontWeight: 800 }}>BLOQUEIO FASE 2</span>}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {checks.map(({ label, ok }) => (
          <div key={label} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ color: ok ? GREEN : RED, fontSize: 13, flexShrink: 0 }}>{ok ? '✓' : '✗'}</span>
            <span style={{ color: ok ? TEXT2 : RED, fontSize: 12 }}>{label}</span>
          </div>
        ))}
      </div>
      {!p.ok && (
        <p style={{ color: RED, fontSize: 11, marginTop: 10, background: 'color-mix(in srgb, var(--danger) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--danger) 20%, transparent)', borderRadius: 6, padding: '8px 10px' }}>
          PII detectado nos logs MCP. Fase 2A bloqueada até resolução. Verificar mcpLogger.sanitizarMensagemErro().
        </p>
      )}
    </div>
  )
}

function QualidadePanel({ dados }: { dados: DadosMcp }) {
  const dist = dados.padraoDistribuicao
  const total = dados.obsCount
  if (total === 0) {
    return (
      <div style={{ background: BG_S, border: BORDER, borderRadius: 12, padding: 18 }}>
        <p style={{ color: TEXT3, fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8, margin: '0 0 12px' }}>Qualidade da alimentação</p>
        <p style={{ color: TEXT3, fontSize: 12 }}>Nenhuma observação registrada ainda.</p>
      </div>
    )
  }
  return (
    <div style={{ background: BG_S, border: BORDER, borderRadius: 12, padding: 18 }}>
      <p style={{ color: TEXT3, fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8, margin: '0 0 14px' }}>Qualidade da alimentação</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {PADROES_ORDENADOS.map(padrao => {
          const count = dist[padrao] ?? 0
          const ratio = count / total
          return (
            <div key={padrao} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ color: TEXT2, fontSize: 11, width: 160, flexShrink: 0 }}>{PADRAO_LABEL[padrao]}</span>
              <div style={{ flex: 1, height: 6, background: 'var(--info-soft)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.round(ratio * 100)}%`, background: PADRAO_COR[padrao], borderRadius: 3 }} />
              </div>
              <span style={{ color: TEXT3, fontSize: 10, width: 36, textAlign: 'right', flexShrink: 0 }}>{count} ({Math.round(ratio * 100)}%)</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function GargalosPanel({ dados }: { dados: DadosMcp }) {
  const g = dados.gargalos
  return (
    <div style={{ background: BG_S, border: BORDER, borderRadius: 12, padding: 18 }}>
      <p style={{ color: TEXT3, fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8, margin: '0 0 12px' }}>Gargalos por step</p>
      {g.length === 0 ? (
        <p style={{ color: TEXT3, fontSize: 12 }}>Nenhum step com amostra suficiente (mín. 3 eventos).</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {g.map(item => {
            const cor = item.taxaProblema > 0.5 ? RED : item.taxaProblema > 0.25 ? YELLOW : GREEN
            return (
              <div key={item.step} style={{ background: BG_R, border: BORDER, borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ color: TEXT, fontSize: 12, fontFamily: 'monospace', fontWeight: 700 }}>{item.step}</span>
                  <span style={{ color: cor, fontSize: 12, fontWeight: 800 }}>{pct(item.taxaProblema)}</span>
                </div>
                <div style={{ height: 5, background: 'var(--info-soft)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: pct(item.taxaProblema), background: cor, borderRadius: 3 }} />
                </div>
                <p style={{ color: TEXT3, fontSize: 10, margin: '4px 0 0' }}>
                  {item.problemasCount} problema{item.problemasCount !== 1 ? 's' : ''} em {item.totalEventos} eventos
                </p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ErrosPanel({ dados }: { dados: DadosMcp }) {
  const erros = dados.ultimosErros
  return (
    <div style={{ background: BG_S, border: BORDER, borderRadius: 12, padding: 18 }}>
      <p style={{ color: TEXT3, fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8, margin: '0 0 12px' }}>Erros MCP (últimos 20)</p>
      {erros.length === 0 ? (
        <p style={{ color: GREEN, fontSize: 12 }}>✓ Nenhum erro registrado.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {erros.map((e, i) => (
            <div key={i} style={{ background: 'color-mix(in srgb, var(--danger) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--danger) 20%, transparent)', borderRadius: 8, padding: '9px 12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div>
                  <span style={{ color: RED, fontSize: 11, fontWeight: 800, fontFamily: 'monospace' }}>{e.origem}</span>
                  <p style={{ color: TEXT2, fontSize: 11, margin: '3px 0 0', fontFamily: 'monospace', wordBreak: 'break-all' }}>{e.mensagem}</p>
                </div>
                <span style={{ color: TEXT3, fontSize: 10, whiteSpace: 'nowrap', flexShrink: 0, fontFamily: 'monospace' }}>
                  {formatTs(e.ts)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TimelinePanel({ dados }: { dados: DadosMcp }) {
  const obs = dados.ultimasObs
  return (
    <div style={{ background: BG_S, border: BORDER, borderRadius: 12, padding: 18 }}>
      <p style={{ color: TEXT3, fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8, margin: '0 0 12px' }}>Timeline sanitizada (últimas 50 obs.)</p>
      {obs.length === 0 ? (
        <p style={{ color: TEXT3, fontSize: 12 }}>Nenhuma observação ainda.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, maxHeight: 360, overflowY: 'auto' }}>
          {obs.map((e, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '7px 0', borderBottom: i < obs.length - 1 ? '1px solid var(--info-soft)' : 'none' }}>
              <span style={{ color: TEXT3, fontSize: 10, fontFamily: 'monospace', width: 40, flexShrink: 0, paddingTop: 1 }}>
                {new Date(e.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span style={{ color: PURPLE_L, fontSize: 11, fontFamily: 'monospace', width: 54, flexShrink: 0 }}>{e.phoneHash}</span>
              <span style={{ color: TEXT3, fontSize: 10, width: 0 }}>→</span>
              <span style={{ color: TEXT2, fontSize: 11, flex: 1, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {e.stepAntes} → {e.stepDepois}
              </span>
              <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, fontWeight: 700, background: `${PADRAO_COR[e.padraoObservado]}20`, color: PADRAO_COR[e.padraoObservado], flexShrink: 0 }}>
                {e.padraoObservado}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function DevMcpPage() {
  const router = useRouter()
  const [dados, setDados] = useState<DadosMcp | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [aba, setAba] = useState<'status' | 'dados' | 'infra'>('status')

  useEffect(() => {
    const role = getUserRole()
    if (role !== 'dev') { router.push('/login'); return }
    fetch('/api/dev/mcp')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<DadosMcp>
      })
      .then(d => { setDados(d); setLoading(false) })
      .catch(e => { setErro(String(e)); setLoading(false) })
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
          <p style={{ color: RED, fontSize: 14, fontWeight: 700 }}>Erro ao carregar dados MCP</p>
          <p style={{ color: TEXT3, fontSize: 12, marginTop: 6 }}>{erro || 'Resposta inválida'}</p>
          <button onClick={() => window.location.reload()} style={{ marginTop: 16, background: PURPLE, border: 'none', color: 'var(--foreground)', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>Tentar novamente</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: BG, padding: '24px 16px', fontFamily: FONT }}>
      <style>{`
        .mcp-grid-2col { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 14px; }
        .mcp-status-3col { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
        @media (max-width: 600px) {
          .mcp-grid-2col { grid-template-columns: 1fr; }
          .mcp-status-3col { grid-template-columns: 1fr 1fr; }
        }
      `}</style>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <p style={{ color: PURPLE_L, fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2, margin: '0 0 4px' }}>MCP Observer · Fase 1</p>
            <h1 style={{ color: TEXT, fontSize: 22, fontWeight: 900, margin: 0 }}>Painel Dev — IA</h1>
            <p style={{ color: TEXT3, fontSize: 12, margin: '4px 0 0' }}>Somente leitura · Nenhuma ação na IA disponível aqui</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => router.push('/dev')} style={{ background: 'color-mix(in srgb, var(--attention) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--attention) 30%, transparent)', color: PURPLE_L, borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
              ← Dev
            </button>
            <button onClick={() => window.location.reload()} style={{ background: 'rgba(var(--overlay-rgb), 0.05)', border: BORDER, color: TEXT3, borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 12 }}>
              Atualizar
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
          {(['status', 'dados', 'infra'] as const).map(t => (
            <button
              key={t}
              onClick={() => setAba(t)}
              style={{ padding: '9px 20px', borderRadius: 9, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, fontFamily: FONT, background: aba === t ? PURPLE : 'rgba(var(--overlay-rgb), 0.05)', color: aba === t ? 'var(--foreground)' : TEXT3 }}
            >
              {t === 'status' ? 'Status e Score' : t === 'dados' ? 'Padrões e Logs' : 'Saúde da Infraestrutura'}
            </button>
          ))}
        </div>

        {aba === 'status' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <StatusMcp dados={dados} />
            <div className="mcp-grid-2col">
              <ScorePanel dados={dados} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <CronPanel dados={dados} />
                <PiiPanel dados={dados} />
              </div>
            </div>
          </div>
        )}

        {aba === 'dados' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="mcp-grid-2col">
              <QualidadePanel dados={dados} />
              <GargalosPanel dados={dados} />
            </div>
            <ErrosPanel dados={dados} />
            <TimelinePanel dados={dados} />
          </div>
        )}

        {aba === 'infra' && <InfraHealthPanel />}

      </div>
    </div>
  )
}
