'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// ─── design tokens ────────────────────────────────────────────────────────────
const BG      = '#060606'
const CARD    = '#101010'
const BORDER  = '1px solid #1f1d1a'
const TEXT    = '#f4f1ec'
const MUTED   = '#a39b8b'
const ACCENT  = '#ff6b00'
const FONT    = "'Archivo', sans-serif"

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

const label: React.CSSProperties = {
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
  taxaEntrega: string
  raioEntrega: string
  temMotoboy: boolean
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
  taxaEntrega: '',
  raioEntrega: '',
  temMotoboy: false,
}

// ─── Toggle ───────────────────────────────────────────────────────────────────
function Toggle({ value, onChange, label: lbl }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div
      onClick={() => onChange(!value)}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: CARD, border: BORDER, borderRadius: 12, padding: '14px 16px', cursor: 'pointer', userSelect: 'none' }}
    >
      <span style={{ fontSize: 15, color: TEXT, fontFamily: FONT }}>{lbl}</span>
      <div style={{ width: 46, height: 26, borderRadius: 13, background: value ? ACCENT : '#2a2420', position: 'relative', transition: 'background .2s', flexShrink: 0 }}>
        <div style={{ position: 'absolute', top: 3, left: value ? 23 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .2s' }} />
      </div>
    </div>
  )
}

// ─── ProgressBar ──────────────────────────────────────────────────────────────
function ProgressBar({ step, total }: { step: number; total: number }) {
  return (
    <div style={{ padding: '16px 20px 0', paddingTop: 'max(16px, env(safe-area-inset-top))' }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              background: i < step ? ACCENT : '#1f1d1a',
              transition: 'background .3s',
            }}
          />
        ))}
      </div>
      <div style={{ fontSize: 12, color: MUTED, fontFamily: FONT }}>
        Passo {step} de {total}
      </div>
    </div>
  )
}

// ─── Field ────────────────────────────────────────────────────────────────────
function Field({ lbl, children }: { lbl: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={label}>{lbl}</label>
      {children}
    </div>
  )
}

// ─── HourSelect ───────────────────────────────────────────────────────────────
function HourSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const hours = Array.from({ length: 24 }, (_, i) => i)
  return (
    <select
      value={value}
      onChange={e => onChange(Number(e.target.value))}
      style={{ ...inp, appearance: 'none', WebkitAppearance: 'none' }}
    >
      {hours.map(h => (
        <option key={h} value={h} style={{ background: '#1a1208' }}>
          {String(h).padStart(2, '0')}:00
        </option>
      ))}
    </select>
  )
}

// ─── Steps ────────────────────────────────────────────────────────────────────
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

function Step2({ form, set, onNext, onBack }: { form: Form; set: (f: Partial<Form>) => void; onNext: () => void; onBack: () => void }) {
  const ok = form.nomePizzaria.trim() && form.whatsappPizzaria.trim() && form.endereco.trim()
  return (
    <div style={{ padding: '24px 20px', flex: 1, display: 'flex', flexDirection: 'column' }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: TEXT, fontFamily: FONT, margin: '0 0 4px' }}>Dados da pizzaria</h2>
      <p style={{ fontSize: 14, color: MUTED, fontFamily: FONT, margin: '0 0 24px' }}>Informações básicas do seu negócio</p>

      <Field lbl="Nome da pizzaria">
        <input style={inp} placeholder="Ex: Chefe da Pizza" value={form.nomePizzaria} onChange={e => set({ nomePizzaria: e.target.value })} />
      </Field>
      <Field lbl="Número do WhatsApp Business">
        <input style={inp} placeholder="5586999999999" type="tel" inputMode="numeric" value={form.whatsappPizzaria} onChange={e => set({ whatsappPizzaria: e.target.value.replace(/\D/g, '') })} />
      </Field>
      <Field lbl="Endereço completo">
        <input style={inp} placeholder="Rua, número, bairro, cidade" value={form.endereco} onChange={e => set({ endereco: e.target.value })} />
      </Field>
      <Field lbl="Horário de abertura">
        <HourSelect value={form.horaAbertura} onChange={v => set({ horaAbertura: v })} />
      </Field>
      <Field lbl="Horário de fechamento">
        <HourSelect value={form.horaFechamento} onChange={v => set({ horaFechamento: v })} />
      </Field>

      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 24 }}>
        <button style={{ ...btn('primary'), opacity: ok ? 1 : 0.4 }} onClick={ok ? onNext : undefined}>Continuar</button>
        <button style={btn('ghost')} onClick={onBack}>Voltar</button>
      </div>
    </div>
  )
}

