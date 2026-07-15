'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Receipt, ChevronRight, Clock, ChefHat, CheckCircle2, Check, X as XIcon } from 'lucide-react'
import ClientBottomNav from '@/components/ClientBottomNav'
import PixPendenteBar, { usePixPendente } from '@/components/PixPendenteBar'
import { CF_OPEN_CART_KEY } from '@/lib/pedidoAtivoCliente'
import {
  filtrarPedidosPorBusca,
  statusVisualPedido,
  type PedidoClienteResumo,
  type PedidoStatusCor,
} from '@/lib/clientePedidos'

type Tela = 'carregando' | 'ok' | 'erro' | 'sessao_expirada'

const cores = {
  fundo: 'var(--background)',
  cardBg: 'var(--surface)',
  cardBorda: 'var(--border)',
  navy: 'var(--foreground)',
  textoSecundario: 'var(--foreground-secondary)',
  textoTerciario: 'var(--foreground-muted)',
  amarelo: 'var(--primary)',
  amareloTexto: 'var(--primary-foreground)',
}

const ICONE_POR_COR: Record<PedidoStatusCor, typeof Clock> = {
  info: Clock,
  atencao: ChefHat,
  sucesso: CheckCircle2,
  neutro: Check,
  perigo: XIcon,
}

const TOKENS_POR_COR: Record<PedidoStatusCor, { bg: string; fg: string }> = {
  info: { bg: 'var(--info-soft)', fg: 'var(--info-soft-foreground)' },
  atencao: { bg: 'var(--attention-soft)', fg: 'var(--attention-soft-foreground)' },
  sucesso: { bg: 'var(--success-soft)', fg: 'var(--success-soft-foreground)' },
  neutro: { bg: 'var(--surface-secondary)', fg: 'var(--foreground-muted)' },
  perigo: { bg: 'var(--danger-soft)', fg: 'var(--danger-soft-foreground)' },
}

function money(v: number) {
  return `R$ ${v.toFixed(2).replace('.', ',')}`
}

function CardPedido({ p }: { p: PedidoClienteResumo }) {
  const visual = statusVisualPedido(p.status, p.tipoEntrega)
  const Icone = ICONE_POR_COR[visual.cor]
  const tokens = TOKENS_POR_COR[visual.cor]
  const itens = p.itens ?? []
  const preview = itens.slice(0, 3).join(', ') + (itens.length > 3 ? '...' : '')

  return (
    <Link
      href={`/rastrear/${p.id}`}
      style={{
        display: 'block',
        background: cores.cardBg,
        border: `1px solid ${cores.cardBorda}`,
        borderRadius: 16,
        padding: 16,
        textDecoration: 'none',
        color: cores.navy,
        minHeight: 44,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <span
          style={{
            flexShrink: 0,
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: tokens.bg,
            color: tokens.fg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icone size={18} aria-hidden="true" />
        </span>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15, fontWeight: 800 }}>Pedido {p.numero != null ? `#${p.numero}` : `#${p.id}`}</span>
            <span style={{ fontSize: 15, fontWeight: 800, color: cores.navy, whiteSpace: 'nowrap' }}>{money(p.total)}</span>
          </div>
          <div style={{ fontSize: 12.5, color: cores.textoTerciario, marginTop: 2 }}>
            {p.data ?? ''}{p.horario ? ` · ${p.horario}` : ''}
          </div>

          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: tokens.fg }}>{visual.label}</span>
            {visual.descricao && (
              <span style={{ fontSize: 12, color: cores.textoTerciario }}>· {visual.descricao}</span>
            )}
          </div>

          {itens.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12.5, color: cores.textoSecundario, lineHeight: 1.4 }}>
              {preview}
            </div>
          )}
          <div style={{ marginTop: 2, fontSize: 11.5, color: cores.textoTerciario }}>
            {itens.length} {itens.length === 1 ? 'item' : 'itens'}
          </div>
        </div>

        <ChevronRight size={20} color="var(--foreground-muted)" style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
      </div>
    </Link>
  )
}

