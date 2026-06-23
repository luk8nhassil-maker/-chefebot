import { redis } from './redis'
import type { AutorMensagem, MensagemRelevante } from './bot'

export const CONVERSAS_ZSET = 'conversas:index'
const META_TTL = 60 * 60 * 24 * 90
const FULL_TTL = 60 * 60 * 24 * 90
export const MAX_FULL_MSGS = 200

export type ConversaMeta = {
  phone: string
  nome: string
  ultimaMensagem: string
  ultimaTs: number
  mensagensCount: number
}

export async function atualizarHistorico(
  phone: string,
  autor: AutorMensagem,
  texto: string,
  ts: number,
  nomeCliente?: string,
): Promise<void> {
  if (!phone || !texto) return
  try {
    await redis.zadd(CONVERSAS_ZSET, { score: ts, member: phone })

    const metaKey = `conversa_meta:${phone}`
    const existing = await redis.get<ConversaMeta>(metaKey)

    let nome = nomeCliente || existing?.nome
    if (!nome) {
      const session = await redis.get<{ customerName?: string }>(`session:${phone}`)
      nome = session?.customerName || phone
    }

    const fullKey = `conversa_full:${phone}`
    const full = (await redis.get<MensagemRelevante[]>(fullKey)) || []
    full.push({ autor, texto: texto.slice(0, 400), ts })
    const trimmed = full.slice(-MAX_FULL_MSGS)
    await redis.set(fullKey, trimmed, { ex: FULL_TTL })

    const meta: ConversaMeta = {
      phone,
      nome,
      ultimaMensagem: texto.slice(0, 200),
      ultimaTs: ts,
      mensagensCount: trimmed.length,
    }
    await redis.set(metaKey, meta, { ex: META_TTL })
  } catch {
    // best-effort; never propagate error
  }
}