function Step3({ form, set, onNext, onBack }: { form: Form; set: (f: Partial<Form>) => void; onNext: () => void; onBack: () => void }) {
  const ok = form.chavePix.trim() && form.nomeTitularPix.trim()
  return (
    <div style={{ padding: '24px 20px', flex: 1, display: 'flex', flexDirection: 'column' }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: TEXT, fontFamily: FONT, margin: '0 0 4px' }}>Pagamento</h2>
      <p style={{ fontSize: 14, color: MUTED, fontFamily: FONT, margin: '0 0 24px' }}>Configure como você recebe</p>

      <Field lbl="Chave Pix (CPF, CNPJ, e-mail ou telefone)">
        <input style={inp} placeholder="sua@chave.pix" value={form.chavePix} onChange={e => set({ chavePix: e.target.value })} />
      </Field>
      <Field lbl="Nome do titular da conta Pix">
        <input style={inp} placeholder="Nome como aparece no banco" value={form.nomeTitularPix} onChange={e => set({ nomeTitularPix: e.target.value })} />
      </Field>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
        <Toggle value={form.aceitaDinheiro} onChange={v => set({ aceitaDinheiro: v })} label="💵 Aceita dinheiro?" />
        <Toggle value={form.aceitaCartao} onChange={v => set({ aceitaCartao: v })} label="💳 Aceita cartão?" />
      </div>

      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 24 }}>
        <button style={{ ...btn('primary'), opacity: ok ? 1 : 0.4 }} onClick={ok ? onNext : undefined}>Continuar</button>
        <button style={btn('ghost')} onClick={onBack}>Voltar</button>
      </div>
    </div>
  )
}

function Step4({ form, set, onNext, onBack, saving }: { form: Form; set: (f: Partial<Form>) => void; onNext: () => void; onBack: () => void; saving: boolean }) {
  return (
    <div style={{ padding: '24px 20px', flex: 1, display: 'flex', flexDirection: 'column' }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: TEXT, fontFamily: FONT, margin: '0 0 4px' }}>Entrega</h2>
      <p style={{ fontSize: 14, color: MUTED, fontFamily: FONT, margin: '0 0 24px' }}>Defina como funciona seu delivery</p>

      <Field lbl="Taxa de entrega padrão (R$)">
        <input
          style={inp}
          placeholder="0,00"
          type="number"
          inputMode="decimal"
          min={0}
          value={form.taxaEntrega}
          onChange={e => set({ taxaEntrega: e.target.value })}
        />
      </Field>
      <Field lbl="Raio de entrega (km)">
        <input
          style={inp}
          placeholder="Ex: 5"
          type="number"
          inputMode="decimal"
          min={0}
          value={form.raioEntrega}
          onChange={e => set({ raioEntrega: e.target.value })}
        />
      </Field>

      <div style={{ marginBottom: 16 }}>
        <Toggle value={form.temMotoboy} onChange={v => set({ temMotoboy: v })} label="🛵 Tem motoboy próprio?" />
      </div>

      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 24 }}>
        <button style={{ ...btn('primary'), opacity: saving ? 0.6 : 1 }} onClick={saving ? undefined : onNext}>
          {saving ? 'Salvando...' : 'Concluir configuração'}
        </button>
        <button style={btn('ghost')} onClick={onBack} disabled={saving}>Voltar</button>
      </div>
    </div>
  )
}

