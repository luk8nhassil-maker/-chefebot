import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { verifyToken } from '@/lib/auth'

type Avaliacao = {
  phone: string
  nota: number
  data: string
}

async function checkAuth(req: NextRequest) {
  const token = req.cookies.get('auth-token')?.value
  if (!token) return false
  const user = await verifyToken(token)
  return user?.role === 'admin' || user?.role === 'dev'
}

export async function GET(req: NextRequest) {
  if (!await checkAuth(req)) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
  const avaliacoes = await redis.get<Avaliacao[]>('avaliacoes') || []
  const total = avaliacoes.length
  const media = total > 0 ? avaliacoes.reduce((s, a) => s + a.nota, 0) / total : 0
  const ultimas = [...avaliacoes].reverse().slice(0, 10)
  return NextResponse.json({ total, media: Math.round(media * 10) / 10, ultimas })
}