import 'server-only'

import { redis } from './redis'
import type { DecisaoAutopilot } from './rankingAutopilot'
import type { PlanoAutopilot } from './rankingAutopilotControle'
import type { ResultadoExecucaoAutopilot } from './rankingAutopilotExecucao.server'

const TTL_ESTADO_SEGUNDOS = 8 * 24 * 60 * 60
const TTL_LOCK_SEGUNDOS = 10 * 60

export type EstadoAutopilot = {
  tenantId: string
  salvoEm: string
  modoExecucao: 'observacao' | 'autonomo'
  executado: boolean
  decisao: DecisaoAutopilot
  plano?: PlanoAutopilot
  execucao?: ResultadoExecucaoAutopilot
  janelaAtual: { inicioMs: number; fimMs: number }
  janelaAnterior: { inicioMs: number; fimMs: number }
}

function chaveEstado(tenantId: string): string {
  return `ranking:autopilot:estado:${tenantId}`
}

function chaveLock(tenantId: string): string {
  return `ranking:autopilot:lock:${tenantId}`
}

/**
 * Guarda somente a última decisão explicada e a trilha de desbloqueio. A
 * execução de uma ação continua separada; esta chave nunca credita pontos nem
 * altera missões. O TTL evita acumular histórico caro no Redis.
 */
export async function salvarEstadoAutopilot(estado: EstadoAutopilot): Promise<{ salvo: boolean; bloqueado: boolean }> {
  const lock = await redis.set(chaveLock(estado.tenantId), estado.salvoEm, { nx: true, ex: TTL_LOCK_SEGUNDOS })
  if (!lock) return { salvo: false, bloqueado: true }
  await redis.set(chaveEstado(estado.tenantId), estado, { ex: TTL_ESTADO_SEGUNDOS })
  return { salvo: true, bloqueado: false }
}

export async function lerEstadoAutopilot(tenantId: string): Promise<EstadoAutopilot | null> {
  return redis.get<EstadoAutopilot>(chaveEstado(tenantId))
}

