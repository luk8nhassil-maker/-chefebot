'use client'

import { useEffect, useRef, useState } from 'react'
import { Gift, Phone, MessageCircle, LogOut, Receipt, ShieldCheck, Sparkles, Pizza } from 'lucide-react'
import ClientBottomNav from '@/components/ClientBottomNav'
import PixPendenteBar, { usePixPendente } from '@/components/PixPendenteBar'
import { CF_OPEN_CART_KEY } from '@/lib/pedidoAtivoCliente'
import { destinoNextPermitido } from '@/lib/clientePedidos'

type Movimento = {
  id: string
  pedidoId: string | null
  tipo: string
  pontos: number
  descricao: string
  criadoEm: string
}

type Recompensa = { recompensaId: string; status: string; criadoEm: string }

type Fidelidade = {
  ativo: boolean
  descricaoRecompensa: string
  saldoPontos: number
  pontosPrevistos: number
  metaPontos: number
  pontosFaltantes: number
  progressoPercentual: number
  metaAtingida: boolean
  extrato: Movimento[]
  recompensas: Recompensa[]
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
  ultimosPedidos: PedidoResumo[]
}

function money(v?: number) {
  return `R$ ${(v ?? 0).toFixed(2).replace('.', ',')}`
}

function dataCurta(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  } catch {
    return ''
  }
}

const cores = {
  fundo: 'var(--background)',
  moldura: 'var(--surface-secondary)',
  cardBg: 'var(--surface)',
  cardBorda: 'var(--border)',
  navy: 'var(--foreground)',
  navyCard: 'var(--secondary)',
  navyCardTexto: 'var(--secondary-foreground)',
  textoSecundario: 'var(--foreground-secondary)',
  textoTerciario: 'var(--foreground-muted)',
  amarelo: 'var(--primary)',
  amareloTexto: 'var(--primary-foreground)',
  sucesso: 'var(--success-text)',
  perigo: 'var(--danger-text)',
}

// Chaves compartilhadas com o cardápio (mesma sessão de navegador): o vínculo
// criado ao abrir o link do WhatsApp sobrevive à navegação entre as abas.
// Nunca guardam o número — só o token opaco e os 4 dígitos finais.
const WA_TOKEN_KEY = 'cf_wa_token'
const WA_FINAL_KEY = 'cf_wa_final'

