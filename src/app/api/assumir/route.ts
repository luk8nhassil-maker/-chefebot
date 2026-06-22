import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { verifyToken } from '@/lib/auth'
import { abrirCiclo } from '@/lib/ciclos'

async function checkAuth(req: NextRequest) {
  const token = req.cookies.get('auth-token')?.value ?? null
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload || !['atendente', 'admin', 'dev'].includes(payload.role as string)) return null
  return payload
}

export async function POST(req: NextRequest) {
  const auth = await checkAuth(req)
  if (!auth) return NextResponse.json({ ok: false, error: 'Não autorizado' }, { status: 401 })

  const { telefone } = await req.json()
  if (!telefone) return NextResponse.json({ ok: false, error: 'telefone obrigatório' }, { status: 400 })

  const phone = telefone.replace(/\D/g, '')
  const phoneFormatado = phone.startsWith('55') ? phone : '55' + phone

  await redis.set(`manual:${phoneFormatado}`, true, { ex: 3600 })
  abrirCiclo(phoneFormatado, 'atendente assumiu conversa').catch(() => {})

  return NextResponse.json({ ok: true })
}