export default function ClientePedidosPage() {
  const [tela, setTela] = useState<Tela>('carregando')
  const { pendente: pixPendente } = usePixPendente()
  const [pedidos, setPedidos] = useState<PedidoClienteResumo[]>([])
  const [busca, setBusca] = useState('')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const carregar = useCallback(async () => {
    try {
      const res = await fetch('/api/cliente/pedidos', { cache: 'no-store' })
      if (res.status === 401) {
        setTela('sessao_expirada')
        return
      }
      if (!res.ok) {
        setTela('erro')
        return
      }
      const data = await res.json()
      setPedidos(Array.isArray(data.pedidos) ? data.pedidos : [])
      setTela('ok')
    } catch {
      setTela('erro')
    }
  }, [])

  useEffect(() => {
    // Busca inicial ao montar — setState acontece dentro de `carregar`
    // (async), só após a resposta da API, nunca de forma síncrona no corpo
    // do efeito. Mesmo padrão de supressão já usado no repo (ver
    // src/app/cliente/page.tsx) para esse tipo de fetch-on-mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    carregar()
  }, [carregar])

  // Atualiza a cada ~15s só enquanto a aba está visível, e imediatamente ao
  // voltar para ela — nunca dispara fetch com a página oculta.
  useEffect(() => {
    function talvezAtualizar() {
      if (document.visibilityState === 'visible') carregar()
    }
    intervalRef.current = setInterval(talvezAtualizar, 15000)
    document.addEventListener('visibilitychange', talvezAtualizar)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      document.removeEventListener('visibilitychange', talvezAtualizar)
    }
  }, [carregar])

  useEffect(() => {
    if (tela === 'sessao_expirada') {
      window.location.href = '/cliente?next=/cliente/pedidos'
    }
  }, [tela])

  function abrirSacola() {
    try { sessionStorage.setItem(CF_OPEN_CART_KEY, '1') } catch {}
    window.location.href = '/pedido'
  }

  function tentarNovamente() {
    setTela('carregando')
    carregar()
  }

  const filtrados = useMemo(() => filtrarPedidosPorBusca(pedidos, busca), [pedidos, busca])

  return (
    <div style={{ background: cores.fundo, minHeight: '100dvh', fontFamily: 'Archivo, sans-serif', color: cores.navy, display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: cores.cardBg, borderBottom: `1px solid ${cores.cardBorda}`, padding: '16px 20px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <Receipt size={20} color={cores.navy} aria-hidden="true" />
          <div style={{ fontSize: 17, fontWeight: 800, color: cores.navy }}>Meus pedidos</div>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: cores.textoSecundario }}>Acompanhe o status de todos os seus pedidos.</p>
      </div>

      <div
        style={{
          flex: 1,
          padding: '20px 20px calc(env(safe-area-inset-bottom) + 96px)',
          maxWidth: 1180,
          width: '100%',
          margin: '0 auto',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {tela !== 'sessao_expirada' && (
          <div style={{ position: 'relative' }}>
            <svg
              style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
              width="15" height="15" viewBox="0 0 24 24" fill="none"
            >
              <circle cx="11" cy="11" r="7" stroke="var(--foreground-secondary)" strokeWidth="2.2" />
              <path d="M16.5 16.5l3.5 3.5" stroke="var(--foreground-secondary)" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por número, nome ou informação do pedido..."
              aria-label="Buscar pedido"
              style={{
                width: '100%',
                height: 44,
                boxSizing: 'border-box',
                background: 'rgba(var(--overlay-rgb), 0.06)',
                border: 'none',
                borderRadius: 22,
                padding: '0 40px',
                color: cores.navy,
                fontSize: 14,
                fontWeight: 600,
                fontFamily: 'Archivo, sans-serif',
                boxShadow: '0 1px 3px rgba(0,0,0,.12) inset',
                outline: 'none',
              }}
            />
            {busca && (
              <button
                onClick={() => setBusca('')}
                aria-label="Limpar busca"
                style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: cores.textoSecundario, fontSize: 18, lineHeight: 1, padding: 4, cursor: 'pointer' }}
              >×</button>
            )}
          </div>
        )}

        {tela === 'ok' && pedidos.length > 0 && (
          <div style={{ fontSize: 11, fontWeight: 700, color: cores.textoTerciario, textTransform: 'uppercase', letterSpacing: 0.6 }}>
            Seus pedidos
          </div>
        )}

        {tela === 'carregando' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ background: cores.cardBg, border: `1px solid ${cores.cardBorda}`, borderRadius: 16, padding: 16, height: 96, opacity: 0.5 }} />
            ))}
          </div>
        )}

        {tela === 'erro' && (
          <div style={{ background: cores.cardBg, border: `1px solid ${cores.cardBorda}`, borderRadius: 14, padding: 22, textAlign: 'center' }}>
            <p style={{ margin: '0 0 12px', fontSize: 14, color: cores.textoSecundario }}>Não foi possível carregar seus pedidos agora.</p>
            <button
              onClick={tentarNovamente}
              style={{ padding: '10px 18px', borderRadius: 12, background: cores.amarelo, color: cores.amareloTexto, fontSize: 14, fontWeight: 700, border: 'none', cursor: 'pointer', fontFamily: 'Archivo, sans-serif' }}
            >
              Tentar novamente
            </button>
          </div>
        )}

        {tela === 'ok' && pedidos.length === 0 && (
          <div style={{ background: cores.cardBg, border: `1px solid ${cores.cardBorda}`, borderRadius: 14, padding: 28, textAlign: 'center' }}>
            <p style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 700 }}>Você ainda não fez nenhum pedido.</p>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: cores.textoSecundario }}>Quando você fizer seu primeiro pedido, ele aparece aqui.</p>
            <Link
              href="/pedido"
              style={{ display: 'inline-block', padding: '12px 20px', borderRadius: 12, background: cores.amarelo, color: cores.amareloTexto, fontSize: 14, fontWeight: 700, textDecoration: 'none' }}
            >
              Fazer meu primeiro pedido
            </Link>
          </div>
        )}

        {tela === 'ok' && pedidos.length > 0 && filtrados.length === 0 && (
          <div style={{ background: cores.cardBg, border: `1px solid ${cores.cardBorda}`, borderRadius: 14, padding: 24, textAlign: 'center' }}>
            <p style={{ margin: '0 0 12px', fontSize: 14, color: cores.textoSecundario }}>Nenhum pedido encontrado para essa busca.</p>
            <button
              onClick={() => setBusca('')}
              style={{ background: 'none', border: 'none', color: cores.navy, fontWeight: 700, fontSize: 13, cursor: 'pointer', textDecoration: 'underline', fontFamily: 'Archivo, sans-serif' }}
            >
              Limpar busca
            </button>
          </div>
        )}

        {tela === 'ok' && filtrados.length > 0 && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {filtrados.map((p) => (
                <CardPedido key={p.id} p={p} />
              ))}
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: cores.textoTerciario, textAlign: 'center' }}>
              {filtrados.length} {filtrados.length === 1 ? 'pedido encontrado' : 'pedidos encontrados'}
            </p>
          </>
        )}
      </div>

      <PixPendenteBar pendente={pixPendente} />
      <ClientBottomNav active="pedido" onSacolaClick={abrirSacola} pixPendente={!!pixPendente} />
    </div>
  )
}
