'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

// ─── design tokens ────────────────────────────────────────────────────────────
const BG     = '#060606'
const CARD   = '#101010'
const BORDER = '1px solid #1f1d1a'
const TEXT   = '#f4f1ec'
const MUTED  = '#a39b8b'
const ACCENT = '#ff6b00'
const FONT   = "'Archivo', sans-serif"

const inp: React.CSSProperties = {
  width: '100%',
  background: '#1a1208',
  border: '1px solid #2a2420',
  borderRadius: 12,
  padding: '14px 16px',
  color: TEXT,
  fontSize: 16,
  fontFamily: FONT,
  outline: 'none',
  boxSizing: 'border-box',
  minHeight: 52,
}

const btn = (variant: 'primary' | 'ghost' = 'primary'): React.CSSProperties => ({
  width: '100%',
  height: 56,
  borderRadius: 14,
  fontSize: 16,
  fontWeight: 700,
  fontFamily: FONT,
  border: 'none',
  cursor: 'pointer',
  background: variant === 'primary' ? ACCENT : 'transparent',
  color: variant === 'primary' ? '#fff' : MUTED,
  transition: 'opacity .15s',
})

const lbl: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  color: MUTED,
  marginBottom: 6,
  fontFamily: FONT,
}

// ─── types ────────────────────────────────────────────────────────────────────
type Form = {
  nomePizzaria: string
  whatsappPizzaria: string
  endereco: string
  horaAbertura: number
  horaFechamento: number
  chavePix: string
  nomeTitularPix: string
  aceitaDinheiro: boolean
  aceitaCartao: boolean
  temMotoboy: boolean
  fazDelivery: boolean
  aceitaRetirada: boolean
}

const INITIAL: Form = {
  nomePizzaria: '',
  whatsappPizzaria: '',
  endereco: '',
  horaAbertura: 18,
  horaFechamento: 23,
  chavePix: '',
  nomeTitularPix: '',
  aceitaDinheiro: true,
  aceitaCartao: true,
  temMotoboy: false,
  fazDelivery: true,
  aceitaRetirada: true,
}

// ─── Toggle ───────────────────────────────────────────────────────────────────
function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div
      onClick={() => onChange(!value)}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: CARD, border: BORDER, borderRadius: 12, padding: '14px 16px', cursor: 'pointer', userSelect: 'none' }}
    >
      <span style={{ fontSize: 15, color: TEXT, fontFamily: FONT }}>{label}</span>
      <div style={{ width: 46, height: 26, borderRadius: 13, background: value ? ACCENT : '#2a2420', position: 'relative', transition: 'background .2s', flexShrink: 0 }}>
        <div style={{ position: 'absolute', top: 3, left: value ? 23 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .2s' }} />
      </div>
    </div>
  )
}

// ─── ProgressBar ──────────────────────────────────────────────────────────────
// steps 2–5 show progress → total = 4 segments
function ProgressBar({ step, total }: { step: number; total: number }) {
  return (
    <div style={{ padding: '16px 20px 0', paddingTop: 'max(16px, env(safe-area-inset-top))' }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        {Array.from({ length: total }).map((_, i) => (
          <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i < step ? ACCENT : '#1f1d1a', transition: 'background .3s' }} />
        ))}
      </div>
      <div style={{ fontSize: 12, color: MUTED, fontFamily: FONT }}>
        Passo {step} de {total}
      </div>
    </div>
  )
}

// ─── Field ────────────────────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={lbl}>{label}</label>
      {children}
    </div>
  )
}

// ─── HourSelect ───────────────────────────────────────────────────────────────
function HourSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <select
      value={value}
      onChange={e => onChange(Number(e.target.value))}
      style={{ ...inp, appearance: 'none', WebkitAppearance: 'none' }}
    >
      {Array.from({ length: 24 }, (_, i) => i).map(h => (
        <option key={h} value={h} style={{ background: '#1a1208' }}>
          {String(h).padStart(2, '0')}:00
        </option>
      ))}
    </select>
  )
}

