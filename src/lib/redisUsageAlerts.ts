// redisUsageAlerts.ts — limiares de alerta de cota do Redis, configuráveis
// por env var (nunca hardcoded espalhado pelo código). Ver
// docs/architecture/REDIS_TELEMETRY.md para o desenho completo.
//
// IMPORTANTE — limite de honestidade desta etapa: não existe, neste
// projeto, uma API confiável para ler o uso OFICIAL de comandos direto da
// Upstash a partir do runtime da aplicação (isso exigiria a Management API
// da Upstash, com credenciais próprias, fora do escopo desta etapa). Todo
// número aqui é ESTIMATIVA INTERNA (ver campo `fonte` em cada retorno),
// calculada a partir da telemetria amostrada deste próprio app — não é o
// número que a Upstash cobra. A forma de conferir o número oficial continua
// sendo o console da Upstash (ver REDIS_RUNBOOK.md).
//
// Da mesma forma, esta etapa detecta e expõe os limiares cruzados (painel +
// log estruturado), mas NÃO envia notificação (push/e-mail/WhatsApp) — não
// existe canal de notificação operacional integrado ao projeto hoje. Isso
// fica documentado como pendência explícita, não implementado por engano.

export type LimiarAlerta = 50 | 70 | 85 | 95 | 100

const LIMIARES: LimiarAlerta[] = [50, 70, 85, 95, 100]

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * Limite mensal de comandos considerado para os alertas. Por padrão, o
 * limite do plano Free da Upstash (500.000/mês) documentado no incidente —
 * configurável via REDIS_MONTHLY_COMMAND_LIMIT para quando o plano mudar
 * (ex.: após upgrade Pay-as-you-go), sem precisar alterar código.
 */
export function limiteComandosMensal(): number {
  return envNumber('REDIS_MONTHLY_COMMAND_LIMIT', 500_000)
}

/** Nomes de env var por limiar — só para leitura de override individual, ex. desativar um limiar específico. */
export const REDIS_USAGE_ALERT_ENV_NAMES: Record<LimiarAlerta, string> = {
  50: 'REDIS_USAGE_ALERT_50',
  70: 'REDIS_USAGE_ALERT_70',
  85: 'REDIS_USAGE_ALERT_85',
  95: 'REDIS_USAGE_ALERT_95',
  100: 'REDIS_USAGE_ALERT_100',
}

function limiarHabilitado(limiar: LimiarAlerta): boolean {
  const raw = process.env[REDIS_USAGE_ALERT_ENV_NAMES[limiar]]
  return raw !== 'false' // habilitado por padrão; só desliga com valor explícito "false"
}

export type AvaliacaoAlerta = {
  usoEstimado: number
  limite: number
  percentual: number
  fonte: 'estimativa_interna'
  limiaresCruzados: LimiarAlerta[]
  limiarMaisAlto: LimiarAlerta | null
}

/** Avalia, a partir do uso estimado do mês (soma dos comandos observados via telemetria), quais limiares já foram cruzados. Função pura — não lê/escreve Redis, não loga, não notifica. */
export function avaliarLimiaresUso(usoEstimado: number, limite: number = limiteComandosMensal()): AvaliacaoAlerta {
  const percentual = limite > 0 ? (usoEstimado / limite) * 100 : 0
  const limiaresCruzados = LIMIARES.filter((l) => limiarHabilitado(l) && percentual >= l)
  const limiarMaisAlto = limiaresCruzados.length > 0 ? limiaresCruzados[limiaresCruzados.length - 1] : null
  return { usoEstimado, limite, percentual, fonte: 'estimativa_interna', limiaresCruzados, limiarMaisAlto }
}

/**
 * Registra (via console.error, visível nos runtime logs da Vercel — mesmo
 * canal já usado para os demais erros críticos do projeto) a primeira vez
 * que um limiar é cruzado nesta chamada. Não envia notificação externa —
 * ver nota no topo do arquivo. Deliberadamente síncrono e sem I/O: quem
 * chama decide se quer persistir "já alertei este limiar neste ciclo" (ver
 * `/api/dev/redis-status`, que faz essa dedup via Redis com TTL).
 */
export function logLimiarCruzado(avaliacao: AvaliacaoAlerta): void {
  if (!avaliacao.limiarMaisAlto) return
  console.error(
    `[redisUsageAlerts] Uso estimado de comandos Redis atingiu ${avaliacao.limiarMaisAlto}% do limite mensal ` +
    `(${Math.round(avaliacao.usoEstimado)}/${avaliacao.limite}, fonte: ${avaliacao.fonte}). ` +
    `Confirme o número oficial no console da Upstash — ver docs/operations/REDIS_RUNBOOK.md.`
  )
}
