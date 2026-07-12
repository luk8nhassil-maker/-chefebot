'use client'

import { useState, useEffect, useRef, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { Inbox, ChefHat, CheckCircle2, Flag, UtensilsCrossed, Bike, Check, Hourglass, X, Pizza, ArrowLeft } from 'lucide-react'
import type { LocalizacaoEntregador } from '@/types/entregador'

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
  icon: ReactNode
}

// Ordem operacional dos status já usados pelo sistema. Status desconhecido é
// tratado como "novo" (primeira etapa), sem quebrar a página.
const ORDEM_STATUS = ['novo', 'em_preparo', 'saiu_entrega', 'entregue']

const ICON_SIZE = 18

function getEtapasTimeline(tipoEntrega: string): { icon: ReactNode; label: string }[] {
  if (tipoEntrega === 'retirada') {
    return [
      { icon: <Inbox size={ICON_SIZE} aria-hidden="true" />, label: 'Pedido recebido' },
      { icon: <ChefHat size={ICON_SIZE} aria-hidden="true" />, label: 'Em preparo' },
      { icon: <CheckCircle2 size={ICON_SIZE} aria-hidden="true" />, label: 'Pronto para retirada' },
      { icon: <Flag size={ICON_SIZE} aria-hidden="true" />, label: 'Finalizado' },
    ]
  }
  if (tipoEntrega === 'dine_in') {
    return [
      { icon: <Inbox size={ICON_SIZE} aria-hidden="true" />, label: 'Pedido recebido' },
      { icon: <ChefHat size={ICON_SIZE} aria-hidden="true" />, label: 'Em preparo' },
      { icon: <UtensilsCrossed size={ICON_SIZE} aria-hidden="true" />, label: 'Pronto para servir' },
      { icon: <Flag size={ICON_SIZE} aria-hidden="true" />, label: 'Finalizado' },
    ]
  }
  return [
    { icon: <Inbox size={ICON_SIZE} aria-hidden="true" />, label: 'Pedido recebido' },
    { icon: <ChefHat size={ICON_SIZE} aria-hidden="true" />, label: 'Em preparo' },
    { icon: <Bike size={ICON_SIZE} aria-hidden="true" />, label: 'Saiu para entrega' },
    { icon: <Check size={ICON_SIZE} aria-hidden="true" />, label: 'Entregue' },
  ]
}

