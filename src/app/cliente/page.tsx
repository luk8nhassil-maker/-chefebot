'use client'

import { useEffect, useState } from 'react'
import { Gift, Phone, MessageCircle, LogOut, Receipt, Sparkles, Clock, Pizza } from 'lucide-react'
import ClientBottomNav from '@/components/ClientBottomNav'
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
  cliente: { nome: string | null; telefone: string; pontosAtivos: boolean }
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

export default function ClientePage() {
  const [step, setStep] = useState<'carregando' | 'erro' | 'indisponivel' | 'ativacao' | 'telefone' | 'otp' | 'perfil'>('carregando')
  // Intenção que trouxe o cliente até o login: 'ativar' (tocou "Ativar meus
  // pontos" sem sessão) ativa a participação automaticamente assim que o OTP
  // é confirmado; 'login' (tocou "Entrar com WhatsApp") só autentica — se
  // ainda não tiver ativado, o cliente continua vendo o card de ativação
  // (estado B) normalmente, sem ativação automática.
  const [intent, setIntent] = useState<'ativar' | 'login'>('login')
  const [telefone, setTelefone] = useState('')
  const [codigo, setCodigo] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [fidelidade, setFidelidade] = useState<Fidelidade | null>(null)
  const [resgatando, setResgatando] = useState(false)
  const [resgateErro, setResgateErro] = useState('')
  const [ativando, setAtivando] = useState(false)
  const [ativacaoErro, setAtivacaoErro] = useState('')
  const [comoFuncionaAberto, setComoFuncionaAberto] = useState(false)

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

  // Estados A/B/C (Nível 6.6): "ativo" abaixo é o programa GLOBAL (config do
  // restaurante), nunca a participação individual do cliente.
  //   - !fidelidade.ativo               -> 'indisponivel' (nunca mostra ativação)
  //   - ativo && !cliente.pontosAtivos  -> 'ativacao' (estado A sem sessão / estado B com sessão)
  //   - ativo && cliente.pontosAtivos   -> 'perfil' (estado C: saldo/progresso)
  async function carregarPerfil() {
    try {
      const [resPerfil, resFidelidade] = await Promise.all([
        fetch('/api/cliente/perfil', { cache: 'no-store' }),
        fetch('/api/cliente/fidelidade', { cache: 'no-store' }),
      ])
      if (resPerfil.ok && resFidelidade.ok) {
        const perfilData: Perfil = await resPerfil.json()
        const fidelidadeData: Fidelidade = await resFidelidade.json()
        setPerfil(perfilData)
        setFidelidade(fidelidadeData)
        if (!fidelidadeData.ativo) { setStep('indisponivel'); return true }
        setStep(perfilData.cliente.pontosAtivos ? 'perfil' : 'ativacao')
        return true
      }
    } catch {}
    return false
  }

  async function buscarStatusPublico(): Promise<{ ativo: boolean } | null> {
    try {
      const res = await fetch('/api/fidelidade/status', { cache: 'no-store' })
      if (!res.ok) return null
      return await res.json()
    } catch {
      return null
    }
  }

  // Usado quando não há sessão (bootstrap inicial e logo após "Sair"): só
  // aqui é preciso perguntar o status do programa sem depender de login,
  // porque /api/cliente/fidelidade (que já traz esse campo) exige sessão.
  async function irParaEstadoInicial() {
    const status = await buscarStatusPublico()
    if (!status) { setStep('erro'); return }
    setStep(status.ativo ? 'ativacao' : 'indisponivel')
  }

  useEffect(() => {
    carregarPerfil().then(async (ok) => {
      if (ok) {
        const destino = nextPermitidoAtual()
        if (destino) window.location.href = destino
        return
      }
      await irParaEstadoInicial()
    })
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
      // "Ativar meus pontos" sem sessão -> ativa a participação assim que o
      // login termina, sem exigir um segundo toque (best-effort: se falhar,
      // carregarPerfil() abaixo ainda cai no estado B, e o cliente pode
      // tocar "Ativar meus pontos" de novo).
      if (intent === 'ativar') {
        try { await fetch('/api/cliente/fidelidade/ativar', { method: 'POST' }) } catch {}
      }
      const ok = await carregarPerfil()
      if (ok) {
        const destino = nextPermitidoAtual()
        if (destino) { window.location.href = destino; return }
      }
    } catch { setErro('Erro de conexão. Tente novamente.') }
    setEnviando(false)
  }

  // Estado A/B: ativa direto se já autenticado; sem sessão, leva ao login
  // (telefone/otp) guardando a intenção para ativar automaticamente depois.
  async function ativarOuEntrar() {
    if (perfil) {
      setAtivacaoErro('')
      setAtivando(true)
      try {
        const res = await fetch('/api/cliente/fidelidade/ativar', { method: 'POST' })
        if (!res.ok) { setAtivacaoErro('Não foi possível ativar agora. Tente novamente.'); setAtivando(false); return }
        await carregarPerfil()
      } catch { setAtivacaoErro('Erro de conexão. Tente novamente.') }
      setAtivando(false)
      return
    }
    setIntent('ativar')
    setErro('')
    setStep('telefone')
  }

  function entrarComWhatsapp() {
    setIntent('login')
    setErro('')
    setStep('telefone')
  }

  async function sair() {
    try { await fetch('/api/cliente/logout', { method: 'POST' }) } catch {}
    setPerfil(null)
    setFidelidade(null)
    setTelefone('')
    setCodigo('')
    setIntent('login')
    setAtivacaoErro('')
    setStep('carregando')
    await irParaEstadoInicial()
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

  return (
    <div style={{ background: cores.fundo, minHeight: '100dvh', fontFamily: 'Archivo, sans-serif', color: cores.navy, display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: cores.cardBg, borderBottom: `1px solid ${cores.cardBorda}`, padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Pizza size={22} color={cores.navy} />
          <div style={{ fontSize: 15, fontWeight: 700, color: cores.navy }}>Meus pontos</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {!!perfil && (
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

        {step === 'erro' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 420, margin: '0 auto', textAlign: 'center' }}>
            <p style={{ color: cores.textoSecundario, fontSize: 14, margin: 0 }}>Não foi possível carregar agora. Verifique sua conexão.</p>
            <button onClick={() => { setStep('carregando'); irParaEstadoInicial() }} style={botaoPrimario}>
              Tentar novamente
            </button>
          </div>
        )}

        {step === 'indisponivel' && (
          <div style={{ background: cores.cardBg, border: `1px solid ${cores.cardBorda}`, borderRadius: 14, padding: 18, textAlign: 'center', maxWidth: 420, margin: '0 auto' }}>
            <p style={{ color: cores.textoSecundario, fontSize: 14, margin: 0 }}>O programa de pontos ainda não está ativo por aqui. Volte em breve!</p>
          </div>
        )}

        {step === 'ativacao' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 420, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                <div style={{ background: cores.navyCard, borderRadius: 999, width: 64, height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Gift size={30} color={cores.amarelo} />
                </div>
              </div>
              <h1 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 6px' }}>Ative seus pontos</h1>
              <p style={{ fontSize: 13.5, color: cores.textoSecundario, margin: 0, lineHeight: 1.5 }}>
                Acumule pontos nos seus pedidos e acompanhe seu progresso até a próxima recompensa.
              </p>
            </div>
            {ativacaoErro && <p style={{ color: cores.perigo, fontSize: 13, margin: 0 }}>{ativacaoErro}</p>}
            <button onClick={ativarOuEntrar} disabled={ativando} style={{ ...botaoPrimario, opacity: ativando ? 0.6 : 1 }}>
              {ativando ? 'Ativando...' : 'Ativar meus pontos'}
            </button>
            {!perfil && (
              <button
                onClick={entrarComWhatsapp}
                style={{ background: 'none', border: `1px solid ${cores.cardBorda}`, borderRadius: 12, padding: 14, color: cores.navy, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'Archivo, sans-serif' }}
              >
                Entrar com WhatsApp
              </button>
            )}
          </div>
        )}

        {step === 'telefone' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 420, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                <div style={{ background: cores.navyCard, borderRadius: 999, width: 64, height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Gift size={30} color={cores.amarelo} />
                </div>
              </div>
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
            <a href="/pedido" style={{ textAlign: 'center', fontSize: 13, color: cores.textoSecundario, textDecoration: 'none' }}>
              Prefiro pedir sem entrar agora
            </a>
          </div>
        )}

        {step === 'otp' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 420, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                <div style={{ background: cores.navyCard, borderRadius: 999, width: 64, height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <MessageCircle size={28} color={cores.amarelo} />
                </div>
              </div>
              <h1 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 6px' }}>Digite o código</h1>
              <p style={{ fontSize: 13.5, color: cores.textoSecundario, margin: 0, lineHeight: 1.5 }}>
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
            {erro && <p style={{ color: cores.perigo, fontSize: 13, margin: 0 }}>{erro}</p>}
            <button onClick={confirmarCodigo} disabled={enviando} style={{ ...botaoPrimario, opacity: enviando ? 0.6 : 1 }}>
              {enviando ? 'Confirmando...' : 'Entrar'}
            </button>
            <button onClick={() => setStep('telefone')} style={{ background: 'none', border: 'none', color: cores.textoSecundario, fontSize: 13, cursor: 'pointer', fontFamily: 'Archivo, sans-serif' }}>
              Trocar número
            </button>
          </div>
        )}

        {step === 'perfil' && perfil && fidelidade && (
          <div className="cliente-grid">
            <div className="cliente-col-esquerda" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ fontSize: 15, color: cores.textoSecundario }}>
                Olá{perfil.cliente.nome ? `, ${perfil.cliente.nome.split(' ')[0]}` : ''}!
              </div>

              {/* Hero de saldo — sempre visível, inclusive com saldo 0 (nunca é confundido com "programa desativado": chegar aqui já exige fidelidade.ativo). */}
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
                    {resgatando ? 'Preparando resgate...' : `Resgatar ${fidelidade.descricaoRecompensa}`}
                  </button>
                </div>
              ) : (
                // Card "Seu progresso" — nunca escondido com saldo 0. Meta
                // não configurada (<=0) tem mensagem própria em vez de uma
                // barra 0/0 sem sentido; calcularProgressoPontos (backend)
                // já garante 0<=progressoPercentual<=100 sempre.
                <div style={{ background: cores.cardBg, border: `1px solid ${cores.cardBorda}`, borderRadius: 16, padding: 22 }}>
                  <p style={{ fontSize: 11, color: cores.textoTerciario, textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 12px' }}>Seu progresso</p>
                  {fidelidade.metaPontos > 0 ? (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
                        <span>{fidelidade.saldoPontos} pontos</span>
                        <span style={{ color: cores.textoSecundario, fontWeight: 600 }}>Meta: {fidelidade.metaPontos}</span>
                      </div>
                      <div
                        role="progressbar"
                        aria-valuenow={Math.min(100, Math.max(0, fidelidade.progressoPercentual))}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`Progresso: ${fidelidade.saldoPontos} de ${fidelidade.metaPontos} pontos`}
                        style={{ background: cores.moldura, borderRadius: 999, height: 12, overflow: 'hidden' }}
                      >
                        <div style={{
                          width: `${Math.min(100, Math.max(0, fidelidade.progressoPercentual))}%`,
                          height: '100%',
                          background: cores.amarelo,
                          borderRadius: 999,
                        }} />
                      </div>
                      <p style={{ fontSize: 13, color: cores.textoSecundario, margin: '10px 0 0' }}>
                        Faltam {fidelidade.pontosFaltantes} pontos para você ganhar {fidelidade.descricaoRecompensa}
                      </p>
                    </>
                  ) : (
                    <p style={{ fontSize: 13, color: cores.textoSecundario, margin: 0 }}>
                      A recompensa ainda não foi configurada por aqui. Volte em breve!
                    </p>
                  )}
                </div>
              )}

              {fidelidade.pontosPrevistos > 0 && (
                <div style={{ background: cores.cardBg, border: `1px dashed ${cores.cardBorda}`, borderRadius: 14, padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Clock size={20} color={cores.textoTerciario} />
                  <p style={{ fontSize: 13, color: cores.textoSecundario, margin: 0 }}>
                    Seu pedido em andamento vai render +{fidelidade.pontosPrevistos} pontos assim que for entregue.
                  </p>
                </div>
              )}

              <button
                onClick={() => setComoFuncionaAberto((v) => !v)}
                aria-expanded={comoFuncionaAberto}
                style={{ background: 'none', border: 'none', color: cores.textoSecundario, fontSize: 13, fontWeight: 700, textDecoration: 'underline', cursor: 'pointer', padding: '4px 0', textAlign: 'left', fontFamily: 'Archivo, sans-serif', minHeight: 44 }}
              >
                Como funcionam os pontos?
              </button>
              {comoFuncionaAberto && (
                <div style={{ background: cores.cardBg, border: `1px solid ${cores.cardBorda}`, borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <p style={{ fontSize: 13, color: cores.textoSecundario, margin: 0 }}>
                    • Você ganha 1 ponto para cada R$1 gasto em pedidos (a taxa de entrega não conta).
                  </p>
                  {fidelidade.metaPontos > 0 && (
                    <p style={{ fontSize: 13, color: cores.textoSecundario, margin: 0 }}>
                      • Junte {fidelidade.metaPontos} pontos para resgatar: {fidelidade.descricaoRecompensa}.
                    </p>
                  )}
                  <p style={{ fontSize: 13, color: cores.textoSecundario, margin: 0 }}>
                    • Os pontos são confirmados quando seu pedido é marcado como entregue. Pedidos cancelados não geram pontos.
                  </p>
                </div>
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

      <ClientBottomNav active="pontos" onSacolaClick={abrirSacola} />

      <style>{`.cliente-grid { display: flex; flex-direction: column; } @media (min-width: 1024px) { .cliente-grid { display: grid; grid-template-columns: 1.35fr 1fr; gap: 24px; align-items: start; } } @media (min-width: 768px) and (max-width: 1023.98px) { .cliente-conteudo { padding: 32px 32px calc(env(safe-area-inset-bottom) + 96px); } }`}</style>
    </div>
  )
}
