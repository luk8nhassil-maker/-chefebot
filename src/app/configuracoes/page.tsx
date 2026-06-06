'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type Config = {
  nomePizzaria: string
  horaAbertura: number
  horaFechamento: number
  chavePix: string
}

function getUserRole(): string | null {
  if (typeof document === 'undefined') return null
  try {
    const cookies = document.cookie.split(';')
    for (const c of cookies) {
      const trimmed = c.trim()
      if (trimmed.startsWith('auth-user=')) {
        const raw = trimmed.substring('auth-user='.length)
        const decoded = decodeURIComponent(raw)
        const user = JSON.parse(decoded)
        return user?.role ?? null
      }
    }
  } catch { return null }
  return null
}

export default function ConfiguracoesPage() {
  const router = useRouter()
  const [config, setConfig] = useState<Config>({
    nomePizzaria: 'Chefe da Pizza',
    horaAbertura: 18,
    horaFechamento: 23,
    chavePix: '',
  })
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [mensagem, setMensagem] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const is24h = config.horaAbertura === 0 && config.horaFechamento === 24

  useEffect(() => {
    const role = getUserRole()
    setIsAdmin(role === 'admin')
    setChecking(false)
    fetch('/api/configuracoes')
      .then(r => {
        if (r.status === 401) { router.push('/login?callbackUrl=/configuracoes'); return null }
        return r.json()
      })
      .then(data => {
        if (data) {
          setConfig(data)
          setLoading(false)
        }
      })
  }, [router])

  const toggle24h = async () => {
    const novaConfig = is24h
      ? { ...config, horaAbertura: 18, horaFechamento: 23 }
      : { ...config, horaAbertura: 0, horaFechamento: 24 }
    setConfig(novaConfig)
    setSalvando(true)
    try {
      const res = await fetch('/api/configuracoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(novaConfig),
      })
      if (res.ok) {
        setMensagem(is24h ? '✅ Horário padrão restaurado!' : '✅ Estabelecimento aberto 24h!')
        setTimeout(() => setMensagem(''), 3000)
      }
    } catch {
      setMensagem('❌ Erro ao salvar.')
      setTimeout(() => setMensagem(''), 3000)
    }
    setSalvando(false)
  }

  const salvar = async () => {
    setSalvando(true)
    try {
      const res = await fetch('/api/configuracoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (res.ok) {
        setMensagem('✅ Configurações salvas!')
        setTimeout(() => setMensagem(''), 3000)
      }
    } catch {
      setMensagem('❌ Erro ao salvar.')
      setTimeout(() => setMensagem(''), 3000)
    }
    setSalvando(false)
  }

  if (checking || loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #1a0a00 0%, #2d0a0a 50%, #1a0505 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#fff' }}>Carregando...</p>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #1a0a00 0%, #2d0a0a 50%, #1a0505 100%)', padding: '40px 16px' }}>
      <div style={{ maxWidth: 500, margin: '0 auto' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
          <button
            onClick={() => router.push('/admin')}
            style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', fontSize: 14 }}
          >
            ← Voltar
          </button>
          <h1 style={{ color: '#fff', fontSize: 24, fontWeight: 700, margin: 0 }}>⚙️ Configurações</h1>
        </div>

        <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>

          <div>
            <label style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 8 }}>
              🍕 Nome da Pizzaria
            </label>
            <input
              type="text"
              value={config.nomePizzaria}
              onChange={e => setConfig(prev => ({ ...prev, nomePizzaria: e.target.value }))}
              style={{ width: '100%', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, padding: '12px 14px', color: '#fff', fontSize: 15, outline: 'none', boxSizing: 'border-box' }}
            />
          </div>

          <div>
            <label style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 8 }}>
              ⏰ Horário de Funcionamento
            </label>
            <button
              onClick={toggle24h}
              disabled={salvando}
              style={{
                width: '100%',
                background: is24h ? 'linear-gradient(135deg, #38a169, #276749)' : 'rgba(255,255,255,0.08)',
                border: is24h ? '2px solid #38a169' : '2px solid rgba(255,255,255,0.15)',
                borderRadius: 10, padding: '12px 14px', color: '#fff', fontSize: 14, fontWeight: 700,
                cursor: salvando ? 'not-allowed' : 'pointer', marginBottom: 12,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              {is24h ? '✅ Aberto 24 horas (ativo) — clique para desativar' : '🕐 Ativar funcionamento 24 horas'}
            </button>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, display: 'block', marginBottom: 4 }}>Abre às</label>
                <input
                  type="number" min={0} max={23} value={config.horaAbertura}
                  onChange={e => setConfig(prev => ({ ...prev, horaAbertura: Number(e.target.value) }))}
                  style={{ width: '100%', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, padding: '12px 14px', color: '#fff', fontSize: 15, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 20, paddingTop: 20 }}>→</span>
              <div style={{ flex: 1 }}>
                <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, display: 'block', marginBottom: 4 }}>Fecha às</label>
                <input
                  type="number" min={0} max={24} value={config.horaFechamento}
                  onChange={e => setConfig(prev => ({ ...prev, horaFechamento: Number(e.target.value) }))}
                  style={{ width: '100%', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, padding: '12px 14px', color: '#fff', fontSize: 15, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
            </div>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 8 }}>
              Horário de Brasília. Fora desse horário o bot avisa que está fechado.
            </p>
          </div>

          {isAdmin && (
            <div style={{ background: 'rgba(255,215,0,0.05)', border: '1px solid rgba(255,215,0,0.2)', borderRadius: 12, padding: 16 }}>
              <label style={{ color: 'rgba(255,220,100,0.9)', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                💸 Chave Pix
                <span style={{ fontSize: 11, background: 'rgba(255,200,0,0.15)', padding: '2px 8px', borderRadius: 20 }}>Somente Admin</span>
              </label>
              <input
                type="text"
                placeholder="Ex: 11999999999 ou email@email.com"
                value={config.chavePix}
                onChange={e => setConfig(prev => ({ ...prev, chavePix: e.target.value }))}
                style={{ width: '100%', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,200,0,0.25)', borderRadius: 10, padding: '12px 14px', color: '#fff', fontSize: 15, outline: 'none', boxSizing: 'border-box' }}
              />
              <p style={{ color: 'rgba(255,220,100,0.5)', fontSize: 12, marginTop: 8 }}>
                Aparece automaticamente no WhatsApp quando cliente escolher Pix.
              </p>
            </div>
          )}

          <button
            onClick={salvar}
            disabled={salvando}
            style={{
              background: salvando ? 'rgba(255,255,255,0.2)' : 'linear-gradient(135deg, #e53e3e, #c53030)',
              border: 'none', borderRadius: 12, padding: '14px 0', color: '#fff',
              fontSize: 16, fontWeight: 700, cursor: salvando ? 'not-allowed' : 'pointer',
              boxShadow: salvando ? 'none' : '0 4px 15px rgba(229,62,62,0.4)',
            }}
          >
            {salvando ? 'Salvando...' : 'Salvar Configurações'}
          </button>

          {mensagem && (
            <p style={{ textAlign: 'center', color: mensagem.includes('✅') ? '#68d391' : '#fc8181', fontWeight: 600 }}>
              {mensagem}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}