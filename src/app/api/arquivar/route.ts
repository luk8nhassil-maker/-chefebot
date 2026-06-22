import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { redis } from '@/lib/redis'

type PedidoArquivavel = {
  id: string
  status: string
  pagamento?: string
  pixConfirmado?: boolean
  escalonado?: boolean
  isArchived?: boolean
  archivedAt?: string
  archivedBy?: string
  archivedReason?: string
  [key: string]: unknown
}

async function checkAuth(req: NextRequest) {
  const token = req.cookies.get('auth-token')?.value ?? null
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload || !['atendente', 'admin'].includes(payload.role as string)) return null
  return payload
}

// Pedido pode ser arquivado se não foi finalizado (entregue/cancelado) e ainda não está arquivado
function ehArquivavel(p: PedidoArquivavel): boolean {
  if (p.isArchived) return false
  if (['entregue', 'cancelado'].includes(p.status)) return false
  return true
}

// POST /api/arquivar
// Body: { id: string } → arquiva pedido específico
// Body: { todos: true } → arquiva todos os não-resolvidos
export async function POST(req: NextRequest) {
  const auth = await checkAuth(req)
  if (!auth) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })

  const body = await req.json()
  const { id, todos } = body as { id?: string; todos?: boolean }

  const pedidos = (await redis.get<PedidoArquivavel[]>('pedidos')) || []
  const agora = new Date().toISOString()

  if (id) {
    const updated = pedidos.map(p =>
      p.id === id && !p.isArchived
        ? { ...p, isArchived: true, archivedAt: agora, archivedBy: 'manual' as const, archivedReason: 'manual' }
        : p
    )
    const found = pedidos.find(p => p.id === id)
    if (!found) return NextResponse.json({ error: 'Pedido nao encontrado' }, { status: 404 })
    await redis.set('pedidos', updated)
    return NextResponse.json({ ok: true, arquivados: 1 })
  }

  if (todos) {
    let count = 0
    const updated = pedidos.map(p => {
      if (ehArquivavel(p)) {
        count++
        return { ...p, isArchived: true, archivedAt: agora, archivedBy: 'system' as const, archivedReason: 'fim_expediente' }
      }
      return p
    })
    await redis.set('pedidos', updated)
    return NextResponse.json({ ok: true, arquivados: count })
  }

  return NextResponse.json({ error: 'Parametros invalidos' }, { status: 400 })
}

// GET /api/arquivar — retorna todos os pedidos arquivados (para auditoria interna)
export async function GET(req: NextRequest) {
  const auth = await checkAuth(req)
  if (!auth) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })

  const pedidos = (await redis.get<PedidoArquivavel[]>('pedidos')) || []
  const arquivados = pedidos.filter(p => p.isArchived)
  return NextResponse.json([...arquivados].reverse())
}
