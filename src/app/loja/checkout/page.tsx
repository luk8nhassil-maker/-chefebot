"use client";
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCart } from '@/lib/cart-context'
import type { BairroInfo } from '@/types/loja'

type TipoEntrega = 'delivery' | 'retirada'
type Pagamento = 'pix' | 'cartao' | 'dinheiro'

function mensagemAmigavel(msg: string): string {
  if (!msg) return 'Erro ao processar pedido. Tente novamente.'
  if (msg.includes('row-level security') || msg.includes('RLS')) return 'Não foi possível salvar o pedido. Tente novamente.'
  if (msg.includes('foreign key') || msg.includes('violates')) return 'Produto inválido. Volte ao cardápio e tente novamente.'
  if (msg.includes('fetch') || msg.includes('network') || msg.includes('Failed')) return 'Sem conexão. Verifique sua internet e tente novamente.'
  if (msg.includes('Dados incompletos')) return 'Preencha todos os campos obrigatórios.'
  return 'Erro ao processar pedido. Tente novamente.'
}

function formatCurrency(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default function CheckoutPage() {
  const router = useRouter()
  const { items, clearCart } = useCart()

  const [nome, setNome] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [endereco, setEndereco] = useState('')
  const [bairro, setBairro] = useState('')
  const [bairros, setBairros] = useState<BairroInfo[]>([])
  const [tipoEntrega, setTipoEntrega] = useState<TipoEntrega>('delivery')
  const [pagamento, setPagamento] = useState<Pagamento>('pix')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')

  const [summary, setSummary] = useState<{ desconto: number; cupom: string; subtotal?: number; total?: number }>({ desconto: 0, cupom: '', subtotal: 0 })

  useEffect(() => {
    try {
      const saved = localStorage.getItem('chefe-cart-summary')
      if (saved) setSummary(JSON.parse(saved))
    } catch {}
  }, [])

  useEffect(() => {
    fetch('/api/loja/cardapio')
      .then(r => r.json())
      .then(d => { if (d.neighborhoods?.length) setBairros(d.neighborhoods) })
      .catch(() => {})
  }, [])

  const subtotal = summary.subtotal ?? summary.total ?? 0
  const taxaEntrega = tipoEntrega === 'retirada' ? 0 : (bairros.find(b => b.nome === bairro)?.fee ?? 0)
  const total = subtotal + taxaEntrega

  useEffect(() => {
    if (items.length === 0 && !enviando) {
      router.replace('/loja/carrinho')
    }
  }, [items, enviando, router])

  async function handleConfirmar() {
    if (!nome.trim()) { setErro('Informe seu nome'); return }
    if (!whatsapp.trim()) { setErro('Informe seu WhatsApp'); return }
    if (tipoEntrega === 'delivery' && !bairro) { setErro('Selecione o bairro de entrega'); return }
    if (tipoEntrega === 'delivery' && !endereco.trim()) { setErro('Informe o endereço de entrega'); return }

    setEnviando(true)
    setErro('')

    try {
      const res = await fetch('/api/pedido-loja', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clienteNome: nome.trim(),
          clienteTelefone: whatsapp.trim(),
          endereco: tipoEntrega === 'delivery' ? endereco.trim() : 'Retirada na loja',
          bairro: tipoEntrega === 'delivery' ? bairro : '',
          tipoEntrega,
          pagamento,
          items,
          total,
          cupom: summary.cupom,
        }),
      })

      const data = await res.json()

      if (!res.ok) throw new Error(data.error || 'Erro ao criar pedido')

      localStorage.setItem('chefe-confirmacao', JSON.stringify({
        ...data.pedido,
        items,
        pagamento,
        tipoEntrega,
        subtotal,
        taxaEntrega,
        bairro: tipoEntrega === 'delivery' ? bairro : '',
      }))
      localStorage.removeItem('chefe-cart-summary')

      clearCart()
      router.push(`/loja/confirmacao?token=${data.pedido.token}`)
    } catch (e: any) {
      setErro(mensagemAmigavel(e.message))
      setEnviando(false)
    }
  }

  const PAGAMENTOS: { key: Pagamento; label: string; icon: string }[] = [
    { key: 'pix', label: 'PIX', icon: '⚡' },
    { key: 'cartao', label: 'Cartão', icon: '💳' },
    { key: 'dinheiro', label: 'Dinheiro', icon: '💵' },
  ]

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white px-4 pt-10 pb-4 sticky top-0 z-20 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <Link href="/loja/carrinho" className="text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-xl font-bold text-gray-900">Finalizar Pedido</h1>
        </div>
      </div>

      <div className="flex-1 px-4 py-4 space-y-4 overflow-y-auto">
        {/* Personal info */}
        <div className="bg-white rounded-2xl p-4 shadow-sm space-y-4">
          <p className="font-semibold text-gray-900">👤 Seus dados</p>

          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">
              Nome completo *
            </label>
            <input
              value={nome}
              onChange={e => setNome(e.target.value)}
              placeholder="João da Silva"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">
              WhatsApp *
            </label>
            <input
              value={whatsapp}
              onChange={e => setWhatsapp(e.target.value)}
              placeholder="(99) 99999-9999"
              type="tel"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
        </div>

        {/* Delivery type */}
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <p className="font-semibold text-gray-900 mb-3">🛵 Tipo de entrega</p>
          <div className="grid grid-cols-2 gap-3">
            {(['delivery', 'retirada'] as TipoEntrega[]).map(tipo => (
              <button
                key={tipo}
                onClick={() => setTipoEntrega(tipo)}
                className={`py-3 rounded-xl border-2 font-semibold capitalize transition-all ${
                  tipoEntrega === tipo
                    ? 'border-red-600 bg-red-50 text-red-600'
                    : 'border-gray-200 text-gray-600'
                }`}
              >
                {tipo === 'delivery' ? '🛵 Delivery' : '🏪 Retirada'}
              </button>
            ))}
          </div>

          {tipoEntrega === 'delivery' && (
            <div className="mt-4 space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">
                  Bairro *
                </label>
                <select
                  value={bairro}
                  onChange={e => setBairro(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-800 focus:outline-none focus:ring-2 focus:ring-red-500 bg-white"
                >
                  <option value="">Selecione o bairro</option>
                  {bairros.map(b => (
                    <option key={b.nome} value={b.nome}>
                      {b.nome} — {b.fee === 0 ? 'Grátis' : `R$ ${b.fee.toFixed(2).replace('.', ',')}`}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">
                  Rua e número *
                </label>
                <input
                  value={endereco}
                  onChange={e => setEndereco(e.target.value)}
                  placeholder="Ex: Rua das Flores, 123"
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
            </div>
          )}
        </div>

        {/* Payment */}
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <p className="font-semibold text-gray-900 mb-3">💳 Forma de pagamento</p>
          <div className="grid grid-cols-3 gap-2">
            {PAGAMENTOS.map(p => (
              <button
                key={p.key}
                onClick={() => setPagamento(p.key)}
                className={`flex flex-col items-center py-3 rounded-xl border-2 transition-all ${
                  pagamento === p.key
                    ? 'border-red-600 bg-red-50'
                    : 'border-gray-200'
                }`}
              >
                <span className="text-xl">{p.icon}</span>
                <span className={`text-xs font-semibold mt-1 ${pagamento === p.key ? 'text-red-600' : 'text-gray-600'}`}>
                  {p.label}
                </span>
              </button>
            ))}
          </div>
          {pagamento === 'pix' && (
            <p className="text-xs text-gray-400 mt-2 text-center">Chave PIX será enviada após confirmação</p>
          )}
        </div>

        {/* Order summary */}
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <p className="font-semibold text-gray-900 mb-3">📋 Resumo do pedido</p>
          <div className="space-y-2">
            {items.map(item => (
              <div key={item.cartId} className="flex justify-between text-sm">
                <span className="text-gray-600 truncate flex-1 mr-2">
                  <span className="font-semibold text-gray-800">{item.quantidade}x</span>{' '}
                  {item.nome}{item.tamanho ? ` (${item.tamanho})` : ''}
                </span>
                <span className="text-gray-800 font-medium shrink-0">{formatCurrency(item.total)}</span>
              </div>
            ))}
            <div className="pt-2 border-t border-gray-100 space-y-1.5 text-sm">
              {summary.desconto > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>Desconto ({(summary.desconto * 100).toFixed(0)}%)</span>
                  <span>−{formatCurrency((summary.subtotal ?? 0) - subtotal)}</span>
                </div>
              )}
              <div className="flex justify-between text-gray-600">
                <span>Subtotal</span>
                <span>{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>Taxa de entrega{bairro ? ` (${bairro})` : ''}</span>
                <span>{tipoEntrega === 'retirada' ? 'Grátis' : taxaEntrega === 0 && !bairro ? 'a definir' : formatCurrency(taxaEntrega)}</span>
              </div>
              <div className="pt-1 border-t border-gray-100 flex justify-between font-bold text-base">
                <span>Total</span>
                <span className="text-red-600">{formatCurrency(total)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Error */}
        {erro && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
            {erro}
          </div>
        )}
      </div>

      {/* Confirm button */}
      <div className="px-4 pb-8 pt-2">
        <button
          onClick={handleConfirmar}
          disabled={enviando}
          className="w-full bg-red-600 disabled:bg-gray-300 text-white py-4 rounded-2xl font-bold text-lg shadow-lg shadow-red-200 active:bg-red-700 flex items-center justify-center gap-2"
        >
          {enviando ? (
            <>
              <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Processando...
            </>
          ) : (
            '✅ Confirmar Pedido'
          )}
        </button>
      </div>
    </div>
  )
}
