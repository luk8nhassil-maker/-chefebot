import 'server-only'

import {
  calcularMetricas,
  type MetricasAnaliticas,
  TENANT_PADRAO_ANALYTICS,
} from './historicoAnalitico'
import { consultarEventosAnaliticosComFallback, type FonteEventosAnalytics } from './analyticsPedidosReadModel.server'
import { simularDecisaoAutopilot, type DecisaoAutopilot, type EntradaAutopilot } from './rankingAutopilot'
import { montarPlanoAutopilot, type PlanoAutopilot, type SinaisControleAutopilot } from './rankingAutopilotControle'
import { obterTemporadaAtiva } from './temporadas'

const MS_DIA = 24 * 60 * 60 * 1000
const DIAS_BASELINE_CAMPANHA = 7
const DIAS_JANELA_ATUAL = 7
const DIAS_JANELA_FALLBACK = 30

type CoberturaAutopilot = {
  diasObservadosAtual: number
  diasComPedidoAtual: number
  eventosAtual: number
  eventosAnterior: number
  dadosConfiaveis: boolean
  capacidadePedidosDia?: number
}

export type JanelasAutopilot = {
  atual: { inicioMs: number; fimMs: number }
  anterior: { inicioMs: number; fimMs: number }
  ancoradaNoInicioCampanha: boolean
}

export type ResultadoSimulacaoAutopilot = {
  entrada: EntradaAutopilot
  decisao: DecisaoAutopilot
  plano: PlanoAutopilot
  sinaisControle: SinaisControleAutopilot
  temporadaAtiva: boolean
  fonte: FonteEventosAnalytics
  janelaAtual: { inicioMs: number; fimMs: number }
  janelaAnterior: { inicioMs: number; fimMs: number }
  metricasAtual: MetricasAnaliticas
  metricasAnterior: MetricasAnaliticas
}

/**
 * O robô compara os últimos 7 dias com os primeiros 7 dias da campanha.
 * Assim ele consegue aprender mesmo quando não existe histórico anterior à
 * campanha. Sem uma data de início válida, cai para uma janela conservadora
 * e mantém a leitura como não confiável.
 */
export function calcularJanelasAutopilot(agora: number, ativadaEm?: string): JanelasAutopilot {
  const inicioCampanha = ativadaEm ? Date.parse(ativadaEm) : Number.NaN
  if (!Number.isFinite(inicioCampanha)) {
    const fimAtual = agora
    const inicioAtual = agora - DIAS_JANELA_FALLBACK * MS_DIA
    const inicioAnterior = inicioAtual - DIAS_JANELA_FALLBACK * MS_DIA
    return {
      atual: { inicioMs: inicioAtual, fimMs: fimAtual },
      anterior: { inicioMs: inicioAnterior, fimMs: inicioAtual - 1 },
      ancoradaNoInicioCampanha: false,
    }
  }

  const fimBaseline = inicioCampanha + DIAS_BASELINE_CAMPANHA * MS_DIA - 1
  const inicioAtual = Math.max(inicioCampanha + DIAS_BASELINE_CAMPANHA * MS_DIA, agora - DIAS_JANELA_ATUAL * MS_DIA)
  return {
    atual: { inicioMs: inicioAtual, fimMs: agora },
    anterior: { inicioMs: inicioCampanha, fimMs: Math.min(fimBaseline, agora) },
    ancoradaNoInicioCampanha: agora >= inicioCampanha + (DIAS_BASELINE_CAMPANHA * 2) * MS_DIA,
  }
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
    capacidadePedidosDia: cobertura.capacidadePedidosDia ?? 0,
    dadosConfiaveis: cobertura.dadosConfiaveis,
    temporadaComTop10Completo,
  }
}

