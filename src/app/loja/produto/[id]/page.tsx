"use client";
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useCart } from '@/lib/cart-context'
import type { CardapioData, ProdutoLoja, TamanhoInfo } from '@/types/loja'

const EMOJI: Record<string, string> = {
  Pizzas: '🍕',
  Lanches: '🍔',
  Bebidas: '🥤',
  Sucos: '🍊',
}

function formatCurrency(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default function ProdutoPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { addItem } = useCart()

  const [data, setData] = useState<CardapioData | null>(null)
  const [produto, setProduto] = useState<ProdutoLoja | null>(null)
  const [loading, setLoading] = useState(true)
  const [tamanho, setTamanho] = useState('M')
  const [borda, setBorda] = useState('')
  const [quantidade, setQuantidade] = useState(1)
  const [observacao, setObservacao] = useState('')
  const [added, setAdded] = useState(false)

  useEffect(() => {
    fetch('/api/loja/cardapio')
      .then(r => r.json())
      .then((cardapio: CardapioData) => {
        const found = cardapio.produtos.find(p => p.id === id) ?? null
        setData(cardapio)
        setProduto(found)
        if (found) {
          if (found.tipo === 'lanche_tamanhos' && found.tamanhos?.length) {
            setTamanho(found.tamanhos[0].code)
          } else if (found.tipo === 'item_simples') {
            setTamanho('')
          }
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [id])

  function computePreco(): number {
    if (!produto || !data) return 0
    if (produto.tipo === 'pizza') {
      const t = data.tamanhosPizza.find(t => t.code === tamanho)
      const pizzaPrice = t?.price ?? 0
      const b = borda ? data.bordas.find(b => b.label === borda) : null
      const bordaPrice = b
        ? (tamanho === 'P' || tamanho === 'M' ? b.priceSmall : b.priceLarge)
        : 0
      return pizzaPrice + bordaPrice
    }
    if (produto.tipo === 'lanche_tamanhos') {
      return produto.tamanhos?.find(t => t.code === tamanho)?.price ?? 0
    }
    return produto.preco
  }

  const precoUnitario = computePreco()
  const total = precoUnitario * quantidade

  function handleAdd() {
    if (!produto) return
    addItem({
      cartId: `${produto.id}-${tamanho}-${borda || 'sem'}`,
      produtoId: produto.id,
      nome: produto.nome,
      tamanho,
      borda: borda || undefined,
      quantidade,
      observacao,
      precoUnitario,
      total,
    })
    setAdded(true)
    setTimeout(() => router.push('/loja/cardapio'), 800)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-red-600 border-t-transparent rounded-full" />
      </div>
    )
  }

  if (!produto) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-4">
        <p className="text-gray-500">Produto não encontrado.</p>
        <Link href="/loja/cardapio" className="text-red-600 font-semibold">
          Voltar ao cardápio
        </Link>
      </div>
    )
  }

  const emoji = EMOJI[produto.categoria] || '🍽️'
  const tamanhos: TamanhoInfo[] =
    produto.tipo === 'pizza'
      ? (data?.tamanhosPizza ?? [])
      : (produto.tamanhos ?? [])

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <div className="bg-red-600 px-4 pt-10 pb-6">
        <Link href="/loja/cardapio" className="text-white/80 mb-4 inline-block">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="flex justify-center mt-2">
          <div className="w-40 h-40 rounded-2xl bg-white/20 flex items-center justify-center text-7xl shadow-xl">
            {emoji}
          </div>
        </div>
      </div>

      {/* Details */}
      <div className="flex-1 px-4 pt-5 pb-6 space-y-5">
        <h1 className="text-2xl font-extrabold text-gray-900">{produto.nome}</h1>

        {/* Size selector — pizza (P/M/G/F) and lanche_tamanhos */}
        {tamanhos.length > 0 && (
          <div>
            <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Tamanho</p>
            <div className={`grid gap-2 ${tamanhos.length === 4 ? 'grid-cols-4' : 'grid-cols-3'}`}>
              {tamanhos.map(t => (
                <button
                  key={t.code}
                  onClick={() => setTamanho(t.code)}
                  className={`flex flex-col items-center py-3 px-2 rounded-xl border-2 transition-all ${
                    tamanho === t.code ? 'border-red-600 bg-red-50' : 'border-gray-200 bg-white'
                  }`}
                >
                  <span className={`text-lg font-extrabold ${tamanho === t.code ? 'text-red-600' : 'text-gray-700'}`}>
                    {t.code}
                  </span>
                  <span className={`text-xs font-medium mt-0.5 ${tamanho === t.code ? 'text-red-500' : 'text-gray-400'}`}>
                    {t.label}
                  </span>
                  <span className={`text-sm font-bold mt-1 ${tamanho === t.code ? 'text-red-600' : 'text-gray-600'}`}>
                    {formatCurrency(t.price)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Borda — pizza only */}
        {produto.tipo === 'pizza' && data && data.bordas.length > 0 && (
          <div>
            <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Borda recheada <span className="normal-case font-normal text-gray-400">(opcional)</span>
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setBorda('')}
                className={`py-2.5 px-3 rounded-xl border-2 text-sm font-semibold transition-all ${
                  borda === '' ? 'border-red-600 bg-red-50 text-red-600' : 'border-gray-200 text-gray-600'
                }`}
              >
                Sem borda
              </button>
              {data.bordas.map(b => {
                const price = tamanho === 'P' || tamanho === 'M' ? b.priceSmall : b.priceLarge
                return (
                  <button
                    key={b.label}
                    onClick={() => setBorda(b.label)}
                    className={`py-2.5 px-3 rounded-xl border-2 text-sm font-semibold transition-all text-left ${
                      borda === b.label ? 'border-red-600 bg-red-50 text-red-600' : 'border-gray-200 text-gray-600'
                    }`}
                  >
                    {b.label}
                    <span className="block text-xs font-normal mt-0.5">+{formatCurrency(price)}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Observations */}
        <div>
          <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Observações <span className="normal-case font-normal text-gray-400">(opcional)</span>
          </p>
          <textarea
            value={observacao}
            onChange={e => setObservacao(e.target.value)}
            placeholder="Ex: sem cebola, bem passado..."
            rows={3}
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-800 placeholder-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm"
          />
        </div>

        {/* Quantity */}
        <div>
          <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Quantidade</p>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setQuantidade(q => Math.max(1, q - 1))}
              className="w-11 h-11 rounded-full border-2 border-gray-200 flex items-center justify-center text-gray-600 text-xl font-bold active:bg-gray-100"
            >
              −
            </button>
            <span className="text-2xl font-bold text-gray-900 w-8 text-center">{quantidade}</span>
            <button
              onClick={() => setQuantidade(q => q + 1)}
              className="w-11 h-11 rounded-full bg-red-600 text-white flex items-center justify-center text-xl font-bold active:bg-red-700"
            >
              +
            </button>
          </div>
        </div>
      </div>

      {/* Add to cart */}
      <div className="px-4 pb-8 pt-2">
        <button
          onClick={handleAdd}
          disabled={added}
          className={`w-full py-4 rounded-2xl font-bold text-lg flex items-center justify-between px-6 transition-all shadow-lg ${
            added
              ? 'bg-green-500 shadow-green-200'
              : 'bg-red-600 hover:bg-red-700 active:bg-red-800 shadow-red-200'
          } text-white`}
        >
          <span>{added ? '✓ Adicionado!' : 'Adicionar ao carrinho'}</span>
          <span>{formatCurrency(total)}</span>
        </button>
      </div>
    </div>
  )
}
