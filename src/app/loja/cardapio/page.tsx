"use client";
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useCart } from '@/lib/cart-context'
import type { ProdutoLoja, CardapioData } from '@/types/loja'

const CATEGORIAS = ['Pizzas', 'Lanches', 'Bebidas', 'Sucos'] as const
type Categoria = typeof CATEGORIAS[number]

const EMOJI: Record<Categoria, string> = {
  Pizzas: '🍕',
  Lanches: '🍔',
  Bebidas: '🥤',
  Sucos: '🍊',
}

function formatCurrency(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function ProductCard({ produto }: { produto: ProdutoLoja }) {
  const emoji = EMOJI[produto.categoria as Categoria] || '🍽️'
  const priceLabel =
    produto.tipo === 'item_simples'
      ? formatCurrency(produto.preco)
      : `A partir de ${formatCurrency(produto.preco)}`

  return (
    <Link href={`/loja/produto/${produto.id}`} className="block">
      <div className="flex items-center gap-4 bg-white border border-gray-100 rounded-2xl p-4 shadow-sm active:bg-gray-50 transition-colors">
        <div className="w-16 h-16 rounded-xl bg-red-50 flex items-center justify-center text-3xl shrink-0">
          {emoji}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-gray-900">{produto.nome}</h3>
          <p className="text-red-600 font-bold mt-1">{priceLabel}</p>
        </div>
        <div className="w-9 h-9 rounded-full bg-red-600 text-white flex items-center justify-center text-xl font-bold shrink-0 shadow-md shadow-red-200">
          +
        </div>
      </div>
    </Link>
  )
}

export default function CardapioPage() {
  const [categoria, setCategoria] = useState<Categoria>('Pizzas')
  const [data, setData] = useState<CardapioData | null>(null)
  const [loading, setLoading] = useState(true)
  const { totalItems, totalPrice } = useCart()

  useEffect(() => {
    fetch('/api/loja/cardapio')
      .then(r => r.json())
      .then((d: CardapioData) => {
        setData(d)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const filtrados = data?.produtos.filter(p => p.categoria === categoria) ?? []

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col pb-24">
      {/* Header */}
      <div className="bg-red-600 text-white px-4 pt-10 pb-4 sticky top-0 z-30 shadow-md">
        <div className="flex items-center gap-3 mb-4">
          <Link href="/loja" className="text-white/80">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-xl font-bold">Cardápio</h1>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
          {CATEGORIAS.map(cat => (
            <button
              key={cat}
              onClick={() => setCategoria(cat)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-colors ${
                categoria === cat
                  ? 'bg-white text-red-600'
                  : 'bg-red-700/50 text-white/90'
              }`}
            >
              {EMOJI[cat]} {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Product list */}
      <div className="flex-1 px-4 py-4 space-y-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 bg-white rounded-2xl animate-pulse" />
          ))
        ) : filtrados.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">{EMOJI[categoria]}</p>
            <p className="text-gray-400 font-medium">Nenhum produto disponível</p>
          </div>
        ) : (
          filtrados.map(p => <ProductCard key={p.id} produto={p} />)
        )}
      </div>

      {/* Floating cart bar */}
      {totalItems > 0 && (
        <div className="fixed bottom-4 left-4 right-4 max-w-md mx-auto z-40">
          <Link
            href="/loja/carrinho"
            className="flex items-center justify-between bg-red-600 text-white px-5 py-4 rounded-2xl shadow-xl shadow-red-300 w-full"
          >
            <span className="flex items-center gap-2 font-semibold">
              🛒 Ver carrinho
              <span className="bg-white text-red-600 text-xs font-bold px-2 py-0.5 rounded-full">
                {totalItems}
              </span>
            </span>
            <span className="font-bold">{formatCurrency(totalPrice)}</span>
          </Link>
        </div>
      )}
    </div>
  )
}
