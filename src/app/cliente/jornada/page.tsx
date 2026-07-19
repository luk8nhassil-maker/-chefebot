'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft, Gift, Pizza, Sparkles } from 'lucide-react'
import ClientBottomNav from '@/components/ClientBottomNav'
import PixPendenteBar, { usePixPendente } from '@/components/PixPendenteBar'
import { CF_OPEN_CART_KEY } from '@/lib/pedidoAtivoCliente'
import { fetchCliente } from '@/lib/clienteSessaoFront'

type CaixaFechada = { recompensaId: string }
type RecompensaAberta = { recompensaId: string; tipo: string; produtoNome: string | null; abertaEm?: string; validaAte?: string }
type RecompensaReservada = { recompensaId: string; produtoNome: string | null; validaAte?: string }

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

  async function usarNoProximoPedido(recompensaId: string) {
    setReservando(recompensaId)
    try {
      const res = await fetchCliente('/api/cliente/jornada-chef/reservar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recompensaId }),
      })
      if (res.ok) {
        const recompensa = jornada?.recompensasDisponiveis.find((r) => r.recompensaId === recompensaId)
        try {
          sessionStorage.setItem('cf_recompensa_jornada', JSON.stringify({
            recompensaId,
            produtoNome: recompensa?.produtoNome ?? 'Presente da Jornada do Chef',
            validaAte: recompensa?.validaAte,
          }))
          sessionStorage.setItem(CF_OPEN_CART_KEY, '1')
        } catch {}
        window.location.href = '/pedido'
        return
      }
    } catch {}
    setReservando(null)
  }

  function abrirSacola() {
    try { sessionStorage.setItem(CF_OPEN_CART_KEY, '1') } catch {}
    window.location.href = '/pedido'
  }

  const marcadores = Array.from({ length: jornada?.metaPizzas ?? 12 }, (_, i) => i < (jornada?.pizzasNoCiclo ?? 0))
  const porFase = Math.ceil((jornada?.metaPizzas ?? 12) / 4)

  return (
    <div style={{ background: cores.fundo, minHeight: '100dvh', fontFamily: 'Archivo, sans-serif', color: cores.navy, display: 'flex', flexDirection: 'column' }}>
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
                  {dias !== null && (
                    <p style={{ fontSize: 13, color: dias <= 3 ? cores.perigo : cores.textoSecundario, margin: '0 0 16px' }}>
                      {dias <= 3 ? `Válido por mais ${dias} dia${dias === 1 ? '' : 's'}` : 'Válido por 30 dias após a abertura'}
                    </p>
                  )}
                  <button onClick={() => usarNoProximoPedido(rec.recompensaId)} disabled={reservando === rec.recompensaId} style={{ ...botaoPrimario, opacity: reservando === rec.recompensaId ? 0.6 : 1, marginBottom: 10 }}>
                    {reservando === rec.recompensaId ? 'Preparando...' : 'Usar no próximo pedido'}
                  </button>
                </div>
              )
            })}

            {jornada.recompensasReservadas.map((rec) => (
              <div key={rec.recompensaId} style={{ background: cores.cardBg, border: `1px solid ${cores.cardBorda}`, borderRadius: 16, padding: 22 }}>
                <p style={{ fontSize: 13, color: cores.textoSecundario, margin: 0 }}>
                  <strong>{rec.produtoNome ?? 'Seu presente'}</strong> já está reservado no seu carrinho — é só finalizar o pedido.
                </p>
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
