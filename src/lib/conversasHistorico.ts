import { redis } from './redis'
import type { AutorMensagem, MensagemRelevante } from './bot'

export const CONVERSAS_ZSET = 'conversas:index'
// Histórico permanente: a conversa NUNCA deve expirar nem ser truncada de forma
// destrutiva durante o atendimento. conversa_full/conversa_meta são gravados SEM
// TTL (permanentes). Mantemos um teto de segurança alto só para evitar um único
// valor Redis patológico; 1000 mensagens cobre conversas reais com folga.
// (Para histórico verdadeiramente ilimitado, migrar conversa_full para uma LIST
//  Redis com RPUSH/LRANGE é o próximo passo recomendado — fora do escopo deste fix.)
export const MAX_FULL_MSGS = 1000

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
    // Permanente: sem TTL — o histórico não pode expirar durante/depois do atendimento.
    await redis.set(fullKey, trimmed)

    const meta: ConversaMeta = {
      phone,
      nome,
      ultimaMensagem: texto.slice(0, 200),
      ultimaTs: ts,
      mensagensCount: trimmed.length,
    }
    // Permanente: sem TTL.
    await redis.set(metaKey, meta)
  } catch {
    // best-effort; never propagate error
  }
}