export default function ClientePage() {
  // Etapas: carregando → (perfil | confirmar | telefone) → otp → (nome) → perfil.
  // "confirmar" é a experiência de número reconhecido pelo link do WhatsApp:
  // mostra só o número mascarado (produzido no servidor) e nunca pede digitação.
  const [step, setStep] = useState<'carregando' | 'confirmar' | 'telefone' | 'otp' | 'nome' | 'perfil'>('carregando')
  const { pendente: pixPendente } = usePixPendente()
  const [telefone, setTelefone] = useState('')
  const [codigo, setCodigo] = useState('')
  const [nome, setNome] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [fidelidade, setFidelidade] = useState<Fidelidade | null>(null)
  const [resgatando, setResgatando] = useState(false)
  const [resgateErro, setResgateErro] = useState('')
  // Vínculo reconhecido: token opaco + máscaras vindas do servidor.
  const [waToken, setWaToken] = useState('')
  const [waMascarado, setWaMascarado] = useState('')
  const [waFinal, setWaFinal] = useState('')
  // O OTP em andamento foi enviado pelo vínculo (servidor decide o destino)
  // ou pelo telefone digitado no fluxo manual?
  const [otpViaVinculo, setOtpViaVinculo] = useState(false)
  const [reenvioEm, setReenvioEm] = useState(0)
  // Preenchido após um código validado com sucesso: permite "Tentar de novo"
  // sem re-submeter o código (que é de uso único e já foi consumido).
  const [posVerificacao, setPosVerificacao] = useState<{ nome: string | null; ticket: string | null } | null>(null)
  const codigoRef = useRef<HTMLInputElement>(null)

  // Retorno seguro pós-login (ex.: veio de "Pedido" no menu inferior sem
  // sessão ativa): só aceita destinos de uma allowlist explícita, nunca uma
  // URL externa/absoluta vinda do navegador — evita open redirect.
  function nextPermitidoAtual(): string | null {
    try {
      const params = new URLSearchParams(window.location.search)
      return destinoNextPermitido(params.get('next'))
    } catch {
      return null
    }
  }

  function abrirSacola() {
    try { sessionStorage.setItem(CF_OPEN_CART_KEY, '1') } catch {}
    window.location.href = '/pedido'
  }

  async function carregarPerfil(): Promise<Perfil | null> {
    try {
      const [resPerfil, resFidelidade] = await Promise.all([
        fetch('/api/cliente/perfil', { cache: 'no-store' }),
        fetch('/api/cliente/fidelidade', { cache: 'no-store' }),
      ])
      if (resPerfil.ok && resFidelidade.ok) {
        const dados: Perfil = await resPerfil.json()
        setPerfil(dados)
        setFidelidade(await resFidelidade.json())
        setStep('perfil')
        return dados
      }
    } catch {}
    return null
  }

  // Alguns navegadores (WhatsApp no iPhone) demoram — ou falham — para
  // aplicar o cookie de sessão vindo de uma resposta de fetch. A sondagem
  // tenta algumas vezes com espera curta antes de acionar o fallback de
  // ativação por navegação (ver confirmarCodigo).
  async function carregarPerfilComRetry(): Promise<Perfil | null> {
    const esperas = [0, 500, 1200]
    for (const ms of esperas) {
      if (ms > 0) await new Promise((r) => setTimeout(r, ms))
      const dados = await carregarPerfil()
      if (dados) return dados
    }
    return null
  }

  function limparVinculo() {
    setWaToken('')
    setWaMascarado('')
    setWaFinal('')
    try { sessionStorage.removeItem(WA_TOKEN_KEY); sessionStorage.removeItem(WA_FINAL_KEY) } catch {}
  }

  // Sem sessão de cliente: tenta reconhecer o WhatsApp do link (token opaco da
  // URL ?t= ou o já validado pelo cardápio nesta sessão do navegador). O token
  // é sempre revalidado no servidor; inválido/expirado cai no fluxo manual.
  async function iniciarSemSessao() {
    let token = ''
    try {
      const params = new URLSearchParams(window.location.search)
      const t = params.get('t')
      if (t) {
        // Remove o token da URL (evita vazar em prints/compartilhamentos) —
        // mesmo comportamento já validado no cardápio.
        params.delete('t')
        const qs = params.toString()
        window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))
        token = t
      } else {
        token = sessionStorage.getItem(WA_TOKEN_KEY) || ''
      }
    } catch {}
    if (!token) { setStep('telefone'); return }
    try {
      const r = await fetch(`/api/cardapio-whatsapp-session?t=${encodeURIComponent(token)}`, { cache: 'no-store' })
      const data = await r.json()
      if (data?.ok && data.phoneMascarado) {
        setWaToken(token)
        setWaMascarado(String(data.phoneMascarado))
        setWaFinal(String(data.phoneFinal || ''))
        try {
          sessionStorage.setItem(WA_TOKEN_KEY, token)
          sessionStorage.setItem(WA_FINAL_KEY, String(data.phoneFinal || ''))
        } catch {}
        setStep('confirmar')
        return
      }
      limparVinculo()
    } catch {}
    setStep('telefone')
  }

  useEffect(() => {
    carregarPerfil().then((dados) => {
      if (!dados) { iniciarSemSessao(); return }
      const destino = nextPermitidoAtual()
      if (destino) { window.location.href = destino; return }
      // Retomada do fallback de ativação por navegação (/api/cliente/sessao):
      // cliente novo volta direto para a etapa do nome.
      try {
        const params = new URLSearchParams(window.location.search)
        if (params.get('cadastro') === 'nome' && !dados.cliente.nome) {
          params.delete('cadastro')
          const qs = params.toString()
          window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))
          setStep('nome')
        }
      } catch {}
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Contador de reenvio do código (60s, alinhado ao cooldown do servidor).
  useEffect(() => {
    if (step !== 'otp' || reenvioEm <= 0) return
    const id = setTimeout(() => setReenvioEm((s) => (s > 0 ? s - 1 : 0)), 1000)
    return () => clearTimeout(id)
  }, [step, reenvioEm])

  // Foco automático no campo de código ao entrar na etapa.
  useEffect(() => {
    if (step === 'otp') codigoRef.current?.focus()
  }, [step])

  // Fluxo de número reconhecido: o body leva SÓ o token opaco — o servidor
  // resolve o destino do OTP; nenhum telefone sai do navegador.
  async function pedirCodigoVinculo() {
    setErro('')
    setEnviando(true)
    try {
      const res = await fetch('/api/cliente/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ waToken }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        if (data?.vinculoInvalido) {
          limparVinculo()
          setErro('Não conseguimos confirmar seu WhatsApp. Digite seu número.')
          setStep('telefone')
        } else {
          setErro(data.error || 'Não foi possível enviar o código')
        }
        setEnviando(false)
        return
      }
      setOtpViaVinculo(true)
      setCodigo('')
      setPosVerificacao(null)
      setReenvioEm(60)
      setStep('otp')
    } catch { setErro('Erro de conexão. Tente novamente.') }
    setEnviando(false)
  }

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
      setOtpViaVinculo(false)
      setCodigo('')
      setPosVerificacao(null)
      setReenvioEm(60)
      setStep('otp')
    } catch { setErro('Erro de conexão. Tente novamente.') }
    setEnviando(false)
  }

  async function reenviarCodigo() {
    if (reenvioEm > 0 || enviando) return
    if (otpViaVinculo) { await pedirCodigoVinculo(); return }
    await pedirCodigo()
  }

  // Depois de um código VÁLIDO: nunca deixar a tela parada em silêncio. A
  // sessão é sondada com retry; se o cookie da resposta de fetch não "pegou"
  // (navegador interno do WhatsApp no iPhone), ativa a sessão numa navegação
  // real usando o ticket de uso único devolvido pelo verificar.
  async function abrirAposVerificacao(pos: { nome: string | null; ticket: string | null }): Promise<void> {
    const dados = await carregarPerfilComRetry()
    if (dados) {
      const destino = nextPermitidoAtual()
      if (destino) { window.location.href = destino; return }
      if (!pos.nome) { setNome(''); setStep('nome') }
      return
    }
    if (pos.ticket) {
      window.location.href = `/api/cliente/sessao?tk=${encodeURIComponent(pos.ticket)}`
      return
    }
    setErro('Seu código foi confirmado, mas não conseguimos abrir seus pontos. Toque em "Tentar de novo".')
  }

  async function tentarAbrirNovamente() {
    if (!posVerificacao) return
    setErro('')
    setEnviando(true)
    await abrirAposVerificacao(posVerificacao)
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
        body: JSON.stringify(otpViaVinculo ? { waToken, codigo } : { telefone, codigo }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        if (data?.vinculoInvalido) {
          limparVinculo()
          setErro('Não conseguimos confirmar seu WhatsApp. Digite seu número.')
          setStep('telefone')
        } else {
          setErro(data.error || 'Código inválido')
        }
        setEnviando(false)
        return
      }
      const pos = { nome: (data?.cliente?.nome as string | null) ?? null, ticket: (data?.ticket as string | null) ?? null }
      setPosVerificacao(pos)
      await abrirAposVerificacao(pos)
    } catch { setErro('Erro de conexão. Tente novamente.') }
    setEnviando(false)
  }

  async function salvarNome() {
    setErro('')
    if (nome.trim().length < 2) { setErro('Digite seu nome'); return }
    setEnviando(true)
    try {
      const res = await fetch('/api/cliente/perfil', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) { setErro(data.error || 'Não foi possível salvar seu nome'); setEnviando(false); return }
      const dados = await carregarPerfilComRetry()
      if (dados) {
        const destino = nextPermitidoAtual()
        if (destino) { window.location.href = destino; return }
      } else {
        setErro('Seu nome foi salvo, mas não conseguimos abrir seus pontos. Tente de novo.')
      }
    } catch { setErro('Erro de conexão. Tente novamente.') }
    setEnviando(false)
  }

  async function sair() {
    try { await fetch('/api/cliente/logout', { method: 'POST' }) } catch {}
    setPerfil(null)
    setFidelidade(null)
    setTelefone('')
    setCodigo('')
    setNome('')
    setErro('')
    // Mantém o vínculo do link (se ainda válido) — sair da conta não apaga o
    // reconhecimento do WhatsApp desta sessão de navegação.
    if (waToken && waMascarado) { setStep('confirmar'); return }
    setStep('telefone')
  }

  // CTA de resgate só aparece quando a meta atual (recalculada no servidor,
  // não um snapshot antigo) bate, a fidelidade está ativa e existe pelo menos
  // uma recompensa aberta de verdade — nunca confia só na existência de um
  // texto de "próxima recompensa".
  const podeResgatar = !!fidelidade && fidelidade.ativo && fidelidade.metaAtingida && fidelidade.recompensas.length > 0

  async function resgatar() {
    if (!fidelidade || fidelidade.recompensas.length === 0) return
    setResgateErro('')
    setResgatando(true)
    try {
      const res = await fetch('/api/cliente/fidelidade/resgate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recompensaId: fidelidade.recompensas[0].recompensaId }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) { setResgateErro(data.error || 'Não foi possível reservar o resgate agora.'); setResgatando(false); return }
      try {
        sessionStorage.setItem('cf_resgate_pontos', JSON.stringify({
          resgateId: data.resgateId,
          valorDescontoMaximo: data.valorDescontoMaximo,
          expiraEm: data.expiraEm,
        }))
      } catch {}
      window.location.href = '/pedido'
    } catch {
      setResgateErro('Erro de conexão. Tente novamente.')
      setResgatando(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '14px 16px',
    borderRadius: 12,
    border: `1px solid ${cores.cardBorda}`,
    background: cores.cardBg,
    color: cores.navy,
    fontSize: 16,
    fontFamily: 'Archivo, sans-serif',
  }

  const botaoPrimario: React.CSSProperties = {
    width: '100%',
    padding: 14,
    borderRadius: 12,
    background: cores.amarelo,
    color: cores.amareloTexto,
    fontSize: 15,
    fontWeight: 700,
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'Archivo, sans-serif',
  }

  const botaoTextoDiscreto: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: cores.textoSecundario,
    fontSize: 13,
    cursor: 'pointer',
    fontFamily: 'Archivo, sans-serif',
  }

  const iconeCirculo = (icone: React.ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
      <div style={{ background: cores.navyCard, borderRadius: 999, width: 64, height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {icone}
      </div>
    </div>
  )

  return (
    <div style={{ background: cores.fundo, minHeight: '100dvh', fontFamily: 'Archivo, sans-serif', color: cores.navy, display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: cores.cardBg, borderBottom: `1px solid ${cores.cardBorda}`, padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Pizza size={22} color={cores.navy} />
          <div style={{ fontSize: 15, fontWeight: 700, color: cores.navy }}>Meus pontos</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {step === 'perfil' && (
            <button onClick={sair} aria-label="Sair da conta" style={{ background: 'none', border: 'none', color: cores.textoSecundario, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontFamily: 'Archivo, sans-serif' }}>
              <LogOut size={16} /> Sair
            </button>
          )}
        </div>
      </div>

      <div
        className="cliente-conteudo"
        style={{
          flex: 1,
          padding: '28px 20px calc(env(safe-area-inset-bottom) + 96px)',
          maxWidth: 1180,
          width: '100%',
          margin: '0 auto',
          boxSizing: 'border-box',
        }}
      >
        {step === 'carregando' && (
          <p style={{ textAlign: 'center', color: cores.textoSecundario, fontSize: 14 }}>Carregando...</p>
        )}

        {step === 'confirmar' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 420, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 4 }}>
              {iconeCirculo(<ShieldCheck size={30} color={cores.amarelo} />)}
              <h1 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 6px' }}>Encontramos seu WhatsApp</h1>
              <p style={{ fontSize: 13.5, color: cores.textoSecundario, margin: 0, lineHeight: 1.5 }}>
                Este é o número usado para abrir seu cardápio:
              </p>
            </div>
            <div style={{ background: cores.cardBg, border: `1px solid ${cores.cardBorda}`, borderRadius: 12, padding: '14px 16px', textAlign: 'center', fontSize: 20, fontWeight: 800, letterSpacing: 1, fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>
              {waMascarado}
            </div>
            <p style={{ fontSize: 13.5, color: cores.textoSecundario, margin: 0, lineHeight: 1.5, textAlign: 'center' }}>
              Confirme seu WhatsApp para ativar seus pontos, acompanhar suas recompensas e não perder nenhuma vantagem.
            </p>
            {erro && <p style={{ color: cores.perigo, fontSize: 13, margin: 0, textAlign: 'center' }}>{erro}</p>}
            <button onClick={pedirCodigoVinculo} disabled={enviando} style={{ ...botaoPrimario, opacity: enviando ? 0.6 : 1 }}>
              {enviando ? 'Enviando...' : 'Confirmar e receber código'}
            </button>
            <p style={{ fontSize: 12.5, color: cores.textoTerciario, margin: 0, textAlign: 'center' }}>
              Vamos enviar um código de segurança para este WhatsApp.
            </p>
            <button onClick={() => { setErro(''); setStep('telefone') }} style={{ ...botaoTextoDiscreto, textAlign: 'center' }}>
              Este número não é meu
            </button>
          </div>
        )}

        {step === 'telefone' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 420, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 4 }}>
              {iconeCirculo(<Gift size={30} color={cores.amarelo} />)}
              <h1 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 6px' }}>Entre com seu WhatsApp</h1>
              <p style={{ fontSize: 13.5, color: cores.textoSecundario, margin: 0, lineHeight: 1.5 }}>
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
            {erro && <p style={{ color: cores.perigo, fontSize: 13, margin: 0 }}>{erro}</p>}
            <button onClick={pedirCodigo} disabled={enviando} style={{ ...botaoPrimario, opacity: enviando ? 0.6 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <Phone size={16} /> {enviando ? 'Enviando...' : 'Receber código no WhatsApp'}
            </button>
            {waToken && waMascarado && (
              <button onClick={() => { setErro(''); setStep('confirmar') }} style={{ ...botaoTextoDiscreto, textAlign: 'center' }}>
                Voltar para o número encontrado
              </button>
            )}
            <a href="/pedido" style={{ textAlign: 'center', fontSize: 13, color: cores.textoSecundario, textDecoration: 'none' }}>
              Prefiro pedir sem entrar agora
            </a>
          </div>
        )}

        {step === 'otp' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 420, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 4 }}>
              {iconeCirculo(<MessageCircle size={28} color={cores.amarelo} />)}
              <h1 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 6px' }}>Confira seu WhatsApp</h1>
              <p style={{ fontSize: 13.5, color: cores.textoSecundario, margin: 0, lineHeight: 1.5 }}>
                {otpViaVinculo && waFinal
                  ? `Enviamos um código para o número final ${waFinal}.`
                  : 'Enviamos um código de 6 dígitos pro seu WhatsApp.'}
              </p>
            </div>
            <input
              ref={codigoRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              value={codigo}
              // Sem maxLength no atributo: colar "12 34 56" não pode ser
              // truncado pelo navegador antes do filtro de dígitos abaixo.
              // Editar o código limpa o erro anterior na hora.
              onChange={(e) => { if (erro) setErro(''); setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6)) }}
              style={{ ...inputStyle, textAlign: 'center', letterSpacing: 4, fontSize: 20 }}
            />
            {erro && <p style={{ color: cores.perigo, fontSize: 13, margin: 0 }}>{erro}</p>}
            {/* Depois de um código já validado, o CTA vira "Tentar de novo":
                reabre o perfil sem re-submeter o código de uso único. */}
            {posVerificacao ? (
              <button onClick={tentarAbrirNovamente} disabled={enviando} style={{ ...botaoPrimario, opacity: enviando ? 0.6 : 1 }}>
                {enviando ? 'Abrindo...' : 'Tentar de novo'}
              </button>
            ) : (
              <button onClick={confirmarCodigo} disabled={enviando} style={{ ...botaoPrimario, opacity: enviando ? 0.6 : 1 }}>
                {enviando ? 'Confirmando...' : 'Confirmar código'}
              </button>
            )}
            <button
              onClick={reenviarCodigo}
              disabled={reenvioEm > 0 || enviando}
              style={{ ...botaoTextoDiscreto, opacity: reenvioEm > 0 ? 0.6 : 1, cursor: reenvioEm > 0 ? 'default' : 'pointer' }}
            >
              {reenvioEm > 0 ? `Reenviar código em ${reenvioEm}s` : 'Reenviar código'}
            </button>
            <button onClick={() => { setErro(''); setCodigo(''); setPosVerificacao(null); setStep('telefone') }} style={botaoTextoDiscreto}>
              Usar outro número
            </button>
          </div>
        )}

        {step === 'nome' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 420, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 4 }}>
              {iconeCirculo(<Sparkles size={28} color={cores.amarelo} />)}
              <h1 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 6px' }}>Como podemos chamar você?</h1>
              <p style={{ fontSize: 13.5, color: cores.textoSecundario, margin: 0, lineHeight: 1.5 }}>
                Seu WhatsApp já está confirmado. Falta só seu nome para ativar suas vantagens.
              </p>
            </div>
            <input
              type="text"
              autoComplete="name"
              placeholder="Seu nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              maxLength={60}
              style={inputStyle}
              autoFocus
            />
            {erro && <p style={{ color: cores.perigo, fontSize: 13, margin: 0 }}>{erro}</p>}
            <button onClick={salvarNome} disabled={enviando} style={{ ...botaoPrimario, opacity: enviando ? 0.6 : 1 }}>
              {enviando ? 'Ativando...' : 'Ativar meus pontos'}
            </button>
          </div>
        )}

        {step === 'perfil' && perfil && fidelidade && (
          <div className="cliente-grid">
            <div className="cliente-col-esquerda" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ fontSize: 15, color: cores.textoSecundario }}>
                Olá{perfil.cliente.nome ? `, ${perfil.cliente.nome.split(' ')[0]}` : ''}!
              </div>

              {!fidelidade.ativo && (
                <div style={{ background: cores.cardBg, border: `1px solid ${cores.cardBorda}`, borderRadius: 14, padding: 18, textAlign: 'center' }}>
                  <p style={{ color: cores.textoSecundario, fontSize: 14, margin: 0 }}>O programa de pontos ainda não está ativo por aqui. Volte em breve!</p>
                </div>
              )}

              {fidelidade.ativo && (
                <>
                  {/* Hero de saldo */}
                  <div style={{ background: cores.cardBg, border: `1px solid ${cores.cardBorda}`, borderRadius: 16, padding: 22 }}>
                    <div style={{ fontSize: 13, color: cores.textoSecundario, marginBottom: 4 }}>Seu saldo de pontos</div>
                    <div style={{ fontSize: 56, fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                      {fidelidade.saldoPontos}
                    </div>
                    <div style={{ fontSize: 12.5, color: cores.textoTerciario, marginTop: 10 }}>A cada R$1 gasto = 1 ponto</div>
                  </div>

                  {podeResgatar ? (
                    // Meta atingida: substitui o card de progresso pelo card
                    // navy com CTA — único lugar da tela com fundo escuro.
                    <div style={{ background: cores.navyCard, borderRadius: 16, padding: 22, color: cores.navyCardTexto }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                        <Sparkles size={20} color={cores.amarelo} />
                        <span style={{ fontSize: 13, fontWeight: 700, color: cores.amarelo, textTransform: 'uppercase', letterSpacing: 0.5 }}>Recompensa disponível</span>
                      </div>
                      <p style={{ fontSize: 16, fontWeight: 700, margin: '0 0 16px' }}>{fidelidade.descricaoRecompensa}</p>
                      {resgateErro && <p style={{ color: 'var(--danger-border)', fontSize: 13, margin: '0 0 12px' }}>{resgateErro}</p>}
                      <button
                        onClick={resgatar}
                        disabled={resgatando}
                        style={{ ...botaoPrimario, opacity: resgatando ? 0.6 : 1 }}
                      >
                        {resgatando ? 'Preparando resgate...' : 'Resgatar minha Pizza Família'}
                      </button>
                    </div>
                  ) : (
                    <div style={{ background: cores.cardBg, border: `1px solid ${cores.cardBorda}`, borderRadius: 16, padding: 22 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
                        {fidelidade.saldoPontos} de {fidelidade.metaPontos} pontos
                      </div>
                      <div style={{ background: cores.moldura, borderRadius: 999, height: 12, overflow: 'hidden' }}>
                        <div style={{
                          width: `${Math.min(100, fidelidade.progressoPercentual)}%`,
                          height: '100%',
                          background: cores.amarelo,
                          borderRadius: 999,
                        }} />
                      </div>
                      <p style={{ fontSize: 13, color: cores.textoSecundario, margin: '10px 0 0' }}>
                        Faltam {fidelidade.pontosFaltantes} pontos para: {fidelidade.descricaoRecompensa}
                      </p>
                    </div>
                  )}

                  {/* Etapa 2: nenhum card de estado operacional (pedido em
                      andamento, lembrete, pagamento) na home/Pontos —
                      informações de pedido ficam em Pedido/Pedidos, no
                      rastreamento e na barra global de Pix pendente. */}
                </>
              )}

              <a href="/pedido" style={{ ...botaoPrimario, textDecoration: 'none', textAlign: 'center', boxSizing: 'border-box', display: 'block' }}>
                Continuar comprando
              </a>
            </div>

            <div className="cliente-col-direita" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {perfil.ultimosPedidos.length > 0 && (
                <div style={{ background: cores.cardBg, border: `1px solid ${cores.cardBorda}`, borderRadius: 14, padding: 18 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <Receipt size={16} color={cores.textoTerciario} />
                    <p style={{ fontSize: 11, color: cores.textoTerciario, textTransform: 'uppercase', letterSpacing: 0.5, margin: 0 }}>Últimos pedidos</p>
                  </div>
                  {perfil.ultimosPedidos.map((p) => (
                    <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, color: cores.navy, padding: '8px 0', borderTop: `1px solid ${cores.moldura}` }}>
                      <span>{p.numero ? `#${p.numero}` : p.id} · {p.data}</span>
                      <span>{money(p.total)}</span>
                    </div>
                  ))}
                </div>
              )}

              {fidelidade.ativo && (
                <div style={{ background: cores.cardBg, border: `1px solid ${cores.cardBorda}`, borderRadius: 14, padding: 18 }}>
                  <p style={{ fontSize: 11, color: cores.textoTerciario, textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 12px' }}>Extrato de pontos</p>
                  {fidelidade.extrato.length === 0 && (
                    <p style={{ fontSize: 13, color: cores.textoSecundario, margin: 0 }}>Nenhuma movimentação ainda — seu primeiro pedido entra aqui.</p>
                  )}
                  {fidelidade.extrato.map((m) => {
                    const positivo = m.tipo === 'confirmado' || m.tipo === 'ajuste' && m.pontos > 0
                    const negativo = m.tipo === 'resgatado' || m.tipo === 'estornado' || (m.tipo === 'ajuste' && m.pontos < 0)
                    const semPontos = m.tipo === 'cancelado' || m.tipo === 'previsto'
                    const delta = semPontos ? '—' : `${positivo ? '+' : negativo ? '−' : ''}${Math.abs(m.pontos)}`
                    const corDelta = semPontos ? cores.textoTerciario : positivo ? cores.sucesso : cores.navy
                    return (
                      <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13.5, padding: '8px 0', borderTop: `1px solid ${cores.moldura}` }}>
                        <div>
                          <div style={{ color: cores.navy }}>{m.descricao}</div>
                          <div style={{ color: cores.textoTerciario, fontSize: 11.5 }}>{dataCurta(m.criadoEm)}</div>
                        </div>
                        <span style={{ color: corDelta, fontWeight: 700 }}>{delta}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <PixPendenteBar pendente={pixPendente} />
      <ClientBottomNav active="pontos" onSacolaClick={abrirSacola} pixPendente={!!pixPendente} />

      <style>{`.cliente-grid { display: flex; flex-direction: column; } @media (min-width: 1024px) { .cliente-grid { display: grid; grid-template-columns: 1.35fr 1fr; gap: 24px; align-items: start; } } @media (min-width: 768px) and (max-width: 1023.98px) { .cliente-conteudo { padding: 32px 32px calc(env(safe-area-inset-bottom) + 96px); } }`}</style>
    </div>
  )
}
