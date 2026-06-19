import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

const _rawUrl = process.env.EVOLUTION_API_URL || 'evolution-api-production-8f99.up.railway.app'
const EVOLUTION_BASE = _rawUrl.startsWith('http') ? _rawUrl : `https://${_rawUrl}`
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY!
const EVOLUTION_INSTANCE = 'chefebot'
const TIMEOUT_MS = 15 * 60 * 1000 // 15 minutos
const STEPS_IGNORADOS = ['done', 'escalado', 'confirm', 'welcome']

async function enviarMensagem(phone: string, text: string) {
  try {
    await fetch(`${EVOLUTION_BASE}/message/sendText/${EVOLUTION_INSTANCE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
      body: JSON.stringify({ number: phone, text }),
    })
  } catch {}
}

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const agora = Date.now()
    const resetadas: string[] = []

    // Busca todas as chaves de timestamp de sessão
    const chaves = await redis.keys('session_ts:*')

    for (const chave of chaves) {
      const phone = chave.replace('session_ts:', '')
      const ts = await redis.get<number>(chave)
      if (!ts) continue

      // Verifica se passou do timeout
      if (agora - ts < TIMEOUT_MS) continue

      // Verifica se tem sessão ativa
      const session = await redis.get<any>(`session:${phone}`)
      if (!session) { await redis.del(chave); continue }

      // Não reseta steps que não devem ser resetados
      if (STEPS_IGNORADOS.includes(session.step)) { await redis.del(chave); continue }

      // Reseta a sessão
      await redis.del(`session:${phone}`)
      await redis.del(`session_ts:${phone}`)
      await redis.del(`avaliacao:${phone}`)

      // Avisa o cliente
      await enviarMensagem(phone, `Oi! 😊 Parece que a gente se perdeu por aqui.\n\nQue tal começar um novo pedido? É só me falar seu nome!`)

      resetadas.push(phone)
    }

    return NextResponse.json({ ok: true, resetadas: resetadas.length, phones: resetadas })
  } catch (error) {
    console.error('Erro no cron de sessoes:', error)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}