function Step5({ form, onGoPanel }: { form: Form; onGoPanel: () => void }) {
  const horaFmt = (h: number) => `${String(h).padStart(2, '0')}:00`
  const items = [
    { icon: '🍕', label: form.nomePizzaria },
    { icon: '📱', label: `+${form.whatsappPizzaria}` },
    { icon: '📍', label: form.endereco },
    { icon: '⏰', label: `${horaFmt(form.horaAbertura)} – ${horaFmt(form.horaFechamento)}` },
    { icon: '🔑', label: form.chavePix },
    { icon: '💰', label: [form.aceitaDinheiro && 'Dinheiro', form.aceitaCartao && 'Cartão', 'Pix'].filter(Boolean).join(' · ') },
    ...(form.taxaEntrega ? [{ icon: '🛵', label: `Taxa R$ ${form.taxaEntrega} · Raio ${form.raioEntrega || '—'} km` }] : []),
  ]

  return (
    <div style={{ padding: '40px 20px 24px', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {/* Animação sucesso */}
      <div style={{ position: 'relative', width: 80, height: 80, marginBottom: 24 }}>
        <div style={{
          width: 80, height: 80, borderRadius: '50%',
          background: 'rgba(255,107,0,.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'popIn .4s cubic-bezier(.34,1.56,.64,1) both',
        }}>
          <span style={{ fontSize: 40 }}>✅</span>
        </div>
      </div>

      <h2 style={{ fontSize: 22, fontWeight: 800, color: TEXT, fontFamily: FONT, margin: '0 0 6px', textAlign: 'center' }}>
        Tudo configurado!
      </h2>
      <p style={{ fontSize: 14, color: MUTED, fontFamily: FONT, margin: '0 0 28px', textAlign: 'center' }}>
        Sua pizzaria está pronta para usar o ChefeBot.
      </p>

      {/* Resumo */}
      <div style={{ width: '100%', background: CARD, border: BORDER, borderRadius: 14, padding: '4px 0', marginBottom: 28 }}>
        {items.map((item, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', borderBottom: i < items.length - 1 ? BORDER : 'none' }}>
            <span style={{ fontSize: 18, flexShrink: 0 }}>{item.icon}</span>
            <span style={{ fontSize: 14, color: TEXT, fontFamily: FONT, wordBreak: 'break-all' }}>{item.label}</span>
          </div>
        ))}
      </div>

      <div style={{ width: '100%', marginTop: 'auto' }}>
        <button style={btn('primary')} onClick={onGoPanel}>Ir para o painel →</button>
      </div>

      <style>{`
        @keyframes popIn {
          from { transform: scale(0); opacity: 0; }
          to   { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function SetupPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<Form>(INITIAL)

  function set(partial: Partial<Form>) {
    setForm(prev => ({ ...prev, ...partial }))
  }

  async function save() {
    setSaving(true)
    try {
      await fetch('/api/configuracoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nomePizzaria: form.nomePizzaria,
          whatsappPizzaria: form.whatsappPizzaria,
          endereco: form.endereco,
          horaAbertura: form.horaAbertura,
          horaFechamento: form.horaFechamento,
          chavePix: form.chavePix,
          nomeTitularPix: form.nomeTitularPix,
          aceitaDinheiro: form.aceitaDinheiro,
          aceitaCartao: form.aceitaCartao,
          taxaEntrega: form.taxaEntrega ? Number(form.taxaEntrega) : 0,
          raioEntrega: form.raioEntrega ? Number(form.raioEntrega) : 0,
          temMotoboy: form.temMotoboy,
        }),
      })
      setStep(5)
    } catch {
      alert('Erro ao salvar. Tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  const TOTAL = 5
  const showProgress = step > 1 && step < 5

  return (
    <div style={{
      background: BG,
      minHeight: '100dvh',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: FONT,
      paddingBottom: 'env(safe-area-inset-bottom, 24px)',
    }}>
      {showProgress && <ProgressBar step={step - 1} total={TOTAL - 2} />}

      {step === 1 && <Step1 onNext={() => setStep(2)} />}
      {step === 2 && <Step2 form={form} set={set} onNext={() => setStep(3)} onBack={() => setStep(1)} />}
      {step === 3 && <Step3 form={form} set={set} onNext={() => setStep(4)} onBack={() => setStep(2)} />}
      {step === 4 && <Step4 form={form} set={set} onNext={save} onBack={() => setStep(3)} saving={saving} />}
      {step === 5 && <Step5 form={form} onGoPanel={() => router.push('/pedidos')} />}
    </div>
  )
}
