import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { redis } from '@/lib/redis'

type Status = 'novo' | 'em_preparo' | 'saiu_entrega' | 'entregue' | 'cancelado'

type Pedido = {
  id: string
  cliente: string
  telefone: string
  itens: string[]
  total: number
  status: Status
  horario: string
  endereco: string
}

const PEDIDOS_INICIAIS: Pedido[] = [
  { id: '1', cliente: 'Ana Lima', telefone: '(86) 99801-1234', itens: ['Pizza Calabresa G', 'Borda Catupiry G', 'Coca 2L'], total: 72.00, status: 'entregue', horario: '19:42', endereco: 'Rua Lizandro Nogueira, 210 — Centro' },
  { id: '2', cliente: 'Carlos Sousa', telefone: '(86) 99700-5678', itens: ['Pizza Frango c/ Catupiry G', 'Pizza Portuguesa M'], total: 90.00, status: 'entregue', horario: '19:35', endereco: 'Av. Frei Serafim, 1200 — Centro' },
  { id: '3', cliente: 'Juliana Costa', telefone: '(86) 98800-9012', itens: ['Pizza 4 Queijos G', 'Borda Chocolate G'], total: 62.00, status: 'entregue', horario: '19:10', endereco: 'Rua Coelho Rodrigues, 45 — Ilhotas' },
  { id: '4', cliente: 'Marcos Oliveira', telefone: '(86) 99600-3456', itens: ['Pizza Pepperoni M', 'Suco de Laranja 1L'], total: 52.00, status: 'entregue', horario: '18:50', endereco: 'Rua Gabriel Ferreira, 88 — Vermelha' },
]

async function getPedidos(): Promise<Pedido[]> {
  const data = await redis.get<Pedido[]>('pedidos')
  if (!data) {
    await redis.set('pedidos', PEDIDOS_INICIAIS)
    return PEDIDOS_INICIAIS
  }
  return data
}

async function checkAuth(req: NextRequest) {
  const token = req.cookies.get('auth-token')?.value ?? null
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload || !['atendente', 'admin'].includes(payload.role as string)) return null
  return payload
}

export async function GET(req: NextRequest) {
  const auth = await checkAuth(req)
  if (!auth) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  const pedidos = await getPedidos()
  return NextResponse.json([...pedidos].reverse())
}

export async function PATCH(req: NextRequest) {
  const auth = await checkAuth(req)
  if (!auth) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  const { id, status } = await req.json()
  const pedidos = await getPedidos()
  const index = pedidos.findIndex(p => p.id === id)
  if (index === -1) return NextResponse.json({ error: 'Pedido não encontrado' }, { status: 404 })
  pedidos[index] = { ...pedidos[index], status }
  await redis.set('pedidos', pedidos)
  return NextResponse.json(pedidos[index])
}