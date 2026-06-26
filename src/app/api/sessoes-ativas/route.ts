import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { verifyToken } from '@/lib/auth'
import { calcularResumoAtendimentoHumano } from '@/lib/resumoAtendimentoHumano'

async function checkAuth(req: NextRequest) {
  const token = req.cookies.get('auth-token')?.value ?? null
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload || !['atendente', 'admin', 'dev'].includes(payload.role as string)) return null
  return payload
}

const STEPS_SEMPRE_IGNORADOS = ['welcome']

const STEP_LABELS: Record<string, string> = {
  name: 'nome',
  returning: 'retorno',
  category: 'categoria',
  size: 'tamanho',
  flavor: 'sabor',
  segundo_sabor: 'segundo sabor',
  border: 'borda',
  border_escolha: 'escolha de borda',
  add_more: 'adicionar mais',
  lanche_escolha: 'escolha de lanche',
  lanche_flavor: 'sabor do lanche',
  lanche_macarronada_size: 'tamanho macarronada',
  bebida_escolha: 'escolha de bebida',
  suco_escolha: 'escolha de suco',
  suco_leite: 'leite no suco',
  consulta_preco: 'consulta de preço',
  consulta_fatias: 'consulta de fatias',
  observacao: 'observação',
  delivery_type: 'tipo de entrega',
  neighborhood: 'bairro',
  confirma_bairro_fuzzy: 'confirmação de bairro',
  confirma_produto_valor: 'confirmação de produto',
  confirma_sabor_ambiguo: 'confirmação de sabor',
  confirma_item_ambiguo: 'confirmação de item',
  address: 'endereço',
  confirm_address: 'confirmar endereço',
  payment: 'pagamento',
  payment_hibrido_valor: 'pagamento híbrido',
  payment_hibrido_complemento: 'complemento pagamento',
  troco: 'troco',
  pedindo_nome: 'pedindo nome',
  confirm: 'confirmação',
  aguardando_pix: 'aguardando Pix',
  escalado: 'atendimento humano',
  confirmando_mudanca: 'mudança de item',
}

export async function GET(req: NextRequest) {
  const auth = await checkAuth(req)
  if (!auth) return NextResponse.json({ ok: false, error: 'Não autorizado' }, { status: 401 })

  try {
    const chaves = await redis.keys('session:*')
    const sessoes = []

    for (const chave of chaves) {
      const phone = chave.replace('session:', '')
      if (!phone || phone.length < 8) continue

      const session = await redis.get<any>(chave)
      if (!session) continue
      if (STEPS_SEMPRE_IGNORADOS.includes(session.step)) continue

      const postOrderPriority = !!(await redis.get(`postOrderPriority:${phone}`))
      // Sessões 'done' só aparecem se houver prioridade pós-pedido.
      if (session.step === 'done' && !postOrderPriority) continue

      const manual = !!(await redis.get(`manual:${phone}`))
      const conversationAlert = !!(await redis.get(`conversationAlert:${phone}`))
      const ultimaMensagem = await redis.get<string>(`ultima_msg:${phone}`)
      const novaMsgManual = manual && !!(await redis.get(`nova_msg_manual:${phone}`))

      const cartResumo = (session.cart || []).map((i: any) => {
        const parts = [i.name]
        if (i.flavor) parts.push(i.flavor)
        if (i.size) parts.push(`(${i.size})`)
        return parts.join(' ')
      })

      const resumoRapido = manual
        ? calcularResumoAtendimentoHumano(session)
        : null

      sessoes.push({
        phone,
        lastDigits: phone.slice(-4),
        step: session.step,
        stepLabel: STEP_LABELS[session.step] ?? session.step,
        cart: cartResumo,
        manual,
        postOrderPriority,
        conversationAlert,
        novaMsgManual,
        ultimaMensagem: ultimaMensagem ?? null,
        customerName: session.customerName ?? null,
        resumoRapido,
      })
    }

    return NextResponse.json(sessoes)
  } catch {
    return NextResponse.json([], { status: 200 })
  }
}
