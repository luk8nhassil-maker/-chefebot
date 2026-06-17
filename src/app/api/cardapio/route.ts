import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { MENU, getMENUDinamico } from '@/lib/menu'

export async function GET() {
  try {
    const menu = await getMENUDinamico()
    const esgotados = (await redis.get<string[]>('esgotados')) || []
    return NextResponse.json({ ...menu, esgotados })
  } catch {
    return NextResponse.json({ ...MENU, esgotados: [] })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    await redis.set('cardapio', body)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { nome, esgotado } = await req.json()
    if (!nome) return NextResponse.json({ ok: false, error: 'nome obrigatorio' }, { status: 400 })
    const lista = (await redis.get<string[]>('esgotados')) || []
    const nova = esgotado
      ? (lista.includes(nome) ? lista : [...lista, nome])
      : lista.filter((n: string) => n !== nome)
    await redis.set('esgotados', nova)
    return NextResponse.json({ ok: true, esgotados: nova })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
