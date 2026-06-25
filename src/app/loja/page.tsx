import { redirect } from 'next/navigation'

// Loja desativada: o pedido agora é feito pelo cardápio.
export default function LojaPage() {
  redirect('/cardapio')
}
