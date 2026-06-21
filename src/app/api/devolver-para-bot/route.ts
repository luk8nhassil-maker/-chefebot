import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { verifyToken } from '@/lib/auth'
import { prepararRetomadaSilenciosa } from '@/lib/bot'
import type { BotSession } from '@/lib/bot'

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
  const sessionKey = `session:${phoneFormatado}`

  // Devolução SILENCIOSA para o bot:
  //  - NÃO envia nenhuma mensagem ao cliente.
  //  - NÃO chama processMessage.
  //  - NÃO reprocessa a última mensagem antiga da cliente.
  // Apenas marca o bot como ativo de novo e arma a retomada. A próxima mensagem
  // real da cliente é que aciona a retomada inteligente (ver /api/whatsapp).
  const session = await redis.get<BotSession>(sessionKey)
  if (session) {
    const sessionAtualizada = prepararRetomadaSilenciosa(session)
    await redis.set(sessionKey, sessionAtualizada, { ex: 1800 })
  }

  // Libera o bot (remove flag de atendimento manual) e arma a retomada pós-handoff.
  await redis.del(`manual:${phoneFormatado}`)
  await redis.del(`resolvendo:${phoneFormatado}`)
  await redis.set(`retomada:${phoneFormatado}`, true, { ex: 1800 })

  return NextResponse.json({ ok: true })
}
