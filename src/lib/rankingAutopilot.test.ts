import { describe, expect, test } from 'vitest'
import { simularDecisaoAutopilot, type EntradaAutopilot } from './rankingAutopilot'

const base: EntradaAutopilot = {
  diasObservados: 30,
  diasComPedido: 30,
  pedidosNoPeriodo: 756,
  pedidosDiaMediana: 23,
  pedidosDiaMediaBase: 28,
  ticketMedioCents: 4760,
  ticketMedioBaseCents: 5000,
  percentualRecorrentes: 29,
  percentualRecorrentesBase: 37,
  receitaSemanalCents: 839_743,
  margemContribuicaoSemanalCents: 140_000,
  orcamentoSemanalConfiguradoCents: 12_000,
  custoEstimadoMissaoCents: 800,
  capacidadePedidosDia: 40,
  temporadaComTop10Completo: true,
}

describe('robô do Ranking em simulação', () => {
  test('usa a fotografia atual de 756 pedidos e escolhe indicação sem executar', () => {
    const decisao = simularDecisaoAutopilot(base)

    expect(decisao.status).toBe('simulacao_pronta')
    expect(decisao.missao).toBe('missao_indicacao')
    expect(decisao.sinaisDeDemandaFraca).toHaveLength(2)
    expect(decisao.gastoEstimadoCents).toBeLessThanOrEqual(decisao.limiteSeguroSemanalCents)
    expect(decisao.limiteSeguroSemanalCents).toBe(11_200)
    expect(decisao.top10PodeSerImportado).toBe(true)
    expect(decisao.executarAgora).toBe(false)
  })

  test('não toma decisão com poucos dados', () => {
    const decisao = simularDecisaoAutopilot({ ...base, diasObservados: 3, diasComPedido: 2 })

    expect(decisao.status).toBe('pausado')
    expect(decisao.missao).toBe('nenhuma')
    expect(decisao.gastoEstimadoCents).toBe(0)
  })

  test('protege a cozinha quando o volume já está perto da capacidade', () => {
    const decisao = simularDecisaoAutopilot({ ...base, pedidosDiaMediana: 37 })

    expect(decisao.status).toBe('observando')
    expect(decisao.missao).toBe('nenhuma')
    expect(decisao.risco).toBe('alto')
  })

  test('sem margem confiável, escolhe apenas ação orgânica sem gasto', () => {
    const decisao = simularDecisaoAutopilot({ ...base, margemContribuicaoSemanalCents: undefined })

    expect(decisao.missao).toBe('divulgacao_organica')
    expect(decisao.gastoEstimadoCents).toBe(0)
    expect(decisao.motivo).toContain('faltam margem')
  })

  test('não ultrapassa o limite quando a missão seria cara', () => {
    const decisao = simularDecisaoAutopilot({ ...base, custoEstimadoMissaoCents: 15_000 })

    expect(decisao.missao).toBe('divulgacao_organica')
    expect(decisao.gastoEstimadoCents).toBe(0)
    expect(decisao.motivo).toContain('passa do limite')
  })

  test('sem semana fraca confirmada, fica observando e não dá bônus', () => {
    const decisao = simularDecisaoAutopilot({ ...base, pedidosDiaMediana: 28, ticketMedioCents: 5000, percentualRecorrentes: 36 })

    expect(decisao.status).toBe('observando')
    expect(decisao.missao).toBe('nenhuma')
  })
})
