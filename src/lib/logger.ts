import { redis } from './redis'

type Nivel = 'erro' | 'aviso' | 'info'

type LogEntry = {
  nivel: Nivel
  mensagem: string
  detalhe?: string
  data: string
}

export async function log(nivel: Nivel, mensagem: string, detalhe?: string) {
  try {
    const logs = await redis.get<LogEntry[]>('system:logs') || []
    logs.push({
      nivel,
      mensagem,
      detalhe: detalhe ? String(detalhe).slice(0, 500) : undefined,
      data: new Date().toISOString(),
    })
    // Mantém só os últimos 100 logs
    const logsTrimmed = logs.slice(-100)
    await redis.set('system:logs', logsTrimmed, { ex: 7 * 24 * 60 * 60 })
  } catch {
    // Silencioso — log nunca pode quebrar o sistema
  }
}