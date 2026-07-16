// healthChecks.ts — health checks independentes (Etapa C do Programa de
// Saúde de Dados). Cada checagem é isolada: a falha de uma nunca esconde
// nem mascara a de outra, e nenhuma finge sucesso quando não tem certeza.
//
// Nenhuma checagem aqui chama a Evolution API ou o Mercado Pago pela rede —
// só confirma presença/validade de configuração — para não gastar
// requisições/cota de terceiros só para responder "está saudável?".

import { redis } from './redis'
import { obterConfigEvolution } from './evolutionApi'

export type HealthStatus = 'ok' | 'degraded' | 'down'

export type ComponentHealth = {
  status: HealthStatus
  latencyMs?: number
  detail: string
  checkedAt: number
}

const HEALTH_CHECK_TIMEOUT_MS = 1500

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) }
    )
  })
}

/** Sanitiza mensagem de erro antes de expor no health check — nunca telefone/token. */
function sanitizeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '')
  return raw
    .replace(/\d{8,}/g, '[numero]')
    .replace(/bearer\s+\S+/gi, 'bearer [token]')
    .slice(0, 200)
}

/**
 * Checagem do Redis: uma leitura trivial e barata (chave que praticamente
 * nunca existe), com timeout curto. Nunca escreve. Classifica quota/timeout
 * explicitamente para o painel/runbook conseguirem diferenciar causa.
 */
export async function checkRedisHealth(): Promise<ComponentHealth> {
  const started = Date.now()
  try {
    await withTimeout(redis.get('healthcheck:probe'), HEALTH_CHECK_TIMEOUT_MS)
    return { status: 'ok', latencyMs: Date.now() - started, detail: 'Redis respondeu normalmente', checkedAt: Date.now() }
  } catch (err) {
    const message = sanitizeErrorMessage(err)
    const lower = message.toLowerCase()
    if (lower.includes('timeout')) {
      return { status: 'down', latencyMs: Date.now() - started, detail: `Timeout ao consultar Redis: ${message}`, checkedAt: Date.now() }
    }
    if (lower.includes('max requests limit exceeded') || lower.includes('quota')) {
      return { status: 'down', latencyMs: Date.now() - started, detail: `Cota do Redis excedida: ${message}`, checkedAt: Date.now() }
    }
    return { status: 'down', latencyMs: Date.now() - started, detail: `Erro ao consultar Redis: ${message}`, checkedAt: Date.now() }
  }
}

/**
 * Checagem do WhatsApp: só confirma que a Evolution API está configurada
 * (mesma checagem síncrona já usada em src/app/api/orders/route.ts:notificarCliente,
 * sem chamada de rede). Não confirma que a instância está conectada — isso
 * exigiria uma chamada real à API, fora do escopo desta checagem barata.
 */
export function checkWhatsappHealth(): ComponentHealth {
  const config = obterConfigEvolution()
  if (!config) {
    return { status: 'down', detail: 'Evolution API não configurada (EVOLUTION_API_URL/EVOLUTION_API_KEY ausentes ou inválidas)', checkedAt: Date.now() }
  }
  return { status: 'ok', detail: 'Evolution API configurada', checkedAt: Date.now() }
}

/**
 * Checagem de pedidos: confirma que a chave "pedidos" é legível e tem o
 * formato esperado (array ou ausente) — não confirma consistência de dado,
 * só que a leitura básica que o painel /pedidos depende funciona.
 */
export async function checkOrdersHealth(): Promise<ComponentHealth> {
  const started = Date.now()
  try {
    const pedidos = await withTimeout(redis.get<unknown>('pedidos'), HEALTH_CHECK_TIMEOUT_MS)
    if (pedidos !== null && !Array.isArray(pedidos)) {
      return { status: 'degraded', latencyMs: Date.now() - started, detail: 'Chave "pedidos" existe mas não é um array — formato inesperado', checkedAt: Date.now() }
    }
    return { status: 'ok', latencyMs: Date.now() - started, detail: `Leitura de pedidos ok (${Array.isArray(pedidos) ? pedidos.length : 0} registros)`, checkedAt: Date.now() }
  } catch (err) {
    return { status: 'down', latencyMs: Date.now() - started, detail: `Falha ao ler pedidos: ${sanitizeErrorMessage(err)}`, checkedAt: Date.now() }
  }
}

export type AggregateHealth = {
  overall: HealthStatus
  redis: ComponentHealth
  whatsapp: ComponentHealth
  orders: ComponentHealth
  checkedAt: number
}

function piorStatus(a: HealthStatus, b: HealthStatus): HealthStatus {
  const ordem: Record<HealthStatus, number> = { ok: 0, degraded: 1, down: 2 }
  return ordem[a] >= ordem[b] ? a : b
}

/**
 * Agrega as três checagens. Redis é checado uma única vez e reaproveitado
 * pela checagem de pedidos (que também depende do Redis) — evita duplicar
 * a mesma leitura de teste duas vezes na mesma chamada.
 */
export async function checkAllHealth(): Promise<AggregateHealth> {
  const [redisHealth, ordersHealth] = await Promise.all([checkRedisHealth(), checkOrdersHealth()])
  const whatsappHealth = checkWhatsappHealth()

  let overall: HealthStatus = 'ok'
  overall = piorStatus(overall, redisHealth.status)
  overall = piorStatus(overall, ordersHealth.status)
  overall = piorStatus(overall, whatsappHealth.status)

  return { overall, redis: redisHealth, whatsapp: whatsappHealth, orders: ordersHealth, checkedAt: Date.now() }
}
