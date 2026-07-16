// redisUsageAlerts.ts — limiares de TENDÊNCIA INTERNA sobre a amostra de
// comandos Redis observada por este app (nunca "cota oficial"). Configurável
// por env var (nunca hardcoded espalhado pelo código). Ver
// docs/architecture/REDIS_TELEMETRY.md para o desenho completo.
//
// IMPORTANTE — por que isto NUNCA pode ser chamado de "uso oficial" nem de
// "estimativa completa" (revisão corretiva pós-implementação da Etapa C):
//
// 1. Não existe, neste projeto, uma API confiável para ler o uso OFICIAL de
//    comandos direto da Upstash a partir do runtime da aplicação (isso
//    exigiria a Management API deles, com credenciais próprias, fora do
//    escopo). A fonte oficial continua sendo exclusivamente o console da
//    Upstash — ver docs/operations/REDIS_RUNBOOK.md.
// 2. A telemetria (src/lib/redisTelemetry.ts) usa flush AMOSTRADO por
//    probabilidade (~5%) para manter overhead baixo — por design, ela nunca
//    tenta contar 100% dos comandos.
// 3. Em ambiente serverless, um processo pode terminar (fim da invocação,
//    "function freeze/kill") ANTES do flush amostrado acontecer. Como o
//    flush é fire-and-forget e os contadores vivem só em memória do
//    processo, comandos observados mas nunca "flushados" são PERDIDOS —
//    não há retry nem persistência de fallback. Isso é adicional à
//    amostragem em si: mesmo elevando a probabilidade para 100%, ainda
//    haveria perda por processos encerrados no meio.
//
// Consequência prática: o número aqui pode subestimar SEVERAMENTE o volume
// real (perda por amostragem + perda por encerramento de função antes do
// flush). Por isso todo valor derivado daqui é chamado de "amostra interna
// observada" / "tendência interna" — nunca "uso estimado da cota" e nunca
// apresentado como substituto do painel oficial da Upstash. Os limiares
// abaixo (50/70/85/95/100%) são tendência sobre essa amostra parcial, sem
// nenhum fator de correção validado — cruzar um limiar aqui NÃO prova
// proximidade real da cota, só que a amostra parcial cresceu.

export type LimiarAlerta = 50 | 70 | 85 | 95 | 100

const LIMIARES: LimiarAlerta[] = [50, 70, 85, 95, 100]

/** Disclaimer único, reutilizado em todo lugar que expõe a amostra (API, painel, log) — nunca reescrito parcialmente em outro texto. */
export const AVISO_AMOSTRA_NAO_OFICIAL =
  'Esta é uma AMOSTRA INTERNA observada por este app (telemetria amostrada, ~5% dos comandos), ' +
  'NÃO o consumo oficial da Upstash e NÃO uma estimativa completa. Pode subestimar severamente o ' +
  'volume real por dois motivos: (1) amostragem probabilística deliberada e (2) processos serverless ' +
  'que terminam antes do flush em memória ser persistido. A fonte oficial da cota é sempre o console ' +
  'da Upstash — ver docs/operations/REDIS_RUNBOOK.md.'

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * Limite mensal de comandos usado como REFERÊNCIA para calcular a tendência
 * (não é lido da Upstash, é configurado aqui). Por padrão, o limite do plano
 * Free da Upstash (500.000/mês) documentado no incidente — configurável via
 * REDIS_MONTHLY_COMMAND_LIMIT para quando o plano mudar (ex.: após upgrade
 * Pay-as-you-go), sem precisar alterar código.
 */
export function limiteComandosMensal(): number {
  return envNumber('REDIS_MONTHLY_COMMAND_LIMIT', 500_000)
}

/** Nomes de env var por limiar — só para leitura de override individual, ex. desativar um limiar específico de tendência. */
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

/**
 * Resultado de uma avaliação de TENDÊNCIA INTERNA (nunca "cota oficial").
 * `tipo` é a marca explícita e estável: qualquer consumidor (API, painel,
 * log) pode checar `tipo === 'tendencia_interna_nao_oficial'` para saber que
 * nunca deve apresentar este número como o uso real cobrado pela Upstash.
 */
export type TendenciaInterna = {
  amostraObservada: number
  limiteReferencia: number
  percentualDaAmostra: number
  tipo: 'tendencia_interna_nao_oficial'
  limiaresCruzados: LimiarAlerta[]
  limiarMaisAlto: LimiarAlerta | null
  avisoOficial: string
}

/**
 * Avalia, a partir da AMOSTRA observada do mês (soma dos comandos captados
 * pelo flush amostrado da telemetria — nunca o total real), quais limiares
 * de TENDÊNCIA já foram cruzados. Função pura — não lê/escreve Redis, não
 * loga, não notifica. Nunca chame o resultado de "uso da cota" — é
 * `percentualDaAmostra`, não percentual da cota oficial.
 */
export function avaliarLimiaresUso(
  amostraObservada: number,
  limiteReferencia: number = limiteComandosMensal()
): TendenciaInterna {
  const percentualDaAmostra = limiteReferencia > 0 ? (amostraObservada / limiteReferencia) * 100 : 0
  const limiaresCruzados = LIMIARES.filter((l) => limiarHabilitado(l) && percentualDaAmostra >= l)
  const limiarMaisAlto = limiaresCruzados.length > 0 ? limiaresCruzados[limiaresCruzados.length - 1] : null
  return {
    amostraObservada,
    limiteReferencia,
    percentualDaAmostra,
    tipo: 'tendencia_interna_nao_oficial',
    limiaresCruzados,
    limiarMaisAlto,
    avisoOficial: AVISO_AMOSTRA_NAO_OFICIAL,
  }
}

/**
 * Registra (via console.error, visível nos runtime logs da Vercel — mesmo
 * canal já usado para os demais erros críticos do projeto) a primeira vez
 * que um limiar de TENDÊNCIA é cruzado nesta chamada. Não envia notificação
 * externa — não existe canal de notificação operacional integrado ao
 * projeto hoje; isso fica documentado como pendência explícita, não
 * implementado por engano. Deliberadamente síncrono e sem I/O: quem chama
 * decide se quer persistir "já alertei este limiar neste ciclo" (ver
 * `/api/dev/redis-status`, que faz essa dedup via Redis com TTL).
 */
export function logLimiarCruzado(avaliacao: TendenciaInterna): void {
  if (!avaliacao.limiarMaisAlto) return
  console.error(
    `[redisUsageAlerts] TENDÊNCIA INTERNA (não oficial): amostra observada atingiu ${avaliacao.limiarMaisAlto}% ` +
    `do limite de referência (${Math.round(avaliacao.amostraObservada)}/${avaliacao.limiteReferencia}, ` +
    `tipo: ${avaliacao.tipo}). Isto NÃO confirma proximidade real da cota — confirme o número oficial no ` +
    `console da Upstash antes de agir. Ver docs/operations/REDIS_RUNBOOK.md.`
  )
}
