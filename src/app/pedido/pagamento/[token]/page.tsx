'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Clock3, RefreshCw } from 'lucide-react'
import ClientBottomNav from '@/components/ClientBottomNav'
import PixPagamentoCard, { type PixPagamentoCardStatus } from '@/app/cardapio/PixPagamentoCard'
import { CF_OPEN_CART_KEY } from '@/lib/pedidoAtivoCliente'
import {
  deveLimparReferenciaPixPendente,
  limparReferenciaPixPendente,
} from '@/lib/pixPendenteLocal'
import { calcularDivisaoPixDinheiro } from '@/lib/pixValores'

interface PageProps {
  params: Promise<{ token: string }>
}

type EstadoPagamentoPix = 'aguardando' | 'confirmado' | 'em_analise' | 'indisponivel'

type RespostaPagamentoPix = {
  ok: boolean
  id?: string
  numero?: number
  total?: number
  status?: string
  estado?: EstadoPagamentoPix
  titulo?: string
  mensagem?: string
  /** Contato do WhatsApp da pizzaria (config:pizzaria, já normalizado pelo
   * backend) — nunca hardcoded no frontend; ausente quando não configurado. */
  whatsappPizzaria?: string
  /** Valor efetivamente devido no Pix (parcela, em pagamento misto) — vem
   * só do backend (pixCliente.valorEsperado), nunca calculado aqui. */
  valorPix?: number
  pix?: { provider?: string; qrCode?: string; copiaECola?: string; chavePix?: string; beneficiario?: string; valorEsperado?: number }
}

type TelaPagamento =
  | { tipo: 'carregando' }
  | { tipo: 'nao_encontrado' }
  | { tipo: 'erro_rede' }
  | { tipo: 'dados'; dados: RespostaPagamentoPix }

const money = (v: number) => 'R$ ' + v.toFixed(2).replace('.', ',')

