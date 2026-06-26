import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { verifyToken } from '@/lib/auth'
import { calcularResumoAtendimentoHumano } from '@/lib/resumoAtendimentoHumano'
import { montarSessaoManualMinima } from '@/lib/sessaoTempoReal'
import type { ConversaMeta } from '@/lib/conversasHistorico'

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
    const phonesIncluidos = new Set<string>() // dedup: nunca duplicar uma conversa

    for (const chave of chaves) {
      const phone = chave.replace('session:', '')
      if (!phone || phone.length < 8) continue

      const session = await redis.get<any>(chave)
      if (!session) continue
      if (STEPS_SEMPRE_IGNORADOS.includes(session.step)) continue

      const postOrderPriority = !!(await redis.get(`postOrderPriority:${phone}`))
      const manual = !!(await redis.get(`manual:${phone}`))
      // Sessões 'done' só aparecem se houver prioridade pós-pedido OU se estiverem
      // em atendimento humano (manual=true). Sem a exceção manual, conversas
      // assumidas com step='done' (ex.: pós-pedido que a Kellyne assumiu — assumir
      // apaga postOrderPriority) sumiam do Tempo Real apesar de manual=true.
      if (session.step === 'done' && !postOrderPriority && !manual) continue

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

      phonesIncluidos.add(phone)
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

    // ── Atendimento humano SEM session: garantir visibilidade no Tempo Real ──
    // Regra estrutural: enquanto manual:{phone} === true, a conversa NÃO pode
    // sumir, mesmo que session:{phone} tenha expirado/sido removida. Reconstrói
    // uma sessão mínima só para o painel (sem inventar carrinho/Pix/pedido).
    const chavesManual = await redis.keys('manual:*')
    for (const chaveM of chavesManual) {
      const phone = chaveM.replace('manual:', '')
      if (!phone || phone.length < 8) continue
      if (phonesIncluidos.has(phone)) continue // dedup com a passada de session:*

      const manual = !!(await redis.get(`manual:${phone}`))
      if (!manual) continue

      const meta = await redis.get<ConversaMeta>(`conversa_meta:${phone}`)
      const ultimaMensagem =
        (await redis.get<string>(`ultima_msg:${phone}`)) ?? meta?.ultimaMensagem ?? null
      const conversationAlert = !!(await redis.get(`conversationAlert:${phone}`))
      const novaMsgManual = !!(await redis.get(`nova_msg_manual:${phone}`))

      phonesIncluidos.add(phone)
      sessoes.push(
        montarSessaoManualMinima(phone, {
          ultimaMensagem,
          customerName: meta?.nome ?? null,
          conversationAlert,
          novaMsgManual,
        }),
      )
    }

    return NextResponse.json(sessoes)
  } catch {
    return NextResponse.json([], { status: 200 })
  }
}
