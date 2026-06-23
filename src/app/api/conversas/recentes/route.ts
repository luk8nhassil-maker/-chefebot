import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { verifyToken } from '@/lib/auth'
import { CONVERSAS_ZSET, type ConversaMeta } from '@/lib/conversasHistorico'
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
    // Prefer permanent ZSET index; fall back to TTL scan if not yet populated
    const phonesFromZset = await redis.zrange<string[]>(CONVERSAS_ZSET, 0, -1, { rev: true })
    let phones: string[]

    if (phonesFromZset.length > 0) {
      phones = phonesFromZset
    } else {
      const chaves = await redis.keys('conversa:*')
      phones = chaves.map(k => k.replace('conversa:', '')).filter(p => p.length >= 8)
    }

    const conversas: ConversaRecente[] = []

    for (const phone of phones) {
      const [meta, session, manualVal] = await Promise.all([
        redis.get<ConversaMeta>(`conversa_meta:${phone}`),
        redis.get<any>(`session:${phone}`),
        redis.get(`manual:${phone}`),
      ])

      const manual = !!manualVal

      let nome: string
      let ultimaMensagem: string
      let ultimaTs: number
      let mensagensCount: number

      if (meta) {
        nome = session?.customerName || meta.nome
        ultimaMensagem = meta.ultimaMensagem
        ultimaTs = meta.ultimaTs
        mensagensCount = meta.mensagensCount
      } else {
        // Fallback: TTL key may still be alive (before first backfill or fresh conversation)
        const msgs = await redis.get<MensagemRelevante[]>(`conversa:${phone}`)
        if (!msgs || msgs.length === 0) continue
        const ultima = msgs[msgs.length - 1]
        nome = session?.customerName || phone
        ultimaMensagem = ultima.texto
        ultimaTs = ultima.ts ?? 0
        mensagensCount = msgs.length
      }

      let status: StatusConversa
      if (manual) {
        status = session?.step === 'escalado' ? 'aguardando' : 'humano'
      } else if (session && !STEPS_BOT_ATIVOS.includes(session.step)) {
        status = 'robo'
      } else {
        status = 'finalizado'
      }

      conversas.push({ phone, nome, ultimaMensagem, ultimaTs, status, mensagensCount })
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
