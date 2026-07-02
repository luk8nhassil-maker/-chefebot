import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { verifyToken } from '@/lib/auth'
import { getMENUDinamico } from '@/lib/menu'
import { PROMOS_KEY, catalogoDoMenu, precoFinalPromocao, validarPromocao, type Promocao } from '@/lib/promocoes'

export const dynamic = 'force-dynamic'

const ROLES_PERMITIDAS = ['admin', 'atendente', 'dev']

async function autorizado(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get('auth-token')?.value
  const payload = token ? await verifyToken(token) : null
  return !!payload && ROLES_PERMITIDAS.includes(payload.role as string)
}

export async function GET(req: NextRequest) {
  if (!(await autorizado(req))) return NextResponse.json({ ok: false, error: 'Nao autorizado' }, { status: 401 })
  try {
    const promos = (await redis.get<Promocao[]>(PROMOS_KEY)) || []
    return NextResponse.json(promos)
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (!(await autorizado(req))) return NextResponse.json({ ok: false, error: 'Nao autorizado' }, { status: 401 })
  try {
    const body = (await req.json()) as Partial<Promocao>
    const menu = await getMENUDinamico()

    // Promoção ativa precisa passar em todas as regras de segurança;
    // rascunho inativo pode ser salvo incompleto.
    if (body.active) {
      const erros = validarPromocao(body, menu as never)
      if (erros.length > 0) return NextResponse.json({ ok: false, erros }, { status: 400 })
    }

    const agora = new Date().toISOString()
    const catalogo = catalogoDoMenu(menu as never)
    const promo: Promocao = {
      id: `promo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      active: !!body.active,
      featured: !!body.featured,
      badge: body.badge || 'PROMO DE HOJE',
      title: body.title || '',
      description: body.description || '',
      buttonText: body.buttonText || 'Pedir essa promoção →',
      type: body.type || 'combo_fixed_price',
      mainItems: Array.isArray(body.mainItems) ? body.mainItems : [],
      freeItems: Array.isArray(body.freeItems) ? body.freeItems : [],
      originalPrice: body.originalPrice,
      promotionalPrice: precoFinalPromocao(body as Promocao, catalogo) ?? body.promotionalPrice,
      discountValue: body.discountValue,
      discountPercent: body.discountPercent,
      includedText: body.includedText || '',
      maxUsesPerOrder: body.maxUsesPerOrder,
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      createdAt: agora,
      updatedAt: agora,
    }

    const promos = (await redis.get<Promocao[]>(PROMOS_KEY)) || []
    await redis.set(PROMOS_KEY, [...promos, promo])
    return NextResponse.json({ ok: true, promo })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
