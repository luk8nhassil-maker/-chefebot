import 'server-only'

import {
  calcularMetricas,
  type MetricasAnaliticas,
  TENANT_PADRAO_ANALYTICS,
} from './historicoAnalitico'
import { consultarEventosAnaliticosComFallback, type FonteEventosAnalytics } from './analyticsPedidosReadModel.server'
import { simularDecisaoAutopilot, type DecisaoAutopilot, type EntradaAutopilot } from './rankingAutopilot'

const MS_DIA = 24 * 60 * 60 * 1000
const JANELA_DIAS = 30

type CoberturaAutopilot = {
  diasObservadosAtual: number
  diasComPedidoAtual: number
  eventosAtual: number
  eventosAnterior: number
  dadosConfiaveis: boolean
}

export type ResultadoSimulacaoAutopilot = {
  entrada: EntradaAutopilot
  decisao: DecisaoAutopilot
  fonte: FonteEventosAnalytics
  janelaAtual: { inicioMs: number; fimMs: number }
  janelaAnterior: { inicioMs: number; fimMs: number }
  metricasAtual: MetricasAnaliticas
  metricasAnterior: MetricasAnaliticas
}

function mediana(valores: number[]): number {
  if (valores.length === 0) return 0
  const ordenados = [...valores].sort((a, b) => a - b)
  const meio = Math.floor(ordenados.length / 2)
  return ordenados.length % 2 === 0
    ? (ordenados[meio - 1]! + ordenados[meio]!) / 2
    : ordenados[meio]!
}

function medianaPedidos(metricas: MetricasAnaliticas): number {
  return mediana(metricas.serieDiaria.map((dia) => dia.pedidos))
}

function diasComPedido(metricas: MetricasAnaliticas): number {
  return metricas.serieDiaria.filter((dia) => dia.pedidos > 0).length
}

/** Converte dois resumos analíticos em uma entrada do motor, sem escrever nada. */
export function montarEntradaAutopilot(
  atual: MetricasAnaliticas,
  anterior: MetricasAnaliticas,
  cobertura: CoberturaAutopilot,
  temporadaComTop10Completo = false,
): EntradaAutopilot {
  const diasBase = Math.max(1, cobertura.diasObservadosAtual)
  return {
    diasObservados: cobertura.diasObservadosAtual,
    diasComPedido: cobertura.diasComPedidoAtual,
    pedidosNoPeriodo: atual.pedidosValidos,
    pedidosDiaMediana: medianaPedidos(atual),
    pedidosDiaMediaBase: medianaPedidos(anterior),
    ticketMedioCents: atual.ticketMedioCents,
    ticketMedioBaseCents: anterior.ticketMedioCents,
    percentualRecorrentes: atual.percentualClientesComSegundoPedido,
    percentualRecorrentesBase: anterior.percentualClientesComSegundoPedido,
    receitaSemanalCents: Math.round((atual.receitaElegivelCents / diasBase) * 7),
    // A fonte atual ainda não possui margem de contribuição confiável. Deixar
    // undefined é intencional: o robô fica no modo orgânico e não gasta.
    margemContribuicaoSemanalCents: undefined,
    orcamentoSemanalConfiguradoCents: undefined,
    custoEstimadoMissaoCents: undefined,
    capacidadePedidosDia: 0,
    dadosConfiaveis: cobertura.dadosConfiaveis,
    temporadaComTop10Completo,
  }
}

function limitarDiasObservados(eventos: Array<{ criadoEmMs: number }>, inicioMs: number, fimMs: number): number {
  const primeiro = eventos.reduce<number | null>((menor, evento) => {
    if (!Number.isFinite(evento.criadoEmMs)) return menor
    return menor === null || evento.criadoEmMs < menor ? evento.criadoEmMs : menor
  }, null)
  if (primeiro === null) return 0
  const primeiroNaJanela = Math.max(inicioMs, primeiro)
  return Math.min(JANELA_DIAS, Math.max(1, Math.floor((fimMs - primeiroNaJanela) / MS_DIA) + 1))
}

/**
 * Consulta duas janelas em uma única leitura do índice e produz uma simulação.
 * A função não salva decisão, não altera a configuração e não envia mensagem.
 */
export async function consultarSimulacaoAutopilot(
  tenantId = TENANT_PADRAO_ANALYTICS,
  agora = Date.now(),
): Promise<ResultadoSimulacaoAutopilot> {
  const inicioAtual = agora - JANELA_DIAS * MS_DIA
  const fimAtual = agora
  const inicioAnterior = inicioAtual - JANELA_DIAS * MS_DIA
  const fimAnterior = inicioAtual - 1
  const leitura = await consultarEventosAnaliticosComFallback(
    tenantId,
    inicioAnterior,
    fimAtual,
    agora,
    { incluirIndiceCompleto: true },
  )

  const eventosAtual = leitura.eventos.filter((evento) => evento.criadoEmMs >= inicioAtual && evento.criadoEmMs <= fimAtual)
  const eventosAnterior = leitura.eventos.filter((evento) => evento.criadoEmMs >= inicioAnterior && evento.criadoEmMs <= fimAnterior)
  const metricasAtual = calcularMetricas(eventosAtual)
  const metricasAnterior = calcularMetricas(eventosAnterior)
  const diasObservadosAtual = limitarDiasObservados(eventosAtual, inicioAtual, fimAtual)
  const cobertura: CoberturaAutopilot = {
    diasObservadosAtual,
    diasComPedidoAtual: diasComPedido(metricasAtual),
    eventosAtual: eventosAtual.length,
    eventosAnterior: eventosAnterior.length,
    // Para comparar semana atual com anterior, ambas precisam existir no índice
    // ou no fallback. Sem base, a decisão não deve liberar bônus.
    dadosConfiaveis: leitura.fonte.indiceDisponivel && eventosAtual.length > 0 && eventosAnterior.length > 0,
  }
  const entrada = montarEntradaAutopilot(metricasAtual, metricasAnterior, cobertura)

  return {
    entrada,
    decisao: simularDecisaoAutopilot(entrada),
    fonte: leitura.fonte,
    janelaAtual: { inicioMs: inicioAtual, fimMs: fimAtual },
    janelaAnterior: { inicioMs: inicioAnterior, fimMs: fimAnterior },
    metricasAtual,
    metricasAnterior,
  }
}

