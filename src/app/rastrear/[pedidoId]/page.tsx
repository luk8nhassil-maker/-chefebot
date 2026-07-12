'use client'

import { useState, useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import type { LocalizacaoEntregador } from '@/types/entregador'
import ClientBottomNav from '@/components/ClientBottomNav'
import { CF_OPEN_CART_KEY } from '@/lib/pedidoAtivoCliente'

const MapaEntregador = dynamic(() => import('@/components/MapaEntregador'), { ssr: false })

const PIZZARIA_NUMERO = '5586999999999'

interface PageProps {
  params: Promise<{ pedidoId: string }>
}

type PedidoStatus = {
  numero?: number
  status: string
  tipoEntrega: string
  itens: string[]
  total: number
}

type InfoStatus = {
  label: string
  desc: string
  color: string
  emoji: string
}

// Ordem operacional dos status já usados pelo sistema. Status desconhecido é
// tratado como "novo" (primeira etapa), sem quebrar a página.
const ORDEM_STATUS = ['novo', 'em_preparo', 'saiu_entrega', 'entregue']

function getEtapasTimeline(tipoEntrega: string): { emoji: string; label: string }[] {
  if (tipoEntrega === 'retirada') {
    return [
      { emoji: '📥', label: 'Pedido recebido' },
      { emoji: '👨‍🍳', label: 'Em preparo' },
      { emoji: '✅', label: 'Pronto para retirada' },
      { emoji: '🏁', label: 'Finalizado' },
    ]
  }
  if (tipoEntrega === 'dine_in') {
    return [
      { emoji: '📥', label: 'Pedido recebido' },
      { emoji: '👨‍🍳', label: 'Em preparo' },
      { emoji: '🍽️', label: 'Pronto para servir' },
      { emoji: '🏁', label: 'Finalizado' },
    ]
  }
  return [
    { emoji: '📥', label: 'Pedido recebido' },
    { emoji: '👨‍🍳', label: 'Em preparo' },
    { emoji: '🛵', label: 'Saiu para entrega' },
    { emoji: '✓', label: 'Entregue' },
  ]
}

function getInfoStatus(status: string, tipoEntrega: string): InfoStatus {
  if (tipoEntrega === 'retirada' || tipoEntrega === 'dine_in') {
    const map: Record<string, InfoStatus> = {
      novo:          { emoji: '⏳', label: 'Pedido recebido',       desc: 'Aguardando a pizzaria confirmar.',          color: 'var(--foreground-secondary)' },
      em_preparo:    { emoji: '👨‍🍳', label: 'Em preparo',            desc: 'Estamos fazendo seu pedido com carinho!',   color: 'var(--brand-text)' },
      saiu_entrega:  { emoji: '✅', label: 'Pronto para retirada',  desc: 'Pode vir buscar — está te esperando!',      color: 'var(--success)' },
      entregue:      { emoji: '✓',  label: 'Retirado',              desc: 'Bom apetite!',                              color: 'var(--success)' },
      cancelado:     { emoji: '✗',  label: 'Cancelado',             desc: 'Entre em contato com a pizzaria.',           color: 'var(--danger)' },
    }
    return map[status] ?? { emoji: '⏳', label: 'Pedido recebido', desc: 'Aguardando confirmação.', color: 'var(--foreground-secondary)' }
  }

  // delivery
  const map: Record<string, InfoStatus> = {
    novo:         { emoji: '⏳', label: 'Pedido recebido',  desc: 'Aguardando a pizzaria começar o preparo.',  color: 'var(--foreground-secondary)' },
    em_preparo:   { emoji: '👨‍🍳', label: 'Em preparo',      desc: 'Estamos fazendo seu pedido com carinho!',  color: 'var(--brand-text)' },
    saiu_entrega: { emoji: '🛵', label: 'A caminho',        desc: 'Seu pedido está na rua!',                   color: 'var(--brand-text)' },
    entregue:     { emoji: '✓',  label: 'Entregue',         desc: 'Bom apetite!',                              color: 'var(--success)' },
    cancelado:    { emoji: '✗',  label: 'Cancelado',        desc: 'Entre em contato com a pizzaria.',           color: 'var(--danger)' },
  }
  return map[status] ?? { emoji: '⏳', label: 'Pedido recebido', desc: 'Aguardando confirmação.', color: 'var(--foreground-secondary)' }
}

export default function RastrearPage({ params }: PageProps) {
  const [pedidoId, setPedidoId] = useState<string | null>(null)
  const [pedidoStatus, setPedidoStatus] = useState<PedidoStatus | null>(null)
  const [localizacao, setLocalizacao] = useState<LocalizacaoEntregador | null>(null)
  const [carregando, setCarregando] = useState(true)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    params.then(p => setPedidoId(p.pedidoId))
  }, [params])

  function abrirSacola() {
    try { sessionStorage.setItem(CF_OPEN_CART_KEY, '1') } catch {}
    window.location.href = '/pedido'
  }

  useEffect(() => {
    if (!pedidoId) return

    async function fetchStatus() {
      try {
        const res = await fetch(`/api/pedido-status?pedidoId=${pedidoId}`, { cache: 'no-store' })
        if (res.ok) {
          const data = await res.json()
          setPedidoStatus(data)
        }
      } catch {}
      setCarregando(false)
    }

    async function fetchLocalizacao() {
      try {
        const res = await fetch(`/api/localizacao?pedidoId=${pedidoId}`)
        if (res.ok) {
          const data = await res.json()
          setLocalizacao(data)
        }
      } catch {}
    }

    fetchStatus()
    fetchLocalizacao()

    // Atualiza status a cada 15s e localização a cada 10s
    intervalRef.current = setInterval(() => {
      fetchStatus()
      fetchLocalizacao()
    }, 10000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [pedidoId])

  const info = pedidoStatus
    ? getInfoStatus(pedidoStatus.status, pedidoStatus.tipoEntrega)
    : { emoji: '⏳', label: 'Carregando...', desc: '', color: 'var(--foreground-secondary)' }

  const isDelivery = pedidoStatus?.tipoEntrega === 'delivery'
  const emRota = pedidoStatus?.status === 'saiu_entrega'
  const mostrarMapa = isDelivery && emRota && !!localizacao

  const etapas = pedidoStatus ? getEtapasTimeline(pedidoStatus.tipoEntrega) : []
  const idxAtual = pedidoStatus ? Math.max(0, ORDEM_STATUS.indexOf(pedidoStatus.status)) : 0
  const mostrarTimeline = !carregando && !!pedidoStatus && pedidoStatus.status !== 'cancelado'

  return (
    <div style={{ background: 'var(--background)', minHeight: '100dvh', fontFamily: 'Archivo, sans-serif', color: 'var(--foreground)', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--surface-secondary)', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '22px' }}>🍕</span>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--brand-text)' }}>
              {pedidoStatus?.numero ? `Pedido #${pedidoStatus.numero}` : 'Acompanhar Pedido'}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--foreground-secondary)' }}>#{pedidoId}</div>
          </div>
        </div>
        <a href="/pedido" style={{ fontSize: '13px', color: 'var(--foreground-secondary)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
          ← Cardápio
        </a>
      </div>

      {/* Área do mapa — só para delivery em rota */}
      {mostrarMapa && (
        <div style={{ flex: 1, minHeight: '50vh', position: 'relative' }}>
          <MapaEntregador localizacao={localizacao} />
        </div>
      )}

      {/* Card de informações */}
      <div style={{ background: 'var(--surface)', borderTop: mostrarMapa ? '1px solid var(--surface-secondary)' : 'none', padding: '28px 20px calc(env(safe-area-inset-bottom) + 96px)', borderRadius: mostrarMapa ? '20px 20px 0 0' : 0, marginTop: mostrarMapa ? '-20px' : 0, position: 'relative', zIndex: 10, flex: mostrarMapa ? 'none' : 1 }}>

        {/* Status principal */}
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div style={{ fontSize: '48px', marginBottom: '8px' }}>{info.emoji}</div>
          <div style={{ fontSize: '18px', fontWeight: 800, color: info.color, marginBottom: '6px' }}>{info.label}</div>
          {info.desc && <div style={{ fontSize: '13px', color: 'var(--foreground-secondary)' }}>{info.desc}</div>}
        </div>

        {/* Timeline de etapas do pedido */}
        {mostrarTimeline && (
          <div style={{ background: 'var(--surface)', borderRadius: '10px', padding: '14px 16px', marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', color: 'var(--foreground-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px' }}>Acompanhamento</div>
            {etapas.map((etapa, i) => {
              const concluida = i < idxAtual
              const atual = i === idxAtual
              const corBorda = atual ? 'var(--primary)' : concluida ? 'var(--success)' : 'var(--surface-elevated)'
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: concluida ? 'var(--success)' : atual ? 'var(--primary)' : 'var(--surface)', border: `2px solid ${corBorda}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 800, color: 'var(--foreground)', boxSizing: 'border-box', flexShrink: 0 }}>
                      {concluida ? '✓' : atual ? '●' : ''}
                    </div>
                    {i < etapas.length - 1 && <div style={{ width: '2px', height: '22px', background: i < idxAtual ? 'var(--success)' : 'var(--surface-secondary)' }} />}
                  </div>
                  <div style={{ paddingBottom: i < etapas.length - 1 ? '8px' : 0, marginTop: '2px' }}>
                    <div style={{ fontSize: '14px', fontWeight: atual ? 800 : 600, color: atual ? 'var(--primary)' : concluida ? 'var(--foreground)' : 'var(--foreground-muted)' }}>{etapa.emoji} {etapa.label}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Itens do pedido */}
        {!carregando && pedidoStatus && (
          <div style={{ background: 'var(--surface)', borderRadius: '10px', padding: '12px 14px', marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', color: 'var(--foreground-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>Seu pedido</div>
            {pedidoStatus.itens.map((item, i) => (
              <div key={i} style={{ fontSize: '13px', color: 'var(--foreground)', paddingLeft: '8px', borderLeft: '2px solid var(--surface-elevated)', marginBottom: '3px' }}>{item}</div>
            ))}
            <div style={{ marginTop: '8px', fontSize: '15px', fontWeight: 700, color: 'var(--brand-text)' }}>
              Total: R$ {pedidoStatus.total.toFixed(2).replace('.', ',')}
            </div>
          </div>
        )}

        {/* Botão novo pedido */}
        <a
          href="/pedido"
          style={{ display: 'block', width: '100%', padding: '14px', borderRadius: '12px', background: 'var(--primary)', color: 'var(--primary-foreground)', fontSize: '15px', fontWeight: 700, textDecoration: 'none', textAlign: 'center', boxSizing: 'border-box', marginBottom: '10px' }}
        >
          Fazer novo pedido
        </a>

        {/* Botão WhatsApp */}
        <a
          href={`https://wa.me/${PIZZARIA_NUMERO}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', width: '100%', padding: '14px', borderRadius: '12px', background: 'var(--success)', color: 'var(--foreground)', fontSize: '15px', fontWeight: 700, textDecoration: 'none', boxSizing: 'border-box' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          Falar com a Pizzaria
        </a>
      </div>

      <ClientBottomNav active="pedido" onSacolaClick={abrirSacola} pedidoHref={pedidoId ? `/rastrear/${pedidoId}` : null} />
    </div>
  )
}
