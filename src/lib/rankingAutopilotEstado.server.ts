import 'server-only'

import { redis } from './redis'
import type { DecisaoAutopilot } from './rankingAutopilot'

const TTL_ESTADO_SEGUNDOS = 8 * 24 * 60 * 60
const TTL_LOCK_SEGUNDOS = 10 * 60

export type EstadoAutopilot = {
  tenantId: string
  salvoEm: string
  modoExecucao: 'observacao'
  executado: false
  decisao: DecisaoAutopilot
  janelaAtual: { inicioMs: number; fimMs: number }
  janelaAnterior: { inicioMs: number; fimMs: number }
}

function chaveEstado(tenantId: string): string {
  return `ranking:autopilot:estado:${tenantId}`
}

function chaveLock(tenantId: string): string {
  return `ranking:autopilot:lock:${tenantId}`
}

/** Guarda somente a última decisão explicada; nunca altera pontos ou missões. */
export async function salvarEstadoAutopilot(estado: EstadoAutopilot): Promise<{ salvo: boolean; bloqueado: boolean }> {
  const lock = await redis.set(chaveLock(estado.tenantId), estado.salvoEm, { nx: true, ex: TTL_LOCK_SEGUNDOS })
  if (!lock) return { salvo: false, bloqueado: true }
  await redis.set(chaveEstado(estado.tenantId), estado, { ex: TTL_ESTADO_SEGUNDOS })
  return { salvo: true, bloqueado: false }
}

export async function lerEstadoAutopilot(tenantId: string): Promise<EstadoAutopilot | null> {
  return redis.get<EstadoAutopilot>(chaveEstado(tenantId))
}

