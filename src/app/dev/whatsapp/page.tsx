'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type CanaryState =
  | 'created' | 'outbound_sent' | 'outbound_failed'
  | 'inbound_received' | 'acknowledgement_sent' | 'acknowledgement_failed' | 'roundtrip_ok' | 'expired'

type CanaryRecord = {
  token: string
  phoneMascarado: string
  state: CanaryState
  createdAt: number
  expiresAt: number
  outboundAt?: number
  outboundLatencyMs?: number
  outboundAttempts?: number
  outboundHttpStatus?: number
  outboundMessageIdMasked?: string
  outboundError?: string
  inboundAt?: number
  ackAt?: number
  ackLatencyMs?: number
  ackAttempts?: number
  ackHttpStatus?: number
  ackMessageIdMasked?: string
  ackError?: string
  roundtripAt?: number
  transitions?: Array<{ state: CanaryState; at: number }>
}

type Diagnostico = {
  providerConfigured: boolean
  providerConnectionState: { erro?: string; estado?: unknown }
  webhookConfigured: { erro?: string; urlConfigurada?: string; apontaParaProducao?: boolean; eventosOk?: boolean }
  inboundLastSeenAt: number | null
  outboundLastSuccessAt: number | null
  botGlobalEnabled: boolean
  canaryPhoneConfigured: boolean
  canaryPhoneMascarado: string | null
  manualConversation: boolean
  canary: CanaryRecord | null
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

const COR_OK = 'var(--success)'
const COR_ALERTA = 'var(--primary)'
const COR_ERRO = 'var(--danger)'

function Pill({ ok, texto }: { ok: boolean | null; texto: string }) {
  const cor = ok === null ? COR_ALERTA : ok ? COR_OK : COR_ERRO
  return (
    <span style={{ background: `color-mix(in srgb, ${cor} 15%, transparent)`, color: cor, fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 20, border: `1px solid color-mix(in srgb, ${cor} 35%, transparent)` }}>
      {texto}
    </span>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'rgba(var(--overlay-rgb), 0.03)', border: '1px solid rgba(var(--overlay-rgb), 0.08)', borderRadius: 12, padding: 16 }}>
      <p style={{ fontSize: 13, fontWeight: 700, margin: '0 0 8px', color: 'var(--foreground)' }}>{title}</p>
      {children}
    </div>
  )
}

const ESTADOS_LABEL: Record<CanaryState, string> = {
  created: 'Criado',
  outbound_sent: 'Enviado (aguardando resposta)',
  outbound_failed: 'Falha no envio',
  inbound_received: 'Resposta recebida',
  acknowledgement_sent: 'Confirmação aceita pela Evolution',
  acknowledgement_failed: 'Falha ao enviar confirmação',
  roundtrip_ok: 'Round-trip confirmado ✅',
  expired: 'Expirado',
}

function fmt(ts: number | null | undefined) {
  if (!ts) return 'nunca'
  return new Date(ts).toLocaleString('pt-BR')
}

