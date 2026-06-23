import { NextRequest, NextResponse } from 'next/server'
import { redis } from '@/lib/redis'
import { verifyToken } from '@/lib/auth'
import { CONVERSAS_ZSET, MAX_FULL_MSGS, type ConversaMeta } from '@/lib/conversasHistorico'
import type { MensagemRelevante } from '@/lib/bot'

const META_TTL = 60 * 60 * 24 * 90
const FULL_TTL = 60 * 60 * 24 * 90

async function checkAuth(req: NextRequest) {
  const token = req.cookies.get('auth-token')?.value ?? null
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload || !['admin', 'dev'].includes(payload.role as string)) return null
  return payload
}

export async function POST(req: NextRequest) {
  const auth = await checkAuth(req)
  if (!auth) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  let indexed = 0
  let skipped = 0

  try {
    // Build phone→name map from pedidos (permanent storage)
    const pedidos = (await redis.get<any[]>('pedidos')) ?? []
    const nomeMap: Record<string, string> = {}
    for (const p of pedidos) {
      if (p.telefone && p.cliente) nomeMap[p.telefone] = p.cliente
    }

    // Index all existing conversa:{phone} TTL keys
    const chaves = await redis.keys('conversa:*')
    for (const chave of chaves) {
      const phone = chave.replace('conversa:', '')
      if (!phone || phone.length < 8) { skipped++; continue }

      const msgs = await redis.get<MensagemRelevante[]>(chave)
      if (!msgs || msgs.length === 0) { skipped++; continue }

      const session = await redis.get<{ customerName?: string }>(`session:${phone}`)
      const nome = nomeMap[phone] || session?.customerName || phone

      const ultima = msgs[msgs.length - 1]
      const ts = ultima.ts ?? Date.now()

      await redis.zadd(CONVERSAS_ZSET, { score: ts, member: phone })

      const fullKey = `conversa_full:${phone}`
      const existingFull = (await redis.get<MensagemRelevante[]>(fullKey)) || []
      const merged = [...existingFull]
      for (const msg of msgs) {
        const alreadyExists = merged.some(m => m.ts === msg.ts && m.autor === msg.autor)
        if (!alreadyExists) merged.push(msg)
      }
      merged.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))
      const trimmed = merged.slice(-MAX_FULL_MSGS)
      await redis.set(fullKey, trimmed, { ex: FULL_TTL })

      const meta: ConversaMeta = {
        phone,
        nome,
        ultimaMensagem: ultima.texto.slice(0, 200),
        ultimaTs: ts,
        mensagensCount: trimmed.length,
      }
      await redis.set(`conversa_meta:${phone}`, meta, { ex: META_TTL })

      indexed++
    }

    // Update nome for phones already in meta where nome was falling back to phone number
    for (const [phone, nome] of Object.entries(nomeMap)) {
      const metaKey = `conversa_meta:${phone}`
      const existing = await redis.get<ConversaMeta>(metaKey)
      if (existing && existing.nome === phone) {
        await redis.set(metaKey, { ...existing, nome }, { ex: META_TTL })
      }
    }

    const total = await redis.zcard(CONVERSAS_ZSET)
    return NextResponse.json({ ok: true, indexed, skipped, total })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
