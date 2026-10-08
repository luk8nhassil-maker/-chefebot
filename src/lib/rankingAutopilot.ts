/**
 * Motor de decisão do Ranking em modo seguro.
 *
 * Esta biblioteca é pura: não lê Redis, não envia mensagem e não ativa missão.
 * Ela recebe um resumo de métricas e devolve uma decisão explicada. Isso permite
 * testar o comportamento com o histórico sem gerar custo ou alterar clientes.
 */

export type MissaoAutopilot =
  | 'nenhuma'
  | 'divulgacao_organica'
  | 'missao_semanal'
  | 'missao_indicacao'

export type StatusAutopilot = 'pausado' | 'observando' | 'simulacao_pronta'
export type RiscoAutopilot = 'baixo' | 'medio' | 'alto'

export type EntradaAutopilot = {
  /** Dias do período que já foram observados. */
  diasObservados: number
  /** Dias que tiveram pelo menos um pedido válido. */
  diasComPedido: number
  pedidosNoPeriodo: number
  pedidosDiaMediana: number
  pedidosDiaMediaBase: number
  ticketMedioCents: number
  ticketMedioBaseCents: number
  percentualRecorrentes: number
  percentualRecorrentesBase: number
  receitaSemanalCents: number
  /** Margem de contribuição, não faturamento bruto. */
  margemContribuicaoSemanalCents?: number
  /** Limite definido pelo dono; nunca é ultrapassado. */
  orcamentoSemanalConfiguradoCents?: number
  /** Custo provável da missão escolhida, se já conhecido. */
  custoEstimadoMissaoCents?: number
  capacidadePedidosDia: number
  /** Incidentes, importação incompleta ou período ainda não confiável. */
  dadosConfiaveis?: boolean
  temporadaComTop10Completo?: boolean
}

export type DecisaoAutopilot = {
  modo: 'simulacao'
  status: StatusAutopilot
  missao: MissaoAutopilot
  motivo: string
  sinaisDeDemandaFraca: string[]
  risco: RiscoAutopilot
  confianca: number
  limiteSeguroSemanalCents: number
  gastoEstimadoCents: number
  executarAgora: false
  top10PodeSerImportado: boolean
}

const MIN_DIAS_OBSERVADOS = 7
const MIN_DIAS_COM_PEDIDO = 4
const LIMIAR_CAPACIDADE = 0.9
const LIMIAR_QUEDA_PEDIDOS = 0.85
const LIMIAR_QUEDA_TICKET = 0.9
const LIMIAR_QUEDA_RECORRENCIA = 0.8
const RESERVA_SEGURANCA = 0.8

function numeroSeguro(valor: number | undefined): number {
  return Number.isFinite(valor) && valor! > 0 ? valor! : 0
}

function limiteSeguro(entrada: EntradaAutopilot): number {
  const receita = numeroSeguro(entrada.receitaSemanalCents)
  const margem = numeroSeguro(entrada.margemContribuicaoSemanalCents)
  const configurado = numeroSeguro(entrada.orcamentoSemanalConfiguradoCents)
  if (receita <= 0 || margem <= 0) return 0

  // Regra conservadora: o menor valor entre 2% da receita e 10% da margem,
  // guardando 20% como reserva. O limite do dono sempre vence se for menor.
  const tetoEconomico = Math.floor(Math.min(receita * 0.02, margem * 0.10) * RESERVA_SEGURANCA)
  return configurado > 0 ? Math.min(configurado, tetoEconomico) : tetoEconomico
}

function percentualQueda(atual: number, base: number): number {
  if (atual <= 0 || base <= 0) return 0
  return 1 - atual / base
}

/**
 * Decide a próxima ação sem executar nada.
 * Falta de dado sempre vence a vontade de vender: o resultado é pausa segura.
 */
