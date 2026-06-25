import { supabase } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'

function generateToken(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let token = ''
  for (let i = 0; i < 4; i++) {
    token += chars[Math.floor(Math.random() * chars.length)]
  }
  return token
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { clienteNome, clienteTelefone, endereco, tipoEntrega, pagamento, items, total } = body

    if (!clienteNome || !clienteTelefone || !tipoEntrega || !pagamento || !items?.length) {
      return NextResponse.json({ error: 'Dados incompletos' }, { status: 400 })
    }

    const token = generateToken()

    const { data: tenantRow } = await supabase.from('tenants').select('id').limit(1).single()
    const tenantId = tenantRow?.id

    const { data: pedido, error: pedidoError } = await supabase
      .from('pedidos')
      .insert({
        tenant_id: tenantId,
        cliente_nome: clienteNome,
        cliente_telefone: clienteTelefone,
        endereco: endereco || '',
        tipo_entrega: tipoEntrega,
        pagamento,
        total,
        status: 'novo',
        token,
      })
      .select()
      .single()

    if (pedidoError) {
      return NextResponse.json({ error: pedidoError.message }, { status: 500 })
    }

    const itens = items.map((item: {
      produtoId: string
      quantidade: number
      tamanho: string
      borda?: string
      observacao: string
      precoUnitario: number
    }) => {
      const tamanhoValido = ['P', 'M', 'G'].includes(item.tamanho) ? item.tamanho : null
      const obs = item.borda
        ? `Borda: ${item.borda}${item.observacao ? ` | ${item.observacao}` : ''}`
        : (item.observacao || '')
      return {
        pedido_id: pedido.id,
        produto_id: null,
        quantidade: item.quantidade,
        tamanho: tamanhoValido,
        observacao: obs,
        preco_unitario: item.precoUnitario,
      }
    })

    const { error: itensError } = await supabase.from('itens_pedido').insert(itens)

    if (itensError) {
      return NextResponse.json({ error: itensError.message }, { status: 500 })
    }

    return NextResponse.json({ pedido, token })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erro interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
