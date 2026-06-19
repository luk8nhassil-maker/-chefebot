import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { verifyToken } from '@/lib/auth'
import { retomarFluxoDoBot } from '@/lib/bot'
import type { BotSession } from '@/lib/bot'

const _evUrl = process.env.EVOLUTION_API_URL ?? 'evolution-api-production-8f99.up.railway.app'
const EVOLUTION_BASE = _evUrl.startsWith('http') ? _evUrl : `https://${_evUrl}`

async function checkAuth(req: NextRequest) {
  const token = req.cookies.get('auth-token')?.value ?? null
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload || !['atendente', 'admin', 'dev'].includes(payload.role as string)) return null
  return payload
}

async function enviarMensagem(phone: string, message: string) {
  const url = `${EVOLUTION_BASE}/message/sendText/chefebot`
  const delay = Math.min(Math.max(message.length * 22, 600), 3500)
  await new Promise(r => setTimeout(r, delay))
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: process.env.EVOLUTION_API_KEY! },
    body: JSON.stringify({ number: phone, text: message }),
  })
}

export async function POST(req: NextRequest) {
  const auth = await checkAuth(req)
  if (!auth) return NextResponse.json({ ok: false, error: 'Não autorizado' }, { status: 401 })

  const { telefone } = await req.json()
  if (!telefone) return NextResponse.json({ ok: false, error: 'telefone obrigatório' }, { status: 400 })

  const phone = telefone.replace(/\D/g, '')
  const phoneFormatado = phone.startsWith('55') ? phone : '55' + phone
  const sessionKey = `session:${phoneFormatado}`

  const session = await redis.get<BotSession>(sessionKey)

  // Determina step de retomada e gera mensagens
  const mensagens = session
    ? retomarFluxoDoBot(session)
    : [`Prontinho, voltei por aqui 😊\n\nMe confirma rapidinho: você quer continuar o pedido ou começar de novo?\n\n  1. Continuar pedido\n  2. Começar de novo`]

  // Atualiza sessão: sai de "escalado", volta ao step anterior
  if (session) {
    const stepRetomada = (session.stepAnteriorEscalado ?? session.step) === 'escalado'
      ? 'category'
      : (session.stepAnteriorEscalado ?? session.step)
    const sessionAtualizada: BotSession = {
      ...session,
      step: stepRetomada as BotSession['step'],
      escalado: false,
      stepAnteriorEscalado: undefined,
    }
    await redis.set(sessionKey, sessionAtualizada, { ex: 1800 })
  }

  // Libera o bot (remove flag manual)
  await redis.del(`manual:${phoneFormatado}`)
  await redis.del(`resolvendo:${phoneFormatado}`)

  // Envia mensagens ao cliente
  for (const msg of mensagens) {
    await enviarMensagem(phoneFormatado, msg)
  }

  return NextResponse.json({ ok: true })
}
