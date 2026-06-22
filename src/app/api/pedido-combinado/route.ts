import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { redis } from '@/lib/redis'
import type { BotSession, CartItem, MensagemRelevante } from '@/lib/bot'

async function checkAuth(req: NextRequest) {
  const token = req.cookies.get('auth-token')?.value ?? null
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload || !['atendente', 'admin'].includes(payload.role as string)) return null
  return payload
}

function formatarItem(item: CartItem): string {
  const border = item.border && item.border !== 'Sem borda' ? ` + ${item.border}` : ''
  const size = item.size ? ` ${item.size}` : ''
  const flavor = item.flavor ? ` ${item.flavor}` : ''
  return `${item.name}${size}${flavor}${border}`
}

export type PedidoCombinadoRascunho = {
  cliente: string
  telefone: string
  tipoEntrega: 'delivery' | 'retirada' | 'dine_in' | ''
  endereco: string
  bairro: string
  referencia: string
  itens: string[]
  total: number
  pagamento: string
  troco: string
  observacao: string
}

export async function GET(req: NextRequest) {
  const auth = await checkAuth(req)
  if (!auth) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })

  const phone = new URL(req.url).searchParams.get('phone')
  if (!phone) return NextResponse.json({ error: 'phone obrigatório' }, { status: 400 })

  const session = await redis.get<BotSession>(`session:${phone}`)
  const conversa = await redis.get<MensagemRelevante[]>(`conversa:${phone}`) ?? []

  const cart: CartItem[] = session?.cart ?? []
  const itens = cart.map(formatarItem).filter(Boolean)
  const total = cart.reduce((acc, i) => acc + i.price, 0) + (session?.deliveryFee ?? 0)

  const tipoMap: Record<string, 'delivery' | 'retirada' | 'dine_in'> = {
    delivery: 'delivery',
    pickup: 'retirada',
    retirada: 'retirada',
    dine_in: 'dine_in',
  }
  const tipoEntrega: 'delivery' | 'retirada' | 'dine_in' | '' = tipoMap[session?.deliveryType ?? ''] ?? ''

  const rascunho: PedidoCombinadoRascunho = {
    cliente: session?.customerName ?? '',
    telefone: phone,
    tipoEntrega,
    endereco: session?.address ?? '',
    bairro: session?.neighborhood ?? '',
    referencia: '',
    itens,
    total,
    pagamento: session?.paymentMethod ?? '',
    troco: session?.troco ?? '',
    observacao: session?.observacao ?? '',
  }

  const pendencias: string[] = []
  if (!rascunho.cliente.trim()) pendencias.push('Nome do cliente não informado')
  if (rascunho.itens.length === 0) pendencias.push('Nenhum item no pedido')
  if (!rascunho.tipoEntrega) pendencias.push('Tipo de entrega não definido')
  if (rascunho.tipoEntrega === 'delivery' && !rascunho.endereco.trim()) pendencias.push('Endereço de entrega não informado')
  if (!rascunho.pagamento.trim()) pendencias.push('Forma de pagamento não informada')

  return NextResponse.json({ rascunho, pendencias, conversa })
}

export async function DELETE(req: NextRequest) {
  const auth = await checkAuth(req)
  if (!auth) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })

  const phone = new URL(req.url).searchParams.get('phone')
  if (!phone) return NextResponse.json({ error: 'phone obrigatório' }, { status: 400 })

  // Remove manual flag and session — order was created, conversation is done
  // NEVER sends messages to the client
  await redis.del(`manual:${phone}`)
  await redis.del(`session:${phone}`)
  await redis.del(`conversa:${phone}`)

  return NextResponse.json({ ok: true })
}
