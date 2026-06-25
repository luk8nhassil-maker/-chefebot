"use client";
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCart } from '@/lib/cart-context'

function formatCurrency(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

const CUPONS: Record<string, number> = {
  PIZZA10: 0.10,
  CHEFE20: 0.20,
  PROMO15: 0.15,
}

export default function CarrinhoPage() {
  const router = useRouter()
  const { items, removeItem, updateQuantity, totalPrice } = useCart()
  const [cupom, setCupom] = useState('')
  const [desconto, setDesconto] = useState(0)
  const [cupomErro, setCupomErro] = useState('')
  const [cupomOk, setCupomOk] = useState(false)

  const taxaEntrega = 5.0
  const descontoValor = totalPrice * desconto
  const total = totalPrice - descontoValor + taxaEntrega

  function aplicarCupom() {
    const key = cupom.trim().toUpperCase()
    if (CUPONS[key]) {
      setDesconto(CUPONS[key])
      setCupomOk(true)
      setCupomErro('')
    } else {
      setCupomErro('Cupom inválido ou expirado')
      setCupomOk(false)
      setDesconto(0)
    }
  }

  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center text-center px-6 gap-5">
        <div className="text-6xl">🛒</div>
        <h2 className="text-xl font-bold text-gray-900">Carrinho vazio</h2>
        <p className="text-gray-500">Adicione itens do cardápio para continuar.</p>
        <Link
          href="/loja/cardapio"
          className="bg-red-600 text-white px-8 py-3 rounded-xl font-bold"
        >
          Ver Cardápio
        </Link>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white px-4 pt-10 pb-4 sticky top-0 z-20 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <Link href="/loja/cardapio" className="text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-xl font-bold text-gray-900">Meu Carrinho</h1>
          <span className="ml-auto text-sm text-gray-400">{items.length} {items.length === 1 ? 'item' : 'itens'}</span>
        </div>
      </div>

      <div className="flex-1 px-4 py-4 space-y-3 overflow-y-auto">
        {/* Items */}
        {items.map(item => (
          <div key={item.cartId} className="bg-white rounded-2xl p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {item.tamanho && (
                    <span className="text-sm font-bold bg-red-100 text-red-600 px-2 py-0.5 rounded-full">
                      {item.tamanho}
                    </span>
                  )}
                  <span className="font-bold text-gray-900 truncate">{item.nome}</span>
                </div>
                {item.borda && (
                  <p className="text-xs text-gray-500 mt-0.5">+ Borda {item.borda}</p>
                )}
                {item.observacao && (
                  <p className="text-xs text-gray-400 mt-1 italic">{item.observacao}</p>
                )}
                <p className="text-red-600 font-bold mt-2">{formatCurrency(item.total)}</p>
              </div>
              <button
                onClick={() => removeItem(item.cartId)}
                className="text-gray-300 hover:text-red-500 transition-colors p-1"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Quantity controls */}
            <div className="flex items-center gap-3 mt-3 pt-3 border-t border-gray-100">
              <button
                onClick={() => updateQuantity(item.cartId, item.quantidade - 1)}
                className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center text-gray-600 font-bold active:bg-gray-100"
              >
                −
              </button>
              <span className="text-base font-bold text-gray-900 w-6 text-center">{item.quantidade}</span>
              <button
                onClick={() => updateQuantity(item.cartId, item.quantidade + 1)}
                className="w-8 h-8 rounded-full bg-red-600 text-white flex items-center justify-center font-bold active:bg-red-700"
              >
                +
              </button>
              <span className="ml-auto text-sm text-gray-400">
                {formatCurrency(item.precoUnitario)} /un
              </span>
            </div>
          </div>
        ))}

        {/* Coupon */}
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <p className="text-sm font-semibold text-gray-700 mb-3">🏷️ Cupom de desconto</p>
          <div className="flex gap-2">
            <input
              value={cupom}
              onChange={e => { setCupom(e.target.value); setCupomErro(''); setCupomOk(false); setDesconto(0) }}
              placeholder="PIZZA10"
              className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm uppercase placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            <button
              onClick={aplicarCupom}
              className="bg-gray-900 text-white px-4 py-2.5 rounded-xl text-sm font-semibold active:bg-gray-700"
            >
              Aplicar
            </button>
          </div>
          {cupomErro && <p className="text-red-500 text-xs mt-2">{cupomErro}</p>}
          {cupomOk && (
            <p className="text-green-600 text-xs mt-2 font-medium">
              ✓ Cupom aplicado! {(desconto * 100).toFixed(0)}% de desconto.
            </p>
          )}
        </div>

        {/* Order summary */}
        <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
          <p className="font-semibold text-gray-900">Resumo do pedido</p>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>Subtotal</span>
              <span>{formatCurrency(totalPrice)}</span>
            </div>
            {desconto > 0 && (
              <div className="flex justify-between text-green-600">
                <span>Desconto ({(desconto * 100).toFixed(0)}%)</span>
                <span>−{formatCurrency(descontoValor)}</span>
              </div>
            )}
            <div className="flex justify-between text-gray-600">
              <span>Taxa de entrega</span>
              <span>{formatCurrency(taxaEntrega)}</span>
            </div>
            <div className="flex justify-between font-bold text-gray-900 text-base pt-2 border-t border-gray-100">
              <span>Total</span>
              <span className="text-red-600">{formatCurrency(total)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Checkout button */}
      <div className="px-4 pb-8 pt-2">
        <button
          onClick={() => {
            localStorage.setItem('chefe-cart-summary', JSON.stringify({
              desconto,
              cupom: cupomOk ? cupom.toUpperCase() : '',
              taxaEntrega,
              total,
            }))
            router.push('/loja/checkout')
          }}
          className="w-full bg-red-600 text-white py-4 rounded-2xl font-bold text-lg shadow-lg shadow-red-200 active:bg-red-700 flex items-center justify-between px-6"
        >
          <span>Ir para Checkout</span>
          <span>{formatCurrency(total)}</span>
        </button>
      </div>
    </div>
  )
}
