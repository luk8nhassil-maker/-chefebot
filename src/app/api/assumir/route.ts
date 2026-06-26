import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { verifyToken } from '@/lib/auth'

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
  await redis.del(`postOrderPriority:${phoneFormatado}`)

  // Renova o TTL da sessão para 3600s (igual ao flag manual).
  // Sem isso, session:{phone} pode expirar antes do atendimento terminar
  // (TTL padrão do bot é 1800s) e a conversa some do Tempo Real.
  const sessaoAtual = await redis.get(`session:${phoneFormatado}`)
  if (sessaoAtual) {
    await redis.set(`session:${phoneFormatado}`, sessaoAtual, { ex: 3600 })
  }

  return NextResponse.json({ ok: true })
}
