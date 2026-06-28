import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/redis'

type Pedido = {
  id: string
  numero?: number
  status: string
  tipoEntrega?: string
  itens: string[]
  total: number
}

export async function GET(req: NextRequest) {
  const pedidoId = req.nextUrl.searchParams.get('pedidoId')
  if (!pedidoId) {
    return NextResponse.json({ error: 'pedidoId obrigatório' }, { status: 400 })
  }

  const pedidos = (await redis.get<Pedido[]>('pedidos')) || []
  const p = pedidos.find((x) => x.id === pedidoId)
  if (!p) {
    return NextResponse.json({ error: 'Pedido não encontrado' }, { status: 404 })
  }

  // Expõe somente campos não-sensíveis (sem cliente, telefone, endereço, pagamento)
  return NextResponse.json({
    numero: p.numero,
    status: p.status,
    tipoEntrega: p.tipoEntrega ?? 'delivery',
    itens: p.itens,
    total: p.total,
  })
}
