import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/redis'

type Custo = {
  id: string
  descricao: string
  valor: number
  categoria: string
  data: string
  mes: string
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const mes = searchParams.get('mes') || new Date().toISOString().slice(0, 7)
    const custos = await redis.get<Custo[]>(`custos:${mes}`) || []
    return NextResponse.json(custos)
  } catch {
    return NextResponse.json([])
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const mes = new Date().toISOString().slice(0, 7)
    const custos = await redis.get<Custo[]>(`custos:${mes}`) || []
    const novo: Custo = {
      id: Date.now().toString(),
      descricao: body.descricao,
      valor: Number(body.valor),
      categoria: body.categoria || 'outros',
      data: new Date().toLocaleDateString('pt-BR'),
      mes,
    }
    await redis.set(`custos:${mes}`, [...custos, novo], { ex: 365 * 24 * 60 * 60 })
    return NextResponse.json({ ok: true, custo: novo })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id, mes } = await req.json()
    const custos = await redis.get<Custo[]>(`custos:${mes}`) || []
    await redis.set(`custos:${mes}`, custos.filter(c => c.id !== id))
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}