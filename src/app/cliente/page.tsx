'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  ChefHat,
  LogOut,
  ArrowLeft,
  Gift,
  Lock,
  Sparkles,
  Clock,
  CheckCircle2,
  XCircle,
  RotateCcw,
  AlertTriangle,
  ShoppingBag,
  Phone,
  MessageCircle,
  Loader2,
  Receipt,
} from 'lucide-react'
import {
  EXTRATO_LABEL,
  descreverMovimento,
  primeiroNome,
  formatarMoeda,
  progressoVisual,
  minutosRestantes,
  deveExibirMetaAtingida,
  deveExibirPontosPrevistos,
  podeExibirCtaResgate,
  type MovimentoExtrato,
  type Fidelidade,
  type Resgate,
} from './clienteViewLogic'

// ==================== Tipos ====================

type Perfil = {
  cliente: { nome: string | null; telefone: string }
  ultimosPedidos: { id: string; numero?: number; data?: string; total?: number; status?: string }[]
}

type Passo = 'carregando' | 'telefone' | 'otp' | 'perfil'

// ==================== Estilos base ====================
// Tokens exclusivos desta área (Skill cliente-ui) — claro, navy + amarelo
// oficial, deliberadamente separados do tema escuro/laranja do restante do
// produto.

const COR = {
  bg: '#FAFAF8',
  bgFrame: '#F1EFEA',
  card: '#FFFFFF',
  borda: '#E7E4DC',
  navy: '#10193A',
  textoSecundario: '#5B6478',
  textoTerciario: '#9AA1B4',
  amarelo: '#FFCD00',
  sucesso: '#1F7A4D',
  erro: '#B3261E',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '14px 16px',
  borderRadius: 12,
  border: `1px solid ${COR.borda}`,
  background: '#fff',
  color: COR.navy,
  fontSize: 16,
  fontFamily: 'Archivo, sans-serif',
}

const botaoPrimario: React.CSSProperties = {
  width: '100%',
  padding: 14,
  borderRadius: 12,
  background: COR.amarelo,
  color: COR.navy,
  fontSize: 15,
  fontWeight: 800,
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'Archivo, sans-serif',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
}

const cardStyle: React.CSSProperties = {
  background: COR.card,
  border: `1px solid ${COR.borda}`,
  borderRadius: 16,
  padding: 20,
  boxShadow: '0 1px 2px rgba(16,25,58,0.04)',
}

const CORES_VALOR: Record<'sucesso' | 'erro' | 'neutra', string> = {
  sucesso: COR.sucesso,
  erro: COR.erro,
  neutra: COR.textoTerciario,
}

// ==================== Extrato ====================

function LinhaExtrato({ mov }: { mov: MovimentoExtrato }) {
  const data = new Date(mov.criadoEm).toLocaleDateString('pt-BR')
  const { valorTexto, cor } = descreverMovimento(mov)

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '10px 0',
        borderTop: `1px solid ${COR.bgFrame}`,
      }}
    >
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: COR.navy }}>{EXTRATO_LABEL[mov.tipo]}</div>
        <div style={{ fontSize: 11.5, color: COR.textoTerciario, marginTop: 2 }}>{data}</div>
      </div>
      <div style={{ fontSize: 14, fontWeight: 800, color: CORES_VALOR[cor], fontVariantNumeric: 'tabular-nums' }}>
        {valorTexto}
      </div>
    </div>
  )
}

// ==================== Página ====================

