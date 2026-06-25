"use client";
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useCart } from '@/lib/cart-context'
import type { Produto } from '@/types/loja'

type Tamanho = 'P' | 'M' | 'G'

const TAMANHOS: { key: Tamanho; label: string; multiplier: number }[] = [
  { key: 'P', label: 'Pequena', multiplier: 0.8 },
  { key: 'M', label: 'Média', multiplier: 1.0 },
  { key: 'G', label: 'Grande', multiplier: 1.3 },
]

function formatCurrency(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default function ProdutoPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { addItem } = useCart()

  const [produto, setProduto] = useState<Produto | null>(null)
  const [loading, setLoading] = useState(true)
  const [tamanho, setTamanho] = useState<Tamanho>('M')
  const [quantidade, setQuantidade] = useState(1)
  const [observacao, setObservacao] = useState('')
  const [added, setAdded] = useState(false)

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('produtos').select('*').eq('id', id).single()
      setProduto(data)
      setLoading(false)
    }
    load()
  }, [id])

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

  const tamanhoInfo = TAMANHOS.find(t => t.key === tamanho)!
  const precoUnitario = Math.round(produto.preco * tamanhoInfo.multiplier * 100) / 100
  const total = precoUnitario * quantidade

  function handleAdd() {
    addItem({
      cartId: `${produto!.id}-${tamanho}-${Date.now()}`,
      produtoId: produto!.id,
      nome: produto!.nome,
      tamanho,
      quantidade,
      observacao,
      precoUnitario,
      total,
    })
    setAdded(true)
    setTimeout(() => router.push('/loja/cardapio'), 800)
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Photo / header */}
      <div className="bg-red-600 px-4 pt-10 pb-6">
        <Link href="/loja/cardapio" className="text-white/80 mb-4 inline-block">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="flex justify-center mt-2">
          {produto.foto_url ? (
            <img
              src={produto.foto_url}
              alt={produto.nome}
              className="w-40 h-40 rounded-2xl object-cover shadow-xl"
            />
          ) : (
            <div className="w-40 h-40 rounded-2xl bg-white/20 flex items-center justify-center text-7xl shadow-xl">
              🍕
            </div>
          )}
        </div>
      </div>

      {/* Details */}
      <div className="flex-1 px-4 pt-5 pb-6 space-y-5">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900">{produto.nome}</h1>
          {produto.descricao && (
            <p className="text-gray-500 mt-1.5 leading-relaxed">{produto.descricao}</p>
          )}
        </div>

        {/* Size selector */}
        <div>
          <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Tamanho</p>
          <div className="grid grid-cols-3 gap-2">
            {TAMANHOS.map(t => {
              const price = Math.round(produto.preco * t.multiplier * 100) / 100
              return (
                <button
                  key={t.key}
                  onClick={() => setTamanho(t.key)}
                  className={`flex flex-col items-center py-3 px-2 rounded-xl border-2 transition-all ${
                    tamanho === t.key
                      ? 'border-red-600 bg-red-50'
                      : 'border-gray-200 bg-white'
                  }`}
                >
                  <span className={`text-lg font-extrabold ${tamanho === t.key ? 'text-red-600' : 'text-gray-700'}`}>
                    {t.key}
                  </span>
                  <span className={`text-xs font-medium mt-0.5 ${tamanho === t.key ? 'text-red-500' : 'text-gray-400'}`}>
                    {t.label}
                  </span>
                  <span className={`text-sm font-bold mt-1 ${tamanho === t.key ? 'text-red-600' : 'text-gray-600'}`}>
                    {formatCurrency(price)}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Observations */}
        <div>
          <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Observações <span className="normal-case font-normal text-gray-400">(opcional)</span>
          </p>
          <textarea
            value={observacao}
            onChange={e => setObservacao(e.target.value)}
            placeholder="Ex: sem cebola, borda recheada..."
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

      {/* Add to cart button */}
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
