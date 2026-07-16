import { afterEach, describe, expect, it, vi } from 'vitest'
import { avaliarLimiaresUso, limiteComandosMensal, AVISO_AMOSTRA_NAO_OFICIAL } from './redisUsageAlerts'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('avaliarLimiaresUso', () => {
  it('não cruza nenhum limiar com uso baixo', () => {
    const avaliacao = avaliarLimiaresUso(1000, 500_000)
    expect(avaliacao.limiaresCruzados).toEqual([])
    expect(avaliacao.limiarMaisAlto).toBeNull()
  })

  it('cruza exatamente o limiar de 50% quando o uso bate 50%', () => {
    const avaliacao = avaliarLimiaresUso(250_000, 500_000)
    expect(avaliacao.limiaresCruzados).toContain(50)
    expect(avaliacao.limiarMaisAlto).toBe(50)
  })

  it('cruza todos os limiares até 95% quando o uso está em 96%', () => {
    const avaliacao = avaliarLimiaresUso(480_000, 500_000)
    expect(avaliacao.limiaresCruzados).toEqual([50, 70, 85, 95])
    expect(avaliacao.limiarMaisAlto).toBe(95)
  })

  it('cruza o limiar de 100% quando o uso excede o limite', () => {
    const avaliacao = avaliarLimiaresUso(510_000, 500_000)
    expect(avaliacao.limiarMaisAlto).toBe(100)
  })

  it('respeita limite zero sem lançar (percentual 0, sem cruzar nada)', () => {
    const avaliacao = avaliarLimiaresUso(100, 0)
    expect(avaliacao.percentualDaAmostra).toBe(0)
    expect(avaliacao.limiarMaisAlto).toBeNull()
  })

  it('permite desativar um limiar específico via env var', () => {
    vi.stubEnv('REDIS_USAGE_ALERT_95', 'false')
    const avaliacao = avaliarLimiaresUso(480_000, 500_000)
    expect(avaliacao.limiaresCruzados).not.toContain(95)
    expect(avaliacao.limiarMaisAlto).toBe(85)
  })
})

describe('terminologia — nunca pode ser confundida com uso oficial ou estimativa completa (cenário obrigatório 8)', () => {
  it('o tipo é explicitamente "tendencia_interna_nao_oficial", nunca um valor que sugira dado oficial', () => {
    const avaliacao = avaliarLimiaresUso(250_000, 500_000)
    expect(avaliacao.tipo).toBe('tendencia_interna_nao_oficial')
    expect(avaliacao.tipo).toMatch(/nao_oficial$/)
    expect(avaliacao.tipo).not.toBe('cota_oficial')
    expect(avaliacao.tipo).not.toBe('uso_oficial')
    expect(avaliacao.tipo).not.toBe('estimativa_completa')
  })

  it('todo resultado carrega o aviso completo em avisoOficial, nunca omitido', () => {
    const casos = [
      avaliarLimiaresUso(0, 500_000),
      avaliarLimiaresUso(250_000, 500_000),
      avaliarLimiaresUso(600_000, 500_000),
    ]
    for (const avaliacao of casos) {
      expect(avaliacao.avisoOficial).toBe(AVISO_AMOSTRA_NAO_OFICIAL)
    }
  })

  it('o aviso menciona explicitamente Upstash, amostragem e não ser estimativa completa/oficial', () => {
    expect(AVISO_AMOSTRA_NAO_OFICIAL).toMatch(/Upstash/)
    expect(AVISO_AMOSTRA_NAO_OFICIAL).toMatch(/AMOSTRA INTERNA/)
    expect(AVISO_AMOSTRA_NAO_OFICIAL).toMatch(/NÃO.*oficial/i)
    expect(AVISO_AMOSTRA_NAO_OFICIAL).toMatch(/NÃO.*estimativa completa/i)
    expect(AVISO_AMOSTRA_NAO_OFICIAL).toMatch(/subestimar/i)
  })

  it('os campos numéricos usam nomes que não afirmam ser "uso"/"estimativa" (amostraObservada, limiteReferencia, percentualDaAmostra)', () => {
    const avaliacao = avaliarLimiaresUso(250_000, 500_000)
    expect(avaliacao).toHaveProperty('amostraObservada')
    expect(avaliacao).toHaveProperty('limiteReferencia')
    expect(avaliacao).toHaveProperty('percentualDaAmostra')
    expect(avaliacao).not.toHaveProperty('usoEstimado')
    expect(avaliacao).not.toHaveProperty('usoOficial')
  })
})

describe('limiteComandosMensal', () => {
  it('usa 500.000 por padrão (plano Free da Upstash documentado no incidente)', () => {
    expect(limiteComandosMensal()).toBe(500_000)
  })

  it('respeita override via REDIS_MONTHLY_COMMAND_LIMIT', () => {
    vi.stubEnv('REDIS_MONTHLY_COMMAND_LIMIT', '2000000')
    expect(limiteComandosMensal()).toBe(2_000_000)
  })

  it('ignora valor inválido e volta ao padrão', () => {
    vi.stubEnv('REDIS_MONTHLY_COMMAND_LIMIT', 'não-é-numero')
    expect(limiteComandosMensal()).toBe(500_000)
  })
})