// ─── Step 1 · Boas-vindas ─────────────────────────────────────────────────────
function Step1({ onNext }: { onNext: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: '40px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 72, marginBottom: 24, lineHeight: 1 }}>🍕</div>
      <h1 style={{ fontSize: 26, fontWeight: 800, color: TEXT, fontFamily: FONT, margin: '0 0 12px', lineHeight: 1.2 }}>
        Vamos configurar<br />sua pizzaria!
      </h1>
      <p style={{ fontSize: 16, color: MUTED, fontFamily: FONT, margin: '0 0 48px', lineHeight: 1.5 }}>
        Leva menos de 3 minutos ⚡
      </p>
      <div style={{ width: '100%', maxWidth: 360 }}>
        <button style={btn('primary')} onClick={onNext}>Começar</button>
      </div>
    </div>
  )
}

// ─── Step 2 · Dados da pizzaria ───────────────────────────────────────────────
function Step2({ form, set, onNext, onBack }: { form: Form; set: (f: Partial<Form>) => void; onNext: () => void; onBack: () => void }) {
  const ok = form.nomePizzaria.trim() && form.whatsappPizzaria.trim() && form.endereco.trim()
  return (
    <div style={{ padding: '24px 20px', flex: 1, display: 'flex', flexDirection: 'column' }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: TEXT, fontFamily: FONT, margin: '0 0 4px' }}>Dados da pizzaria</h2>
      <p style={{ fontSize: 14, color: MUTED, fontFamily: FONT, margin: '0 0 24px' }}>Informações básicas do seu negócio</p>

      <Field label="Nome da pizzaria">
        <input style={inp} placeholder="Ex: Chefe da Pizza" value={form.nomePizzaria} onChange={e => set({ nomePizzaria: e.target.value })} />
      </Field>
      <Field label="Número do WhatsApp Business">
        <input style={inp} placeholder="5586999999999" type="tel" inputMode="numeric" value={form.whatsappPizzaria} onChange={e => set({ whatsappPizzaria: e.target.value.replace(/\D/g, '') })} />
      </Field>
      <Field label="Endereço completo">
        <input style={inp} placeholder="Rua, número, bairro, cidade" value={form.endereco} onChange={e => set({ endereco: e.target.value })} />
      </Field>
      <Field label="Horário de abertura">
        <HourSelect value={form.horaAbertura} onChange={v => set({ horaAbertura: v })} />
      </Field>
      <Field label="Horário de fechamento">
        <HourSelect value={form.horaFechamento} onChange={v => set({ horaFechamento: v })} />
      </Field>

      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 24 }}>
        <button style={{ ...btn('primary'), opacity: ok ? 1 : 0.4 }} onClick={ok ? onNext : undefined}>Continuar</button>
        <button style={btn('ghost')} onClick={onBack}>Voltar</button>
      </div>
    </div>
  )
}

// ─── Step 3 · Pagamento ───────────────────────────────────────────────────────
function Step3({ form, set, onNext, onBack }: { form: Form; set: (f: Partial<Form>) => void; onNext: () => void; onBack: () => void }) {
  const ok = form.chavePix.trim() && form.nomeTitularPix.trim()
  return (
    <div style={{ padding: '24px 20px', flex: 1, display: 'flex', flexDirection: 'column' }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: TEXT, fontFamily: FONT, margin: '0 0 4px' }}>Pagamento</h2>
      <p style={{ fontSize: 14, color: MUTED, fontFamily: FONT, margin: '0 0 24px' }}>Configure como você recebe</p>

      <Field label="Chave Pix (CPF, CNPJ, e-mail ou telefone)">
        <input style={inp} placeholder="sua@chave.pix" value={form.chavePix} onChange={e => set({ chavePix: e.target.value })} />
      </Field>
      <Field label="Nome do titular da conta Pix">
        <input style={inp} placeholder="Nome como aparece no banco" value={form.nomeTitularPix} onChange={e => set({ nomeTitularPix: e.target.value })} />
      </Field>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
        <Toggle value={form.aceitaDinheiro} onChange={v => set({ aceitaDinheiro: v })} label="💵 Aceita dinheiro?" />
        <Toggle value={form.aceitaCartao}   onChange={v => set({ aceitaCartao: v })}   label="💳 Aceita cartão?" />
      </div>

      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 24 }}>
        <button style={{ ...btn('primary'), opacity: ok ? 1 : 0.4 }} onClick={ok ? onNext : undefined}>Continuar</button>
        <button style={btn('ghost')} onClick={onBack}>Voltar</button>
      </div>
    </div>
  )
}

