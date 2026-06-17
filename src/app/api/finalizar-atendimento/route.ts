import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { verifyToken } from '@/lib/auth'

type Pedido = {
  id: string
  telefone: string
  itens: string[]
  status: string
  escalonado?: boolean
  horarioEscalonado?: number
  resolvidoConversas?: boolean
  [key: string]: unknown
}

async function checkAuth(req: NextRequest) {
  const token = req.cookies.get('auth-token')?.value ?? null
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload || !['atendente', 'admin', 'dev'].includes(payload.role as string)) return null
  return payload
}

export async function POST(req: NextRequest) {
  const auth = await checkAuth(req)
  if (!auth) return NextResponse.json({ ok: false, error: 'Não autorizado' }, { status: 401 })

  const { id, telefone } = await req.json()
  if (!id || !telefone) {
    return NextResponse.json({ ok: false, error: 'id e telefone obrigatórios' }, { status: 400 })
  }

  const pedidos = (await redis.get<Pedido[]>('pedidos')) || []
  const idx = pedidos.findIndex(p => p.id === id)
  if (idx === -1) {
    return NextResponse.json({ ok: false, error: 'Pedido não encontrado' }, { status: 404 })
  }

  const pedido = pedidos[idx]
  const isPedidoEscalonamentoPuro =
    pedido.itens.length === 1 && pedido.itens[0] === 'Cliente precisa de atendimento humano'

  let novosPedidos: Pedido[]

  if (isPedidoEscalonamentoPuro) {
    // Ticket puro de escalamento — pode deletar
    novosPedidos = pedidos.filter(p => p.id !== id)
  } else if (pedido.escalonado) {
    // Pedido real da fila (escalonado) — remove flag escalonado, mantém pedido no fluxo
    novosPedidos = pedidos.map(p =>
      p.id === id ? { ...p, escalonado: false, horarioEscalonado: undefined } : p
    )
  } else {
    // Pedido da seção "Em atendimento hoje" (não escalonado) — apenas marca como resolvido
    // na visão de conversas, sem alterar status do pedido e sem enviar mensagem
    novosPedidos = pedidos.map(p =>
      p.id === id ? { ...p, resolvidoConversas: true } : p
    )
  }

  await redis.set('pedidos', novosPedidos)

  // Limpa sessão do bot para re-engajamento futuro. NÃO envia mensagem WhatsApp.
  const phone = telefone.replace(/\D/g, '')
  const phoneFormatado = phone.startsWith('55') ? phone : '55' + phone
  await redis.del(`session:${phoneFormatado}`)
  await redis.del(`manual:${phoneFormatado}`)
  await redis.del(`resolvendo:${phoneFormatado}`)

  return NextResponse.json({ ok: true })
}