export default function WhatsappDiagPage() {
  const router = useRouter()
  const [data, setData] = useState<Diagnostico | null>(null)
  const [loading, setLoading] = useState(true)
  const [executando, setExecutando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [avisoInicio, setAvisoInicio] = useState<string | null>(null)

  const buscar = () => {
    fetch('/api/dev/whatsapp/canary')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((d) => setData(d))
      .catch((e) => setErro(e instanceof Error ? e.message : 'Erro desconhecido'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    const role = getUserRole()
    if (role !== 'dev' && role !== 'admin') { router.push('/login'); return }
    // Sem polling automático — só carrega ao abrir a página. Toda
    // atualização depois disso é manual (botões abaixo).
    buscar()
  }, [router])

  const executarTeste = () => {
    setExecutando(true)
    setErro(null)
    setAvisoInicio(null)
    fetch('/api/dev/whatsapp/canary', { method: 'POST' })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}))
        if (!r.ok) {
          setAvisoInicio(body?.error ?? `HTTP ${r.status}`)
          return
        }
        setAvisoInicio('Teste iniciado — verifique o WhatsApp do número autorizado e clique em "Atualizar" após responder.')
      })
      .catch((e) => setErro(e instanceof Error ? e.message : 'Erro desconhecido'))
      .finally(() => {
        setExecutando(false)
        buscar()
      })
  }

  if (loading && !data) return (
    <div style={{ minHeight: '100vh', background: 'var(--info-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: 'rgba(var(--overlay-rgb), 0.3)' }}>Carregando...</p>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: 'var(--info-soft)', padding: '24px 16px', fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <h1 style={{ color: 'var(--attention)', fontSize: 22, fontWeight: 800, margin: 0 }}>WhatsApp — Diagnóstico &amp; Canário</h1>
            <p style={{ color: 'rgba(var(--overlay-rgb), 0.3)', fontSize: 13, margin: '4px 0 0' }}>Etapa G — teste real ponta-a-ponta, sem atualização automática</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={buscar} disabled={loading} style={{ background: 'color-mix(in srgb, var(--info) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--info) 30%, transparent)', color: 'var(--info)', borderRadius: 8, padding: '8px 14px', cursor: loading ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700 }}>
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 20 }}>
              <Card title="Configuração do provider">
                <Pill ok={data.providerConfigured} texto={data.providerConfigured ? 'Configurado' : 'Ausente'} />
              </Card>
              <Card title="Estado da conexão (Evolution)">
                {data.providerConnectionState.erro
                  ? <Pill ok={false} texto={data.providerConnectionState.erro} />
                  : <Pill ok={data.providerConnectionState.estado === 'open'} texto={String(data.providerConnectionState.estado ?? 'desconhecido')} />}
              </Card>
              <Card title="Webhook configurado">
                {data.webhookConfigured.erro
                  ? <Pill ok={false} texto={data.webhookConfigured.erro} />
                  : (
                    <>
                      <Pill ok={!!data.webhookConfigured.apontaParaProducao && !!data.webhookConfigured.eventosOk} texto={data.webhookConfigured.apontaParaProducao ? 'Aponta p/ produção' : 'URL divergente'} />
                      {!data.webhookConfigured.eventosOk && <p style={{ fontSize: 11, color: 'var(--danger)', margin: '6px 0 0' }}>MESSAGES_UPSERT/CONNECTION_UPDATE ausentes</p>}
                    </>
                  )}
              </Card>
              <Card title="Bot global (bot_ativo)">
                <Pill ok={data.botGlobalEnabled} texto={data.botGlobalEnabled ? 'Ativo' : 'Pausado'} />
              </Card>
              <Card title="Último inbound real">
                <p style={{ fontSize: 13, color: 'var(--foreground)', margin: 0 }}>{fmt(data.inboundLastSeenAt)}</p>
              </Card>
              <Card title="Último outbound confirmado">
                <p style={{ fontSize: 13, color: 'var(--foreground)', margin: 0 }}>{fmt(data.outboundLastSuccessAt)}</p>
              </Card>
            </div>

            <div style={{ background: 'rgba(var(--overlay-rgb), 0.03)', border: '1px solid rgba(var(--overlay-rgb), 0.08)', borderRadius: 12, padding: 18, marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <p style={{ fontSize: 13, fontWeight: 700, margin: 0, color: 'var(--foreground)' }}>Número autorizado para teste</p>
                <Pill ok={data.canaryPhoneConfigured} texto={data.canaryPhoneConfigured ? (data.canaryPhoneMascarado ?? '') : 'WHATSAPP_CANARY_PHONE ausente'} />
              </div>
              {data.canaryPhoneConfigured && (
                <p style={{ fontSize: 12, color: 'rgba(var(--overlay-rgb), 0.5)', margin: '0 0 14px' }}>
                  Manual (pausa humana) neste número: <strong>{data.manualConversation ? 'ativo' : 'inativo'}</strong> — o canário ignora esse gate por design.
                </p>
              )}

              <button onClick={executarTeste} disabled={executando || !data.canaryPhoneConfigured} style={{ background: 'var(--attention)', border: 'none', color: '#1a1a1a', borderRadius: 8, padding: '10px 18px', cursor: executando || !data.canaryPhoneConfigured ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 800, opacity: executando || !data.canaryPhoneConfigured ? 0.5 : 1 }}>
                {executando ? 'Enviando...' : 'Executar teste real'}
              </button>
              {avisoInicio && <p style={{ fontSize: 12, color: 'rgba(var(--overlay-rgb), 0.6)', margin: '10px 0 0' }}>{avisoInicio}</p>}

              {data.canary && (
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid rgba(var(--overlay-rgb), 0.08)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <p style={{ fontSize: 13, fontWeight: 700, margin: 0, color: 'var(--foreground)' }}>Último teste — {data.canary.token}</p>
                    <Pill ok={data.canary.state === 'roundtrip_ok' ? true : data.canary.state === 'expired' || data.canary.state === 'outbound_failed' || data.canary.state === 'acknowledgement_failed' ? false : null} texto={ESTADOS_LABEL[data.canary.state]} />
                  </div>
                  <p style={{ fontSize: 12, color: 'rgba(var(--overlay-rgb), 0.5)', margin: '2px 0' }}>Criado: {fmt(data.canary.createdAt)} · Expira: {fmt(data.canary.expiresAt)}</p>
                  {typeof data.canary.outboundLatencyMs === 'number' && (
                    <p style={{ fontSize: 12, color: 'rgba(var(--overlay-rgb), 0.5)', margin: '2px 0' }}>Latência de envio: {data.canary.outboundLatencyMs}ms</p>
                  )}
                  {typeof data.canary.outboundHttpStatus === 'number' && <p style={{ fontSize: 12, color: 'rgba(var(--overlay-rgb), 0.5)', margin: '2px 0' }}>Evolution outbound: HTTP {data.canary.outboundHttpStatus} · {data.canary.outboundAttempts ?? 0} tentativa(s) · {data.canary.outboundMessageIdMasked || 'sem messageId'}</p>}
                  {data.canary.outboundError && <p style={{ fontSize: 12, color: 'var(--danger)', margin: '2px 0' }}>Erro no envio: {data.canary.outboundError}</p>}
                  {data.canary.inboundAt && <p style={{ fontSize: 12, color: 'rgba(var(--overlay-rgb), 0.5)', margin: '2px 0' }}>Resposta recebida: {fmt(data.canary.inboundAt)}</p>}
                  {typeof data.canary.ackHttpStatus === 'number' && <p style={{ fontSize: 12, color: 'rgba(var(--overlay-rgb), 0.5)', margin: '2px 0' }}>Evolution confirmação: HTTP {data.canary.ackHttpStatus} · {data.canary.ackAttempts ?? 0} tentativa(s) · {data.canary.ackMessageIdMasked || 'sem messageId'}</p>}
                  {data.canary.ackError && <p style={{ fontSize: 12, color: 'var(--danger)', margin: '2px 0' }}>Erro na confirmação: {data.canary.ackError}</p>}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
