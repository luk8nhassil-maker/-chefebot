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

    // ───────────── [DIAG-TEMP] instrumentação SOMENTE-LEITURA — REMOVER após diagnóstico ─────────────
    // Não altera filtros, retornos nem escreve no Redis. Só observa. Telefone sempre mascarado (4 últimos).
    const diagMask = (p: string) => '…' + p.slice(-4)
    const diagReturned: Array<Record<string, unknown>> = []
    const diagDiscarded: Array<Record<string, unknown>> = []
    // ───────────── [DIAG-TEMP] fim ─────────────

    for (const chave of chaves) {
      const phone = chave.replace('session:', '')
      if (!phone || phone.length < 8) { if (phone) diagDiscarded.push({ phone: diagMask(phone), reason: 'phone_invalido_len_lt_8' }) /* [DIAG-TEMP] */; continue }

      const session = await redis.get<any>(chave)
      if (!session) { diagDiscarded.push({ phone: diagMask(phone), reason: 'session_nula_ou_expirada' }) /* [DIAG-TEMP] */; continue }
      if (STEPS_SEMPRE_IGNORADOS.includes(session.step)) { diagDiscarded.push({ phone: diagMask(phone), reason: 'step_sempre_ignorado', step: session.step }) /* [DIAG-TEMP] */; continue }

      const postOrderPriority = !!(await redis.get(`postOrderPriority:${phone}`))
      const manual = !!(await redis.get(`manual:${phone}`))
      // Sessões 'done' só aparecem se houver prioridade pós-pedido OU se estiverem
      // em atendimento humano (manual=true). Sem a exceção manual, conversas
      // assumidas com step='done' (ex.: pós-pedido que a Kellyne assumiu — assumir
      // apaga postOrderPriority) sumiam do Tempo Real apesar de manual=true.
      if (session.step === 'done' && !postOrderPriority && !manual) { diagDiscarded.push({ phone: diagMask(phone), reason: 'done_sem_manual_nem_postorder', step: session.step, manual, postOrderPriority }) /* [DIAG-TEMP] */; continue }

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

      // ───────────── [DIAG-TEMP] TTLs (leitura) + resumo da sessão RETORNADA — remover depois ─────────────
      const diagTtlSession = await redis.ttl(`session:${phone}`)
      const diagTtlManual = await redis.ttl(`manual:${phone}`)
      const diagTtlUltima = await redis.ttl(`ultima_msg:${phone}`)
      diagReturned.push({ phone: diagMask(phone), step: session.step, manual, postOrderPriority, hasUltimaMsg: !!ultimaMensagem, hasSession: true, ttlSession: diagTtlSession, ttlManual: diagTtlManual, ttlUltimaMsg: diagTtlUltima })
      // ───────────── [DIAG-TEMP] fim ─────────────

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

    // ───────────── [DIAG-TEMP] resumo final no runtime log (console) — remover depois ─────────────
    console.log('[DIAG-SA]', JSON.stringify({
      ts: new Date().toISOString(),
      totalKeysSession: chaves.length,
      returned: diagReturned.length,
      discarded: diagDiscarded.length,
      returnedSessions: diagReturned,
      discardedSessions: diagDiscarded,
    }))
    // ───────────── [DIAG-TEMP] fim ─────────────

    return NextResponse.json(sessoes)
  } catch (e) {
    // [DIAG-TEMP] loga a exceção que hoje é engolida silenciosamente (NÃO muda o retorno: continua [] 200)
    console.error('[DIAG-SA] EXCEPTION', e instanceof Error ? `${e.name}: ${e.message}` : String(e))
    return NextResponse.json([], { status: 200 })
  }
}
