'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type Status = 'novo' | 'em_preparo' | 'saiu_entrega' | 'entregue' | 'cancelado'

type Pedido = {
  id: string
  cliente: string
  telefone: string
  itens: string[]
  total: number
  status: Status
  horario: string
  endereco: string
}

const STATUS_LABEL: Record<Status, string> = {
  novo: '🆕 Novo',
  em_preparo: '🍕 Em preparo',
  saiu_entrega: '🛵 Saiu pra entrega',
  entregue: '✅ Entregue',
  cancelado: '❌ Cancelado',
}

const STATUS_COR: Record<Status, string> = {
  novo: 'bg-yellow-100 text-yellow-800',
  em_preparo: 'bg-orange-100 text-orange-800',
  saiu_entrega: 'bg-blue-100 text-blue-800',
  entregue: 'bg-green-100 text-green-800',
  cancelado: 'bg-red-100 text-red-800',
}

const PROXIMO_STATUS: Record<Status, Status | null> = {
  novo: 'em_preparo',
  em_preparo: 'saiu_entrega',
  saiu_entrega: 'entregue',
  entregue: null,
  cancelado: null,
}

export default function PedidosPage() {
  const router = useRouter()
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [filtro, setFiltro] = useState<Status | 'todos'>('todos')
  const [loading, setLoading] = useState(true)
  const [userName, setUserName] = useState('')
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState('')
  const [erro, setErro] = useState('')
  const [atualizando, setAtualizando] = useState<string | null>(null)

  useEffect(() => {
    const carregarPedidos = () => {
      fetch('/api/orders')
        .then(r => {
          if (r.status === 401) { router.push('/login?callbackUrl=/pedidos'); return null }
          return r.json()
        })
        .then(data => {
          if (data) {
            setPedidos(data)
            setLoading(false)
            setErro('')
            setUltimaAtualizacao(new Date().toLocaleTimeString('pt-BR'))
          }
        })
        .catch(() => setErro('Erro ao carregar pedidos. Tentando novamente...'))
    }

    const cookie = document.cookie.split(';').find(c => c.trim().startsWith('auth-user='))
    if (cookie) {
      try {
        const raw = cookie.split('=').slice(1).join('=')
        const user = JSON.parse(decodeURIComponent(decodeURIComponent(raw)))
        setUserName(user.name || '')
      } catch {}
    }

    carregarPedidos()
    const intervalo = setInterval(carregarPedidos, 30000)
    return () => clearInterval(intervalo)
  }, [router])

  const avancarStatus = async (id: string, novoStatus: Status) => {
  setAtualizando(id)
  const res = await fetch('/api/orders', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, status: novoStatus }),
  })
  if (res.ok) {
    setPedidos(prev => prev.map(p => p.id === id ? { ...p, status: novoStatus } : p))
    setUltimaAtualizacao(new Date().toLocaleTimeString('pt-BR'))
  }
  setAtualizando(null)
}

  const pedidosFiltrados = filtro === 'todos' ? pedidos : pedidos.filter(p => p.status === filtro)
  const ativos = pedidos.filter(p => !['entregue', 'cancelado'].includes(p.status)).length

  return (
    <div className="min-h-screen bg-gray-50">
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
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <p className="text-gray-500">Carregando pedidos...</p>
          </div>
        ) : (
          <>
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-gray-900">📋 Gestão de Pedidos</h1>
              <p className="text-sm text-gray-500">
                {ativos} pedido{ativos !== 1 ? 's' : ''} ativo{ativos !== 1 ? 's' : ''}
                {ultimaAtualizacao && <span className="text-xs text-gray-400"> · atualizado às {ultimaAtualizacao}</span>}
              </p>
            </div>

            <div className="flex gap-2 flex-wrap mb-6">
              {(['todos', 'novo', 'em_preparo', 'saiu_entrega', 'entregue', 'cancelado'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setFiltro(s)}
                  className={`px-3 py-1 rounded-full text-sm font-medium transition-all ${
                    filtro === s ? 'bg-red-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:border-red-300'
                  }`}
                >
                  {s === 'todos' ? `Todos (${pedidos.length})` : STATUS_LABEL[s]}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              {pedidosFiltrados.length === 0 && (
                <div className="text-center py-12 text-gray-400">Nenhum pedido encontrado</div>
              )}
              {pedidosFiltrados.map(pedido => (
                <div key={pedido.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-gray-900">{pedido.cliente}</span>
                        <span className="text-xs text-gray-400">{pedido.horario}</span>
                      </div>
                      <p className="text-sm text-gray-500 mb-1">📱 {pedido.telefone}</p>
                      <p className="text-sm text-gray-500 mb-2">📍 {pedido.endereco}</p>
                      <div className="text-sm text-gray-700 mb-2">
                        {pedido.itens.map((item, i) => <span key={i} className="mr-2">• {item}</span>)}
                      </div>
                      <p className="font-bold text-gray-900">R$ {pedido.total.toFixed(2)}</p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COR[pedido.status]}`}>
                        {STATUS_LABEL[pedido.status]}
                      </span>
                      {PROXIMO_STATUS[pedido.status] && (
  <button
    onClick={() => avancarStatus(pedido.id, PROXIMO_STATUS[pedido.status]!)}
    disabled={atualizando === pedido.id}
    className={`text-xs px-3 py-1 rounded-lg transition-colors ${
      atualizando === pedido.id
        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
        : 'bg-red-600 text-white hover:bg-red-700'
    }`}
  >
    {atualizando === pedido.id ? 'Salvando...' : 'Avançar →'}
  </button>
)}
                      {pedido.status === 'novo' && (
                        <button
                          onClick={() => avancarStatus(pedido.id, 'cancelado')}
                          className="text-xs text-red-400 hover:text-red-600"
                        >
                          Cancelar
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}