import { NextRequest, NextResponse } from 'next/server'
import { Redis } from '@upstash/redis'
import type { PedidoEntregador } from '@/types/entregador'
import { creditarPontosPedidoEntregue } from '@/lib/fidelidade'

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
})

export async function GET(req: NextRequest) {
  const entregadorId = req.nextUrl.searchParams.get('entregadorId')
  if (!entregadorId) {
    return NextResponse.json({ error: 'entregadorId obrigatório' }, { status: 400 })
  }

  const pedidos = await redis.get<PedidoEntregador[]>(`entregador:pedidos:${entregadorId}`) || []
  return NextResponse.json(pedidos)
}

export async function POST(req: NextRequest) {
  const { entregadorId, pedidoId, acao } = await req.json()

  if (!entregadorId || !pedidoId || !acao) {
    return NextResponse.json({ error: 'Campos obrigatórios faltando' }, { status: 400 })
  }

  const pedidos = await redis.get<PedidoEntregador[]>(`entregador:pedidos:${entregadorId}`) || []
  const index = pedidos.findIndex(p => p.pedidoId === pedidoId)

  if (index === -1) {
    return NextResponse.json({ error: 'Pedido não encontrado' }, { status: 404 })
  }

  if (acao === 'iniciar') {
    pedidos[index] = { ...pedidos[index], status: 'em_rota' }
  } else if (acao === 'entregar') {
    pedidos[index] = { ...pedidos[index], status: 'entregue' }

    // Atualiza o pedido principal
    type PedidoMain = { id: string; status: string; telefone?: string; total?: number; taxaEntrega?: number; clienteId?: string }
    const todosPedidos = await redis.get<PedidoMain[]>('pedidos') || []
    const pi = todosPedidos.findIndex(p => p.id === pedidoId)
    if (pi !== -1) {
      todosPedidos[pi] = { ...todosPedidos[pi], status: 'entregue' }
      await redis.set('pedidos', todosPedidos)

      // Fidelidade por pontos: idempotente por pedidoId, isolada em
      // try/catch proprio — falha aqui nunca pode impedir a confirmacao de
      // entrega pelo entregador, que ja foi salva acima.
      try {
        await creditarPontosPedidoEntregue({
          id: todosPedidos[pi].id,
          status: 'entregue',
          telefone: todosPedidos[pi].telefone,
          clienteId: todosPedidos[pi].clienteId,
          total: todosPedidos[pi].total ?? 0,
          taxaEntrega: todosPedidos[pi].taxaEntrega,
        })
      } catch (err) {
        console.error('[ChefeBot] Erro ao creditar pontos de fidelidade (ignorado):', err)
      }
    }
  } else {
    return NextResponse.json({ error: 'acao inválida' }, { status: 400 })
  }

  await redis.set(`entregador:pedidos:${entregadorId}`, pedidos, { ex: 86400 })
  return NextResponse.json({ ok: true, pedido: pedidos[index] })
}
