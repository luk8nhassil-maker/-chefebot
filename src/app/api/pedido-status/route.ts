import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { derivarEstadoPagamentoPixCliente } from '@/lib/pixCardapio'

type Pedido = {
  id: string
  numero?: number
  status: string
  tipoEntrega?: string
  itens: string[]
  total: number
  statusToken?: string
  pixConfirmado?: boolean
  pix?: { status?: string; confirmadoPor?: string }
}

export async function GET(req: NextRequest) {
  const pedidoId = req.nextUrl.searchParams.get('pedidoId')
  const token = req.nextUrl.searchParams.get('token')
  if (!pedidoId) {
    return NextResponse.json({ error: 'pedidoId obrigatório' }, { status: 400 })
  }

  const pedidos = (await redis.get<Pedido[]>('pedidos')) || []
  const p = pedidos.find((x) => x.id === pedidoId)
  if (!p) {
    return NextResponse.json({ error: 'Pedido não encontrado' }, { status: 404 })
  }

  // Estado de pagamento Pix: exposto SOMENTE com o token gerado na criação do
  // pedido (só quem criou o pedido o recebeu). Token errado/ausente não é erro:
  // devolve o status básico de sempre, sem o bloco pix — mantém o /rastrear
  // funcionando por id, como antes.
  const tokenValido = !!token && !!p.statusToken && token === p.statusToken
  const estadoPix = tokenValido ? derivarEstadoPagamentoPixCliente(p) : undefined

  // Expõe somente campos não-sensíveis (sem cliente, telefone, endereço, pagamento)
  return NextResponse.json({
    numero: p.numero,
    status: p.status,
    tipoEntrega: p.tipoEntrega ?? 'delivery',
    itens: p.itens,
    total: p.total,
    ...(estadoPix
      ? {
          pix: {
            estado: estadoPix,
            ...(estadoPix === 'pago' && p.pix?.confirmadoPor ? { confirmadoPor: p.pix.confirmadoPor } : {}),
          },
        }
      : {}),
  })
}