// ─── Step 4 · Entrega ────────────────────────────────────────────────────────
function Step4({ form, set, onNext, onBack, saving }: { form: Form; set: (f: Partial<Form>) => void; onNext: () => void; onBack: () => void; saving: boolean }) {
  return (
    <div style={{ padding: '24px 20px', flex: 1, display: 'flex', flexDirection: 'column' }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: TEXT, fontFamily: FONT, margin: '0 0 4px' }}>Entrega</h2>
      <p style={{ fontSize: 14, color: MUTED, fontFamily: FONT, margin: '0 0 24px' }}>Defina como funciona seu delivery</p>

      <div style={{ background: '#0d1a0d', border: '1px solid #1a2e1a', borderRadius: 12, padding: '12px 14px', marginBottom: 20 }}>
        <p style={{ fontSize: 13, color: '#7aad7a', fontFamily: FONT, margin: 0, lineHeight: 1.6 }}>
          💡 As taxas de entrega são configuradas por bairro depois que você terminar o setup. Você pode adicionar quantos bairros quiser com taxas individuais em <strong style={{ color: '#9dcc9d' }}>Configurações</strong>.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
        <Toggle value={form.fazDelivery}    onChange={v => set({ fazDelivery: v })}    label="🛵 Faz delivery?" />
        <Toggle value={form.aceitaRetirada} onChange={v => set({ aceitaRetirada: v })} label="🏪 Aceita retirada na loja?" />
        <Toggle value={form.temMotoboy}     onChange={v => set({ temMotoboy: v })}     label="🛵 Tem motoboy próprio?" />
      </div>

      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 24 }}>
        <button style={{ ...btn('primary'), opacity: saving ? 0.6 : 1 }} onClick={saving ? undefined : onNext}>
          {saving ? 'Salvando...' : 'Salvar e continuar'}
        </button>
        <button style={btn('ghost')} onClick={onBack} disabled={saving}>Voltar</button>
      </div>
    </div>
  )
}

// ─── Step 5 · Conectar WhatsApp ───────────────────────────────────────────────
type QrStatus = 'loading' | 'waiting' | 'connected' | 'error'

