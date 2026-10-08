import { describe, expect, test } from 'vitest'
import { criarComandoAutopilot, montarPlanoAutopilot, type SinaisControleAutopilot } from './rankingAutopilotControle'
import { simularDecisaoAutopilot, type EntradaAutopilot } from './rankingAutopilot'

const entrada: EntradaAutopilot = {
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
  dadosConfiaveis: true,
  temporadaComTop10Completo: true,
}

const sinais: SinaisControleAutopilot = {
  fonteConfiavel: true,
  temporadaAtiva: true,
  economiaConhecida: true,
  custoConhecido: true,
  capacidadeConhecida: true,
  idempotenciaPronta: true,
  top10Completo: true,
}

describe('controle do robô autônomo', () => {
  test('fica pronto somente quando todos os portões estão seguros', () => {
    const decisao = simularDecisaoAutopilot(entrada)
    const plano = montarPlanoAutopilot(entrada, decisao, sinais)

    expect(plano.estado).toBe('pronto')
    expect(plano.percentual).toBe(100)
    expect(plano.podeExecutar).toBe(true)
    expect(plano.acao).toBe('missao_indicacao')
  })

  test('não executa promoção quando não há margem e orçamento confiáveis', () => {
    const entradaSemEconomia = { ...entrada, margemContribuicaoSemanalCents: undefined }
    const decisao = simularDecisaoAutopilot(entradaSemEconomia)
    const plano = montarPlanoAutopilot(entradaSemEconomia, decisao, { ...sinais, economiaConhecida: false, custoConhecido: false })

    expect(plano.podeExecutar).toBe(false)
    expect(plano.acao).toBe('nenhuma')
    expect(plano.motivo).toContain('custo e o limite')
    expect(plano.fases.find((item) => item.id === 'economia')?.estado).toBe('em_andamento')
  })

  test('pausa tudo quando a operação ainda não conhece a própria capacidade', () => {
    const decisao = simularDecisaoAutopilot(entrada)
    const plano = montarPlanoAutopilot(entrada, decisao, { ...sinais, capacidadeConhecida: false })

    expect(plano.podeExecutar).toBe(false)
    expect(plano.motivo).toContain('capacidade conhecida')
    expect(plano.fases.find((item) => item.id === 'protecao')?.estado).toBe('em_andamento')
  })

  test('pausa de emergência sempre vence a decisão do robô', () => {
    const decisao = simularDecisaoAutopilot(entrada)
    const plano = montarPlanoAutopilot(entrada, decisao, { ...sinais, pausaEmergencia: true })

    expect(plano.estado).toBe('observando')
    expect(plano.podeExecutar).toBe(false)
    expect(plano.acao).toBe('nenhuma')
    expect(plano.motivo).toContain('Pausa de emergência')
  })

  test('comando automático tem valores seguros e uma chave diária idempotente', () => {
    const decisao = simularDecisaoAutopilot(entrada)
    const plano = montarPlanoAutopilot(entrada, decisao, sinais)
    const comando = criarComandoAutopilot(plano, Date.parse('2026-10-08T12:00:00Z'))

    expect(comando).toMatchObject({
      id: 'ranking-autopilot:2026-10-08:missao_indicacao',
      missao: 'missao_indicacao',
      patch: { missaoIndicacaoAtiva: true, missaoIndicacaoBonus: 1 },
    })
  })

  test('sem fase pronta não cria comando nem ativa nada', () => {
    const decisao = simularDecisaoAutopilot({ ...entrada, diasObservados: 2, diasComPedido: 1 })
    const plano = montarPlanoAutopilot({ ...entrada, diasObservados: 2, diasComPedido: 1 }, decisao, sinais)

    expect(criarComandoAutopilot(plano)).toBeNull()
  })
})
