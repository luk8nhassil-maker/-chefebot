import { vi, describe, it, expect, beforeEach } from 'vitest'

const { redisMock, healthMock, telemetryMock } = vi.hoisted(() => ({
  redisMock: { set: vi.fn(async () => 'OK') },
  healthMock: {
    checkAllHealth: vi.fn(async () => ({
      overall: 'ok',
      redis: { status: 'ok', detail: 'ok', checkedAt: 1 },
      whatsapp: { status: 'ok', detail: 'ok', checkedAt: 1 },
      orders: { status: 'ok', detail: 'ok', checkedAt: 1 },
      checkedAt: 1,
    })),
  },
  telemetryMock: {
    obterSnapshotEmMemoria: vi.fn(() => ({
      windowStartedAt: 1, totalCommands: 0, totalErrors: 0, byGroup: {}, byOperation: {}, lastError: null,
    })),
    lerAmostraInterna: vi.fn(async () => ({
      mesAtual: { total: 100 },
      diaAtual: { total: 10 },
      fonte: 'amostra_interna_observada',
      avisoOficial: 'AVISO_TESTE',
    })),
  },
}))

vi.mock('@/lib/redis', () => ({ redis: redisMock }))
vi.mock('@/lib/healthChecks', () => healthMock)
vi.mock('@/lib/redisTelemetry', () => telemetryMock)

import { GET } from './route'
import { createToken } from '@/lib/auth'
import { AVISO_AMOSTRA_NAO_OFICIAL } from '@/lib/redisUsageAlerts'

function makeReq(token?: string | null) {
  return {
    cookies: { get: (name: string) => (name === 'auth-token' && token ? { value: token } : undefined) },
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  redisMock.set.mockResolvedValue('OK')
})

describe('GET /api/dev/redis-status — autenticação', () => {
  it('retorna 401 sem token', async () => {
    const res = await GET(makeReq(null))
    expect(res.status).toBe(401)
  })

  it('retorna 403 para role atendente', async () => {
    const token = await createToken({ username: 'kellyne', name: 'Kellyne', role: 'atendente' })
    const res = await GET(makeReq(token))
    expect(res.status).toBe(403)
  })

  it('permite role dev', async () => {
    const token = await createToken({ username: 'ominix', name: 'Ominix Dev', role: 'dev' })
    const res = await GET(makeReq(token))
    expect(res.status).toBe(200)
  })

  it('permite role admin', async () => {
    const token = await createToken({ username: 'brito', name: 'Brito', role: 'admin' })
    const res = await GET(makeReq(token))
    expect(res.status).toBe(200)
  })
})

describe('GET /api/dev/redis-status — terminologia nunca afirma dado oficial ou estimativa completa (cenário obrigatório 8)', () => {
  it('a resposta nunca contém as palavras "oficial" ou "completa" fora dos campos de aviso/disclaimer', async () => {
    const token = await createToken({ username: 'ominix', name: 'Ominix Dev', role: 'dev' })
    const res = await GET(makeReq(token))
    const body = await res.json()

    // Os únicos lugares onde "oficial" pode aparecer são os campos de aviso
    // explícitos (avisoOficial) — nunca dentro de um rótulo/valor que
    // afirme "isto é o dado oficial" ou "isto é completo".
    expect(body.amostra.fonte).toBe('amostra_interna_observada')
    expect(body.amostra.fonte).not.toMatch(/oficial/i)
    expect(body.amostra.fonte).not.toMatch(/completa/i)

    expect(body.tendencia.tipo).toBe('tendencia_interna_nao_oficial')
    expect(body.tendencia.tipo).not.toBe('cota_oficial')
    expect(body.tendencia.tipo).not.toBe('estimativa_completa')

    // Os campos numéricos não usam nomes que implicam ser o dado oficial.
    expect(body.tendencia).toHaveProperty('amostraObservada')
    expect(body.tendencia).not.toHaveProperty('usoOficial')
    expect(body.tendencia).not.toHaveProperty('cotaOficial')
  })

  it('todo bloco relevante carrega o aviso de não-oficialidade explícito', async () => {
    const token = await createToken({ username: 'ominix', name: 'Ominix Dev', role: 'dev' })
    const res = await GET(makeReq(token))
    const body = await res.json()

    expect(body.configuracao.avisoOficial).toBe(AVISO_AMOSTRA_NAO_OFICIAL)
    expect(body.configuracao.avisoOficial).toMatch(/Upstash/)
    expect(body.configuracao.avisoOficial).toMatch(/NÃO.*oficial/i)
  })

  it('renomeou o campo de configuração de limite para deixar claro que é referência, não cota real lida da Upstash', async () => {
    const token = await createToken({ username: 'ominix', name: 'Ominix Dev', role: 'dev' })
    const res = await GET(makeReq(token))
    const body = await res.json()

    expect(body.configuracao).toHaveProperty('limiteReferenciaComandosMensal')
    expect(body.configuracao).not.toHaveProperty('limiteComandosMensal')
  })
})
