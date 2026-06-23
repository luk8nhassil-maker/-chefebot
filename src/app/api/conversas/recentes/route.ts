import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { verifyToken } from '@/lib/auth'
import type { MensagemRelevante } from '@/lib/bot'

async function checkAuth(req: NextRequest) {
  const token = req.cookies.get('auth-token')?.value ?? null
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload || !['atendente', 'admin', 'dev'].includes(payload.role as string)) return null
  return payload
}

export type StatusConversa = 'aguardando' | 'humano' | 'robo' | 'finalizado'

export type ConversaRecente = {
  phone: string
  nome: string
  ultimaMensagem: string
  ultimaTs: number
  status: StatusConversa
  mensagensCount: number
}

const STATUS_ORDER: Record<StatusConversa, number> = {
  aguardando: 0,
  humano: 1,
  robo: 2,
  finalizado: 3,
}

const STEPS_BOT_ATIVOS = ['done', 'welcome']

export async function GET(req: NextRequest) {
  const auth = await checkAuth(req)
  if (!auth) return NextResponse.json({ ok: false, error: 'Não autorizado' }, { status: 401 })

  try {
    const chaves = await redis.keys('conversa:*')
    const conversas: ConversaRecente[] = []

    for (const chave of chaves) {
      const phone = chave.replace('conversa:', '')
      if (!phone || phone.length < 8) continue

      const msgs = await redis.get<MensagemRelevante[]>(chave)
      if (!msgs || msgs.length === 0) continue

      const ultima = msgs[msgs.length - 1]
      const session = await redis.get<any>(`session:${phone}`)
      const manual = !!(await redis.get(`manual:${phone}`))

      let status: StatusConversa
      if (manual) {
        // manual flag + escalado step = waiting in queue; otherwise human is handling
        status = session?.step === 'escalado' ? 'aguardando' : 'humano'
      } else if (session && !STEPS_BOT_ATIVOS.includes(session.step)) {
        status = 'robo'
      } else {
        status = 'finalizado'
      }

      conversas.push({
        phone,
        nome: session?.customerName || phone,
        ultimaMensagem: ultima.texto,
        ultimaTs: ultima.ts ?? 0,
        status,
        mensagensCount: msgs.length,
      })
    }

    conversas.sort((a, b) => {
      const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
      if (byStatus !== 0) return byStatus
      return b.ultimaTs - a.ultimaTs
    })

    return NextResponse.json(conversas)
  } catch {
    return NextResponse.json([], { status: 200 })
  }
}