function Step5WhatsApp({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [qr, setQr]           = useState<string | null>(null)
  const [status, setStatus]   = useState<QrStatus>('loading')
  const [elapsed, setElapsed] = useState(0)
  const [gen, setGen]         = useState(0) // increment → triggers fresh fetch

  useEffect(() => {
    let cancelled   = false
    let timerId: ReturnType<typeof setInterval> | null = null
    let ticks       = 0

    setStatus('loading')
    setQr(null)
    setElapsed(0)

    fetch('/api/whatsapp/qrcode')
      .then(r => r.json())
      .then((data: Record<string, unknown>) => {
        if (cancelled) return
        const raw = (data.base64 as string | undefined) ?? (data.code as string | undefined)
        if (!raw) { setStatus('error'); return }
        const src = raw.startsWith('data:') ? raw : `data:image/png;base64,${raw}`
        setQr(src)
        setStatus('waiting')

        timerId = setInterval(() => {
          if (cancelled) return
          ticks += 3
          setElapsed(ticks)
          fetch('/api/whatsapp/state')
            .then(r => r.json())
            .then((d: Record<string, unknown>) => {
              if (cancelled) return
              const inst = d.instance as Record<string, unknown> | undefined
              const state = (d.state as string | undefined) ?? (inst?.state as string | undefined)
              if (state === 'open') {
                setStatus('connected')
                if (timerId) clearInterval(timerId)
              }
            })
            .catch(() => {/* ignore poll errors silently */})
        }, 3000)
      })
      .catch(() => { if (!cancelled) setStatus('error') })

    return () => {
      cancelled = true
      if (timerId) clearInterval(timerId)
    }
  }, [gen])

  const timedOut = elapsed >= 60 && status === 'waiting'

  return (
    <div style={{ padding: '24px 20px', flex: 1, display: 'flex', flexDirection: 'column' }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: TEXT, fontFamily: FONT, margin: '0 0 4px' }}>
        Conecte seu WhatsApp
      </h2>
      <p style={{ fontSize: 13, color: MUTED, fontFamily: FONT, margin: '0 0 20px', lineHeight: 1.65 }}>
        Abra o WhatsApp → <strong style={{ color: TEXT }}>Dispositivos conectados</strong> → Conectar dispositivo → Escaneie o QR Code
      </p>

      {/* ── QR area ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18 }}>

        {status === 'loading' && (
          <div style={{ width: 220, height: 220, background: CARD, border: BORDER, borderRadius: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', border: `3px solid ${ACCENT}`, borderTopColor: 'transparent', animation: 'spin .8s linear infinite' }} />
              <span style={{ fontSize: 12, color: MUTED, fontFamily: FONT }}>Gerando QR Code…</span>
            </div>
          </div>
        )}

        {status === 'connected' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 88, height: 88, borderRadius: '50%', background: 'rgba(74,222,128,.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'popIn .4s cubic-bezier(.34,1.56,.64,1) both' }}>
              <span style={{ fontSize: 44 }}>✅</span>
            </div>
            <p style={{ fontSize: 17, fontWeight: 700, color: '#4ade80', fontFamily: FONT, margin: 0 }}>WhatsApp conectado!</p>
          </div>
        )}

        {status === 'error' && (
          <div style={{ textAlign: 'center' }}>
            <span style={{ fontSize: 40 }}>⚠️</span>
            <p style={{ fontSize: 14, color: '#f87171', fontFamily: FONT, margin: '10px 0 0', lineHeight: 1.5 }}>
              Não foi possível gerar o QR Code.<br />Verifique sua conexão.
            </p>
          </div>
        )}

        {(status === 'waiting' || timedOut) && qr && (
          <div style={{ position: 'relative', width: 220, height: 220 }}>
            <img
              src={qr}
              alt="QR Code WhatsApp"
              style={{ width: 220, height: 220, borderRadius: 20, display: 'block', border: `2px solid ${ACCENT}20`, filter: timedOut ? 'blur(5px) brightness(.25)' : 'none', transition: 'filter .3s' }}
            />
            {timedOut && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <span style={{ fontSize: 28 }}>⏱️</span>
                <span style={{ fontSize: 13, color: TEXT, fontFamily: FONT, fontWeight: 700 }}>QR Code expirado</span>
              </div>
            )}
          </div>
        )}

        {status === 'waiting' && !timedOut && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: ACCENT, animation: 'pulse 1.5s ease-in-out infinite' }} />
            <span style={{ fontSize: 13, color: MUTED, fontFamily: FONT }}>Aguardando conexão… {elapsed > 0 ? `${elapsed}s` : ''}</span>
          </div>
        )}
      </div>

      {/* ── Actions ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 16 }}>
        {(timedOut || status === 'error') && (
          <button style={btn('primary')} onClick={() => setGen(g => g + 1)}>
            Gerar novo QR Code
          </button>
        )}
        <button
          style={{ ...btn('primary'), opacity: status === 'connected' ? 1 : 0.3 }}
          onClick={status === 'connected' ? onNext : undefined}
        >
          Continuar
        </button>
        <button style={btn('ghost')} onClick={onBack} disabled={status === 'loading'}>
          Voltar
        </button>
      </div>

      <style>{`
        @keyframes spin   { to { transform: rotate(360deg); } }
        @keyframes pulse  { 0%,100% { opacity:1; } 50% { opacity:.25; } }
        @keyframes popIn  { from { transform:scale(0); opacity:0; } to { transform:scale(1); opacity:1; } }
      `}</style>
    </div>
  )
}

// ─── Step 6 · Concluído ───────────────────────────────────────────────────────
function Step6({ form, onGoPanel }: { form: Form; onGoPanel: () => void }) {
  const horaFmt = (h: number) => `${String(h).padStart(2, '0')}:00`
  const items = [
    { icon: '🍕', label: form.nomePizzaria },
    { icon: '📱', label: `+${form.whatsappPizzaria}` },
    { icon: '📍', label: form.endereco },
    { icon: '⏰', label: `${horaFmt(form.horaAbertura)} – ${horaFmt(form.horaFechamento)}` },
    { icon: '🔑', label: form.chavePix },
    { icon: '💰', label: [form.aceitaDinheiro && 'Dinheiro', form.aceitaCartao && 'Cartão', 'Pix'].filter(Boolean).join(' · ') },
    { icon: '🛵', label: [form.fazDelivery && 'Delivery', form.aceitaRetirada && 'Retirada', form.temMotoboy && 'Motoboy próprio'].filter(Boolean).join(' · ') || '—' },
    { icon: '✅', label: 'WhatsApp conectado' },
  ]

  return (
    <div style={{ padding: '40px 20px 24px', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ width: 80, height: 80, borderRadius: '50%', background: 'rgba(255,107,0,.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 24, animation: 'popIn .4s cubic-bezier(.34,1.56,.64,1) both' }}>
        <span style={{ fontSize: 40 }}>🚀</span>
      </div>

      <h2 style={{ fontSize: 22, fontWeight: 800, color: TEXT, fontFamily: FONT, margin: '0 0 6px', textAlign: 'center' }}>
        Tudo configurado!
      </h2>
      <p style={{ fontSize: 14, color: MUTED, fontFamily: FONT, margin: '0 0 28px', textAlign: 'center' }}>
        Sua pizzaria está pronta para usar o ChefeBot.
      </p>

      <div style={{ width: '100%', background: CARD, border: BORDER, borderRadius: 14, padding: '4px 0', marginBottom: 28 }}>
        {items.map((item, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', borderBottom: i < items.length - 1 ? BORDER : 'none' }}>
            <span style={{ fontSize: 18, flexShrink: 0 }}>{item.icon}</span>
            <span style={{ fontSize: 14, color: TEXT, fontFamily: FONT, wordBreak: 'break-all' }}>{item.label}</span>
          </div>
        ))}
      </div>

      <div style={{ width: '100%', marginTop: 'auto' }}>
        <button style={btn('primary')} onClick={onGoPanel}>Ir para os pedidos →</button>
      </div>

      <style>{`@keyframes popIn { from { transform:scale(0); opacity:0; } to { transform:scale(1); opacity:1; } }`}</style>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function SetupPage() {
  const router = useRouter()
  const [step, setStep]   = useState(1)
  const [saving, setSaving] = useState(false)
  const [form, setForm]   = useState<Form>(INITIAL)

  function set(partial: Partial<Form>) {
    setForm(prev => ({ ...prev, ...partial }))
  }

  // Saves config to Redis, then advances to WhatsApp step
  async function save() {
    setSaving(true)
    try {
      await fetch('/api/configuracoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nomePizzaria:     form.nomePizzaria,
          whatsappPizzaria: form.whatsappPizzaria,
          endereco:         form.endereco,
          horaAbertura:     form.horaAbertura,
          horaFechamento:   form.horaFechamento,
          chavePix:         form.chavePix,
          nomeTitularPix:   form.nomeTitularPix,
          aceitaDinheiro:   form.aceitaDinheiro,
          aceitaCartao:     form.aceitaCartao,
          temMotoboy:       form.temMotoboy,
          fazDelivery:      form.fazDelivery,
          aceitaRetirada:   form.aceitaRetirada,
        }),
      })
      setStep(5)
    } catch {
      alert('Erro ao salvar. Tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  // Progress shows for steps 2–5 (4 segments)
  const showProgress = step > 1 && step < 6

  return (
    <div style={{ background: BG, minHeight: '100dvh', display: 'flex', flexDirection: 'column', fontFamily: FONT, paddingBottom: 'env(safe-area-inset-bottom, 24px)' }}>
      {showProgress && <ProgressBar step={step - 1} total={4} />}

      {step === 1 && <Step1 onNext={() => setStep(2)} />}
      {step === 2 && <Step2 form={form} set={set} onNext={() => setStep(3)} onBack={() => setStep(1)} />}
      {step === 3 && <Step3 form={form} set={set} onNext={() => setStep(4)} onBack={() => setStep(2)} />}
      {step === 4 && <Step4 form={form} set={set} onNext={save}           onBack={() => setStep(3)} saving={saving} />}
      {step === 5 && <Step5WhatsApp onNext={() => setStep(6)} onBack={() => setStep(4)} />}
      {step === 6 && <Step6 form={form} onGoPanel={() => router.push('/pedidos')} />}
    </div>
  )
}
