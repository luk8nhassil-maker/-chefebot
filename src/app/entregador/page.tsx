'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { PedidoEntregador } from '@/types/entregador'

type EstadoAcesso = 'verificando' | 'trocando' | 'autenticado' | 'legado' | 'sem_sessao'
type EntregadorMinimo = { id: string; nome: string }

export default function EntregadorPage() {
  const router = useRouter()
  const [estado, setEstado] = useState<EstadoAcesso>('verificando')
  const [entregador, setEntregador] = useState<EntregadorMinimo | null>(null)
  const entregadorIdLegadoRef = useRef('')
  const entregadorIdLegado = entregadorIdLegadoRef.current
  const [pedidos, setPedidos] = useState<PedidoEntregador[]>([])
  const [loading, setLoading] = useState(false)
  const [reenviando, setReenviando] = useState(false)
  const [mensagemReenvio, setMensagemReenvio] = useState('')
  const [rastreando, setRastreando] = useState<string | null>(null)
  const [erro, setErro] = useState('')
  const watchRef = useRef<number | null>(null)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)

  const buscarPedidos = useCallback(async () => {
    setLoading(true)
    setErro('')
    try {
      const res = await fetch('/api/entregador-pedidos', { cache: 'no-store' })
      if (res.status === 401) {
        setEntregador(null)
        setEstado('sem_sessao')
        setPedidos([])
        return
      }
      if (!res.ok) throw new Error('falha')
      setPedidos(await res.json())
    } catch {
      setErro('Erro ao carregar pedidos. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let ativo = true
    const params = new URLSearchParams(window.location.search)
    const fragmento = new URLSearchParams(window.location.hash.slice(1))
    const acesso = fragmento.get('acesso')
    const acessoQueryInseguro = params.has('acesso')
    const idLegado = params.get('id') || ''
    entregadorIdLegadoRef.current = idLegado

    // Remove o segredo da barra e do histórico antes de qualquer chamada de
    // rede. O valor permanece somente nesta closure durante a troca.
    if (acesso) {
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${window.location.search}`
      )
    }

    async function iniciar() {
      if (acesso) {
        setEstado('trocando')
        try {
          const res = await fetch('/api/entregador/auth/trocar-acesso', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ acesso }),
          })
          const data = await res.json().catch(() => null)
          if (!ativo) return
          if (!res.ok || !data?.entregador) {
            setErro('Este acesso é inválido, expirou ou já foi utilizado.')
            setEstado(idLegado ? 'legado' : 'sem_sessao')
            return
          }
          setEntregador(data.entregador)
          setEstado('autenticado')
          router.replace('/entregador')
          await buscarPedidos()
          return
        } catch {
          if (ativo) {
            setErro('Não foi possível validar o acesso. Tente novamente.')
            setEstado(idLegado ? 'legado' : 'sem_sessao')
          }
          return
        }
      }

      try {
        const res = await fetch('/api/entregador/auth/me', { cache: 'no-store' })
        const data = await res.json().catch(() => null)
        if (!ativo) return
        if (res.ok && data?.entregador) {
          setEntregador(data.entregador)
          setEstado('autenticado')
          if (idLegado) router.replace('/entregador')
          await buscarPedidos()
          return
        }
      } catch {}

      if (acessoQueryInseguro && ativo) {
        setErro('Este acesso é inválido. Solicite um novo link seguro à pizzaria.')
      }
      if (ativo) setEstado(idLegado ? 'legado' : 'sem_sessao')
    }

    void iniciar()
    return () => { ativo = false }
  }, [buscarPedidos, router])

  useEffect(() => () => {
    if (watchRef.current !== null) navigator.geolocation?.clearWatch(watchRef.current)
    if (wakeLockRef.current) void wakeLockRef.current.release().catch(() => {})
  }, [])

  async function ativarWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await (navigator as Navigator & { wakeLock: { request: (type: string) => Promise<WakeLockSentinel> } }).wakeLock.request('screen')
      }
    } catch {}
  }

  function liberarRastreamento() {
    if (watchRef.current !== null) {
      navigator.geolocation.clearWatch(watchRef.current)
      watchRef.current = null
    }
    if (wakeLockRef.current) {
      void wakeLockRef.current.release().catch(() => {})
      wakeLockRef.current = null
    }
    setRastreando(null)
  }

  async function executarAcao(pedidoId: string, acao: 'iniciar' | 'entregar') {
    const res = await fetch('/api/entregador-pedidos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pedidoId, acao }),
    })
    const data = await res.json().catch(() => null)
    if (res.status === 401) {
      liberarRastreamento()
      setEstado('sem_sessao')
      setEntregador(null)
      setPedidos([])
      throw new Error('Sessão expirada')
    }
    if (!res.ok) throw new Error(data?.error || 'Não foi possível atualizar o pedido')
    return data
  }

  async function iniciarRastreamento(pedidoId: string) {
    if (!navigator.geolocation) {
      setErro('GPS não disponível neste dispositivo.')
      return
    }
    setErro('')
    try {
      await executarAcao(pedidoId, 'iniciar')
      await ativarWakeLock()
      setRastreando(pedidoId)
      setPedidos(prev => prev.map(p => p.pedidoId === pedidoId ? { ...p, status: 'em_rota' } : p))

      if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current)
      watchRef.current = navigator.geolocation.watchPosition(
        async (pos) => {
          try {
            const res = await fetch('/api/localizacao', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                pedidoId,
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
              }),
            })
            if (res.status === 401) {
              liberarRastreamento()
              setEstado('sem_sessao')
              setEntregador(null)
              setPedidos([])
            }
          } catch {}
        },
        () => setErro('Não foi possível obter a localização do GPS.'),
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
      )
    } catch (error) {
      setErro(error instanceof Error ? error.message : 'Não foi possível iniciar a entrega.')
    }
  }

  async function confirmarEntrega(pedidoId: string) {
    setErro('')
    try {
      await executarAcao(pedidoId, 'entregar')
      liberarRastreamento()
      setPedidos(prev => prev.map(p => p.pedidoId === pedidoId ? { ...p, status: 'entregue' } : p))
    } catch (error) {
      setErro(error instanceof Error ? error.message : 'Não foi possível confirmar a entrega.')
    }
  }

  async function reenviarAcesso() {
    if (!entregadorIdLegado || reenviando) return
    setReenviando(true)
    setMensagemReenvio('')
    try {
      const res = await fetch('/api/entregador/auth/reenviar-acesso', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entregadorId: entregadorIdLegado }),
      })
      const data = await res.json().catch(() => null)
      setMensagemReenvio(data?.message || 'Se o cadastro estiver ativo, o novo acesso será enviado ao WhatsApp cadastrado.')
    } catch {
      setMensagemReenvio('Se o cadastro estiver ativo, o novo acesso será enviado ao WhatsApp cadastrado.')
    } finally {
      setReenviando(false)
    }
  }

  async function sair() {
    liberarRastreamento()
    await fetch('/api/entregador/auth/logout', { method: 'POST' }).catch(() => null)
    setEntregador(null)
    setPedidos([])
    setEstado('sem_sessao')
  }

  if (estado !== 'autenticado') {
    const trocando = estado === 'verificando' || estado === 'trocando'
    return (
      <div style={{ background: 'var(--background)', minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', fontFamily: 'Archivo, sans-serif' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>🛵</div>
        <h1 style={{ color: 'var(--brand-text)', fontSize: '24px', fontWeight: 700, marginBottom: '8px', textAlign: 'center' }}>Área do Entregador</h1>
        {trocando ? (
          <p style={{ color: 'var(--foreground-secondary)', fontSize: '14px', textAlign: 'center' }}>
            {estado === 'trocando' ? 'Validando seu acesso seguro…' : 'Verificando sua sessão…'}
          </p>
        ) : estado === 'legado' ? (
          <>
            <p style={{ color: 'var(--foreground-secondary)', fontSize: '14px', maxWidth: '360px', lineHeight: 1.5, textAlign: 'center' }}>
              Este link precisa ser atualizado. Enviaremos um novo acesso seguro para o WhatsApp cadastrado.
            </p>
            <button
              onClick={reenviarAcesso}
              disabled={reenviando}
              style={{ width: '100%', maxWidth: '320px', marginTop: '20px', padding: '14px', borderRadius: '12px', background: 'var(--primary)', color: 'var(--primary-foreground)', fontSize: '16px', fontWeight: 700, border: 'none', cursor: 'pointer', opacity: reenviando ? 0.65 : 1 }}
            >
              {reenviando ? 'Solicitando…' : 'Enviar novo acesso'}
            </button>
          </>
        ) : (
          <p style={{ color: 'var(--foreground-secondary)', fontSize: '14px', maxWidth: '360px', lineHeight: 1.5, textAlign: 'center' }}>
            Solicite à pizzaria um novo link seguro para acessar suas entregas.
          </p>
        )}
        {erro && <div style={{ marginTop: '18px', color: 'var(--danger)', fontSize: '14px', textAlign: 'center' }}>{erro}</div>}
        {mensagemReenvio && <div style={{ marginTop: '18px', color: 'var(--success-text)', fontSize: '14px', textAlign: 'center', maxWidth: '360px' }}>{mensagemReenvio}</div>}
      </div>
    )
  }

  return (
    <div style={{ background: 'var(--background)', minHeight: '100dvh', fontFamily: 'Archivo, sans-serif', color: 'var(--foreground)', paddingBottom: '32px' }}>
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--surface-secondary)', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '12px', position: 'sticky', top: 0, zIndex: 10 }}>
        <span style={{ fontSize: '24px' }}>🛵</span>
        <div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--brand-text)' }}>Meus Pedidos</div>
          <div style={{ fontSize: '12px', color: 'var(--foreground-secondary)' }}>{entregador?.nome}</div>
        </div>
        <button onClick={buscarPedidos} style={{ marginLeft: 'auto', background: 'var(--surface-secondary)', border: 'none', color: 'var(--foreground)', padding: '8px 12px', borderRadius: '8px', fontSize: '13px', cursor: 'pointer' }}>Atualizar</button>
        <button onClick={sair} style={{ background: 'transparent', border: '1px solid var(--surface-secondary)', color: 'var(--foreground-secondary)', padding: '8px 12px', borderRadius: '8px', fontSize: '13px', cursor: 'pointer' }}>Sair</button>
      </div>

      <div style={{ padding: '20px' }}>
        {erro && <div style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', color: 'var(--danger)', fontSize: '14px' }}>{erro}</div>}
        {loading && <div style={{ textAlign: 'center', color: 'var(--foreground-secondary)', padding: '40px 0', fontSize: '15px' }}>Carregando pedidos...</div>}
        {!loading && pedidos.length === 0 && <div style={{ textAlign: 'center', color: 'var(--foreground-secondary)', padding: '60px 0' }}><div style={{ fontSize: '48px', marginBottom: '12px' }}>📭</div><div style={{ fontSize: '15px' }}>Nenhum pedido atribuído ainda.</div></div>}

        {pedidos.map(pedido => (
          <div key={pedido.pedidoId} style={{ background: 'var(--surface)', border: `1px solid ${pedido.status === 'entregue' ? 'var(--success-border)' : pedido.status === 'em_rota' ? 'var(--primary)' : 'var(--attention-border)'}`, borderRadius: '14px', padding: '18px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, padding: '4px 10px', borderRadius: '20px', background: pedido.status === 'entregue' ? 'var(--success-surface)' : pedido.status === 'em_rota' ? 'var(--primary-soft)' : 'var(--attention-surface)', color: pedido.status === 'entregue' ? 'var(--success-text)' : pedido.status === 'em_rota' ? 'var(--brand-text)' : 'var(--attention-text)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {pedido.status === 'entregue' ? '✓ Entregue' : pedido.status === 'em_rota' ? '🛵 Em Rota' : '⏳ Pendente'}
              </span>
              <span style={{ color: 'var(--brand-text)', fontWeight: 700, fontSize: '18px' }}>R$ {pedido.total.toFixed(2).replace('.', ',')}</span>
            </div>
            <div style={{ marginBottom: '8px' }}><div style={{ fontSize: '17px', fontWeight: 700, marginBottom: '2px' }}>{pedido.clienteNome}</div><div style={{ color: 'var(--foreground-secondary)', fontSize: '13px' }}>📞 {pedido.clienteTelefone}</div></div>
            <div style={{ background: 'var(--surface)', borderRadius: '8px', padding: '10px 12px', marginBottom: '10px' }}><div style={{ color: 'var(--foreground-secondary)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '3px' }}>Endereço</div><div style={{ fontSize: '14px', fontWeight: 500 }}>📍 {pedido.endereco}</div></div>
            <div style={{ marginBottom: '14px' }}><div style={{ color: 'var(--foreground-secondary)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Itens</div>{pedido.itens.map((item, i) => <div key={i} style={{ fontSize: '13px', color: 'var(--foreground)', paddingLeft: '8px', borderLeft: '2px solid var(--surface-elevated)', marginBottom: '3px' }}>{item}</div>)}</div>
            {pedido.status === 'pendente' && <button onClick={() => iniciarRastreamento(pedido.pedidoId)} style={{ width: '100%', padding: '14px', borderRadius: '10px', background: 'var(--primary)', color: 'var(--primary-foreground)', fontSize: '15px', fontWeight: 700, border: 'none', cursor: 'pointer' }}>🛵 Iniciar Entrega</button>}
            {pedido.status === 'em_rota' && rastreando === pedido.pedidoId && <div><div style={{ background: 'var(--background)', borderRadius: '8px', padding: '8px 12px', marginBottom: '10px', fontSize: '12px', color: 'var(--brand-text)', textAlign: 'center' }}>📡 GPS ativo — transmitindo localização</div><button onClick={() => confirmarEntrega(pedido.pedidoId)} style={{ width: '100%', padding: '14px', borderRadius: '10px', background: 'var(--success)', color: 'var(--foreground)', fontSize: '15px', fontWeight: 700, border: 'none', cursor: 'pointer' }}>✓ Confirmar Entrega</button></div>}
            {pedido.status === 'em_rota' && rastreando !== pedido.pedidoId && <button onClick={() => iniciarRastreamento(pedido.pedidoId)} style={{ width: '100%', padding: '14px', borderRadius: '10px', background: 'var(--surface-elevated)', color: 'var(--foreground)', fontSize: '15px', fontWeight: 700, border: 'none', cursor: 'pointer' }}>Retomar GPS</button>}
          </div>
        ))}
      </div>
    </div>
  )
}
