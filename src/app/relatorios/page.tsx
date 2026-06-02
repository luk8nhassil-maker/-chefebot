'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

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
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">🍕</span>
          <span className="font-bold text-gray-900">ChefBot</span>
        </div>
        {userName && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">Olá, <strong>{userName}</strong></span>
            <button
              onClick={() => fetch('/api/auth/logout', { method: 'POST' }).then(() => router.push('/login'))}
              className="text-sm text-gray-400 hover:text-gray-600"
            >
              Sair
            </button>
          </div>
        )}
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">📊 Relatórios</h1>
          <p className="text-sm text-gray-500">Análise de hoje</p>
        </div>

        {/* Cards de métricas */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs text-gray-500 mb-1">Total de pedidos</p>
            <p className="text-3xl font-bold text-gray-900">{pedidos.length}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs text-gray-500 mb-1">Entregues</p>
            <p className="text-3xl font-bold text-green-600">{entregues.length}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs text-gray-500 mb-1">Cancelados</p>
            <p className="text-3xl font-bold text-red-500">{cancelados.length}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs text-gray-500 mb-1">Taxa de conclusão</p>
            <p className="text-3xl font-bold text-blue-600">{taxaConclusao}%</p>
          </div>
        </div>

        {/* Sabores mais pedidos */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 mb-4">
          <h2 className="font-semibold text-gray-900 mb-3">🍕 Sabores mais pedidos</h2>
          <div className="space-y-2">
            {topSabores.map(([sabor, count]) => (
              <div key={sabor} className="flex items-center justify-between">
                <span className="text-sm text-gray-700">{sabor}</span>
                <div className="flex items-center gap-2">
                  <div className="w-24 bg-gray-100 rounded-full h-2">
                    <div
                      className="bg-red-500 h-2 rounded-full"
                      style={{ width: `${(count / pedidos.length) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium text-gray-900 w-4">{count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Horários de pico */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 mb-4">
          <h2 className="font-semibold text-gray-900 mb-3">⏰ Horários de pico</h2>
          <div className="space-y-2">
            {topHoras.map(([hora, count]) => (
              <div key={hora} className="flex items-center justify-between">
                <span className="text-sm text-gray-700">{hora}</span>
                <div className="flex items-center gap-2">
                  <div className="w-24 bg-gray-100 rounded-full h-2">
                    <div
                      className="bg-orange-400 h-2 rounded-full"
                      style={{ width: `${(count / pedidos.length) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium text-gray-900 w-4">{count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bairros */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <h2 className="font-semibold text-gray-900 mb-3">📍 Bairros que mais pedem</h2>
          <div className="space-y-2">
            {topBairros.map(([bairro, count]) => (
              <div key={bairro} className="flex items-center justify-between">
                <span className="text-sm text-gray-700">{bairro}</span>
                <div className="flex items-center gap-2">
                  <div className="w-24 bg-gray-100 rounded-full h-2">
                    <div
                      className="bg-blue-400 h-2 rounded-full"
                      style={{ width: `${(count / pedidos.length) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium text-gray-900 w-4">{count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}