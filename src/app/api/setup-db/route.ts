import { supabase } from '@/lib/supabase'
import { NextResponse } from 'next/server'

const SEED_TENANT = {
  nome: 'Chefe da Pizza',
  cor_primaria: '#DC2626',
  horario: 'Seg-Sex: 18h–23h | Sáb-Dom: 18h–00h',
  endereco: 'Rua das Pizzas, 123 – Centro',
  telefone: '(99) 99999-9999',
}

const SEED_PIZZAS = [
  { nome: 'Margherita', descricao: 'Molho de tomate, mozzarella fresca e manjericão', preco: 35.0, categoria: 'Pizzas' },
  { nome: 'Calabresa', descricao: 'Molho de tomate, mozzarella e calabresa fatiada', preco: 38.0, categoria: 'Pizzas' },
  { nome: 'Frango c/ Catupiry', descricao: 'Molho de tomate, frango desfiado e catupiry cremoso', preco: 42.0, categoria: 'Pizzas' },
  { nome: 'Quatro Queijos', descricao: 'Mozzarella, parmesão, provolone e gorgonzola', preco: 45.0, categoria: 'Pizzas' },
  { nome: 'Pepperoni', descricao: 'Molho de tomate, mozzarella abundante e pepperoni importado', preco: 44.0, categoria: 'Pizzas' },
]

export async function POST() {
  try {
    // Upsert tenant
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .upsert(SEED_TENANT, { onConflict: 'nome' })
      .select()
      .single()

    if (tenantError) {
      return NextResponse.json({ error: `Tenant error: ${tenantError.message}` }, { status: 500 })
    }

    // Insert pizzas
    const pizzas = SEED_PIZZAS.map(p => ({ ...p, tenant_id: tenant.id, ativo: true }))
    const { error: prodError } = await supabase
      .from('produtos')
      .upsert(pizzas, { onConflict: 'nome' })

    if (prodError) {
      return NextResponse.json({ error: `Produtos error: ${prodError.message}` }, { status: 500 })
    }

    return NextResponse.json({ ok: true, tenant })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erro interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function GET() {
  const { data: tenants } = await supabase.from('tenants').select('id, nome').limit(1)
  const { data: produtos, count } = await supabase.from('produtos').select('id', { count: 'exact' }).limit(1)
  return NextResponse.json({ tenants, produtosCount: count })
}
