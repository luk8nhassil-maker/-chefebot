'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

const FONT = "'Archivo', sans-serif"
const BG = '#060606'
const CARD = '#101010'
const BORDER = '1px solid #1f1d1a'
const TEXT = '#f4f1ec'
const TEXT2 = '#a39b8b'

export default function RelatoriosPage() {
  const router = useRouter()
  const [userName, setUserName] = useState('')

  useEffect(() => {
    const cookie = document.cookie.split(';').find(c => c.trim().startsWith('auth-user='))
    if (cookie) {
      try {
        const raw = cookie.split('=').slice(1).join('=')
        const user = JSON.parse(decodeURIComponent(decodeURIComponent(raw)))
        if (user.role !== 'admin') { router.push('/login?callbackUrl=/relatorios'); return }
        setUserName(user.name || '')
      } catch {
        router.push('/login?callbackUrl=/relatorios')
      }
    } else {
      router.push('/login?callbackUrl=/relatorios')
    }
  }, [router])

  const pedidos = [
    { id: '1', sabor: 'Calabresa', tamanho: 'G', horario: '19:42', bairro: 'Centro', status: 'entregue' },
    { id: '2', sabor: 'Frango c/ Catupiry', tamanho: 'G', horario: '19:35', bairro: 'Centro', status: 'entregue' },
    { id: '3', sabor: 'Portuguesa', tamanho: 'M', horario: '19:35', bairro: 'Centro', status: 'entregue' },
    { id: '4', sabor: '4 Queijos', tamanho: 'G', horario: '19:10', bairro: 'Ilhotas', status: 'entregue' },
    { id: '5', sabor: 'Pepperoni', tamanho: 'M', horario: '18:50', bairro: 'Vermelha', status: 'entregue' },
    { id: '6', sabor: 'Calabresa', tamanho: 'M', horario: '18:30', bairro: 'Centro', status: 'cancelado' },
    { id: '7', sabor: 'Frango c/ Catupiry', tamanho: 'G', horario: '18:10', bairro: 'Ilhotas', status: 'entregue' },
    { id: '8', sabor: 'Baiana', tamanho: 'G', horario: '17:55', bairro: 'Vermelha', status: 'entregue' },
    { id: '9', sabor: 'Marguerita', tamanho: 'M', horario: '17:40', bairro: 'Centro', status: 'entregue' },
    { id: '10', sabor: 'Calabresa', tamanho: 'G', horario: '17:20', bairro: 'Ilhotas', status: 'entregue' },
  ]

  const entregues = pedidos.filter(p => p.status === 'entregue')
  const cancelados = pedidos.filter(p => p.status === 'cancelado')

  const sabores = pedidos.reduce((acc, p) => {
    acc[p.sabor] = (acc[p.sabor] || 0) + 1
    return acc
  }, {} as Record<string, number>)
  const topSabores = Object.entries(sabores).sort((a, b) => b[1] - a[1])

  const bairros = pedidos.reduce((acc, p) => {
    acc[p.bairro] = (acc[p.bairro] || 0) + 1
    return acc
  }, {} as Record<string, number>)
  const topBairros = Object.entries(bairros).sort((a, b) => b[1] - a[1])

  const horas = pedidos.reduce((acc, p) => {
    const hora = p.horario.split(':')[0] + 'h'
    acc[hora] = (acc[hora] || 0) + 1
    return acc
  }, {} as Record<string, number>)
  const topHoras = Object.entries(horas).sort((a, b) => b[1] - a[1])

  const taxaConclusao = Math.round((entregues.length / pedidos.length) * 100)

  return (
    <div style={{ minHeight: '100svh', background: BG, fontFamily: FONT, overflowX: 'hidden', paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)' }}>
      <style>{`@keyframes slideUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }`}</style>

      {/* Header */}
      <div style={{ background: '#0a0a0a', borderBottom: BORDER, padding: '18px 16px', paddingTop: 'calc(env(safe-area-inset-top) + 18px)', position: 'sticky', top: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: '#ff6b00', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>📊</div>
          <div style={{ minWidth: 0 }}>
            <p style={{ color: TEXT, fontSize: 15, fontWeight: 700, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Relatórios</p>
            {userName && <p style={{ color: TEXT2, fontSize: 10, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Olá, {userName}</p>}
          </div>
        </div>
        <button
          onClick={() => fetch('/api/auth/logout', { method: 'POST' }).then(() => router.push('/login'))}
          style={{ background: CARD, border: BORDER, color: TEXT2, borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 12, minHeight: 40, flexShrink: 0, fontFamily: FONT }}
        >
          Sair
        </button>
      </div>

      <div style={{ padding: '16px', maxWidth: 375, margin: '0 auto', width: '100%' }}>

        <div style={{ marginBottom: 20 }}>
          <h1 style={{ color: TEXT, fontSize: 20, fontWeight: 700, margin: '0 0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📊 Relatórios</h1>
          <p style={{ color: TEXT2, fontSize: 12, margin: 0 }}>Análise de hoje</p>
        </div>

        {/* Cards de métricas */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
          {[
            { label: 'Total de pedidos', value: pedidos.length, color: TEXT },
            { label: 'Entregues', value: entregues.length, color: '#4ade80' },
            { label: 'Cancelados', value: cancelados.length, color: '#f87171' },
            { label: 'Taxa de conclusão', value: `${taxaConclusao}%`, color: '#60a5fa' },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background: CARD, border: BORDER, borderRadius: 14, padding: 14 }}>
              <p style={{ color: TEXT2, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</p>
              <p style={{ color, fontSize: 28, fontWeight: 800, margin: 0, letterSpacing: -0.5 }}>{value}</p>
            </div>
          ))}
        </div>

        {/* Sabores mais pedidos */}
        <div style={{ background: CARD, border: BORDER, borderRadius: 14, padding: 16, marginBottom: 12 }}>
          <p style={{ color: TEXT2, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 14px' }}>🍕 Sabores mais pedidos</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {topSabores.map(([sabor, count]) => (
              <div key={sabor} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ color: TEXT, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{sabor}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <div style={{ width: 60, background: '#1a1a1a', borderRadius: 4, height: 6 }}>
                    <div style={{ height: 6, borderRadius: 4, background: '#ff6b00', width: `${(count / pedidos.length) * 100}%` }} />
                  </div>
                  <span style={{ color: TEXT, fontSize: 13, fontWeight: 600, minWidth: 16, textAlign: 'right' }}>{count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Horários de pico */}
        <div style={{ background: CARD, border: BORDER, borderRadius: 14, padding: 16, marginBottom: 12 }}>
          <p style={{ color: TEXT2, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 14px' }}>⏰ Horários de pico</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {topHoras.map(([hora, count]) => (
              <div key={hora} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ color: TEXT, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{hora}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <div style={{ width: 60, background: '#1a1a1a', borderRadius: 4, height: 6 }}>
                    <div style={{ height: 6, borderRadius: 4, background: '#f97316', width: `${(count / pedidos.length) * 100}%` }} />
                  </div>
                  <span style={{ color: TEXT, fontSize: 13, fontWeight: 600, minWidth: 16, textAlign: 'right' }}>{count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bairros */}
        <div style={{ background: CARD, border: BORDER, borderRadius: 14, padding: 16 }}>
          <p style={{ color: TEXT2, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 14px' }}>📍 Bairros que mais pedem</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {topBairros.map(([bairro, count]) => (
              <div key={bairro} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ color: TEXT, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{bairro}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <div style={{ width: 60, background: '#1a1a1a', borderRadius: 4, height: 6 }}>
                    <div style={{ height: 6, borderRadius: 4, background: '#3b82f6', width: `${(count / pedidos.length) * 100}%` }} />
                  </div>
                  <span style={{ color: TEXT, fontSize: 13, fontWeight: 600, minWidth: 16, textAlign: 'right' }}>{count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}
