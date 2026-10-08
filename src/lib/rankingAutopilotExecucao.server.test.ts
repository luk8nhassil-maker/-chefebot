import { beforeEach, describe, expect, test, vi } from 'vitest'

const store = new Map<string, unknown>()
const configAtual = { value: null as Record<string, unknown> | null }

vi.mock('./redis', () => ({
  redis: {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown, options?: { nx?: boolean }) => {
      if (options?.nx && store.has(key)) return null
      store.set(key, value)
      return 'OK'
    }),
    del: vi.fn(async (key: string) => { store.delete(key); return 1 }),
  },
}))

vi.mock('./rankingGamificacaoConfig', () => ({
  CONFIG_GAMIFICACAO_PADRAO: {
    missaoSemanalAtiva: false, missaoSemanalMultiplicador: 2, missaoSemanalCooldownDias: 7,
    missaoIndicacaoAtiva: false, missaoIndicacaoBonus: 0,
    missaoFotoPerfilAtiva: false, missaoFotoPerfilBonus: 0,
    missaoDivulgacaoAtiva: false, missaoDivulgacaoBonus: 0,
    impulsoPodioAtivo: false, impulsoPodioBonus: 0, impulsoPodioCapTemporada: 0,
    carryoverAtivo: false, carryoverTabela: [], nivelChefAtivo: false,
    nivelChefLimiares: [], ameacaPodioMaxGap: 0,
  },
  obterConfigGamificacao: vi.fn(async () => configAtual.value ?? {
    missaoSemanalAtiva: false, missaoSemanalMultiplicador: 2, missaoSemanalCooldownDias: 7,
    missaoIndicacaoAtiva: false, missaoIndicacaoBonus: 0,
    missaoFotoPerfilAtiva: false, missaoFotoPerfilBonus: 0,
    missaoDivulgacaoAtiva: false, missaoDivulgacaoBonus: 0,
    impulsoPodioAtivo: false, impulsoPodioBonus: 0, impulsoPodioCapTemporada: 0,
    carryoverAtivo: false, carryoverTabela: [], nivelChefAtivo: false,
    nivelChefLimiares: [], ameacaPodioMaxGap: 0,
  }),
  salvarConfigGamificacao: vi.fn(async (config: Record<string, unknown>) => { configAtual.value = config }),
}))

import { aplicarComandoAutopilot, reverterAplicacaoAutopilot } from './rankingAutopilotExecucao.server'
import type { ComandoAutopilot } from './rankingAutopilotControle'

const comando: ComandoAutopilot = {
  id: 'ranking-autopilot:2026-10-08:missao_indicacao',
  missao: 'missao_indicacao',
  patch: { missaoIndicacaoAtiva: true, missaoIndicacaoBonus: 1 },
  motivo: 'teste',
  criadoEm: '2026-10-08T12:00:00.000Z',
  gastoEstimadoCents: 0,
}

beforeEach(() => {
  store.clear()
  configAtual.value = null
})

describe('execução segura do robô', () => {
  test('aplica a missão escolhida com +1 e registra o controle', async () => {
    const resultado = await aplicarComandoAutopilot('default', comando)

    expect(resultado).toMatchObject({ executado: true, status: 'aplicado' })
    expect(configAtual.value).toMatchObject({ missaoIndicacaoAtiva: true, missaoIndicacaoBonus: 1 })
    expect(store.has('ranking:autopilot:controle:default')).toBe(true)
  })

  test('não sobrescreve configuração manual diferente', async () => {
    configAtual.value = {
      missaoSemanalAtiva: false, missaoSemanalMultiplicador: 2, missaoSemanalCooldownDias: 7,
      missaoIndicacaoAtiva: true, missaoIndicacaoBonus: 8,
      missaoFotoPerfilAtiva: false, missaoFotoPerfilBonus: 0,
      missaoDivulgacaoAtiva: false, missaoDivulgacaoBonus: 0,
      impulsoPodioAtivo: false, impulsoPodioBonus: 0, impulsoPodioCapTemporada: 0,
      carryoverAtivo: false, carryoverTabela: [], nivelChefAtivo: false,
      nivelChefLimiares: [], ameacaPodioMaxGap: 0,
    }
    const resultado = await aplicarComandoAutopilot('default', comando)

    expect(resultado.status).toBe('conflito_manual')
    expect(configAtual.value?.missaoIndicacaoBonus).toBe(8)
  })

  test('não executa duas vezes o mesmo comando diário', async () => {
    await aplicarComandoAutopilot('default', comando)
    const repetido = await aplicarComandoAutopilot('default', comando)

    expect(repetido).toMatchObject({ executado: false, status: 'duplicado' })
  })

  test('reverte somente o que o robô aplicou', async () => {
    await aplicarComandoAutopilot('default', comando)
    const resultado = await reverterAplicacaoAutopilot('default')

    expect(resultado.executado).toBe(true)
    expect(configAtual.value?.missaoIndicacaoAtiva).toBe(false)
    expect(configAtual.value?.missaoIndicacaoBonus).toBe(0)
    expect(store.has('ranking:autopilot:controle:default')).toBe(false)
  })
})
