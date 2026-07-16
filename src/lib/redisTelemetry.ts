// redisTelemetry.ts — camada de observabilidade do cliente Redis compartilhado.
//
// Objetivo (Etapa C do Programa de Saúde de Dados, ver
// docs/architecture/REDIS_TELEMETRY.md): dar visibilidade real sobre volume
// de comandos, erros, timeouts e falhas de cota SEM alterar nenhum
// comportamento de leitura/escrita já validado, e sem criar um novo
// consumidor pesado de cota — a telemetria em si é o cuidado nº1 aqui.
//
// Regras de design (todas verificáveis nos testes deste arquivo):
// 1. Nunca engole nem transforma o resultado/erro de um comando Redis real —
//    apenas observa (mede latência, classifica, incrementa contador em
//    memória) e sempre repassa o valor/erro original para quem chamou.
// 2. Uma falha da PRÓPRIA telemetria (ex.: erro ao persistir o snapshot)
//    nunca pode derrubar o comando Redis que a originou — "falha aberta".
// 3. Nenhuma chave de telemetria é escrita a cada comando. A escrita real no
//    Redis é agregada em memória e só persistida por amostragem
//    probabilística (ver FLUSH_SAMPLE_PROBABILITY) — na prática, bem menos
//    de 1 gravação de telemetria por invocação típica.
// 4. Toda chave de telemetria tem TTL. Nenhuma cresce para sempre.
// 5. Nunca registra telefone completo, token, payload de mensagem ou
//    qualquer dado de cliente — só nome de chave classificado por grupo
//    (ver classifyKey) e metadados técnicos (latência, tipo de erro).

import type { Redis } from '@upstash/redis'

/** Grupos de chave — mesmos grupos documentados em REDIS_KEY_INVENTORY.md. */
export type RedisKeyGroup =
  | 'orders'
  | 'orders_lock'
  | 'loyalty'
  | 'whatsapp'
  | 'pix_coordination'
  | 'mcp'
  | 'config'
  | 'push'
  | 'other'
  | 'telemetry'
  | 'healthcheck'

export type RedisErrorType = 'quota' | 'timeout' | 'network' | 'other'

export type CommandStats = {
  count: number
  errors: number
  quotaErrors: number
  timeouts: number
  totalLatencyMs: number
  maxLatencyMs: number
}

export type TelemetrySnapshot = {
  /** Início da janela em memória deste processo (cold start), ms epoch. */
  windowStartedAt: number
  totalCommands: number
  totalErrors: number
  byGroup: Record<string, CommandStats>
  byOperation: Record<string, CommandStats>
  lastError: { group: string; operation: string; type: RedisErrorType; message: string; at: number } | null
}

// ---------------------------------------------------------------------------
// Classificação de chave — nunca lança, sempre retorna um grupo válido.
// Baseado 1:1 nos prefixos documentados em docs/architecture/REDIS_KEY_INVENTORY.md.
// ---------------------------------------------------------------------------
export function classifyKey(rawKey: unknown): RedisKeyGroup {
  if (typeof rawKey !== 'string' || !rawKey) return 'other'
  const key = rawKey

  if (key.startsWith('telemetry:')) return 'telemetry'
  if (key.startsWith('healthcheck:')) return 'healthcheck'
  if (key.startsWith('pedido:edit:mutex:')) return 'orders_lock'
  if (
    key === 'pedidos' ||
    key === 'avaliacoes' ||
    key.startsWith('entregador:') ||
    key.startsWith('entregador_aguardando:') ||
    key.startsWith('entregador_escolhendo:') ||
    key.startsWith('avaliacao:') ||
    key.startsWith('avaliacao_enviada:') ||
    key.startsWith('contador_pedidos:')
  ) return 'orders'
  if (key.startsWith('fidelidade:')) return 'loyalty'
  if (
    key.startsWith('conversa') ||
    key.startsWith('session') ||
    key.startsWith('manual:') ||
    key.startsWith('nova_msg_manual:') ||
    key.startsWith('resolvendo:') ||
    key.startsWith('conversationAlert:') ||
    key.startsWith('postOrderPriority:') ||
    key.startsWith('revive_cooldown:') ||
    key.startsWith('aguardando_resposta:') ||
    key.startsWith('retomada:') ||
    key.startsWith('ultima_msg:') ||
    key.startsWith('cliente:') ||
    key.startsWith('idempotency') ||
    key.startsWith('spam')
  ) return 'whatsapp'
  if (
    key.startsWith('pix:') ||
    key.startsWith('cooldown:mercadopago') ||
    key.toLowerCase().includes('comprovante')
  ) return 'pix_coordination'
  if (key.startsWith('mcp:')) return 'mcp'
  if (
    key === 'cardapio' ||
    key === 'cardapio:imagens' ||
    key === 'funcionarios' ||
    key === 'padroes_aprendidos' ||
    key.startsWith('config:') ||
    key.startsWith('custos:') ||
    key.startsWith('mes_status:')
  ) return 'config'
  if (key.startsWith('push:')) return 'push'
  return 'other'
}

