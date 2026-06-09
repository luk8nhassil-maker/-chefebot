import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { verifyToken } from '@/lib/auth'

type LogEntry = {
  nivel: 'erro' | 'aviso' | 'info'
  mensagem: string
  detalhe?: string
  data: string
}

async function checkDev(req: NextRequest) {
  const token = req.cookies.get('auth-token')?.value
  if (!token) return false
  const user = await verifyToken(token)
  return user?.role === 'dev'
}

export async function GET(req: NextRequest) {
  if (!await checkDev(req)) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
  const logs = await redis.get<LogEntry[]>('system:logs') || []
  return NextResponse.json(logs.slice(-50).reverse())
}

export async function DELETE(req: NextRequest) {
  if (!await checkDev(req)) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
  await redis.del('system:logs')
  return NextResponse.json({ ok: true })
}