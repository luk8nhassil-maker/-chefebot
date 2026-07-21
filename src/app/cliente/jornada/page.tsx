'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft, CheckCircle2, Gift, Pizza, Sparkles } from 'lucide-react'
import ClientBottomNav from '@/components/ClientBottomNav'
import PixPendenteBar, { usePixPendente } from '@/components/PixPendenteBar'
import { CF_OPEN_CART_KEY } from '@/lib/pedidoAtivoCliente'
import { fetchCliente } from '@/lib/clienteSessaoFront'
import { lerReferenciaRecompensa, gravarReferenciaRecompensa, reconciliarReservaComReferencia } from '@/lib/recompensaJornadaCarrinho'

type PizzaRecompensa = { tamanho: string; sabores: string[] }
type ItemComposicao = { item: { produtoNome: string }; quantidade: number }

type CaixaFechada = { recompensaId: string }
type RecompensaAberta = {
  recompensaId: string
  tipo: string
  produtoNome: string | null
  abertaEm?: string
  validaAte?: string
  pizza?: PizzaRecompensa
  composicao?: ItemComposicao[]
}
type RecompensaReservada = { recompensaId: string; tipo: string; produtoNome: string | null; validaAte?: string; pizza?: PizzaRecompensa; composicao?: ItemComposicao[]; reservaPedidoId?: string }

type Jornada = {
  ativo: boolean
  metaPizzas: number
  limitePizzasPorPedido: number
  cicloAtual: number
  pizzasNoCiclo: number
  faltam: number
  faseAtual: number
  mensagem: string
  totalJornadasConcluidas: number
  textos: { tituloTrilha: string; subtituloTrilha: string }
  caixasFechadas: CaixaFechada[]
  recompensasDisponiveis: RecompensaAberta[]
  recompensasReservadas: RecompensaReservada[]
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
  perigo: 'var(--danger-text)',
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
  boxSizing: 'border-box',
}

const botaoSecundario: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 10,
  background: 'transparent',
  color: cores.textoSecundario,
  fontSize: 13,
  fontWeight: 700,
  border: `1px solid ${cores.cardBorda}`,
  cursor: 'pointer',
  fontFamily: 'Archivo, sans-serif',
}

const label: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: cores.textoTerciario,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
}

function diasRestantes(validaAte?: string): number | null {
  if (!validaAte) return null
  const ms = new Date(validaAte).getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)))
}

