import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'

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

const pedidos: Pedido[] = [
  { id: '1', cliente: 'Ana Lima', telefone: '(86) 99801-1234', itens: ['Pizza Calabresa G', 'Coca 2L'], total: 62.00, status: 'novo', horario: '19:42', endereco: 'Rua das Flores, 210' },
  { id: '2', cliente: 'Carlos Sousa', telefone: '(86) 99700-5678', itens: ['Pizza Frango G', 'Pizza Marguerita M'], total: 89.00, status: 'em_preparo', horario: '19:35', endereco: 'Av. Frei Serafim, 1200' },
  { id: '3', cliente: 'Juliana Costa', telefone: '(86) 98800-9012', itens: ['Pizza 4 Queijos G'], total: 52.00, status: 'saiu_entrega', horario: '19:10', endereco: 'Rua Coelho Rodrigues, 45' },
  { id: '4', cliente: 'Marcos Oliveira', telefone: '(86) 99600-3456', itens: ['Pizza Pepperoni M', 'Suco 1L'], total: 48.00, status: 'entregue', horario: '18:50', endereco: 'Rua Lizandro Nogueira, 88' },
]

function getToken(req: NextRequest) {
  return req.cookies.get('auth-token')?.value ?? null
}

export async function GET(req: NextRequest) {
  const token = getToken(req)
  if (!token) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  const payload = await verifyToken(token)
  if (!payload || !['atendente', 'admin'].includes(payload.role as string)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  return NextResponse.json(pedidos)
}

export async function PATCH(req: NextRequest) {
  const token = getToken(req)
  if (!token) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  const payload = await verifyToken(token)
  if (!payload || !['atendente', 'admin'].includes(payload.role as string)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  const { id, status } = await req.json()
  const pedido = pedidos.find(p => p.id === id)
  if (!pedido) return NextResponse.json({ error: 'Pedido não encontrado' }, { status: 404 })
  pedido.status = status
  return NextResponse.json(pedido)
}