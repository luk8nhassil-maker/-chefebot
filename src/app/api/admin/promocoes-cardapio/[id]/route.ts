import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { verifyToken } from '@/lib/auth'
import { getMENUDinamico } from '@/lib/menu.server'
import { PROMOS_KEY, catalogoDoMenu, precoFinalPromocao, validarPromocao, type Promocao } from '@/lib/promocoes'

export const dynamic = 'force-dynamic'

const ROLES_PERMITIDAS = ['admin', 'atendente', 'dev']

async function autorizado(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get('auth-token')?.value
  const payload = token ? await verifyToken(token) : null
  return !!payload && ROLES_PERMITIDAS.includes(payload.role as string)
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await autorizado(req))) return NextResponse.json({ ok: false, error: 'Nao autorizado' }, { status: 401 })
  try {
    const { id } = await params
    const body = (await req.json()) as Partial<Promocao>
    const promos = (await redis.get<Promocao[]>(PROMOS_KEY)) || []
    const atual = promos.find((p) => p.id === id)
    if (!atual) return NextResponse.json({ ok: false, error: 'Promoção não encontrada' }, { status: 404 })

    const menu = await getMENUDinamico()
    const catalogo = catalogoDoMenu(menu as never)
    const atualizada: Promocao = {
      ...atual,
      ...body,
      id: atual.id,
      createdAt: atual.createdAt,
      updatedAt: new Date().toISOString(),
    }
    atualizada.promotionalPrice = precoFinalPromocao(atualizada, catalogo) ?? atualizada.promotionalPrice

    if (atualizada.active) {
      const erros = validarPromocao(atualizada, menu as never)
      if (erros.length > 0) return NextResponse.json({ ok: false, erros }, { status: 400 })
    }

    await redis.set(PROMOS_KEY, promos.map((p) => (p.id === id ? atualizada : p)))
    return NextResponse.json({ ok: true, promo: atualizada })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

// Remoção segura: desativa em vez de apagar (histórico preservado e nenhum
// pedido antigo fica órfão de referência).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await autorizado(req))) return NextResponse.json({ ok: false, error: 'Nao autorizado' }, { status: 401 })
  try {
    const { id } = await params
    const promos = (await redis.get<Promocao[]>(PROMOS_KEY)) || []
    if (!promos.some((p) => p.id === id)) return NextResponse.json({ ok: false, error: 'Promoção não encontrada' }, { status: 404 })
    await redis.set(PROMOS_KEY, promos.map((p) => (p.id === id ? { ...p, active: false, updatedAt: new Date().toISOString() } : p)))
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
