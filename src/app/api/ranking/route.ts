import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { verifyToken } from '@/lib/auth'

type Pedido = {
  id: string
  itens: string[]
  status: string
  escalonado?: boolean
}

async function checkAuth(req: NextRequest) {
  const token = req.cookies.get('auth-token')?.value
  if (!token) return false
  const user = await verifyToken(token)
  return user?.role === 'admin' || user?.role === 'dev'
}

export async function GET(req: NextRequest) {
  if (!await checkAuth(req)) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })

  const pedidos = await redis.get<Pedido[]>('pedidos') || []
  const pedidosValidos = pedidos.filter(p => !p.escalonado && p.status !== 'cancelado')

  const contagem: Record<string, number> = {}

  for (const pedido of pedidosValidos) {
    for (const itemRaw of pedido.itens) {
      const subitens = itemRaw.includes(',') ? itemRaw.split(',') : [itemRaw]
      for (const item of subitens) {
        const nome = item.trim()
        if (!nome || nome === 'Cliente precisa de atendimento humano') continue
        if (nome.startsWith('Borda')) continue
        if (nome.includes('Coca') || nome.includes('Guarana') || nome.includes('Suco') || nome.includes('Agua') || nome.includes('Cerveja')) continue
        contagem[nome] = (contagem[nome] || 0) + 1
      }
    }
  }

  const ranking = Object.entries(contagem)
    .map(([nome, total]) => ({ nome, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)

  return NextResponse.json(ranking)
}