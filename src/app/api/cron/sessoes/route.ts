import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { enviarTextoWhatsApp } from "@/lib/whatsappMensagem";

const TIMEOUT_MS = 15 * 60 * 1000 // 15 minutos
const STEPS_IGNORADOS = ['done', 'escalado', 'confirm', 'welcome']

type SessaoComStep = {
  step: string
}

async function enviarMensagem(phone: string, text: string) {
  try {
    await enviarTextoWhatsApp(phone, text, { prioridade: 'promocional', maxAttempts: 1 })
  } catch {}
}

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    // Rotina legada de retomada: com o bot pausado, não apaga sessões nem
    // dispara convites para começar outro pedido.
    if (await redis.get<boolean>('bot_ativo') === false) {
      return NextResponse.json({ ok: true, skipped: true, motivo: 'bot_pausado' })
    }
    const agora = Date.now()
    const resetadas: string[] = []

    // Busca todas as chaves de timestamp de sessão
    const chaves = await redis.keys('session_ts:*')

    for (const chave of chaves) {
      if (await redis.get<boolean>('bot_ativo') === false) break
      const phone = chave.replace('session_ts:', '')
      const ts = await redis.get<number>(chave)
      if (!ts) continue

      // Verifica se passou do timeout
      if (agora - ts < TIMEOUT_MS) continue

      // Verifica se tem sessão ativa
      const session = await redis.get<SessaoComStep>(`session:${phone}`)
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