/** Usa o maior pico observado como teto conservador, sem inventar capacidade. */
export function calcularCapacidadePedidosDia(atual: MetricasAnaliticas, anterior: MetricasAnaliticas): number {
  const picos = [...atual.serieDiaria, ...anterior.serieDiaria]
    .map((dia) => dia.pedidos)
    .filter((pedidos) => Number.isFinite(pedidos) && pedidos > 0)
  return picos.length > 0 ? Math.max(...picos) : 0
}

function limitarDiasObservados(eventos: Array<{ criadoEmMs: number }>, inicioMs: number, fimMs: number): number {
  const primeiro = eventos.reduce<number | null>((menor, evento) => {
    if (!Number.isFinite(evento.criadoEmMs)) return menor
    return menor === null || evento.criadoEmMs < menor ? evento.criadoEmMs : menor
  }, null)
  if (primeiro === null) return 0
  const primeiroNaJanela = Math.max(inicioMs, primeiro)
  return Math.min(DIAS_JANELA_FALLBACK, Math.max(1, Math.floor((fimMs - primeiroNaJanela) / MS_DIA) + 1))
}

/**
 * Consulta duas janelas em uma única leitura do índice e produz uma simulação.
 * A função não salva decisão, não altera a configuração e não envia mensagem.
 */
export async function consultarSimulacaoAutopilot(
  tenantId = TENANT_PADRAO_ANALYTICS,
  agora = Date.now(),
): Promise<ResultadoSimulacaoAutopilot> {
  // A data da temporada define o início da leitura. Buscamos esse marco antes
  // do histórico para não perder os primeiros 7 dias de campanhas antigas.
  const temporada = await obterTemporadaAtiva(tenantId)
  const janelas = calcularJanelasAutopilot(agora, temporada?.ativadaEm)
  const leitura = await consultarEventosAnaliticosComFallback(
    tenantId,
    janelas.anterior.inicioMs,
    agora,
    agora,
    { incluirIndiceCompleto: true },
  )

  const inicioAtual = janelas.atual.inicioMs
  const fimAtual = janelas.atual.fimMs
  const inicioAnterior = janelas.anterior.inicioMs
  const fimAnterior = janelas.anterior.fimMs

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
    // Para comparar a semana atual com os primeiros 7 dias da campanha, ambas
    // precisam existir no índice ou no fallback. Sem base, a decisão para.
    dadosConfiaveis: leitura.fonte.indiceDisponivel
      && janelas.ancoradaNoInicioCampanha
      && eventosAtual.length > 0
      && eventosAnterior.length > 0,
    capacidadePedidosDia: calcularCapacidadePedidosDia(metricasAtual, metricasAnterior),
  }
  const entrada = montarEntradaAutopilot(metricasAtual, metricasAnterior, cobertura)
  const decisao = simularDecisaoAutopilot(entrada)
  const sinaisControle: SinaisControleAutopilot = {
    fonteConfiavel: cobertura.dadosConfiaveis,
    temporadaAtiva: temporada !== null,
    // A fonte atual ainda não informa margem, orçamento e custo da campanha.
    // False é deliberado: o robô fica impedido de gastar até aprender isso.
    economiaConhecida: entrada.margemContribuicaoSemanalCents !== undefined
      && entrada.orcamentoSemanalConfiguradoCents !== undefined,
    custoConhecido: entrada.custoEstimadoMissaoCents !== undefined,
    capacidadeConhecida: entrada.capacidadePedidosDia > 0,
    idempotenciaPronta: true,
    top10Completo: entrada.temporadaComTop10Completo === true,
  }

  return {
    entrada,
    decisao,
    plano: montarPlanoAutopilot(entrada, decisao, sinaisControle),
    sinaisControle,
    temporadaAtiva: temporada !== null,
    fonte: leitura.fonte,
    janelaAtual: { inicioMs: inicioAtual, fimMs: fimAtual },
    janelaAnterior: { inicioMs: inicioAnterior, fimMs: fimAnterior },
    metricasAtual,
    metricasAnterior,
  }
}