export function simularDecisaoAutopilot(entrada: EntradaAutopilot): DecisaoAutopilot {
  const confiavel = entrada.dadosConfiaveis !== false
  const limiteCents = limiteSeguro(entrada)
  const top10PodeSerImportado = entrada.temporadaComTop10Completo === true

  if (!confiavel || entrada.diasObservados < MIN_DIAS_OBSERVADOS || entrada.diasComPedido < MIN_DIAS_COM_PEDIDO) {
    return {
      modo: 'simulacao',
      status: 'pausado',
      missao: 'nenhuma',
      motivo: 'Ainda não há dias e dados confiáveis suficientes para uma decisão segura.',
      sinaisDeDemandaFraca: [],
      risco: 'baixo',
      confianca: 0.35,
      limiteSeguroSemanalCents: limiteCents,
      gastoEstimadoCents: 0,
      executarAgora: false,
      top10PodeSerImportado,
    }
  }

  const capacidade = numeroSeguro(entrada.capacidadePedidosDia)
  if (capacidade > 0 && entrada.pedidosDiaMediana >= capacidade * LIMIAR_CAPACIDADE) {
    return {
      modo: 'simulacao',
      status: 'observando',
      missao: 'nenhuma',
      motivo: 'A operação já está perto do limite; incentivar mais pedidos agora pode causar atraso.',
      sinaisDeDemandaFraca: [],
      risco: 'alto',
      confianca: 0.9,
      limiteSeguroSemanalCents: limiteCents,
      gastoEstimadoCents: 0,
      executarAgora: false,
      top10PodeSerImportado,
    }
  }

  const sinais: string[] = []
  if (percentualQueda(entrada.pedidosDiaMediana, entrada.pedidosDiaMediaBase) >= 1 - LIMIAR_QUEDA_PEDIDOS) {
    sinais.push('volume de pedidos abaixo da referência')
  }
  if (percentualQueda(entrada.ticketMedioCents, entrada.ticketMedioBaseCents) >= 1 - LIMIAR_QUEDA_TICKET) {
    sinais.push('ticket médio abaixo da referência')
  }
  if (entrada.percentualRecorrentesBase > 0 && entrada.percentualRecorrentes / entrada.percentualRecorrentesBase <= LIMIAR_QUEDA_RECORRENCIA) {
    sinais.push('menos clientes recorrentes que o normal')
  }

  if (sinais.length < 2) {
    return {
      modo: 'simulacao',
      status: 'observando',
      missao: 'nenhuma',
      motivo: 'A demanda está dentro do padrão; não há motivo suficiente para oferecer bônus.',
      sinaisDeDemandaFraca: sinais,
      risco: 'baixo',
      confianca: 0.76,
      limiteSeguroSemanalCents: limiteCents,
      gastoEstimadoCents: 0,
      executarAgora: false,
      top10PodeSerImportado,
    }
  }

  // Sem margem ou orçamento conhecido, só é permitida uma ação orgânica e sem custo.
  const custoEstimado = numeroSeguro(entrada.custoEstimadoMissaoCents)
  if (limiteCents <= 0 || custoEstimado <= 0 || custoEstimado > limiteCents) {
    return {
      modo: 'simulacao',
      status: 'simulacao_pronta',
      missao: 'divulgacao_organica',
      motivo: custoEstimado > limiteCents && limiteCents > 0
        ? 'Há sinais de semana fraca, mas o custo previsto passa do limite seguro; a alternativa orgânica não gera gasto.'
        : 'Há sinais de semana fraca, mas faltam margem, orçamento ou custo confiável; só a alternativa orgânica é segura.',
      sinaisDeDemandaFraca: sinais,
      risco: 'baixo',
      confianca: 0.82,
      limiteSeguroSemanalCents: limiteCents,
      gastoEstimadoCents: 0,
      executarAgora: false,
      top10PodeSerImportado,
    }
  }

  const missao: MissaoAutopilot = entrada.percentualRecorrentes / Math.max(entrada.percentualRecorrentesBase, 1) <= LIMIAR_QUEDA_RECORRENCIA
    ? 'missao_indicacao'
    : 'missao_semanal'

  return {
    modo: 'simulacao',
    status: 'simulacao_pronta',
    missao,
    motivo: missao === 'missao_indicacao'
      ? 'A recorrência caiu e há sinais suficientes de semana fraca; a indicação é a ação mais adequada para recuperar clientes.'
      : 'O volume e o ticket caíram juntos; a missão semanal é a ação mais simples para testar recuperação.',
    sinaisDeDemandaFraca: sinais,
    risco: 'medio',
    confianca: 0.84,
    limiteSeguroSemanalCents: limiteCents,
    gastoEstimadoCents: custoEstimado,
    executarAgora: false,
    top10PodeSerImportado,
  }
}