function getInfoStatus(status: string, tipoEntrega: string): InfoStatus {
  const tamanhoGrande = 40
  if (tipoEntrega === 'retirada' || tipoEntrega === 'dine_in') {
    const map: Record<string, InfoStatus> = {
      novo:          { icon: <Hourglass size={tamanhoGrande} aria-hidden="true" />, label: 'Pedido recebido',       desc: 'Aguardando a pizzaria confirmar.',          color: '#888' },
      em_preparo:    { icon: <ChefHat size={tamanhoGrande} aria-hidden="true" />, label: 'Em preparo',            desc: 'Estamos fazendo seu pedido com carinho!',   color: '#ff6b00' },
      saiu_entrega:  { icon: <CheckCircle2 size={tamanhoGrande} aria-hidden="true" />, label: 'Pronto para retirada',  desc: 'Pode vir buscar — está te esperando!',      color: '#4caf50' },
      entregue:      { icon: <Check size={tamanhoGrande} aria-hidden="true" />, label: 'Retirado',              desc: 'Bom apetite!',                              color: '#4caf50' },
      cancelado:     { icon: <X size={tamanhoGrande} aria-hidden="true" />, label: 'Cancelado',             desc: 'Entre em contato com a pizzaria.',           color: '#ef4444' },
    }
    return map[status] ?? { icon: <Hourglass size={tamanhoGrande} aria-hidden="true" />, label: 'Pedido recebido', desc: 'Aguardando confirmação.', color: '#888' }
  }

  // delivery
  const map: Record<string, InfoStatus> = {
    novo:         { icon: <Hourglass size={tamanhoGrande} aria-hidden="true" />, label: 'Pedido recebido',  desc: 'Aguardando a pizzaria começar o preparo.',  color: '#888' },
    em_preparo:   { icon: <ChefHat size={tamanhoGrande} aria-hidden="true" />, label: 'Em preparo',      desc: 'Estamos fazendo seu pedido com carinho!',  color: '#ff6b00' },
    saiu_entrega: { icon: <Bike size={tamanhoGrande} aria-hidden="true" />, label: 'A caminho',        desc: 'Seu pedido está na rua!',                   color: '#ff6b00' },
    entregue:     { icon: <Check size={tamanhoGrande} aria-hidden="true" />, label: 'Entregue',         desc: 'Bom apetite!',                              color: '#4caf50' },
    cancelado:    { icon: <X size={tamanhoGrande} aria-hidden="true" />, label: 'Cancelado',        desc: 'Entre em contato com a pizzaria.',           color: '#ef4444' },
  }
  return map[status] ?? { icon: <Hourglass size={tamanhoGrande} aria-hidden="true" />, label: 'Pedido recebido', desc: 'Aguardando confirmação.', color: '#888' }
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
    : { icon: <Hourglass size={40} aria-hidden="true" />, label: 'Carregando...', desc: '', color: '#888' }

  const isDelivery = pedidoStatus?.tipoEntrega === 'delivery'
  const emRota = pedidoStatus?.status === 'saiu_entrega'
  const mostrarMapa = isDelivery && emRota && !!localizacao

  const etapas = pedidoStatus ? getEtapasTimeline(pedidoStatus.tipoEntrega) : []
  const idxAtual = pedidoStatus ? Math.max(0, ORDEM_STATUS.indexOf(pedidoStatus.status)) : 0
  const mostrarTimeline = !carregando && !!pedidoStatus && pedidoStatus.status !== 'cancelado'

  return (
    <div style={{ background: '#060606', minHeight: '100dvh', fontFamily: 'Archivo, sans-serif', color: '#fff', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ background: '#111', borderBottom: '1px solid #222', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Pizza size={22} aria-hidden="true" />
          <div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#ff6b00' }}>
              {pedidoStatus?.numero ? `Pedido #${pedidoStatus.numero}` : 'Acompanhar Pedido'}
            </div>
            <div style={{ fontSize: '11px', color: '#888' }}>#{pedidoId}</div>
          </div>
        </div>
        <a href="/cardapio" style={{ fontSize: '13px', color: '#888', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <ArrowLeft size={14} aria-hidden="true" /> Cardápio
        </a>
      </div>

      {/* Área do mapa — só para delivery em rota */}
      {mostrarMapa && (
        <div style={{ flex: 1, minHeight: '50vh', position: 'relative' }}>
          <MapaEntregador localizacao={localizacao} />
        </div>
      )}

      {/* Card de informações */}
      <div style={{ background: '#111', borderTop: mostrarMapa ? '1px solid #222' : 'none', padding: '28px 20px 20px', borderRadius: mostrarMapa ? '20px 20px 0 0' : 0, marginTop: mostrarMapa ? '-20px' : 0, position: 'relative', zIndex: 10, flex: mostrarMapa ? 'none' : 1 }}>

        {/* Status principal */}
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'center', color: info.color }}>{info.icon}</div>
          <div style={{ fontSize: '18px', fontWeight: 800, color: info.color, marginBottom: '6px' }}>{info.label}</div>
          {info.desc && <div style={{ fontSize: '13px', color: '#888' }}>{info.desc}</div>}
        </div>

        {/* Timeline de etapas do pedido */}
        {mostrarTimeline && (
          <div style={{ background: '#0a0a0a', borderRadius: '10px', padding: '14px 16px', marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px' }}>Acompanhamento</div>
            {etapas.map((etapa, i) => {
              const concluida = i < idxAtual
              const atual = i === idxAtual
              const corBorda = atual ? '#ff6b00' : concluida ? '#4caf50' : '#333'
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: concluida ? '#4caf50' : atual ? '#ff6b00' : '#1c1c1c', border: `2px solid ${corBorda}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 800, color: '#fff', boxSizing: 'border-box', flexShrink: 0 }}>
                      {concluida ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : atual ? <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff', display: 'block' }} aria-hidden="true" /> : ''}
                    </div>
                    {i < etapas.length - 1 && <div style={{ width: '2px', height: '22px', background: i < idxAtual ? '#4caf50' : '#222' }} />}
                  </div>
                  <div style={{ paddingBottom: i < etapas.length - 1 ? '8px' : 0, marginTop: '2px' }}>
                    <div style={{ fontSize: '14px', fontWeight: atual ? 800 : 600, color: atual ? '#ff6b00' : concluida ? '#ccc' : '#666', display: 'flex', alignItems: 'center', gap: 6 }}>{etapa.icon} {etapa.label}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Itens do pedido */}
        {!carregando && pedidoStatus && (
          <div style={{ background: '#0a0a0a', borderRadius: '10px', padding: '12px 14px', marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>Seu pedido</div>
            {pedidoStatus.itens.map((item, i) => (
              <div key={i} style={{ fontSize: '13px', color: '#ccc', paddingLeft: '8px', borderLeft: '2px solid #333', marginBottom: '3px' }}>{item}</div>
            ))}
            <div style={{ marginTop: '8px', fontSize: '15px', fontWeight: 700, color: '#ff6b00' }}>
              Total: R$ {pedidoStatus.total.toFixed(2).replace('.', ',')}
            </div>
          </div>
        )}

        {/* Botão novo pedido */}
        <a
          href="/cardapio"
          style={{ display: 'block', width: '100%', padding: '14px', borderRadius: '12px', background: '#ff6b00', color: '#fff', fontSize: '15px', fontWeight: 700, textDecoration: 'none', textAlign: 'center', boxSizing: 'border-box', marginBottom: '10px' }}
        >
          Fazer novo pedido
        </a>

        {/* Botão WhatsApp */}
        <a
          href={`https://wa.me/${PIZZARIA_NUMERO}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', width: '100%', padding: '14px', borderRadius: '12px', background: '#1a7a1a', color: '#fff', fontSize: '15px', fontWeight: 700, textDecoration: 'none', boxSizing: 'border-box' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          Falar com a Pizzaria
        </a>
      </div>
    </div>
  )
}