export function classifyError(err: unknown): RedisErrorType {
  const message = err instanceof Error ? err.message : String(err ?? '')
  const lower = message.toLowerCase()
  if (lower.includes('max requests limit exceeded') || lower.includes('quota')) return 'quota'
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('etimedout')) return 'timeout'
  if (lower.includes('econnrefused') || lower.includes('enotfound') || lower.includes('network') || lower.includes('fetch failed')) return 'network'
  return 'other'
}

/** Sanitiza mensagem de erro antes de guardar — nunca telefone/token/payload. Mesmo padrão de mcpLogger.sanitizarMensagemErro. */
function sanitizeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '')
  return raw
    .replace(/\d{8,}/g, '[numero]')
    .replace(/r\$\s*\d[\d.,]*/gi, '[valor]')
    .replace(/bearer\s+\S+/gi, 'bearer [token]')
    .slice(0, 200)
}

// ---------------------------------------------------------------------------
// Estado agregado em memória — vive só durante a vida do processo/invocação
// (cold start reseta). É intencional: a fonte durável é o snapshot amostrado
// persistido no Redis (ver flushSampled abaixo), não este objeto.
// ---------------------------------------------------------------------------
function novasStats(): CommandStats {
  return { count: 0, errors: 0, quotaErrors: 0, timeouts: 0, totalLatencyMs: 0, maxLatencyMs: 0 }
}

class RedisTelemetryState {
  windowStartedAt = Date.now()
  totalCommands = 0
  totalErrors = 0
  byGroup = new Map<string, CommandStats>()
  byOperation = new Map<string, CommandStats>()
  lastError: TelemetrySnapshot['lastError'] = null

  record(group: RedisKeyGroup, operation: string, latencyMs: number, error: unknown | null): void {
    this.totalCommands++
    const g = this.byGroup.get(group) ?? novasStats()
    const o = this.byOperation.get(operation) ?? novasStats()

    g.count++
    o.count++
    g.totalLatencyMs += latencyMs
    o.totalLatencyMs += latencyMs
    g.maxLatencyMs = Math.max(g.maxLatencyMs, latencyMs)
    o.maxLatencyMs = Math.max(o.maxLatencyMs, latencyMs)

    if (error) {
      this.totalErrors++
      g.errors++
      o.errors++
      const type = classifyError(error)
      if (type === 'quota') { g.quotaErrors++; o.quotaErrors++ }
      if (type === 'timeout') { g.timeouts++; o.timeouts++ }
      this.lastError = { group, operation, type, message: sanitizeErrorMessage(error), at: Date.now() }
    }

    this.byGroup.set(group, g)
    this.byOperation.set(operation, o)
  }

  snapshot(): TelemetrySnapshot {
    return {
      windowStartedAt: this.windowStartedAt,
      totalCommands: this.totalCommands,
      totalErrors: this.totalErrors,
      byGroup: Object.fromEntries(this.byGroup),
      byOperation: Object.fromEntries(this.byOperation),
      lastError: this.lastError,
    }
  }
}

export const telemetryState = new RedisTelemetryState()

