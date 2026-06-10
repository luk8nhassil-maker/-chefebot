import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { MENU } from '@/lib/menu'

export async function GET() {
  try {
    const cardapio = await redis.get('cardapio')
    if (cardapio) return NextResponse.json(cardapio)
    return NextResponse.json(MENU)
  } catch {
    return NextResponse.json(MENU)
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