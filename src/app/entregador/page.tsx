'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { PedidoEntregador } from '@/types/entregador'

export default function EntregadorPage() {
  const [entregadorId, setEntregadorId] = useState('')
  const [inputId, setInputId] = useState('')
  const [pedidos, setPedidos] = useState<PedidoEntregador[]>([])
  const [loading, setLoading] = useState(false)
  const [rastreando, setRastreando] = useState<string | null>(null)
  const [erro, setErro] = useState('')
  const watchRef = useRef<number | null>(null)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const id = params.get('id')
    if (id) setEntregadorId(id)
  }, [])

  const buscarPedidos = useCallback(async (id: string) => {
    setLoading(true)
    setErro('')
    try {
      const res = await fetch(`/api/entregador-pedidos?entregadorId=${id}`)
      if (!res.ok) throw new Error('Erro ao buscar pedidos')
      const data = await res.json()
      setPedidos(data)
    } catch {
      setErro('Erro ao carregar pedidos. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (entregadorId) buscarPedidos(entregadorId)
  }, [entregadorId, buscarPedidos])

  async function ativarWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await (navigator as Navigator & { wakeLock: { request: (type: string) => Promise<WakeLockSentinel> } }).wakeLock.request('screen')
      }
    } catch {}
  }

  function liberarWakeLock() {
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {})
      wakeLockRef.current = null
    }
  }

  async function iniciarRastreamento(pedidoId: string) {
    if (!navigator.geolocation) {
      setErro('GPS não disponível neste dispositivo.')
      return
    }

    await ativarWakeLock()

    // Atualiza status para em_rota
    await fetch('/api/entregador-pedidos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entregadorId, pedidoId, acao: 'iniciar' }),
    })

    setRastreando(pedidoId)
    setPedidos(prev => prev.map(p => p.pedidoId === pedidoId ? { ...p, status: 'em_rota' } : p))

    const watchId = navigator.geolocation.watchPosition(
      async (pos) => {
        await fetch('/api/localizacao', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entregadorId,
            pedidoId,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          }),
        })
      },
      (err) => console.error('GPS erro:', err),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    )

    watchRef.current = watchId
  }

  async function confirmarEntrega(pedidoId: string) {
    if (watchRef.current !== null) {
      navigator.geolocation.clearWatch(watchRef.current)
      watchRef.current = null
    }
    liberarWakeLock()

    await fetch('/api/entregador-pedidos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entregadorId, pedidoId, acao: 'entregar' }),
    })

    setRastreando(null)
    setPedidos(prev => prev.map(p => p.pedidoId === pedidoId ? { ...p, status: 'entregue' } : p))
  }

  if (!entregadorId) {
    return (
      <div style={{ background: 'var(--background)', minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', fontFamily: 'Archivo, sans-serif' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>🛵</div>
        <h1 style={{ color: 'var(--primary-text)', fontSize: '24px', fontWeight: 700, marginBottom: '8px', textAlign: 'center' }}>Área do Entregador</h1>
        <p style={{ color: 'var(--foreground-secondary)', fontSize: '14px', marginBottom: '32px', textAlign: 'center' }}>Digite seu código de acesso</p>
        <input
          value={inputId}
          onChange={e => setInputId(e.target.value)}
          placeholder="Código do entregador"
          style={{ width: '100%', maxWidth: '320px', padding: '14px 16px', borderRadius: '12px', border: '2px solid var(--surface-secondary)', background: 'var(--surface)', color: 'var(--foreground)', fontSize: '16px', marginBottom: '16px', outline: 'none', boxSizing: 'border-box' }}
        />
        <button
          onClick={() => { if (inputId.trim()) setEntregadorId(inputId.trim()) }}
          style={{ width: '100%', maxWidth: '320px', padding: '14px', borderRadius: '12px', background: 'var(--primary)', color: 'var(--primary-foreground)', fontSize: '16px', fontWeight: 700, border: 'none', cursor: 'pointer' }}
        >
          Entrar
        </button>
      </div>
    )
  }

  return (
    <div style={{ background: 'var(--background)', minHeight: '100dvh', fontFamily: 'Archivo, sans-serif', color: 'var(--foreground)', paddingBottom: '32px' }}>
      {/* Header */}
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--surface-secondary)', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '12px', position: 'sticky', top: 0, zIndex: 10 }}>
        <span style={{ fontSize: '24px' }}>🛵</span>
        <div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--primary-text)' }}>Meus Pedidos</div>
          <div style={{ fontSize: '12px', color: 'var(--foreground-secondary)' }}>ID: {entregadorId}</div>
        </div>
        <button
          onClick={() => buscarPedidos(entregadorId)}
          style={{ marginLeft: 'auto', background: 'var(--surface-secondary)', border: 'none', color: 'var(--foreground)', padding: '8px 14px', borderRadius: '8px', fontSize: '13px', cursor: 'pointer' }}
        >
          Atualizar
        </button>
      </div>

      <div style={{ padding: '20px' }}>
        {erro && (
          <div style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', color: 'var(--danger)', fontSize: '14px' }}>
            {erro}
          </div>
        )}

        {loading && (
          <div style={{ textAlign: 'center', color: 'var(--foreground-secondary)', padding: '40px 0', fontSize: '15px' }}>Carregando pedidos...</div>
        )}

        {!loading && pedidos.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--foreground-secondary)', padding: '60px 0' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>📭</div>
            <div style={{ fontSize: '15px' }}>Nenhum pedido atribuído ainda.</div>
          </div>
        )}

        {pedidos.map(pedido => (
          <div
            key={pedido.pedidoId}
            style={{
              background: 'var(--surface)',
              border: `1px solid ${pedido.status === 'entregue' ? 'var(--success-soft)' : pedido.status === 'em_rota' ? 'var(--surface)' : 'var(--surface-secondary)'}`,
              borderRadius: '14px',
              padding: '18px',
              marginBottom: '16px',
            }}
          >
            {/* Status badge */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, padding: '4px 10px', borderRadius: '20px', background: pedido.status === 'entregue' ? 'var(--success-soft)' : pedido.status === 'em_rota' ? 'var(--surface)' : 'var(--surface-secondary)', color: pedido.status === 'entregue' ? 'var(--success)' : pedido.status === 'em_rota' ? 'var(--primary)' : 'var(--foreground-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {pedido.status === 'entregue' ? '✓ Entregue' : pedido.status === 'em_rota' ? '🛵 Em Rota' : '⏳ Pendente'}
              </span>
              <span style={{ color: 'var(--primary-text)', fontWeight: 700, fontSize: '18px' }}>R$ {pedido.total.toFixed(2).replace('.', ',')}</span>
            </div>

            {/* Cliente */}
            <div style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: '17px', fontWeight: 700, marginBottom: '2px' }}>{pedido.clienteNome}</div>
              <div style={{ color: 'var(--foreground-secondary)', fontSize: '13px' }}>📞 {pedido.clienteTelefone}</div>
            </div>

            {/* Endereço */}
            <div style={{ background: 'var(--surface)', borderRadius: '8px', padding: '10px 12px', marginBottom: '10px' }}>
              <div style={{ color: 'var(--foreground-secondary)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '3px' }}>Endereço</div>
              <div style={{ fontSize: '14px', fontWeight: 500 }}>📍 {pedido.endereco}</div>
            </div>

            {/* Itens */}
            <div style={{ marginBottom: '14px' }}>
              <div style={{ color: 'var(--foreground-secondary)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Itens</div>
              {pedido.itens.map((item, i) => (
                <div key={i} style={{ fontSize: '13px', color: 'var(--foreground)', paddingLeft: '8px', borderLeft: '2px solid var(--surface-elevated)', marginBottom: '3px' }}>{item}</div>
              ))}
            </div>

            {/* Ações */}
            {pedido.status === 'pendente' && (
              <button
                onClick={() => iniciarRastreamento(pedido.pedidoId)}
                style={{ width: '100%', padding: '14px', borderRadius: '10px', background: 'var(--primary)', color: 'var(--primary-foreground)', fontSize: '15px', fontWeight: 700, border: 'none', cursor: 'pointer' }}
              >
                🛵 Iniciar Entrega
              </button>
            )}
            {pedido.status === 'em_rota' && rastreando === pedido.pedidoId && (
              <div>
                <div style={{ background: 'var(--background)', borderRadius: '8px', padding: '8px 12px', marginBottom: '10px', fontSize: '12px', color: 'var(--primary-text)', textAlign: 'center' }}>
                  📡 GPS ativo — transmitindo localização
                </div>
                <button
                  onClick={() => confirmarEntrega(pedido.pedidoId)}
                  style={{ width: '100%', padding: '14px', borderRadius: '10px', background: 'var(--success)', color: 'var(--foreground)', fontSize: '15px', fontWeight: 700, border: 'none', cursor: 'pointer' }}
                >
                  ✓ Confirmar Entrega
                </button>
              </div>
            )}
            {pedido.status === 'em_rota' && rastreando !== pedido.pedidoId && (
              <button
                onClick={() => iniciarRastreamento(pedido.pedidoId)}
                style={{ width: '100%', padding: '14px', borderRadius: '10px', background: 'var(--surface-elevated)', color: 'var(--foreground)', fontSize: '15px', fontWeight: 700, border: 'none', cursor: 'pointer' }}
              >
                Retomar GPS
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