// ---------------------------------------------------------------------------
// Flush amostrado — no máximo 1 a cada FLUSH_SAMPLE_RATE comandos observados
// resulta em uma gravação real no Redis, e essa gravação é um único pipeline
// (poucos comandos) carregando o snapshot acumulado até aqui. Nunca é
// chamado de dentro do wrapper de forma síncrona ao ponto de atrasar a
// resposta do comando original — é fire-and-forget (never awaited pelo
// chamador do comando real).
// ---------------------------------------------------------------------------
// Amostragem por PROBABILIDADE (não por contagem fixa): cada comando
// observado tem FLUSH_SAMPLE_PROBABILITY de chance de disparar um flush do
// que já estiver acumulado em memória. Com uma invocação típica de ~10-15
// comandos Redis (ver docs/architecture/DATA_ARCHITECTURE.md, seção de
// orçamento) e probabilidade padrão de 5%, o valor esperado é bem menos de
// 1 flush por invocação — na prática a maioria das invocações não persiste
// nada, e quando persiste é 1 única vez. Isso é mais barato e mais simples
// de raciocinar que um contador global compartilhado entre invocações
// concorrentes de uma mesma função serverless "quente".
const FLUSH_SAMPLE_PROBABILITY = (() => {
  const raw = Number(process.env.REDIS_TELEMETRY_SAMPLE_PROBABILITY)
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 0.05
})()
const TELEMETRY_TTL_SECONDS = 40 * 24 * 60 * 60 // 40 dias — cobre um ciclo mensal de cota com folga
const DIAS_MAX_AGREGACAO_MENSAL = 31
let flushing = false

function diaBucket(data: Date): string {
  return `${data.getUTCFullYear()}${String(data.getUTCMonth() + 1).padStart(2, '0')}${String(data.getUTCDate()).padStart(2, '0')}`
}

function diaAtualBucket(): string {
  return diaBucket(new Date())
}

/**
 * Persiste o snapshot atual em memória, de forma agregada, numa ÚNICA chave
 * (bucket do dia corrente), via pipeline. Grava só os campos realmente
 * tocados (total, errors, e um campo por grupo efetivamente usado — nunca
 * todos os grupos possíveis) para manter o pipeline pequeno. Nunca lança —
 * qualquer falha aqui é engolida com log, porque telemetria nunca pode
 * derrubar nada (regra "falha aberta"). Reseta os contadores em memória
 * após persistir com sucesso, para não persistir o mesmo dado duas vezes.
 */
export async function flushToRedis(redisClient: Redis): Promise<void> {
  if (flushing) return
  flushing = true
  try {
    const snap = telemetryState.snapshot()
    if (snap.totalCommands === 0) return

    const diaKey = `telemetry:redis:dia:${diaAtualBucket()}`

    const pipeline = redisClient.pipeline()
    pipeline.hincrby(diaKey, 'total', snap.totalCommands)
    if (snap.totalErrors > 0) pipeline.hincrby(diaKey, 'errors', snap.totalErrors)
    for (const [group, stats] of Object.entries(snap.byGroup)) {
      pipeline.hincrby(diaKey, `group:${group}`, stats.count)
    }
    pipeline.expire(diaKey, TELEMETRY_TTL_SECONDS)

    await pipeline.exec()

    // Reseta só o que foi persistido — evita dupla contagem no próximo flush.
    telemetryState.totalCommands = 0
    telemetryState.totalErrors = 0
    telemetryState.byGroup.clear()
    telemetryState.byOperation.clear()
  } catch (err) {
    console.error('[redisTelemetry] Falha ao persistir snapshot (ignorada, telemetria é best-effort):', sanitizeErrorMessage(err))
  } finally {
    flushing = false
  }
}

function toNumMap(m: Record<string, string> | null): Record<string, number> {
  if (!m) return {}
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(m)) out[k] = Number(v) || 0
  return out
}

function somarMapas(mapas: Record<string, number>[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const mapa of mapas) {
    for (const [k, v] of Object.entries(mapa)) out[k] = (out[k] ?? 0) + v
  }
  return out
}

/**
 * Lê o bucket do dia atual e agrega o mês corrente sob demanda, somando os
 * buckets diários desde o dia 1 até hoje. Isto é deliberadamente MAIS caro
 * em comandos de leitura do que uma chave mensal pré-agregada — a troca é
 * intencional: o caminho de ESCRITA (quente, automático, roda em toda
 * requisição) fica mais barato gravando só 1 bucket por flush; o caminho de
 * LEITURA (frio, só quando um humano abre o painel /dev/redis-status) pode
 * pagar até ~31 comandos extra sem impacto relevante na cota. Nunca lança —
 * qualquer falha em qualquer dia individual é ignorada (mês fica
 * parcialmente subestimado, nunca quebra o painel).
 */
