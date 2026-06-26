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

  const { telefone, force } = await req.json()
  if (!telefone) return NextResponse.json({ ok: false, error: 'telefone obrigatório' }, { status: 400 })

  const phone = String(telefone).replace(/\D/g, '')

  // Bloqueia arquivamento silencioso de conversa aguardando Pix, a menos que
  // o cliente confirme explicitamente (force=true vindo da UI após confirm()).
  if (!force) {
    const session = await redis.get<{ step?: string }>(`session:${phone}`)
    if (session?.step === 'aguardando_pix') {
      return NextResponse.json({ ok: false, aviso: 'aguardando_pix' })
    }
  }

  // Remove apenas chaves de estado ativo. Nunca toca conversa_full ou conversa_meta.
  await Promise.all([
    redis.del(`session:${phone}`),
    redis.del(`manual:${phone}`),
    redis.del(`postOrderPriority:${phone}`),
    redis.del(`resolvendo:${phone}`),
    redis.del(`nova_msg_manual:${phone}`),
    redis.del(`conversationAlert:${phone}`),
  ])

  return NextResponse.json({ ok: true })
}