export default function JornadaDoChefPage() {
  const { pendente: pixPendente } = usePixPendente()
  const [jornada, setJornada] = useState<Jornada | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [abrindo, setAbrindo] = useState(false)
  const [reservando, setReservando] = useState<string | null>(null)
  // Pizza-presente exige escolher o sabor ANTES de reservar/enviar ao
  // carrinho (rule 4) — nunca uma quantidade/tamanho livre, só um sabor entre
  // os permitidos configurados pela Kellyne (recompensa.pizza.sabores).
  const [escolhendoSaborPara, setEscolhendoSaborPara] = useState<string | null>(null)
  const [saborSelecionado, setSaborSelecionado] = useState('')
  // Aviso da reconciliação reserva ↔ carrinho (nunca manter um falso
  // "presente está no carrinho" quando o item não puder ser rematerializado).
  const [avisoReserva, setAvisoReserva] = useState('')
  // O card "presente está no carrinho" só renderiza para uma reserva
  // CONFIRMADA pela reconciliação (referência local presente) — nunca só
  // porque o servidor diz "reservada".
  const [reservaConfirmadaId, setReservaConfirmadaId] = useState<string | null>(null)

  async function carregar() {
    setErro('')
    try {
      const res = await fetchCliente('/api/cliente/jornada-chef', { cache: 'no-store' })
      if (res.status === 401) { window.location.href = '/cliente'; return }
      if (!res.ok) { setErro('Não foi possível carregar sua Jornada do Chef agora.'); setCarregando(false); return }
      setJornada(await res.json())
    } catch {
      setErro('Erro de conexão. Tente novamente.')
    }
    setCarregando(false)
  }

  useEffect(() => { carregar() }, [])

  // Reconciliação da reserva do servidor com o carrinho real do navegador:
  // o card "presente está no carrinho" só pode existir se a referência local
  // que rematerializa o item na sacola também existir. Se ela se perdeu
  // (navegador fechado/reaberto, outra aba):
  // - presente sem escolha (bebida/composição) → reconstrói a referência com
  //   segurança (o cardápio volta a injetar o item ao abrir a sacola);
  // - pizza (o sabor escolhido se perdeu junto) → libera a reserva no
  //   servidor e devolve a recompensa para "disponivel", com aviso claro —
  //   nunca inventamos uma escolha que o cliente não fez, nunca consumimos a
  //   recompensa.
  useEffect(() => {
    if (!jornada?.ativo) return
    const reservada = jornada.recompensasReservadas.find((r) => !r.reservaPedidoId)
    if (!reservada) return
    const decisao = reconciliarReservaComReferencia(reservada, lerReferenciaRecompensa(localStorage))
    if (decisao.acao === 'manter') {
      setReservaConfirmadaId(reservada.recompensaId)
      return
    }
    if (decisao.acao === 'reconstruir' && gravarReferenciaRecompensa(localStorage, decisao.referencia)) {
      setReservaConfirmadaId(reservada.recompensaId)
      return
    }
    // "liberar" (pizza sem o sabor escolhido) ou storage bloqueado: devolve a
    // recompensa para "disponivel" no servidor. Nunca consome/perde o prêmio.
    ;(async () => {
      try {
        const res = await fetchCliente('/api/cliente/jornada-chef/cancelar-reserva', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recompensaId: reservada.recompensaId }),
        })
        if (res.ok) {
          setAvisoReserva(
            reservada.tipo === 'pizza'
              ? 'Seu presente voltou para a Jornada — escolha o sabor de novo para usá-lo no próximo pedido.'
              : 'Seu presente voltou para a Jornada — toque em "Usar no próximo pedido" para colocá-lo na sacola de novo.'
          )
          await carregar()
          return
        }
      } catch {}
      setAvisoReserva('Não conseguimos confirmar seu presente na sacola agora. Atualize a página para tentar de novo.')
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jornada])

  async function abrirCaixa(recompensaId: string) {
    setAbrindo(true)
    try {
      const res = await fetchCliente('/api/cliente/jornada-chef/abrir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recompensaId }),
      })
      if (res.ok) await carregar()
    } catch {}
    setAbrindo(false)
  }

  function iniciarUsoDoPresente(recompensaId: string) {
    const recompensa = jornada?.recompensasDisponiveis.find((r) => r.recompensaId === recompensaId)
    if (recompensa?.tipo === 'pizza' && recompensa.pizza) {
      // Pizza-presente sempre exige um sabor escolhido antes de prosseguir —
      // nunca reserva sem essa escolha.
      setEscolhendoSaborPara(recompensaId)
      setSaborSelecionado('')
      return
    }
    usarNoProximoPedido(recompensaId)
  }

  async function usarNoProximoPedido(recompensaId: string, sabor?: string) {
    setReservando(recompensaId)
    try {
      const res = await fetchCliente('/api/cliente/jornada-chef/reservar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recompensaId }),
      })
      if (res.ok) {
        const recompensa = jornada?.recompensasDisponiveis.find((r) => r.recompensaId === recompensaId)
        // Só recompensaId + a escolha permitida (sabor) são guardados — nome,
        // preço e demais dados do presente nunca são fonte de verdade aqui; o
        // carrinho materializa o item só depois de confirmar a reserva na API
        // autenticada (rule 4). A referência vive em localStorage para o item
        // sobreviver a fechar/reabrir o navegador enquanto a reserva valer.
        const gravou = gravarReferenciaRecompensa(localStorage, {
          recompensaId,
          ...(sabor ? { escolha: { sabor } } : {}),
          produtoNome: recompensa?.produtoNome ?? 'Presente da Jornada do Chef',
          ...(recompensa?.validaAte ? { validaAte: recompensa.validaAte } : {}),
        })
        if (!gravou) {
          // Sem a referência o item nunca chegaria à sacola — desfaz a
          // reserva na hora para não nascer um falso "está no carrinho".
          try {
            await fetchCliente('/api/cliente/jornada-chef/cancelar-reserva', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ recompensaId }),
            })
          } catch {}
          setAvisoReserva('Seu navegador bloqueou o armazenamento da sacola — não foi possível colocar o presente no carrinho. Seu presente continua disponível na Jornada.')
          await carregar()
          setReservando(null)
          setEscolhendoSaborPara(null)
          return
        }
        try { sessionStorage.setItem(CF_OPEN_CART_KEY, '1') } catch {}
        window.location.href = '/pedido'
        return
      }
    } catch {}
    setReservando(null)
    setEscolhendoSaborPara(null)
  }

  function abrirSacola() {
    try { sessionStorage.setItem(CF_OPEN_CART_KEY, '1') } catch {}
    window.location.href = '/pedido'
  }

  const marcadores = Array.from({ length: jornada?.metaPizzas ?? 12 }, (_, i) => i < (jornada?.pizzasNoCiclo ?? 0))
  const porFase = Math.ceil((jornada?.metaPizzas ?? 12) / 4)

  return (
    <div style={{ background: cores.fundo, minHeight: '100dvh', fontFamily: 'Archivo, sans-serif', color: cores.navy, display: 'flex', flexDirection: 'column' }}>
      <style>{`
        @keyframes jcReservadoIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        @keyframes jcReservadoGiftPop { 0% { transform: scale(0.6) rotate(-8deg); } 55% { transform: scale(1.12) rotate(6deg); } 100% { transform: scale(1) rotate(0deg); } }
        @keyframes jcReservadoCheckIn { from { opacity: 0; transform: scale(0.7); } to { opacity: 1; transform: scale(1); } }
        .jc-reservado-card { animation: jcReservadoIn 450ms ease-out both; }
        .jc-reservado-gift { animation: jcReservadoGiftPop 550ms cubic-bezier(.34,1.56,.64,1) both; }
        .jc-reservado-check { animation: jcReservadoCheckIn 350ms ease-out 300ms both; }
        @media (prefers-reduced-motion: reduce) {
          .jc-reservado-card, .jc-reservado-gift, .jc-reservado-check { animation: none; }
        }
      `}</style>
      <div style={{ background: cores.cardBg, borderBottom: `1px solid ${cores.cardBorda}`, padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <a href="/cliente" aria-label="Voltar" style={{ color: cores.navy, display: 'flex' }}>
          <ArrowLeft size={20} />
        </a>
        <div style={{ fontSize: 15, fontWeight: 700 }}>{jornada?.textos.tituloTrilha ?? 'Jornada do Chef'}</div>
      </div>

      <div style={{ flex: 1, padding: '28px 20px calc(env(safe-area-inset-bottom) + 96px)', maxWidth: 640, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        {carregando && <p style={{ textAlign: 'center', color: cores.textoSecundario, fontSize: 14 }}>Carregando...</p>}

        {!carregando && erro && (
          <div style={{ background: cores.cardBg, border: `1px solid ${cores.cardBorda}`, borderRadius: 14, padding: 18, textAlign: 'center' }}>
            <p style={{ color: cores.textoSecundario, fontSize: 14, margin: '0 0 12px' }}>{erro}</p>
            <button onClick={carregar} style={{ ...botaoPrimario, width: 'auto', padding: '10px 18px' }}>Tentar novamente</button>
          </div>
        )}

        {!carregando && !erro && jornada && !jornada.ativo && (
          <div style={{ background: cores.cardBg, border: `1px solid ${cores.cardBorda}`, borderRadius: 14, padding: 18, textAlign: 'center' }}>
            <p style={{ color: cores.textoSecundario, fontSize: 14, margin: 0 }}>A Jornada do Chef ainda não está ativa por aqui. Volte em breve!</p>
          </div>
        )}

        {!carregando && !erro && jornada && jornada.ativo && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ textAlign: 'center' }}>
              <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 6px' }}>{jornada.textos.tituloTrilha}</h1>
              <p style={{ fontSize: 13.5, color: cores.textoSecundario, margin: 0 }}>{jornada.textos.subtituloTrilha}</p>
            </div>

            {/* Caixas fechadas — nunca abrem sozinhas */}
            {jornada.caixasFechadas.map((caixa) => (
              <div key={caixa.recompensaId} style={{ background: cores.navyCard, borderRadius: 16, padding: 22, color: cores.navyCardTexto, textAlign: 'center' }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
                  <Gift size={32} color={cores.amarelo} />
                </div>
                <p style={{ fontSize: 16, fontWeight: 800, margin: '0 0 6px' }}>Seu presente está aqui!</p>
                <p style={{ fontSize: 13.5, margin: '0 0 16px', opacity: 0.85 }}>Você completou {jornada.metaPizzas} pizzas e desbloqueou um presente 🎁</p>
                <button onClick={() => abrirCaixa(caixa.recompensaId)} disabled={abrindo} style={{ ...botaoPrimario, opacity: abrindo ? 0.6 : 1 }}>
                  {abrindo ? 'Abrindo...' : 'Abrir meu presente'}
                </button>
              </div>
            ))}

            {/* Recompensas já abertas, ainda não reservadas para um pedido */}
            {jornada.recompensasDisponiveis.map((rec) => {
              const dias = diasRestantes(rec.validaAte)
              return (
                <div key={rec.recompensaId} style={{ background: cores.cardBg, border: `1px solid ${cores.cardBorda}`, borderRadius: 16, padding: 22 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <Sparkles size={20} color={cores.amarelo} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: cores.amarelo, textTransform: 'uppercase', letterSpacing: 0.5 }}>Presente revelado</span>
                  </div>
                  <p style={{ fontSize: 16, fontWeight: 700, margin: '0 0 6px' }}>{rec.produtoNome ?? 'Presente especial'}</p>
                  {rec.tipo === 'pizza' && rec.pizza && (
                    <p style={{ fontSize: 12.5, color: cores.textoSecundario, margin: '0 0 12px' }}>Borda e adicionais não estão incluídos no presente.</p>
                  )}
                  {rec.tipo === 'presente_especial' && rec.composicao && rec.composicao.length > 0 && (
                    <ul style={{ fontSize: 12.5, color: cores.textoSecundario, margin: '0 0 12px', paddingLeft: 18 }}>
                      {rec.composicao.map((c, idx) => (
                        <li key={idx}>{c.quantidade > 1 ? `${c.quantidade}x ${c.item.produtoNome}` : c.item.produtoNome}</li>
                      ))}
                    </ul>
                  )}
                  {dias !== null && (
                    <p style={{ fontSize: 13, color: dias <= 3 ? cores.perigo : cores.textoSecundario, margin: '0 0 16px' }}>
                      {dias <= 3 ? `Válido por mais ${dias} dia${dias === 1 ? '' : 's'}` : 'Válido por 30 dias após a abertura'}
                    </p>
                  )}

                  {escolhendoSaborPara === rec.recompensaId && rec.pizza ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 10 }}>
                      <span style={label}>Escolha o sabor da sua pizza {rec.pizza.tamanho}</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {rec.pizza.sabores.map((sabor) => (
                          <button
                            key={sabor}
                            onClick={() => setSaborSelecionado(sabor)}
                            style={{
                              ...botaoSecundario,
                              padding: '6px 12px',
                              ...(saborSelecionado === sabor ? { background: cores.amarelo, color: cores.amareloTexto, border: 'none' } : {}),
                            }}
                          >
                            {sabor}
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() => usarNoProximoPedido(rec.recompensaId, saborSelecionado)}
                        disabled={!saborSelecionado || reservando === rec.recompensaId}
                        style={{ ...botaoPrimario, opacity: !saborSelecionado || reservando === rec.recompensaId ? 0.6 : 1 }}
                      >
                        {reservando === rec.recompensaId ? 'Preparando...' : 'Confirmar sabor e usar no próximo pedido'}
                      </button>
                      <button onClick={() => setEscolhendoSaborPara(null)} style={{ ...botaoSecundario, width: 'fit-content' }}>Cancelar</button>
                    </div>
                  ) : (
                    <button onClick={() => iniciarUsoDoPresente(rec.recompensaId)} disabled={reservando === rec.recompensaId} style={{ ...botaoPrimario, opacity: reservando === rec.recompensaId ? 0.6 : 1, marginBottom: 10 }}>
                      {reservando === rec.recompensaId ? 'Preparando...' : 'Usar no próximo pedido'}
                    </button>
                  )}
                </div>
              )
            })}

            {avisoReserva && (
              <div style={{ background: cores.cardBg, border: `1px solid ${cores.cardBorda}`, borderRadius: 14, padding: 14 }}>
                <p style={{ fontSize: 13, color: cores.textoSecundario, margin: 0 }}>{avisoReserva}</p>
              </div>
            )}

            {/* Só reservas CONFIRMADAS pela reconciliação (referência local
                presente ou já vinculadas a um pedido real) — o card "está no
                carrinho" nunca aparece com a sacola de fato vazia. */}
            {jornada.recompensasReservadas.filter((rec) => rec.reservaPedidoId || rec.recompensaId === reservaConfirmadaId).map((rec) => (
              <div
                key={rec.recompensaId}
                className="jc-reservado-card"
                style={{ background: cores.cardBg, border: `1px solid ${cores.cardBorda}`, borderRadius: 16, padding: 20 }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span
                    className="jc-reservado-gift"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      background: 'color-mix(in srgb, var(--primary) 18%, transparent)',
                      flexShrink: 0,
                    }}
                  >
                    <Gift size={19} color={cores.amarelo} />
                  </span>
                  <p style={{ fontSize: 15, fontWeight: 800, margin: 0, flex: 1 }}>Seu presente está no carrinho 🎁</p>
                  <span className="jc-reservado-check" style={{ display: 'flex', flexShrink: 0 }}>
                    <CheckCircle2 size={18} color="var(--success-text)" />
                  </span>
                </div>

                <p style={{ fontSize: 15, fontWeight: 700, margin: '10px 0 2px' }}>{rec.produtoNome ?? 'Seu presente'}</p>
                <p style={{ fontSize: 13, color: cores.textoSecundario, margin: '0 0 8px' }}>
                  Foi adicionado grátis. Finalize seu pedido para aproveitar.
                </p>
                <p style={{ fontSize: 12, color: cores.textoTerciario, margin: '0 0 16px' }}>
                  Se o pedido for cancelado, seu presente volta para a Jornada.
                </p>

                <button onClick={abrirSacola} style={botaoPrimario}>Ver minha sacola</button>
              </div>
            ))}

            {/* Trilha visual */}
            <div style={{ background: cores.cardBg, border: `1px solid ${cores.cardBorda}`, borderRadius: 16, padding: 22 }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
                {jornada.pizzasNoCiclo} de {jornada.metaPizzas} pizzas
              </div>
              <p style={{ fontSize: 13, color: cores.textoSecundario, margin: '0 0 16px' }}>{jornada.mensagem}</p>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${porFase}, 1fr)`, gap: 8 }}>
                {marcadores.map((concluido, i) => {
                  const fase = Math.floor(i / porFase) + 1
                  const inicioNovaFase = i % porFase === 0
                  return (
                    <div
                      key={i}
                      title={`Pizza ${i + 1} — fase ${fase}`}
                      style={{
                        aspectRatio: '1',
                        borderRadius: 12,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: concluido ? cores.amarelo : cores.moldura,
                        border: fase === jornada.faseAtual && inicioNovaFase ? `2px solid ${cores.amarelo}` : 'none',
                      }}
                    >
                      <Pizza size={16} color={concluido ? cores.amareloTexto : cores.textoTerciario} />
                    </div>
                  )
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
                {[1, 2, 3, 4].map((fase) => (
                  <span key={fase} style={{ fontSize: 11, fontWeight: fase === jornada.faseAtual ? 800 : 400, color: fase === jornada.faseAtual ? cores.navy : cores.textoTerciario }}>
                    Fase {fase}
                  </span>
                ))}
              </div>
            </div>

            {/* Como funciona */}
            <details style={{ background: cores.cardBg, border: `1px solid ${cores.cardBorda}`, borderRadius: 16, padding: 18 }}>
              <summary style={{ fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>Como funciona</summary>
              <ul style={{ fontSize: 13, color: cores.textoSecundario, margin: '12px 0 0', paddingLeft: 18, lineHeight: 1.7 }}>
                <li>Cada pizza elegível vale uma na trilha.</li>
                <li>No máximo {jornada.limitePizzasPorPedido} pizzas do mesmo pedido avançam na Jornada do Chef.</li>
                <li>Todas as pizzas continuam gerando pontos normalmente.</li>
                <li>Pizza meio a meio conta como uma pizza.</li>
                <li>O progresso não expira.</li>
                <li>Presentes têm validade de 30 dias depois de abertos.</li>
              </ul>
            </details>
          </div>
        )}
      </div>

      <PixPendenteBar pendente={pixPendente} />
      <ClientBottomNav active="pontos" onSacolaClick={abrirSacola} pixPendente={!!pixPendente} />
    </div>
  )
}