// Reaproveita a mesma cadência de polling já validada em src/app/cardapio/page.tsx
// (5s por chamada, sem lógica de verificação nova) — só troca o endpoint pelo
// dedicado à retomada (/api/pedido-app/pagamento-pix), que é o único que pode
// devolver QR/copia-e-cola.
export default function PagamentoPixPage({ params }: PageProps) {
  const [token, setToken] = useState<string | null>(null)
  const [tela, setTela] = useState<TelaPagamento>({ tipo: 'carregando' })
  const [toast, setToast] = useState('')
  const [verificandoManual, setVerificandoManual] = useState(false)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const tentativas = useRef(0)

  useEffect(() => {
    params.then((p) => setToken(p.token))
  }, [params])

  function showToast(m: string) {
    setToast(m)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 1700)
  }

  function abrirSacola() {
    try { sessionStorage.setItem(CF_OPEN_CART_KEY, '1') } catch {}
    window.location.href = '/pedido'
  }

  const verificar = useCallback(async (tokenAtual: string) => {
    tentativas.current += 1
    try {
      const res = await fetch(`/api/pedido-app/pagamento-pix?token=${encodeURIComponent(tokenAtual)}`, { cache: 'no-store' })
      if (res.status === 404) {
        setTela({ tipo: 'nao_encontrado' })
        limparReferenciaPixPendente(localStorage)
        return
      }
      if (!res.ok) {
        setTela({ tipo: 'erro_rede' })
        return
      }
      const data = (await res.json()) as RespostaPagamentoPix
      setTela({ tipo: 'dados', dados: data })
      if (deveLimparReferenciaPixPendente(data.estado)) {
        limparReferenciaPixPendente(localStorage)
      }
      if (data.estado === 'confirmado' || data.estado === 'indisponivel' || tentativas.current >= 240) {
        if (intervalRef.current) clearInterval(intervalRef.current)
      }
    } catch {
      setTela((atual) => (atual.tipo === 'dados' ? atual : { tipo: 'erro_rede' }))
    }
  }, [])

  useEffect(() => {
    if (!token) return
    tentativas.current = 0
    verificar(token)
    intervalRef.current = setInterval(() => verificar(token), 5000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [token, verificar])

  async function handleVerificarManual() {
    if (!token || verificandoManual) return
    setVerificandoManual(true)
    await verificar(token)
    setVerificandoManual(false)
    showToast('Status atualizado')
  }

  const dados = tela.tipo === 'dados' ? tela.dados : null
  const estado = dados?.estado

  return (
    <div style={{ background: 'var(--background)', minHeight: '100dvh', fontFamily: 'Archivo, sans-serif', color: 'var(--foreground)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>🍕</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--foreground)' }}>
              {dados?.numero ? `Pedido #${dados.numero}` : 'Pagamento Pix'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--foreground-muted)' }}>Retomar pagamento</div>
          </div>
        </div>
        <Link href="/cliente/pedidos" style={{ fontSize: 13, color: 'var(--foreground-muted)', textDecoration: 'none' }}>
          ← Meus pedidos
        </Link>
      </div>

      <main style={{ flex: 1, padding: '20px 20px calc(env(safe-area-inset-bottom) + 96px)', maxWidth: 480, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        {tela.tipo === 'carregando' && <TelaCarregandoSkeleton />}

        {tela.tipo === 'erro_rede' && (
          <TelaAvisoSimples
            titulo="Não foi possível carregar"
            mensagem="Verifique sua conexão e tente novamente."
            token={token}
          >
            <button
              type="button"
              onClick={() => token && verificar(token)}
              style={botaoSecundario}
            >
              <RefreshCw size={16} /> Tentar novamente
            </button>
          </TelaAvisoSimples>
        )}

        {tela.tipo === 'nao_encontrado' && (
          <TelaIndisponivel pedidoId={undefined} whatsappPizzaria={undefined} />
        )}

        {dados && estado === 'indisponivel' && (
          <TelaIndisponivel pedidoId={dados.id} whatsappPizzaria={dados.whatsappPizzaria} />
        )}

        {dados && estado === 'em_analise' && (
          <TelaEmAnalise titulo={dados.titulo} mensagem={dados.mensagem} pedidoId={dados.id} />
        )}

        {dados && (estado === 'aguardando' || estado === 'confirmado') && (() => {
          // Pagamento misto Pix + Dinheiro: valorPix (ou, em fallback, o
          // valorEsperado dentro de `pix`) vem só do backend — nunca
          // recalculado no cliente. Cálculo em centavos para nunca gerar
          // diferença de ponto flutuante nem valor negativo.
          const valorPixBackend = dados.valorPix ?? dados.pix?.valorEsperado
          const divisao = calcularDivisaoPixDinheiro(dados.total || 0, valorPixBackend)
          return (
            <>
              <PixPagamentoCard
                statusPix={(estado === 'confirmado' ? 'pago' : 'aguardando_pix') as PixPagamentoCardStatus}
                statusLabel={dados.titulo || ''}
                pedidoNumero={dados.numero || 0}
                pedidoTotal={dados.total || 0}
                pixPedido={{ chavePix: dados.pix?.chavePix, beneficiario: dados.pix?.beneficiario }}
                pixCodigoCopiaECola={(dados.pix?.copiaECola || dados.pix?.qrCode || '').trim()}
                temPixCopiaECola={!!(dados.pix?.copiaECola || dados.pix?.qrCode)}
                isHibrido={divisao.isHibrido}
                hibridoAtual={divisao.isHibrido ? { pix: divisao.pix, dinheiro: divisao.dinheiro } : null}
                trocoConfirmadoTexto={null}
                money={money}
                onToast={showToast}
              />

              {estado === 'aguardando' && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 14, fontSize: 12, color: 'var(--foreground-muted)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Clock3 size={14} /> Verificando automaticamente
                  </span>
                  <button type="button" onClick={handleVerificarManual} disabled={verificandoManual} style={botaoLink}>
                    {verificandoManual ? 'Verificando...' : 'Verificar agora'}
                  </button>
                </div>
              )}

              {estado === 'confirmado' && dados.id && (
                <Link href={`/rastrear/${dados.id}`} style={{ ...botaoPrimario, marginTop: 16, textDecoration: 'none', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <CheckCircle2 size={18} /> Acompanhar meu pedido
                </Link>
              )}
            </>
          )
        })()}
      </main>

      {toast && (
        <div style={{ position: 'fixed', bottom: 110, left: '50%', transform: 'translateX(-50%)', background: 'var(--secondary)', color: 'var(--secondary-foreground)', padding: '10px 18px', borderRadius: 999, fontSize: 13, fontWeight: 700, zIndex: 60 }}>
          {toast}
        </div>
      )}

      <ClientBottomNav active={null} onSacolaClick={abrirSacola} />

      <PixPagamentoCardEstilos />
    </div>
  )
}

const botaoPrimario: React.CSSProperties = {
  width: '100%',
  padding: 14,
  borderRadius: 12,
  background: 'var(--primary)',
  color: 'var(--primary-foreground)',
  fontSize: 15,
  fontWeight: 700,
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'Archivo, sans-serif',
}

const botaoSecundario: React.CSSProperties = {
  width: '100%',
  padding: 14,
  borderRadius: 12,
  background: 'var(--surface-secondary)',
  color: 'var(--foreground)',
  border: '1px solid var(--border)',
  fontSize: 14,
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: 'Archivo, sans-serif',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
}

const botaoLink: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--info)',
  fontWeight: 700,
  fontSize: 12,
  cursor: 'pointer',
  fontFamily: 'Archivo, sans-serif',
  textDecoration: 'underline',
}

function TelaCarregandoSkeleton() {
  const bloco = (h: number) => (
    <div style={{ height: h, borderRadius: 14, background: 'var(--surface-secondary)', animation: 'pixSkeletonPulse 1.4s ease-in-out infinite' }} />
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {bloco(140)}
      {bloco(260)}
      {bloco(90)}
      <style>{`@keyframes pixSkeletonPulse{0%,100%{opacity:.6}50%{opacity:1}}`}</style>
    </div>
  )
}

function TelaAvisoSimples({ titulo, mensagem, children }: { titulo: string; mensagem: string; token: string | null; children?: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <p style={{ fontSize: 16, fontWeight: 800, margin: '0 0 6px' }}>{titulo}</p>
        <p style={{ fontSize: 13.5, color: 'var(--foreground-muted)', margin: 0, lineHeight: 1.5 }}>{mensagem}</p>
      </div>
      {children}
    </div>
  )
}

// Item 7 do escopo: quando o Pix não pode ser recuperado (token inválido,
// pedido cancelado ou sem QR/copia-e-cola disponível), NUNCA cria uma nova
// cobrança nem regenera QR aqui — só oferece ações seguras já existentes.
// O contato do WhatsApp vem só da configuração pública já sanitizada pelo
// backend (whatsappPizzaria) — nunca um número fixo no código; sem
// configuração válida, o botão simplesmente não aparece.
function TelaIndisponivel({ pedidoId, whatsappPizzaria }: { pedidoId?: string; whatsappPizzaria?: string }) {
  return (
    <div style={{ background: 'var(--danger-soft)', color: 'var(--danger-soft-foreground)', borderRadius: 16, padding: 22, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <p style={{ fontSize: 16, fontWeight: 800, margin: '0 0 6px' }}>Este Pix não está mais disponível.</p>
        <p style={{ fontSize: 13.5, margin: 0, lineHeight: 1.5 }}>
          O código de pagamento deste pedido não pode ser recuperado por aqui.
        </p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {pedidoId && (
          <Link href={`/rastrear/${pedidoId}`} style={{ ...botaoPrimario, textDecoration: 'none', textAlign: 'center' }}>
            Acompanhar pedido
          </Link>
        )}
        <Link href="/cliente/pedidos" style={{ ...botaoSecundario, textDecoration: 'none' }}>
          Voltar aos pedidos
        </Link>
        {whatsappPizzaria && (
          <a
            href={`https://wa.me/${whatsappPizzaria}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...botaoSecundario, textDecoration: 'none', background: 'var(--success)', color: 'var(--on-success)', border: 'none' }}
          >
            Falar com a Pizzaria
          </a>
        )}
      </div>
    </div>
  )
}

function TelaEmAnalise({ titulo, mensagem, pedidoId }: { titulo?: string; mensagem?: string; pedidoId?: string }) {
  return (
    <div style={{ background: 'var(--info-soft)', color: 'var(--info-soft-foreground)', borderRadius: 16, padding: 22, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <p style={{ fontSize: 16, fontWeight: 800, margin: '0 0 6px' }}>{titulo || 'Comprovante em análise'}</p>
        <p style={{ fontSize: 13.5, margin: 0, lineHeight: 1.5 }}>
          {mensagem || 'Recebemos o comprovante. A equipe vai conferir os detalhes antes de liberar o pedido.'}
        </p>
      </div>
      {pedidoId && (
        <Link href={`/rastrear/${pedidoId}`} style={{ ...botaoPrimario, textDecoration: 'none', textAlign: 'center' }}>
          Acompanhar pedido
        </Link>
      )}
    </div>
  )
}

// CSS do PixPagamentoCard.tsx hoje só existe embutido no <style> gigante de
// src/app/cardapio/page.tsx (cardápio) — para reaproveitar o componente
// aqui sem tocar naquele arquivo, replica-se apenas o bloco de estilos
// (variáveis locais + classes .pix-*) que o card consome, verbatim.
function PixPagamentoCardEstilos() {
  return (
    <style>{`
:root{--font-ui:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
:root[data-theme="dark"]{--bg:var(--background);--surface2:var(--surface-secondary);--text:var(--text-primary);--text-sub:var(--text-secondary);--text-faint:var(--text-muted);--brand:var(--primary);--brand-press:var(--primary-active);--brand-soft:var(--primary-soft);--brand-foreground:var(--on-primary);--gold:var(--brand-text);--green:var(--success);--green-soft:var(--success-surface);--green-foreground:var(--on-success);--line:rgba(var(--overlay-rgb), 0.08);--line-strong:rgba(var(--overlay-rgb), 0.16);}
:root[data-theme="light"]{--bg:var(--background);--surface2:var(--surface-secondary);--text:var(--text-primary);--text-sub:var(--text-secondary);--text-faint:var(--text-muted);--brand:var(--primary);--brand-press:var(--primary-active);--brand-soft:var(--primary-soft);--brand-foreground:var(--on-primary);--gold:var(--brand-text);--green:var(--success);--green-soft:var(--success-surface);--green-foreground:var(--on-success);--line:rgba(var(--overlay-rgb), 0.08);--line-strong:rgba(var(--overlay-rgb), 0.14);}
.pix-premium{display:flex;flex-direction:column;gap:14px;text-align:left;margin-bottom:16px}
.pix-alerta{position:relative;text-align:center;background:linear-gradient(180deg, color-mix(in srgb, var(--primary) 20%, var(--surface)), var(--surface) 75%);border:2px solid var(--brand);border-radius:24px;padding:22px 18px 20px;box-shadow:0 10px 34px color-mix(in srgb, var(--primary) 28%, transparent);animation:pixCardIn .45s ease-out both,pixGlow 2.6s ease-in-out infinite}
.pix-alerta.pago{background:linear-gradient(180deg, var(--green-soft), var(--surface) 75%);border-color:var(--green);box-shadow:0 10px 34px color-mix(in srgb, var(--green) 24%, transparent);animation:pixCardIn .45s ease-out both}
.pix-alerta-eyebrow{display:inline-flex;align-items:center;gap:6px;background:var(--brand);color:var(--brand-foreground);padding:6px 14px;border-radius:999px;font-size:12px;font-weight:800;letter-spacing:.03em;margin-bottom:14px}
.pix-alerta-eyebrow.pago{background:var(--green);color:var(--green-foreground)}
.pix-alerta-eyebrow .pix-alerta-dot{width:7px;height:7px;border-radius:50%;background:var(--brand-foreground);animation:pixDot 1.4s ease-in-out infinite}
.pix-alerta-headline{margin:0;font-size:clamp(24px,7vw,32px);font-weight:800;line-height:1.08;letter-spacing:-.6px;color:var(--text)}
.pix-alerta-headline .destaque{color:var(--brand-text);background:var(--brand-soft);padding:0 8px;border-radius:8px;white-space:nowrap}
.pix-alerta.pago .pix-alerta-headline{color:var(--green)}
.pix-alerta-regra{margin:14px 0 0;font-size:16.5px;font-weight:800;color:var(--text);line-height:1.4}
.pix-alerta-sub{margin:6px 0 0;font-size:13.5px;color:var(--text-sub);font-weight:500;line-height:1.5}
.pix-alerta-acao{margin:16px 0 0;display:inline-flex;align-items:center;gap:8px;font-size:14px;font-weight:700;color:var(--text)}
.pix-alerta-seta{animation:pixBounce 1.6s ease-in-out infinite;color:var(--brand-text)}
.pix-resumo-linha{display:flex;align-items:baseline;justify-content:center;gap:8px;flex-wrap:wrap;margin:2px 0 16px;font-size:13.5px;color:var(--text-sub);font-weight:600}
.pix-resumo-linha strong{color:var(--text);font-weight:800}
.pix-hibrido-card{text-align:left;background:var(--surface);border:1px solid var(--line-strong);border-radius:16px;padding:14px 16px;display:grid;gap:4px;font-size:14px;color:var(--text);line-height:1.5;animation:pixCardIn .4s ease-out .12s both}
.pix-hibrido-card p{margin:0}
.pix-qr-card{display:flex;flex-direction:column;align-items:center;gap:10px;background:var(--surface);border:1px solid var(--line-strong);border-radius:20px;padding:22px 18px;box-shadow:var(--shadow-sm);animation:pixCardIn .4s ease-out .16s both}
.pix-qr-glow{padding:10px;border-radius:16px;background:var(--surface);box-shadow:0 0 0 1px var(--line),0 0 30px color-mix(in srgb, var(--primary) 32%, transparent);animation:pixQrGlow 2.6s ease-in-out infinite}
.pix-qr-svg{width:min(220px,60vw);max-width:220px;height:auto;display:block;border-radius:10px}
.pix-qr-legenda{margin:0;font-size:12.5px;color:var(--text-sub);text-align:center}
.pix-copia-cola-card{text-align:left;background:var(--surface);border:1px solid var(--line-strong);border-radius:18px;padding:16px;display:flex;flex-direction:column;gap:10px;box-shadow:var(--shadow-sm);animation:pixCardIn .4s ease-out .2s both}
.pix-copia-cola-label{font-size:11px;font-weight:700;color:var(--text-sub);text-transform:uppercase;letter-spacing:.14em}
.pix-copia-cola-campo{background:var(--surface2);border:1px solid var(--line);border-radius:12px;padding:11px 13px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;color:var(--text-sub);line-height:1.5;word-break:break-all;max-height:74px;overflow:hidden}
.pix-copiar-btn{width:100%;display:flex;align-items:center;justify-content:center;gap:8px;background:var(--brand);color:var(--brand-foreground);border:none;border-radius:14px;padding:17px;font-family:var(--font-ui);font-size:16.5px;font-weight:800;cursor:pointer;transition:transform .14s,background .18s,color .18s,box-shadow .18s;box-shadow:0 6px 20px color-mix(in srgb, var(--primary) 45%, transparent)}
.pix-copiar-btn:active{transform:scale(.97)}
.pix-copiar-btn.copiado{background:var(--green);box-shadow:0 6px 20px color-mix(in srgb, var(--green) 45%, transparent);animation:pixPop .35s ease-out}
.pix-reforco{display:flex;align-items:flex-start;gap:10px;background:var(--surface2);border:1px solid var(--line);border-radius:14px;padding:12px 14px;font-size:13px;color:var(--text-sub);line-height:1.5;font-weight:600;animation:pixCardIn .4s ease-out .24s both}
.pix-reforco svg{flex:0 0 auto;color:var(--brand-text);margin-top:1px}
.pix-chave-manual{background:var(--surface);border:1px solid var(--line-strong);border-radius:16px;overflow:hidden;animation:pixCardIn .4s ease-out .28s both}
.pix-chave-manual-toggle{width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;background:transparent;border:none;padding:13px 16px;font-family:var(--font-ui);font-size:13.5px;font-weight:700;color:var(--text);cursor:pointer}
.pix-chave-manual-toggle-label{display:flex;align-items:center;gap:8px;color:var(--text-sub)}
.pix-chave-manual-chevron{transition:transform .2s}
.pix-chave-manual-chevron.open{transform:rotate(180deg)}
.pix-chave-manual-conteudo{padding:0 16px 14px;display:grid;gap:4px;font-size:13.5px;color:var(--text);line-height:1.5;animation:pixFadeIn .2s ease-out both}
.pix-chave-manual-conteudo p{margin:0}
.pix-como-funciona{background:var(--surface);border:1px solid var(--line-strong);border-radius:18px;padding:16px;animation:pixCardIn .4s ease-out .32s both}
.pix-como-funciona-titulo{display:block;font-size:11px;font-weight:700;color:var(--text-sub);text-transform:uppercase;letter-spacing:.14em;margin-bottom:12px}
.pix-como-funciona-passos{display:flex;flex-direction:column;gap:12px}
.pix-passo{display:flex;align-items:center;gap:10px}
.pix-passo-icone{flex:0 0 auto;width:34px;height:34px;border-radius:10px;background:var(--brand-soft);color:var(--brand-text);display:flex;align-items:center;justify-content:center}
.pix-passo-num{flex:0 0 auto;width:18px;height:18px;border-radius:50%;background:var(--line-strong);color:var(--text-sub);font-size:10.5px;font-weight:800;display:flex;align-items:center;justify-content:center}
.pix-passo-texto{font-size:13.5px;color:var(--text);font-weight:600;line-height:1.4}
@keyframes pixCardIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes pixFadeIn{from{opacity:0}to{opacity:1}}
@keyframes pixGlow{0%,100%{box-shadow:0 10px 34px color-mix(in srgb, var(--primary) 28%, transparent)}50%{box-shadow:0 10px 44px color-mix(in srgb, var(--primary) 46%, transparent)}}
@keyframes pixQrGlow{0%,100%{box-shadow:0 0 0 1px var(--line),0 0 30px color-mix(in srgb, var(--primary) 32%, transparent)}50%{box-shadow:0 0 0 1px var(--line),0 0 42px color-mix(in srgb, var(--primary) 50%, transparent)}}
@keyframes pixDot{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.7)}}
@keyframes pixBounce{0%,100%{transform:translateY(0)}50%{transform:translateY(5px)}}
@keyframes pixPop{0%{transform:scale(1)}40%{transform:scale(1.04)}100%{transform:scale(1)}}
    `}</style>
  )
}
