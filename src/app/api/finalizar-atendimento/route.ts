import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { verifyToken } from '@/lib/auth'
import { mutarPedidoPorIdAtomico, removerPedidoAtomico } from '@/lib/pedidosStore'

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

  // Busca só para decidir qual dos 3 caminhos seguir (checagem fresca e
  // definitiva de cada um roda de novo dentro da mutação atômica abaixo).
  const pedidos = (await redis.get<Pedido[]>('pedidos')) || []
  const pedido = pedidos.find(p => p.id === id)
  if (!pedido) {
    return NextResponse.json({ ok: false, error: 'Pedido não encontrado' }, { status: 404 })
  }

  const isPedidoEscalonamentoPuro =
    pedido.itens.length === 1 && pedido.itens[0] === 'Cliente precisa de atendimento humano'

  const resultado = isPedidoEscalonamentoPuro
    ? await removerPedidoAtomico<Pedido>(id)
    : await mutarPedidoPorIdAtomico<Pedido>(id, (fresco) =>
        fresco.escalonado
          ? { ...fresco, escalonado: false, horarioEscalonado: undefined }
          : { ...fresco, resolvidoConversas: true }
      )

  if (resultado.tipo === 'nao_encontrado') {
    return NextResponse.json({ ok: false, error: 'Pedido não encontrado' }, { status: 404 })
  }
  if (resultado.tipo !== 'sucesso') {
    return NextResponse.json({ ok: false, error: 'Não foi possível finalizar agora. Tente de novo.' }, { status: 503 })
  }

  // Limpa sessão do bot para re-engajamento futuro. NÃO envia mensagem WhatsApp.
  const phone = telefone.replace(/\D/g, '')
  const phoneFormatado = phone.startsWith('55') ? phone : '55' + phone
  await redis.del(`session:${phoneFormatado}`)
  await redis.del(`manual:${phoneFormatado}`)
  await redis.del(`resolvendo:${phoneFormatado}`)

  return NextResponse.json({ ok: true })
}