export default function ClientePage() {
  const [passo, setPasso] = useState<Passo>('carregando')
  const [telefone, setTelefone] = useState('')
  const [codigo, setCodigo] = useState('')
  const [erro, setErro] = useState('')
  const [sessaoExpirada, setSessaoExpirada] = useState(false)
  const [enviando, setEnviando] = useState(false)

  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [fidelidade, setFidelidade] = useState<Fidelidade | null>(null)
  const [fidelidadeErro, setFidelidadeErro] = useState(false)
  const [carregandoFidelidade, setCarregandoFidelidade] = useState(false)

  const [resgateAtivo, setResgateAtivo] = useState<Resgate | null>(null)
  const [pedindoConfirmacao, setPedindoConfirmacao] = useState(false)
  const [processandoResgate, setProcessandoResgate] = useState(false)
  const [mensagemResgate, setMensagemResgate] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  const carregarFidelidade = useCallback(async () => {
    setCarregandoFidelidade(true)
    setFidelidadeErro(false)
    try {
      const res = await fetch('/api/cliente/fidelidade', { cache: 'no-store' })
      if (res.status === 401) {
        setSessaoExpirada(true)
        setPasso('telefone')
        setPerfil(null)
        setFidelidade(null)
        return
      }
      if (!res.ok) {
        setFidelidadeErro(true)
        return
      }
      const data = await res.json()
      setFidelidade(data)
    } catch {
      setFidelidadeErro(true)
    } finally {
      setCarregandoFidelidade(false)
    }
  }, [])

  const carregarResgates = useCallback(async () => {
    try {
      const res = await fetch('/api/cliente/fidelidade/resgates', { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      const ativo = (data.resgates as Resgate[] | undefined)?.find(
        (r) => r.status === 'reservado' && minutosRestantes(r.expiraEm) > 0
      )
      setResgateAtivo(ativo ?? null)
    } catch {
      /* silencioso: nao bloqueia a tela por causa da lista de resgates */
    }
  }, [])

  const carregarPerfil = useCallback(async () => {
    try {
      const res = await fetch('/api/cliente/perfil', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setPerfil(data)
        setPasso('perfil')
        carregarFidelidade()
        carregarResgates()
        return true
      }
    } catch {}
    return false
  }, [carregarFidelidade, carregarResgates])

  useEffect(() => {
    carregarPerfil().then((ok) => { if (!ok) setPasso('telefone') })
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setPasso('otp')
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
      setSessaoExpirada(false)
      await carregarPerfil()
    } catch { setErro('Erro de conexão. Tente novamente.') }
    setEnviando(false)
  }

  async function sair() {
    try { await fetch('/api/cliente/logout', { method: 'POST' }) } catch {}
    setPerfil(null)
    setFidelidade(null)
    setResgateAtivo(null)
    setTelefone('')
    setCodigo('')
    setSessaoExpirada(false)
    setPasso('telefone')
  }

  async function resgatar() {
    setProcessandoResgate(true)
    setMensagemResgate(null)
    try {
      const res = await fetch('/api/cliente/fidelidade/resgates', { method: 'POST' })
      const data = await res.json()
      if (res.status === 401) { setSessaoExpirada(true); setPasso('telefone'); return }
      if (!res.ok) {
        setMensagemResgate({ tipo: 'erro', texto: data.error || 'Não foi possível criar o resgate' })
        return
      }
      setResgateAtivo(data.resgate)
      setPedindoConfirmacao(false)
      setMensagemResgate({ tipo: 'ok', texto: 'Resgate reservado! Aplique no seu próximo pedido durante o checkout.' })
      carregarFidelidade()
    } catch {
      setMensagemResgate({ tipo: 'erro', texto: 'Erro de conexão. Tente novamente.' })
    } finally {
      setProcessandoResgate(false)
    }
  }

  async function cancelarResgate() {
    if (!resgateAtivo) return
    setProcessandoResgate(true)
    setMensagemResgate(null)
    try {
      const res = await fetch(`/api/cliente/fidelidade/resgates/${resgateAtivo.resgateId}`, { method: 'DELETE' })
      const data = await res.json()
      if (res.status === 401) { setSessaoExpirada(true); setPasso('telefone'); return }
      if (!res.ok) {
        setMensagemResgate({ tipo: 'erro', texto: data.error || 'Não foi possível cancelar o resgate' })
        return
      }
      setResgateAtivo(null)
      setMensagemResgate({ tipo: 'ok', texto: 'Resgate cancelado. Seus pontos continuam guardados.' })
    } catch {
      setMensagemResgate({ tipo: 'erro', texto: 'Erro de conexão. Tente novamente.' })
    } finally {
      setProcessandoResgate(false)
    }
  }

  const nome = primeiroNome(perfil?.cliente.nome)

  return (
    <div style={{ background: COR.bg, minHeight: '100dvh', fontFamily: 'Archivo, sans-serif', color: COR.navy, display: 'flex', flexDirection: 'column' }}>
      <style>{`
        .cliArea { display: flex; flex-direction: column; gap: 16px; }
        .cliColEsquerda, .cliColDireita { display: flex; flex-direction: column; gap: 16px; }
        @media (min-width: 1024px) {
          .cliArea { display: grid; grid-template-columns: 1.35fr 1fr; align-items: start; gap: 20px; }
        }
        @media (min-width: 768px) {
          .cliContainer { padding: 32px 28px !important; }
        }
        @keyframes cliSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .cli-spin { animation: cliSpin 0.9s linear infinite; }
      `}</style>

      {/* Topbar */}
      <div style={{ background: COR.card, borderBottom: `1px solid ${COR.borda}`, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ChefHat size={22} color={COR.navy} strokeWidth={2.2} aria-hidden="true" />
          <div style={{ fontSize: 15, fontWeight: 800, color: COR.navy }}>Chefe da Pizza</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <a href="/cardapio" aria-label="Voltar ao cardápio" style={{ fontSize: 13, color: COR.textoSecundario, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <ArrowLeft size={15} strokeWidth={2.2} aria-hidden="true" /> Cardápio
          </a>
          {passo === 'perfil' && (
            <button
              onClick={sair}
              aria-label="Sair da conta"
              style={{ background: 'none', border: 'none', color: COR.textoSecundario, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, padding: 0, fontFamily: 'Archivo, sans-serif' }}
            >
              <LogOut size={15} strokeWidth={2.2} aria-hidden="true" /> Sair
            </button>
          )}
        </div>
      </div>

      <div className="cliContainer" style={{ flex: 1, padding: '24px 18px', maxWidth: 1180, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>

        {passo === 'carregando' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '60px 0', color: COR.textoSecundario }}>
            <Loader2 size={22} className="cli-spin" aria-hidden="true" />
            <p style={{ fontSize: 14, margin: 0 }}>Carregando sua área do cliente...</p>
          </div>
        )}

        {passo === 'telefone' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 420, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 4 }}>
              <Gift size={38} color={COR.amarelo} style={{ marginBottom: 8 }} aria-hidden="true" />
              <h1 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 6px' }}>Entre com seu WhatsApp</h1>
              <p style={{ fontSize: 13.5, color: COR.textoSecundario, margin: 0, lineHeight: 1.5 }}>
                {sessaoExpirada
                  ? 'Sua sessão expirou. Entre novamente para ver seus pontos.'
                  : 'Acompanhe seus pontos de fidelidade e resgate recompensas.'}
              </p>
            </div>
            <input
              type="tel"
              inputMode="numeric"
              placeholder="(99) 99999-9999"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              style={inputStyle}
              aria-label="Número de WhatsApp"
            />
            {erro && (
              <p style={{ color: COR.erro, fontSize: 13, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle size={14} aria-hidden="true" /> {erro}
              </p>
            )}
            <button onClick={pedirCodigo} disabled={enviando} style={{ ...botaoPrimario, opacity: enviando ? 0.6 : 1 }}>
              <Phone size={16} aria-hidden="true" /> {enviando ? 'Enviando...' : 'Receber código no WhatsApp'}
            </button>
            <a href="/cardapio" style={{ textAlign: 'center', fontSize: 13, color: COR.textoSecundario, textDecoration: 'none' }}>
              Prefiro pedir sem entrar agora
            </a>
          </div>
        )}

        {passo === 'otp' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 420, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 4 }}>
              <MessageCircle size={38} color={COR.amarelo} style={{ marginBottom: 8 }} aria-hidden="true" />
              <h1 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 6px' }}>Digite o código</h1>
              <p style={{ fontSize: 13.5, color: COR.textoSecundario, margin: 0, lineHeight: 1.5 }}>
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
              aria-label="Código de verificação"
            />
            {erro && (
              <p style={{ color: COR.erro, fontSize: 13, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle size={14} aria-hidden="true" /> {erro}
              </p>
            )}
            <button onClick={confirmarCodigo} disabled={enviando} style={{ ...botaoPrimario, opacity: enviando ? 0.6 : 1 }}>
              {enviando ? 'Confirmando...' : 'Entrar'}
            </button>
            <button onClick={() => setPasso('telefone')} style={{ background: 'none', border: 'none', color: COR.textoSecundario, fontSize: 13, cursor: 'pointer', fontFamily: 'Archivo, sans-serif' }}>
              Trocar número
            </button>
          </div>
        )}

        {passo === 'perfil' && perfil && (
          <div className="cliArea">
            <div className="cliColEsquerda">
              {/* Saudação */}
              <div>
                <div style={{ fontSize: 15, color: COR.textoSecundario }}>Olá{nome ? `, ${nome}` : ''}!</div>
              </div>

              {carregandoFidelidade && !fidelidade && (
                <div style={{ ...cardStyle, textAlign: 'center', color: COR.textoSecundario, fontSize: 13.5 }}>
                  Carregando seus pontos...
                </div>
              )}

              {fidelidadeErro && (
                <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', textAlign: 'center' }}>
                  <AlertTriangle size={22} color={COR.erro} aria-hidden="true" />
                  <p style={{ fontSize: 13.5, color: COR.textoSecundario, margin: 0 }}>
                    Não foi possível carregar seus pontos agora.
                  </p>
                  <button
                    onClick={carregarFidelidade}
                    style={{ background: 'none', border: `1px solid ${COR.borda}`, borderRadius: 10, padding: '8px 14px', color: COR.navy, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'Archivo, sans-serif' }}
                  >
                    Tentar novamente
                  </button>
                </div>
              )}

              {fidelidade && (
                <>
                  {/* Hero de saldo */}
                  <div style={cardStyle}>
                    <div style={{ fontSize: 13, color: COR.textoSecundario, fontWeight: 600, marginBottom: 4 }}>Seus pontos</div>
                    <div style={{ fontSize: 56, fontWeight: 800, color: COR.navy, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                      {fidelidade.saldoPontos}
                    </div>
                    <div style={{ fontSize: 12.5, color: COR.textoTerciario, marginTop: 8 }}>A cada R$1 gasto = 1 ponto</div>

                    {deveExibirPontosPrevistos(fidelidade) && (
                      <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px dashed ${COR.borda}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Clock size={16} color={COR.textoSecundario} aria-hidden="true" />
                        <div style={{ fontSize: 12.5, color: COR.textoSecundario }}>
                          +{fidelidade.pontosPrevistos} pontos previstos — ainda dependem da conclusão do seu pedido, não estão no saldo acima.
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Progresso — substituido pelo card navy quando a meta e atingida */}
                  {deveExibirMetaAtingida(fidelidade) ? (
                    <div style={{ ...cardStyle, background: COR.navy, border: 'none', color: '#fff', textAlign: 'center' }}>
                      <Sparkles size={26} color={COR.amarelo} aria-hidden="true" style={{ marginBottom: 8 }} />
                      <p style={{ fontSize: 15, fontWeight: 800, margin: '0 0 4px' }}>Meta atingida!</p>
                      <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', margin: 0 }}>
                        Você chegou aos {fidelidade.metaPontos} pontos da meta.
                      </p>
                    </div>
                  ) : (
                    <div style={cardStyle}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: COR.textoSecundario, marginBottom: 8 }}>
                        <span>{fidelidade.saldoPontos} de {fidelidade.metaPontos} pontos</span>
                        <span>{fidelidade.progressoPercentual}%</span>
                      </div>
                      <div style={{ background: COR.bgFrame, borderRadius: 999, height: 12, overflow: 'hidden' }}>
                        <div
                          style={{
                            width: `${progressoVisual(fidelidade.progressoPercentual)}%`,
                            height: '100%',
                            background: `linear-gradient(90deg, ${COR.amarelo}, #ffdf4d)`,
                            borderRadius: 999,
                          }}
                        />
                      </div>
                      <p style={{ textAlign: 'center', fontSize: 12.5, color: COR.textoSecundario, margin: '10px 0 0' }}>
                        Faltam {fidelidade.pontosFaltantes} pontos para a meta
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="cliColDireita">
              {/* Recompensa configurada */}
              {fidelidade?.recompensa && (
                <div style={cardStyle}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: COR.navy, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Gift size={18} color="#fff" aria-hidden="true" />
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: COR.navy }}>{fidelidade.recompensa.descricao}</div>
                      <div style={{ fontSize: 12, color: COR.textoTerciario }}>{fidelidade.recompensa.custoPontos} pontos</div>
                    </div>
                  </div>

                  {!fidelidade.recompensa.disponivel && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: COR.textoSecundario, background: COR.bgFrame, borderRadius: 10, padding: '8px 10px' }}>
                      <Lock size={14} aria-hidden="true" /> Bloqueada — junte mais pontos para desbloquear
                    </div>
                  )}

                  {podeExibirCtaResgate(fidelidade.recompensa, resgateAtivo) && (
                    <>
                      {!pedindoConfirmacao ? (
                        <button
                          onClick={() => setPedindoConfirmacao(true)}
                          style={{ ...botaoPrimario, marginTop: 4 }}
                        >
                          <Gift size={16} aria-hidden="true" /> Resgatar recompensa
                        </button>
                      ) : (
                        <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <p style={{ fontSize: 12.5, color: COR.textoSecundario, margin: 0 }}>
                            Confirmar resgate de {fidelidade.recompensa.custoPontos} pontos?
                          </p>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button
                              onClick={resgatar}
                              disabled={processandoResgate}
                              style={{ ...botaoPrimario, opacity: processandoResgate ? 0.6 : 1 }}
                            >
                              {processandoResgate ? 'Confirmando...' : 'Confirmar'}
                            </button>
                            <button
                              onClick={() => setPedindoConfirmacao(false)}
                              disabled={processandoResgate}
                              style={{ flex: 1, padding: 14, borderRadius: 12, background: 'none', border: `1px solid ${COR.borda}`, color: COR.textoSecundario, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'Archivo, sans-serif' }}
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {resgateAtivo && (
                    <div style={{ marginTop: 4, background: '#FFFBEB', border: `1px solid ${COR.amarelo}`, borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: COR.navy, fontWeight: 700 }}>
                        <CheckCircle2 size={15} color={COR.sucesso} aria-hidden="true" /> Resgate reservado
                      </div>
                      <div style={{ fontSize: 12, color: COR.textoSecundario }}>
                        Válido por mais {minutosRestantes(resgateAtivo.expiraEm)} min. Aplique no checkout do seu próximo pedido.
                      </div>
                      <button
                        onClick={cancelarResgate}
                        disabled={processandoResgate}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: COR.erro, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', padding: 0, fontFamily: 'Archivo, sans-serif' }}
                      >
                        <RotateCcw size={13} aria-hidden="true" /> Cancelar resgate
                      </button>
                    </div>
                  )}

                  {mensagemResgate && (
                    <p style={{ fontSize: 12.5, marginTop: 8, marginBottom: 0, color: mensagemResgate.tipo === 'ok' ? COR.sucesso : COR.erro, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {mensagemResgate.tipo === 'ok' ? <CheckCircle2 size={14} aria-hidden="true" /> : <XCircle size={14} aria-hidden="true" />}
                      {mensagemResgate.texto}
                    </p>
                  )}
                </div>
              )}

              {/* Extrato */}
              {fidelidade && (
                <div style={cardStyle}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <Receipt size={16} color={COR.textoSecundario} aria-hidden="true" />
                    <p style={{ fontSize: 11, color: COR.textoSecundario, textTransform: 'uppercase', letterSpacing: 0.5, margin: 0, fontWeight: 700 }}>
                      Extrato
                    </p>
                  </div>
                  {fidelidade.extrato.length === 0 ? (
                    <p style={{ fontSize: 13, color: COR.textoTerciario, margin: '10px 0 0' }}>
                      Você ainda não tem movimentações de pontos.
                    </p>
                  ) : (
                    <div>
                      {fidelidade.extrato.map((mov) => (
                        <LinhaExtrato key={mov.id} mov={mov} />
                      ))}
                    </div>
                  )}
                </div>
              )}

              <a href="/cardapio" style={{ ...botaoPrimario, textDecoration: 'none', boxSizing: 'border-box' }}>
                <ShoppingBag size={16} aria-hidden="true" /> Continuar comprando
              </a>

              {perfil.ultimosPedidos.length > 0 && (
                <div style={cardStyle}>
                  <p style={{ fontSize: 11, color: COR.textoSecundario, textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 10px', fontWeight: 700 }}>Últimos pedidos</p>
                  {perfil.ultimosPedidos.map((p) => (
                    <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, color: COR.textoSecundario, padding: '6px 0', borderTop: `1px solid ${COR.bgFrame}` }}>
                      <span>{p.numero ? `#${p.numero}` : p.id} · {p.data}</span>
                      <span style={{ color: COR.navy, fontWeight: 700 }}>{formatarMoeda(p.total)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
