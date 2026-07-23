import { NextRequest, NextResponse } from 'next/server'
import { buscarPedidoUnico } from '@/lib/pedidosStore'

type Pedido = {
  id: string
  revision?: number
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

  // Busca única central — nunca escolhe arbitrariamente entre registros
  // duplicados: `multiplos_encontrados` é erro crítico sanitizado (503),
  // nunca expõe qualquer um dos dois como se fosse o pedido certo.
  const resultado = await buscarPedidoUnico<Pedido>(pedidoId)
  if (resultado.tipo === 'leitura_incerta') {
    return NextResponse.json({ error: 'Não foi possível consultar o pedido agora. Tente de novo.' }, { status: 503 })
  }
  if (resultado.tipo === 'multiplos_encontrados') {
    console.error('[ChefeBot] pedido-status: múltiplos pedidos com o mesmo id — inconsistência crítica', { pedidoId })
    return NextResponse.json({ error: 'Não foi possível consultar o pedido agora. Tente de novo.' }, { status: 503 })
  }
  if (resultado.tipo === 'nao_encontrado') {
    return NextResponse.json({ error: 'Pedido não encontrado' }, { status: 404 })
  }

  const p = resultado.pedido
  // Expõe somente campos não-sensíveis (sem cliente, telefone, endereço, pagamento)
  return NextResponse.json({
    numero: p.numero,
    status: p.status,
    tipoEntrega: p.tipoEntrega ?? 'delivery',
    itens: p.itens,
    total: p.total,
  })
}
