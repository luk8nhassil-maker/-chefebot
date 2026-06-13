'use client'

import { useState, useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import type { PedidoEntregador, LocalizacaoEntregador } from '@/types/entregador'

const MapaEntregador = dynamic(() => import('@/components/MapaEntregador'), { ssr: false })

const PIZZARIA_NUMERO = '5586999999999'

interface PageProps {
  params: Promise<{ pedidoId: string }>
}

export default function RastrearPage({ params }: PageProps) {
  const [pedidoId, setPedidoId] = useState<string | null>(null)
  const [localizacao, setLocalizacao] = useState<LocalizacaoEntregador | null>(null)
  const [pedido, setPedido] = useState<PedidoEntregador | null>(null)
  const [erro, setErro] = useState('')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    params.then(p => setPedidoId(p.pedidoId))
  }, [params])

  useEffect(() => {
    if (!pedidoId) return

    async function fetchLocalizacao() {
      try {
        const res = await fetch(`/api/localizacao?pedidoId=${pedidoId}`)
        if (res.ok) {
          const data = await res.json()
          setLocalizacao(data)
          setErro('')
        }
      } catch {}
    }

    async function fetchPedido() {
      try {
        // Busca o pedido em todos os entregadores pela localização
        const locRes = await fetch(`/api/localizacao?pedidoId=${pedidoId}`)
        if (!locRes.ok) return
        const loc: LocalizacaoEntregador = await locRes.json()

        const res = await fetch(`/api/entregador-pedidos?entregadorId=${loc.entregadorId}`)
        if (!res.ok) return
        const pedidos: PedidoEntregador[] = await res.json()
        const p = pedidos.find(x => x.pedidoId === pedidoId)
        if (p) setPedido(p)
      } catch {}
    }

    fetchLocalizacao()
    fetchPedido()

    intervalRef.current = setInterval(fetchLocalizacao, 10000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [pedidoId])

  const statusLabel = pedido?.status === 'entregue' ? '✓ Entregue' : pedido?.status === 'em_rota' ? '🛵 A caminho' : '⏳ Saiu para entrega'
  const statusColor = pedido?.status === 'entregue' ? '#4caf50' : '#ff6b00'

  return (
    <div style={{ background: '#060606', minHeight: '100dvh', fontFamily: 'Archivo, sans-serif', color: '#fff', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ background: '#111', borderBottom: '1px solid #222', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontSize: '22px' }}>🍕</span>
        <div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#ff6b00' }}>Rastreamento do Pedido</div>
          <div style={{ fontSize: '11px', color: '#888' }}>#{pedidoId}</div>
        </div>
      </div>

      {/* Mapa */}
      <div style={{ flex: 1, minHeight: '50vh', position: 'relative' }}>
        {localizacao ? (
          <MapaEntregador localizacao={localizacao} />
        ) : (
          <div style={{ height: '50vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px', color: '#888' }}>
            <div style={{ fontSize: '40px' }}>🛵</div>
            <div style={{ fontSize: '14px' }}>{erro || 'Aguardando localização do entregador...'}</div>
          </div>
        )}
      </div>

      {/* Card de informações */}
      <div style={{ background: '#111', borderTop: '1px solid #222', padding: '20px', borderRadius: '20px 20px 0 0', marginTop: '-20px', position: 'relative', zIndex: 10 }}>
        {/* Status */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <span style={{ fontSize: '14px', fontWeight: 700, color: statusColor }}>{statusLabel}</span>
          {localizacao && (
            <span style={{ fontSize: '11px', color: '#666' }}>
              Atualizado: {new Date(localizacao.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>

        {pedido ? (
          <>
            {/* Entregador */}
            <div style={{ background: '#0a0a0a', borderRadius: '10px', padding: '12px 14px', marginBottom: '12px' }}>
              <div style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Entregador</div>
              <div style={{ fontSize: '15px', fontWeight: 600 }}>🛵 {pedido.entregadorNome}</div>
            </div>

            {/* Itens */}
            <div style={{ background: '#0a0a0a', borderRadius: '10px', padding: '12px 14px', marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>Seu pedido</div>
              {pedido.itens.map((item, i) => (
                <div key={i} style={{ fontSize: '13px', color: '#ccc', paddingLeft: '8px', borderLeft: '2px solid #333', marginBottom: '3px' }}>{item}</div>
              ))}
              <div style={{ marginTop: '8px', fontSize: '15px', fontWeight: 700, color: '#ff6b00' }}>Total: R$ {pedido.total.toFixed(2).replace('.', ',')}</div>
            </div>
          </>
        ) : (
          <div style={{ color: '#888', fontSize: '14px', textAlign: 'center', padding: '20px 0' }}>Carregando detalhes do pedido...</div>
        )}

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
