import { NextResponse } from 'next/server'

// Loja desativada. O pedido agora é feito pelo cardápio (/cardapio).
// Mantemos a rota apenas para responder de forma clara a clientes antigos.
export async function POST() {
  return NextResponse.json(
    { error: 'Loja desativada. Use /cardapio' },
    { status: 410 },
  )
}
