import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { redis } from '@/lib/redis'
import { mutarPedidos } from '@/lib/pedidosConcorrencia'
import { sanitizarPedidoPixResposta } from '@/lib/pix'

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

  const agora = new Date().toISOString()

  // Protegido pelo lock GLOBAL de "pedidos" (ver
  // src/lib/pedidosConcorrencia.ts): leitura, marcação e escrita sobre um
  // snapshot fresco, dentro do lock — nenhuma chamada externa acontece
  // nesta seção crítica.
  if (id) {
    const resultado = await mutarPedidos<PedidoArquivavel, 'nao_encontrado' | 'ok'>((pedidosFrescos) => {
      const found = pedidosFrescos.find(p => p.id === id)
      if (!found) return { persistir: false, resultado: 'nao_encontrado' }
      const updated = pedidosFrescos.map(p =>
        p.id === id && !p.isArchived
          ? { ...p, isArchived: true, archivedAt: agora, archivedBy: 'manual' as const, archivedReason: 'manual' }
          : p
      )
      return { persistir: true, pedidos: updated, resultado: 'ok' }
    })
    if (resultado === 'nao_encontrado') return NextResponse.json({ error: 'Pedido nao encontrado' }, { status: 404 })
    return NextResponse.json({ ok: true, arquivados: 1 })
  }

  if (todos) {
    const count = await mutarPedidos<PedidoArquivavel, number>((pedidosFrescos) => {
      let count = 0
      const updated = pedidosFrescos.map(p => {
        if (ehArquivavel(p)) {
          count++
          return { ...p, isArchived: true, archivedAt: agora, archivedBy: 'system' as const, archivedReason: 'fim_expediente' }
        }
        return p
      })
      return { persistir: true, pedidos: updated, resultado: count }
    })
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
  return NextResponse.json([...arquivados].reverse().map(sanitizarPedidoPixResposta))
}
