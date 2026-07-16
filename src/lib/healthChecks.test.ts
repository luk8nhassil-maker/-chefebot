import { beforeEach, describe, expect, it, vi } from 'vitest'

const { redisMock, evolutionConfigMock } = vi.hoisted(() => {
  const redisMock = { get: vi.fn(async () => null) }
  const evolutionConfigMock = vi.fn<() => unknown>(() => null)
  return { redisMock, evolutionConfigMock }
})

vi.mock('./redis', () => ({ redis: redisMock }))
vi.mock('./evolutionApi', () => ({ obterConfigEvolution: () => evolutionConfigMock() }))

import { checkRedisHealth, checkWhatsappHealth, checkOrdersHealth, checkAllHealth } from './healthChecks'

beforeEach(() => {
  vi.clearAllMocks()
  redisMock.get.mockReset()
  evolutionConfigMock.mockReset()
})

describe('checkRedisHealth', () => {
  it('reporta "ok" quando a leitura de teste responde normalmente', async () => {
    redisMock.get.mockResolvedValue(null)
    const health = await checkRedisHealth()
    expect(health.status).toBe('ok')
    expect(typeof health.latencyMs).toBe('number')
  })

  it('reporta "down" e classifica cota quando o Redis rejeita por cota excedida (cenário obrigatório 4)', async () => {
    redisMock.get.mockRejectedValue(new Error('Command failed: ERR max requests limit exceeded. Limit: 500000, Usage: 500000.'))
    const health = await checkRedisHealth()
    expect(health.status).toBe('down')
    expect(health.detail).toContain('Cota do Redis excedida')
  })

  it('reporta "down" quando o Redis está totalmente indisponível (timeout/erro de rede)', async () => {
    redisMock.get.mockRejectedValue(new Error('fetch failed: ECONNREFUSED'))
    const health = await checkRedisHealth()
    expect(health.status).toBe('down')
  })

  it('nunca vaza telefone/token na mensagem de erro exposta pelo health check', async () => {
    redisMock.get.mockRejectedValue(new Error('Erro ao autenticar 5511999998888 com Bearer sk_abcdef123'))
    const health = await checkRedisHealth()
    expect(health.detail).not.toContain('5511999998888')
    expect(health.detail).not.toContain('sk_abcdef123')
  })
})

describe('checkWhatsappHealth', () => {
  it('reporta "ok" quando a Evolution API está configurada', () => {
    evolutionConfigMock.mockReturnValue({ baseUrl: 'https://x', apiKey: 'k', instanceName: 'i', webhookUrl: 'https://x/webhook' })
    expect(checkWhatsappHealth().status).toBe('ok')
  })

  it('reporta "down" quando a Evolution API não está configurada', () => {
    evolutionConfigMock.mockReturnValue(null)
    expect(checkWhatsappHealth().status).toBe('down')
  })
})

describe('checkOrdersHealth', () => {
  it('reporta "ok" quando a chave pedidos é um array (ou ausente)', async () => {
    redisMock.get.mockResolvedValue([{ id: '1' }, { id: '2' }])
    const health = await checkOrdersHealth()
    expect(health.status).toBe('ok')
    expect(health.detail).toContain('2 registros')
  })

  it('reporta "degraded" quando a chave pedidos existe mas não é array', async () => {
    redisMock.get.mockResolvedValue({ inesperado: true })
    const health = await checkOrdersHealth()
    expect(health.status).toBe('degraded')
  })

  it('reporta "down" quando a leitura falha', async () => {
    redisMock.get.mockRejectedValue(new Error('timeout'))
    const health = await checkOrdersHealth()
    expect(health.status).toBe('down')
  })
})

describe('checkAllHealth — agregação (cenários obrigatórios 9 e 10)', () => {
  it('health check saudável: overall "ok" quando todos os componentes estão ok', async () => {
    redisMock.get.mockResolvedValue([])
    evolutionConfigMock.mockReturnValue({ baseUrl: 'https://x', apiKey: 'k', instanceName: 'i', webhookUrl: 'https://x/webhook' })

    const health = await checkAllHealth()
    expect(health.overall).toBe('ok')
    expect(health.redis.status).toBe('ok')
    expect(health.whatsapp.status).toBe('ok')
    expect(health.orders.status).toBe('ok')
  })

  it('health check degradado: overall reflete o pior status entre os componentes', async () => {
    redisMock.get.mockRejectedValue(new Error('Command failed: ERR max requests limit exceeded. Limit: 500000, Usage: 500000.'))
    evolutionConfigMock.mockReturnValue({ baseUrl: 'https://x', apiKey: 'k', instanceName: 'i', webhookUrl: 'https://x/webhook' })

    const health = await checkAllHealth()
    expect(health.overall).toBe('down')
    expect(health.redis.status).toBe('down')
  })

  it('um componente falhando não impede a checagem dos outros (isolamento)', async () => {
    redisMock.get.mockRejectedValue(new Error('timeout'))
    evolutionConfigMock.mockReturnValue(null)

    const health = await checkAllHealth()
    expect(health.redis.status).toBe('down')
    expect(health.whatsapp.status).toBe('down')
    expect(health.orders.status).toBe('down')
    // As três checagens rodaram e retornaram, mesmo todas falhando — nenhuma lançou.
    expect(health.overall).toBe('down')
  })
})
