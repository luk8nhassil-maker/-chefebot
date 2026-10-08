import { describe, expect, test } from 'vitest'
import { calcularMetricas, type EventoAnaliticoLeitura } from './historicoAnalitico'
import { calcularCapacidadePedidosDia, calcularJanelasAutopilot, montarEntradaAutopilot } from './rankingAutopilotReadModel.server'

function evento(id: string, criadoEmMs: number, valorElegivelCents: number): EventoAnaliticoLeitura {
  return {
    pedidoId: id,
    clienteId: `cli_${id}`,
    tenantId: 'default',
    criadoEmMs,
    expedienteId: 'expediente',
    valorElegivelCents,
    statusAnalitico: 'entregue',
    canal: 'app',
    estrelasGeradas: 1,
    schemaVersao: 1,
    regraVersao: 'teste',
  }
}

describe('leitura do histórico para o robô', () => {
  test('ancora a comparação nos primeiros 7 dias da campanha', () => {
    const inicioCampanha = Date.parse('2026-09-19T00:00:00.000Z')
    const agora = Date.parse('2026-10-18T12:00:00.000Z')
    const janelas = calcularJanelasAutopilot(agora, '2026-09-19T00:00:00.000Z')

    expect(janelas.anterior.inicioMs).toBe(inicioCampanha)
    expect(janelas.anterior.fimMs).toBe(inicioCampanha + 7 * 86400000 - 1)
    expect(janelas.atual.inicioMs).toBe(agora - 7 * 86400000)
    expect(janelas.atual.inicioMs).toBeGreaterThan(janelas.anterior.fimMs)
    expect(janelas.ancoradaNoInicioCampanha).toBe(true)
  })

  test('usa o maior pico observado como capacidade conservadora', () => {
    const agora = Date.parse('2026-10-08T12:00:00.000Z')
    const atual = calcularMetricas([
      evento('pico-atual', agora - 1 * 86400000, 4760),
      evento('pico-atual-2', agora - 1 * 86400000, 4760),
      evento('pico-atual-3', agora - 1 * 86400000, 4760),
    ])
    const anterior = calcularMetricas([
      evento('pico-base', agora - 10 * 86400000, 5000),
      evento('pico-base-2', agora - 10 * 86400000, 5000),
    ])

    expect(calcularCapacidadePedidosDia(atual, anterior)).toBe(3)
  })

  test('transforma métricas atuais e base anterior em uma entrada somente leitura', () => {
    const agora = Date.parse('2026-10-08T12:00:00-03:00')
    const atual = calcularMetricas([
      evento('a1', agora - 2 * 86400000, 4760),
      evento('a2', agora - 2 * 86400000, 4760),
      evento('a3', agora - 1 * 86400000, 4760),
    ])
    const anterior = calcularMetricas([
      evento('b1', agora - 32 * 86400000, 5000),
      evento('b2', agora - 32 * 86400000, 5000),
      evento('b3', agora - 31 * 86400000, 5000),
    ])
    const entrada = montarEntradaAutopilot(atual, anterior, {
      diasObservadosAtual: 3,
      diasComPedidoAtual: 2,
      eventosAtual: 3,
      eventosAnterior: 3,
      dadosConfiaveis: true,
    })

    expect(entrada.pedidosNoPeriodo).toBe(3)
    expect(entrada.ticketMedioCents).toBe(4760)
    expect(entrada.ticketMedioBaseCents).toBe(5000)
    expect(entrada.receitaSemanalCents).toBe(33320)
    expect(entrada.margemContribuicaoSemanalCents).toBeUndefined()
  })
})