export async function lerUsoEstimado(redisClient: Redis): Promise<{
  mesAtual: Record<string, number>
  diaAtual: Record<string, number>
  fonte: 'estimativa_interna'
}> {
  try {
    const hoje = new Date()
    const diasDoMes = hoje.getUTCDate() // 1..31, sempre <= DIAS_MAX_AGREGACAO_MENSAL
    const chaves: string[] = []
    for (let dia = 1; dia <= Math.min(diasDoMes, DIAS_MAX_AGREGACAO_MENSAL); dia++) {
      const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), dia))
      chaves.push(`telemetry:redis:dia:${diaBucket(d)}`)
    }

    const resultados = await Promise.all(
      chaves.map((chave) => redisClient.hgetall<Record<string, string>>(chave).catch(() => null))
    )
    const mapas = resultados.map(toNumMap)
    const mesAtual = somarMapas(mapas)
    const diaAtual = mapas[mapas.length - 1] ?? {}

    return { mesAtual, diaAtual, fonte: 'estimativa_interna' }
  } catch {
    return { mesAtual: {}, diaAtual: {}, fonte: 'estimativa_interna' }
  }
}

// ---------------------------------------------------------------------------
// Wrapper — envolve o client @upstash/redis com um Proxy transparente.
// Nenhum call site precisa mudar: `redis.get(...)`, `redis.set(...)` etc
// continuam funcionando exatamente igual, com o mesmo retorno e os mesmos
// erros. Só os métodos de comando conhecidos (não `pipeline`/`multi`, que já
// são agregações do próprio SDK) são instrumentados.
// ---------------------------------------------------------------------------
const OPERACOES_INSTRUMENTADAS = new Set([
  'get', 'set', 'del', 'incr', 'expire', 'ttl',
  'zadd', 'zrange', 'zrem', 'zscore',
  'hset', 'hget', 'hgetall', 'hincrby', 'hdel',
  'sadd', 'smembers', 'srem',
  'rpush', 'lpush', 'lrange', 'ltrim',
  'eval', 'evalsha',
])

function extrairChavePrincipal(args: unknown[]): unknown {
  return args[0]
}

export function wrapRedisClient(redisClient: Redis): Redis {
  const flushSeAmostrado = () => {
    if (Math.random() < FLUSH_SAMPLE_PROBABILITY) {
      // Fire-and-forget deliberado: nunca atrasa nem pode derrubar o comando
      // real que disparou este flush.
      void flushToRedis(redisClient)
    }
  }

  return new Proxy(redisClient, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver)
      if (typeof prop !== 'string' || !OPERACOES_INSTRUMENTADAS.has(prop) || typeof original !== 'function') {
        return original
      }

      return function instrumented(this: unknown, ...args: unknown[]) {
        const group = classifyKey(extrairChavePrincipal(args))
        const started = Date.now()

        let result: unknown
        try {
          result = (original as (...a: unknown[]) => unknown).apply(target, args)
        } catch (syncErr) {
          // @upstash/redis é assíncrono por padrão (retorna Promise), mas
          // se algum call site futuro usar uma chamada síncrona que lance,
          // ainda registramos e nunca escondemos o erro original.
          telemetryState.record(group, prop, Date.now() - started, syncErr)
          flushSeAmostrado()
          throw syncErr
        }

        if (result instanceof Promise) {
          return result.then(
            (value) => {
              telemetryState.record(group, prop, Date.now() - started, null)
              flushSeAmostrado()
              return value
            },
            (err) => {
              telemetryState.record(group, prop, Date.now() - started, err)
              flushSeAmostrado()
              throw err
            }
          )
        }

        telemetryState.record(group, prop, Date.now() - started, null)
        flushSeAmostrado()
        return result
      }
    },
  })
}

/** Snapshot em memória do processo atual — usado pelo painel/health check para o número "ao vivo" desta invocação. */
export function obterSnapshotEmMemoria(): TelemetrySnapshot {
  return telemetryState.snapshot()
}

/** Uso exclusivo de testes: zera o estado agregado em memória entre casos. */
export function resetarTelemetriaParaTeste(): void {
  telemetryState.totalCommands = 0
  telemetryState.totalErrors = 0
  telemetryState.byGroup.clear()
  telemetryState.byOperation.clear()
  telemetryState.lastError = null
}
