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

function normalizarNomeItem(nome: string): string {
  // Remove tamanhos do nome para agrupar corretamente
  return nome
    .replace(/\b(Pizza\s+)?(P|M|G|F|Pequena|Media|Grande|Familia)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isPizzaValida(nome: string): boolean {
  if (!nome) return false
  if (nome === 'Cliente precisa de atendimento humano') return false
  if (nome.startsWith('Borda')) return false
  if (/^(Coca|Guarana|Suco|Agua|Cerveja|Pepsi|Refrigerante|Vitamina)/i.test(nome)) return false
  if (nome.includes('indefinida')) return false
  if (nome.length < 3) return false
  return true
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
        if (!isPizzaValida(nome)) continue
        const nomeNormalizado = normalizarNomeItem(nome)
        if (!nomeNormalizado || nomeNormalizado.length < 3) continue
        contagem[nomeNormalizado] = (contagem[nomeNormalizado] || 0) + 1
      }
    }
  }

  const ranking = Object.entries(contagem)
    .map(([nome, total]) => ({ nome, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)

  return NextResponse.json(ranking)
}