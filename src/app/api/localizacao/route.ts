import { NextRequest, NextResponse } from 'next/server'
import { Redis } from '@upstash/redis'
import type { LocalizacaoEntregador } from '@/types/entregador'

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
})

export async function POST(req: NextRequest) {
  const { entregadorId, pedidoId, lat, lng } = await req.json()

  if (!entregadorId || !pedidoId || lat == null || lng == null) {
    return NextResponse.json({ error: 'Campos obrigatórios faltando' }, { status: 400 })
  }

  const localizacao: LocalizacaoEntregador = {
    entregadorId,
    pedidoId,
    lat,
    lng,
    timestamp: Date.now(),
  }

  await redis.set(`loc:${pedidoId}`, localizacao, { ex: 7200 })
  return NextResponse.json({ ok: true })
}

export async function GET(req: NextRequest) {
  const pedidoId = req.nextUrl.searchParams.get('pedidoId')
  if (!pedidoId) {
    return NextResponse.json({ error: 'pedidoId obrigatório' }, { status: 400 })
  }

  const loc = await redis.get<LocalizacaoEntregador>(`loc:${pedidoId}`)
  if (!loc) {
    return NextResponse.json({ error: 'Localização não encontrada' }, { status: 404 })
  }

  return NextResponse.json(loc)
}
