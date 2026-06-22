import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { redis } from '@/lib/redis'
import type { BotSession, CartItem, MensagemRelevante } from '@/lib/bot'
import { extrairDaConversa, filtrarMensagensDoCiclo } from '@/lib/pedidoCombinado'
import { obterCicloAtivo, fecharCiclo } from '@/lib/ciclos'

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

  const [session, conversaCompleta, cicloAtivo] = await Promise.all([
    redis.get<BotSession>(`session:${phone}`),
    redis.get<MensagemRelevante[]>(`conversa:${phone}`).then(v => v ?? []),
    obterCicloAtivo(phone),
  ])

  // Filtrar apenas mensagens do ciclo atual (evita contaminação de pedidos antigos)
  const conversa = filtrarMensagensDoCiclo(conversaCompleta, cicloAtivo?.id ?? null)

  // Dados estruturados do bot (fonte primária)
  const cart: CartItem[] = session?.cart ?? []
  const sessionItens = cart.map(formatarItem).filter(Boolean)
  const sessionTotal = cart.reduce((acc, i) => acc + i.price, 0) + (session?.deliveryFee ?? 0)

  const tipoMap: Record<string, 'delivery' | 'retirada' | 'dine_in'> = {
    delivery: 'delivery',
    pickup: 'retirada',
    retirada: 'retirada',
    dine_in: 'dine_in',
  }
  const sessionTipo: 'delivery' | 'retirada' | 'dine_in' | '' = tipoMap[session?.deliveryType ?? ''] ?? ''

  // Extração da conversa como fallback para campos ausentes na sessão
  const extraido = extrairDaConversa(conversa)

  const itens = sessionItens.length > 0 ? sessionItens : extraido.itens
  const tipoEntrega = sessionTipo || extraido.tipoEntrega
  const endereco = session?.address?.trim() || extraido.endereco
  const bairro = session?.neighborhood?.trim() || extraido.bairro
  const pagamento = session?.paymentMethod?.trim() || extraido.pagamento
  const troco = session?.troco?.trim() || extraido.troco

  const rascunho: PedidoCombinadoRascunho = {
    cliente: session?.customerName ?? '',
    telefone: phone,
    tipoEntrega,
    endereco,
    bairro,
    referencia: '',
    itens,
    total: sessionTotal,
    pagamento,
    troco,
    observacao: session?.observacao ?? '',
  }

  const pendencias: string[] = []
  if (!rascunho.cliente.trim()) pendencias.push('Nome do cliente não informado')
  if (rascunho.itens.length === 0) pendencias.push('Nenhum item no pedido')
  if (!rascunho.tipoEntrega) pendencias.push('Tipo de entrega não definido')
  if (rascunho.tipoEntrega === 'delivery' && !rascunho.endereco.trim()) pendencias.push('Endereço de entrega não informado')
  if (rascunho.tipoEntrega === 'delivery' && !rascunho.bairro.trim()) pendencias.push('Bairro não informado')
  if (!rascunho.pagamento.trim()) pendencias.push('Forma de pagamento não informada')

  return NextResponse.json({ rascunho, pendencias, conversa, cicloId: cicloAtivo?.id ?? null })
}

export async function DELETE(req: NextRequest) {
  const auth = await checkAuth(req)
  if (!auth) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })

  const phone = new URL(req.url).searchParams.get('phone')
  if (!phone) return NextResponse.json({ error: 'phone obrigatório' }, { status: 400 })

  // Remove manual flag and session — order was created, conversation is done
  // NEVER sends messages to the client; conversa:{phone} is preserved
  await redis.del(`manual:${phone}`)
  await redis.del(`session:${phone}`)
  fecharCiclo(phone, 'finalizado', 'pedido combinado criado pela atendente').catch(() => {})

  return NextResponse.json({ ok: true })
}
