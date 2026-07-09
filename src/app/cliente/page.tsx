'use client'

import { useEffect, useState } from 'react'

type Fidelidade = {
  ativo: boolean
  progresso: number
  meta: number
  faltam: number
  tipoRecompensa: string
  descricaoRecompensa: string
  recompensasDisponiveis: { recompensaId: string; descricao: string }[]
}

type PedidoResumo = {
  id: string
  numero?: number
  data?: string
  total?: number
  status?: string
}

type Perfil = {
  cliente: { nome: string | null; telefone: string }
  fidelidade: Fidelidade
  ultimosPedidos: PedidoResumo[]
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '14px 16px',
  borderRadius: 12,
  border: '1px solid #222',
  background: '#0a0a0a',
  color: '#fff',
  fontSize: 16,
  fontFamily: 'Archivo, sans-serif',
}

const botaoPrimario: React.CSSProperties = {
  width: '100%',
  padding: 14,
  borderRadius: 12,
  background: '#ff6b00',
  color: '#fff',
  fontSize: 15,
  fontWeight: 700,
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'Archivo, sans-serif',
}

function money(v?: number) {
  return `R$ ${(v ?? 0).toFixed(2).replace('.', ',')}`
}

export default function ClientePage() {
  const [step, setStep] = useState<'carregando' | 'telefone' | 'otp' | 'perfil'>('carregando')
  const [telefone, setTelefone] = useState('')
  const [codigo, setCodigo] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [perfil, setPerfil] = useState<Perfil | null>(null)

  async function carregarPerfil() {
    try {
      const res = await fetch('/api/cliente/perfil', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setPerfil(data)
        setStep('perfil')
        return true
      }
    } catch {}
    return false
  }

  useEffect(() => {
    carregarPerfil().then((ok) => { if (!ok) setStep('telefone') })
  }, [])

  async function pedirCodigo() {
    setErro('')
    if (telefone.replace(/\D/g, '').length < 10) { setErro('Digite um WhatsApp válido com DDD'); return }
    setEnviando(true)
    try {
      const res = await fetch('/api/cliente/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefone }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) { setErro(data.error || 'Não foi possível enviar o código'); setEnviando(false); return }
      setStep('otp')
    } catch { setErro('Erro de conexão. Tente novamente.') }
    setEnviando(false)
  }

  async function confirmarCodigo() {
    setErro('')
    if (!codigo.trim()) { setErro('Digite o código recebido no WhatsApp'); return }
    setEnviando(true)
    try {
      const res = await fetch('/api/cliente/verificar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefone, codigo }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) { setErro(data.error || 'Código inválido'); setEnviando(false); return }
      await carregarPerfil()
    } catch { setErro('Erro de conexão. Tente novamente.') }
    setEnviando(false)
  }

  async function sair() {
    try { await fetch('/api/cliente/logout', { method: 'POST' }) } catch {}
    setPerfil(null)
    setTelefone('')
    setCodigo('')
    setStep('telefone')
  }

  return (
    <div style={{ background: '#060606', minHeight: '100dvh', fontFamily: 'Archivo, sans-serif', color: '#fff', display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: '#111', borderBottom: '1px solid #222', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>🍕</span>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#ff6b00' }}>Sua fidelidade</div>
        </div>
        <a href="/cardapio" style={{ fontSize: 13, color: '#888', textDecoration: 'none' }}>← Cardápio</a>
      </div>

      <div style={{ flex: 1, padding: '28px 20px', maxWidth: 420, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        {step === 'carregando' && (
          <p style={{ textAlign: 'center', color: '#888', fontSize: 14 }}>Carregando...</p>
        )}

        {step === 'telefone' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ textAlign: 'center', marginBottom: 4 }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>🎁</div>
              <h1 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 6px' }}>Entre com seu WhatsApp</h1>
              <p style={{ fontSize: 13.5, color: '#a39b8b', margin: 0, lineHeight: 1.5 }}>
                Suas pizzas começam a contar rumo à sua recompensa.
              </p>
            </div>
            <input
              type="tel"
              inputMode="numeric"
              placeholder="(99) 99999-9999"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              style={inputStyle}
            />
            {erro && <p style={{ color: '#f87171', fontSize: 13, margin: 0 }}>{erro}</p>}
            <button onClick={pedirCodigo} disabled={enviando} style={{ ...botaoPrimario, opacity: enviando ? 0.6 : 1 }}>
              {enviando ? 'Enviando...' : 'Receber código no WhatsApp'}
            </button>
            <a href="/cardapio" style={{ textAlign: 'center', fontSize: 13, color: '#888', textDecoration: 'none' }}>
              Prefiro pedir sem entrar agora
            </a>
          </div>
        )}

        {step === 'otp' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ textAlign: 'center', marginBottom: 4 }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>💬</div>
              <h1 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 6px' }}>Digite o código</h1>
              <p style={{ fontSize: 13.5, color: '#a39b8b', margin: 0, lineHeight: 1.5 }}>
                Enviamos um código de 6 dígitos pro seu WhatsApp.
              </p>
            </div>
            <input
              type="text"
              inputMode="numeric"
              placeholder="000000"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              style={{ ...inputStyle, textAlign: 'center', letterSpacing: 4, fontSize: 20 }}
              maxLength={6}
            />
            {erro && <p style={{ color: '#f87171', fontSize: 13, margin: 0 }}>{erro}</p>}
            <button onClick={confirmarCodigo} disabled={enviando} style={{ ...botaoPrimario, opacity: enviando ? 0.6 : 1 }}>
              {enviando ? 'Confirmando...' : 'Entrar'}
            </button>
            <button onClick={() => setStep('telefone')} style={{ background: 'none', border: 'none', color: '#888', fontSize: 13, cursor: 'pointer' }}>
              Trocar número
            </button>
          </div>
        )}

        {step === 'perfil' && perfil && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 15, color: '#a39b8b' }}>Olá{perfil.cliente.nome ? `, ${perfil.cliente.nome.split(' ')[0]}` : ''}!</div>
            </div>

            {!perfil.fidelidade.ativo && (
              <div style={{ background: '#111', border: '1px solid #222', borderRadius: 14, padding: 18, textAlign: 'center' }}>
                <p style={{ color: '#a39b8b', fontSize: 14, margin: 0 }}>A fidelidade ainda não está ativa por aqui. Volte em breve!</p>
              </div>
            )}

            {perfil.fidelidade.ativo && (
              <div style={{ background: '#111', border: '1px solid #222', borderRadius: 14, padding: 20 }}>
                <p style={{ fontSize: 16, fontWeight: 800, margin: '0 0 12px', textAlign: 'center' }}>
                  Você tem {perfil.fidelidade.progresso} de {perfil.fidelidade.meta} pizzas 🍕
                </p>
                <div style={{ background: '#0a0a0a', borderRadius: 999, height: 14, overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.min(100, (perfil.fidelidade.progresso / Math.max(1, perfil.fidelidade.meta)) * 100)}%`,
                    height: '100%',
                    background: '#ff6b00',
                    borderRadius: 999,
                  }} />
                </div>
                <p style={{ textAlign: 'center', fontSize: 13, color: '#a39b8b', margin: '10px 0 0' }}>
                  {perfil.fidelidade.faltam > 0
                    ? `Faltam só ${perfil.fidelidade.faltam} pizzas para liberar: ${perfil.fidelidade.descricaoRecompensa}`
                    : `Você já pode liberar: ${perfil.fidelidade.descricaoRecompensa}`}
                </p>

                {perfil.fidelidade.recompensasDisponiveis.length > 0 && (
                  <div style={{ marginTop: 14, background: 'rgba(74,222,128,.1)', border: '1px solid rgba(74,222,128,.3)', borderRadius: 10, padding: 12 }}>
                    {perfil.fidelidade.recompensasDisponiveis.map((r) => (
                      <p key={r.recompensaId} style={{ color: '#4ade80', fontWeight: 700, fontSize: 14, margin: 0 }}>
                        🎉 Recompensa disponível: {r.descricao}
                      </p>
                    ))}
                    <p style={{ color: '#a39b8b', fontSize: 12, margin: '6px 0 0' }}>Combine o resgate no seu próximo pedido.</p>
                  </div>
                )}
              </div>
            )}

            <a href="/cardapio" style={{ ...botaoPrimario, textDecoration: 'none', textAlign: 'center', boxSizing: 'border-box', display: 'block' }}>
              Continuar comprando
            </a>

            {perfil.ultimosPedidos.length > 0 && (
              <div style={{ background: '#111', border: '1px solid #222', borderRadius: 14, padding: 16 }}>
                <p style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 10px' }}>Últimos pedidos</p>
                {perfil.ultimosPedidos.map((p) => (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, color: '#ccc', padding: '6px 0', borderTop: '1px solid #1a1a1a' }}>
                    <span>{p.numero ? `#${p.numero}` : p.id} · {p.data}</span>
                    <span>{money(p.total)}</span>
                  </div>
                ))}
              </div>
            )}

            <button onClick={sair} style={{ background: 'none', border: 'none', color: '#888', fontSize: 13, cursor: 'pointer', padding: 8 }}>
              Sair da conta
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
