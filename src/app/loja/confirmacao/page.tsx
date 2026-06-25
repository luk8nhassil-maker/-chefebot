"use client";
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { PedidoConfirmado } from '@/types/loja'

function formatCurrency(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

const PAGAMENTO_LABEL: Record<string, string> = {
  pix: '⚡ PIX',
  cartao: '💳 Cartão',
  dinheiro: '💵 Dinheiro',
}

const ENTREGA_LABEL: Record<string, string> = {
  delivery: '🛵 Delivery (~40 min)',
  retirada: '🏪 Retirada na loja (~20 min)',
}

function ConfirmacaoContent() {
  const params = useSearchParams()
  const token = params.get('token') || '????'
  const [pedido, setPedido] = useState<PedidoConfirmado | null>(null)

  useEffect(() => {
    try {
      const saved = localStorage.getItem('chefe-confirmacao')
      if (saved) setPedido(JSON.parse(saved))
    } catch {}
  }, [])

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Success header */}
      <div className="bg-gradient-to-b from-red-600 to-red-500 text-white px-6 pt-16 pb-10 text-center">
        <div className="w-20 h-20 rounded-full bg-white/20 flex items-center justify-center text-4xl mx-auto mb-4 shadow-lg">
          ✅
        </div>
        <h1 className="text-2xl font-extrabold">Pedido Confirmado!</h1>
        <p className="text-red-100 mt-1">Seu pedido foi recebido com sucesso.</p>

        <div className="mt-5 bg-white/15 rounded-2xl px-6 py-4 inline-block">
          <p className="text-red-100 text-sm font-medium">Código do pedido</p>
          <p className="text-4xl font-black tracking-[0.2em] mt-1">#{token}</p>
        </div>
      </div>

      <div className="flex-1 px-4 py-6 space-y-4">
        {/* Delivery estimate */}
        {pedido && (
          <div className="bg-orange-50 border border-orange-100 rounded-2xl p-4 flex items-center gap-4">
            <span className="text-3xl">⏱️</span>
            <div>
              <p className="font-bold text-gray-900">Previsão de entrega</p>
              <p className="text-gray-600 text-sm mt-0.5">
                {ENTREGA_LABEL[pedido.tipoEntrega] || '~40 min'}
              </p>
            </div>
          </div>
        )}

        {/* Order details */}
        {pedido && (
          <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm space-y-4">
            <p className="font-bold text-gray-900">Detalhes do pedido</p>

            <div className="space-y-2">
              {pedido.items?.map((item, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-gray-600 flex-1 mr-2">
                    <span className="font-semibold text-gray-800">{item.quantidade}x</span>{' '}
                    {item.nome}{item.tamanho ? ` (${item.tamanho})` : ''}
                    {item.observacao && (
                      <span className="text-gray-400 italic"> — {item.observacao}</span>
                    )}
                  </span>
                  <span className="text-gray-800 font-medium shrink-0">{formatCurrency(item.total)}</span>
                </div>
              ))}
              <div className="pt-2 border-t border-gray-100 flex justify-between font-bold">
                <span>Total</span>
                <span className="text-red-600">{formatCurrency(pedido.total)}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm pt-2 border-t border-gray-100">
              <div>
                <p className="text-gray-400 text-xs font-semibold uppercase tracking-wide">Pagamento</p>
                <p className="font-semibold text-gray-800 mt-0.5">{PAGAMENTO_LABEL[pedido.pagamento] || pedido.pagamento}</p>
              </div>
              <div>
                <p className="text-gray-400 text-xs font-semibold uppercase tracking-wide">Entrega</p>
                <p className="font-semibold text-gray-800 mt-0.5 capitalize">{pedido.tipoEntrega}</p>
              </div>
            </div>

            {pedido.pagamento === 'pix' && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 text-sm text-yellow-800">
                ⚡ <strong>PIX:</strong> Aguarde o contato via WhatsApp com a chave de pagamento.
              </div>
            )}
          </div>
        )}

        {/* Contact note */}
        <div className="bg-gray-50 rounded-2xl p-4 text-sm text-gray-500 text-center">
          📱 Você receberá atualizações do seu pedido via WhatsApp.
        </div>
      </div>

      {/* Back to menu */}
      <div className="px-4 pb-8 pt-2">
        <Link
          href="/loja/cardapio"
          className="block w-full bg-red-600 text-white text-center py-4 rounded-2xl font-bold text-lg shadow-lg shadow-red-200 active:bg-red-700"
        >
          🍕 Fazer novo pedido
        </Link>
      </div>
    </div>
  )
}

export default function ConfirmacaoPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-red-600 border-t-transparent rounded-full" />
      </div>
    }>
      <ConfirmacaoContent />
    </Suspense>
  )
}
