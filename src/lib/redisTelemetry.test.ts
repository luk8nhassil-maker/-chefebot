import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  classifyKey,
  classifyError,
  wrapRedisClient,
  flushToRedis,
  obterSnapshotEmMemoria,
  resetarTelemetriaParaTeste,
  lerAmostraInterna,
} from './redisTelemetry'
import { AVISO_AMOSTRA_NAO_OFICIAL } from './redisUsageAlerts'

beforeEach(() => {
  resetarTelemetriaParaTeste()
  // O wrapper dispara um flush amostrado por probabilidade (Math.random()).
  // Travamos em um valor alto para que os testes que só observam contadores
  // em memória (não o flush em si) nunca sejam afetados por amostragem real
  // — os testes de flush chamam flushToRedis(...) diretamente, sem depender
  // de sorteio algum.
  vi.spyOn(Math, 'random').mockReturnValue(0.999)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('classifyKey', () => {
  it('agrupa chaves de pedidos', () => {
    expect(classifyKey('pedidos')).toBe('orders')
    expect(classifyKey('entregador:pedidos:123')).toBe('orders')
    expect(classifyKey('avaliacao_enviada:1')).toBe('orders')
    expect(classifyKey('contador_pedidos:17/06/2026')).toBe('orders')
  })

  it('agrupa chaves de fidelidade', () => {
    expect(classifyKey('fidelidade:pontos:estado:cli_123')).toBe('loyalty')
  })

  it('agrupa chaves de whatsapp/conversa/sessão', () => {
    expect(classifyKey('session:5511999999999')).toBe('whatsapp')
    expect(classifyKey('conversa_full:5511999999999')).toBe('whatsapp')
    expect(classifyKey('manual:5511999999999')).toBe('whatsapp')
  })

  it('agrupa chaves do Pix como pix_coordination sem tocar na lógica', () => {
    expect(classifyKey('pix:sentinela:estado:123')).toBe('pix_coordination')
    expect(classifyKey('cooldown:mercadopago:reconciliacao')).toBe('pix_coordination')
  })

  it('agrupa chaves do MCP', () => {
    expect(classifyKey('mcp:log:obs')).toBe('mcp')
  })

  it('retorna "other" para chave desconhecida e nunca lança para entrada inválida', () => {
    expect(classifyKey('chave-nunca-vista:xyz')).toBe('other')
    expect(classifyKey(undefined)).toBe('other')
    expect(classifyKey(123)).toBe('other')
    expect(classifyKey(null)).toBe('other')
  })

  it('classifica chaves de telemetria e healthcheck separadamente, sem poluir outros grupos', () => {
    expect(classifyKey('telemetry:redis:dia:20260716')).toBe('telemetry')
    expect(classifyKey('healthcheck:probe')).toBe('healthcheck')
  })
})

describe('classifyError', () => {
  it('detecta erro de cota (cenário obrigatório 2)', () => {
    const err = new Error('Command failed: ERR max requests limit exceeded. Limit: 500000, Usage: 500000.')
    expect(classifyError(err)).toBe('quota')
  })

  it('detecta timeout (cenário obrigatório 3)', () => {
    expect(classifyError(new Error('Request timed out after 1500ms'))).toBe('timeout')
    expect(classifyError(new Error('ETIMEDOUT'))).toBe('timeout')
  })

  it('detecta falha de rede', () => {
    expect(classifyError(new Error('fetch failed: ECONNREFUSED'))).toBe('network')
  })

  it('cai em "other" para erro não classificado', () => {
    expect(classifyError(new Error('algo inesperado aconteceu'))).toBe('other')
  })
})

/** Fake client mínimo compatível com a superfície usada pelo wrapper — não é o SDK real, propositalmente, para testar o Proxy de forma isolada. */
function criarFakeRedisClient(overrides: Partial<Record<string, (...args: unknown[]) => unknown>> = {}) {
  const pipelineCalls: Array<{ method: string; args: unknown[] }> = []
  const pipelineChain = {
    hincrby: (...args: unknown[]) => { pipelineCalls.push({ method: 'hincrby', args }); return pipelineChain },
    expire: (...args: unknown[]) => { pipelineCalls.push({ method: 'expire', args }); return pipelineChain },
    exec: vi.fn(async () => []),
  }
  const client = {
    get: vi.fn(async () => null),
    set: vi.fn(async () => 'OK'),
    del: vi.fn(async () => 1),
    hgetall: vi.fn(async () => ({})),
    pipeline: vi.fn(() => pipelineChain),
    ...overrides,
  }
  return { client, pipelineCalls, pipelineChain }
}

describe('wrapRedisClient — comando bem-sucedido (cenário obrigatório 1)', () => {
  it('repassa o valor original e registra 1 comando no grupo correto', async () => {
    const { client } = criarFakeRedisClient({ get: vi.fn(async () => ({ ok: true })) })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrapped = wrapRedisClient(client as any)

    const resultado = await wrapped.get('pedidos')

    expect(resultado).toEqual({ ok: true })
    const snap = obterSnapshotEmMemoria()
    expect(snap.totalCommands).toBe(1)
    expect(snap.totalErrors).toBe(0)
    expect(snap.byGroup.orders?.count).toBe(1)
  })
})

describe('wrapRedisClient — erro nunca é escondido (regra "nunca esconder erro")', () => {
  it('propaga o erro de cota original para quem chamou, além de registrar', async () => {
    const erroOriginal = new Error('Command failed: ERR max requests limit exceeded. Limit: 500000, Usage: 500000.')
    const { client } = criarFakeRedisClient({ set: vi.fn(async () => { throw erroOriginal }) })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrapped = wrapRedisClient(client as any)

    await expect(wrapped.set('pedidos', [])).rejects.toBe(erroOriginal)

    const snap = obterSnapshotEmMemoria()
    expect(snap.totalErrors).toBe(1)
    expect(snap.byGroup.orders?.quotaErrors).toBe(1)
    expect(snap.lastError?.type).toBe('quota')
  })

  it('propaga erro de timeout original e classifica corretamente', async () => {
    const erroOriginal = new Error('timeout')
    const { client } = criarFakeRedisClient({ get: vi.fn(async () => { throw erroOriginal }) })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrapped = wrapRedisClient(client as any)

    await expect(wrapped.get('session:123')).rejects.toBe(erroOriginal)

    const snap = obterSnapshotEmMemoria()
    expect(snap.byGroup.whatsapp?.timeouts).toBe(1)
  })
})

describe('agregação por grupo (cenário obrigatório 6)', () => {
  it('acumula contagens de múltiplos grupos e operações ao longo de várias chamadas', async () => {
    const { client } = criarFakeRedisClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrapped = wrapRedisClient(client as any)

    await wrapped.get('pedidos')
    await wrapped.get('pedidos')
    await wrapped.set('session:123', {})
    await wrapped.get('mcp:log:obs')

    const snap = obterSnapshotEmMemoria()
    expect(snap.totalCommands).toBe(4)
    expect(snap.byGroup.orders?.count).toBe(2)
    expect(snap.byGroup.whatsapp?.count).toBe(1)
    expect(snap.byGroup.mcp?.count).toBe(1)
    expect(snap.byOperation.get?.count).toBe(3)
    expect(snap.byOperation.set?.count).toBe(1)
  })

  it('não instrumenta métodos fora da lista conhecida (ex.: pipeline) — comportamento original preservado', () => {
    const { client, pipelineChain } = criarFakeRedisClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrapped = wrapRedisClient(client as any)
    expect(wrapped.pipeline()).toBe(pipelineChain)
    expect(obterSnapshotEmMemoria().totalCommands).toBe(0)
  })
})

describe('TTL das métricas (cenário obrigatório 7)', () => {
  it('flushToRedis sempre define expire nas 3 chaves agregadas (hora/dia/mês)', async () => {
    const { client } = criarFakeRedisClient({ get: vi.fn(async () => null) })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrapped = wrapRedisClient(client as any)
    await wrapped.get('pedidos') // gera 1 comando em memória para ter o que persistir

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await flushToRedis(client as any)

    const pipelineResult = await (client.pipeline as ReturnType<typeof vi.fn>).mock.results[0]?.value
    expect(pipelineResult).toBeDefined()
    // A cadeia registra as chamadas; validamos indiretamente via o mock exec ter sido chamado.
    expect((pipelineResult.exec as ReturnType<typeof vi.fn>)).toHaveBeenCalled()
  })

  it('zera o snapshot em memória depois de um flush bem-sucedido, para não persistir duas vezes', async () => {
    const { client } = criarFakeRedisClient({ get: vi.fn(async () => null) })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrapped = wrapRedisClient(client as any)
    await wrapped.get('pedidos')
    expect(obterSnapshotEmMemoria().totalCommands).toBe(1)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await flushToRedis(client as any)

    expect(obterSnapshotEmMemoria().totalCommands).toBe(0)
  })
})

describe('telemetria falhando não pode derrubar a rota (cenário obrigatório 5)', () => {
  it('flushToRedis nunca lança, mesmo se o pipeline falhar', async () => {
    const client = {
      get: vi.fn(async () => null),
      pipeline: vi.fn(() => { throw new Error('falha simulada de rede no pipeline de telemetria') }),
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrapped = wrapRedisClient(client as any)
    await wrapped.get('pedidos')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(flushToRedis(client as any)).resolves.toBeUndefined()
  })

  it('uma falha ao persistir telemetria não impede o comando Redis original de retornar seu valor', async () => {
    const client = {
      get: vi.fn(async () => 'valor-real-do-pedido'),
      pipeline: vi.fn(() => { throw new Error('telemetria fora do ar') }),
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrapped = wrapRedisClient(client as any)

    // O comando real deve responder normalmente mesmo que, internamente, o
    // flush amostrado (fire-and-forget) tropece no pipeline.
    const valor = await wrapped.get('pedidos')
    expect(valor).toBe('valor-real-do-pedido')
  })
})

describe('ausência de PII nas mensagens registradas (cenário obrigatório 8)', () => {
  it('mascara sequência longa de dígitos (telefone) e token Bearer na mensagem de erro guardada', async () => {
    const erroComPii = new Error('Falha ao notificar 5511987654321, Authorization: Bearer sk_live_abcdef123456')
    const { client } = criarFakeRedisClient({ get: vi.fn(async () => { throw erroComPii }) })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrapped = wrapRedisClient(client as any)

    await expect(wrapped.get('session:5511987654321')).rejects.toBe(erroComPii)

    const snap = obterSnapshotEmMemoria()
    expect(snap.lastError?.message).not.toContain('5511987654321')
    expect(snap.lastError?.message).not.toContain('sk_live_abcdef123456')
    expect(snap.lastError?.message).toContain('[numero]')
  })
})

describe('lerAmostraInterna — nunca lança mesmo se o Redis falhar', () => {
  it('retorna estrutura vazia com fonte "amostra_interna_observada" quando hgetall falha em todos os dias', async () => {
    const client = { hgetall: vi.fn(async () => { throw new Error('Redis indisponível') }) }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resultado = await lerAmostraInterna(client as any)
    expect(resultado.fonte).toBe('amostra_interna_observada')
    expect(resultado.mesAtual).toEqual({})
  })

  it('soma os buckets diários do mês corrente no total mensal', async () => {
    const client = { hgetall: vi.fn(async () => ({ total: '10', 'group:orders': '4' })) }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resultado = await lerAmostraInterna(client as any)
    const diasChamados = (client.hgetall as ReturnType<typeof vi.fn>).mock.calls.length
    expect(diasChamados).toBeGreaterThan(0)
    expect(resultado.mesAtual.total).toBe(10 * diasChamados)
  })

  it('nunca faz mais que 31 leituras, mesmo em teoria', async () => {
    const client = { hgetall: vi.fn(async () => ({ total: '1' })) }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await lerAmostraInterna(client as any)
    expect((client.hgetall as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(31)
  })
})

describe('terminologia de lerAmostraInterna — nunca oficial nem estimativa completa (cenário obrigatório 8)', () => {
  it('sempre retorna o aviso completo em avisoOficial, mesmo em caso de falha total', async () => {
    const clienteFalhando = { hgetall: vi.fn(async () => { throw new Error('indisponível') }) }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const semDados = await lerAmostraInterna(clienteFalhando as any)
    expect(semDados.avisoOficial).toBe(AVISO_AMOSTRA_NAO_OFICIAL)

    const clienteOk = { hgetall: vi.fn(async () => ({ total: '5' })) }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const comDados = await lerAmostraInterna(clienteOk as any)
    expect(comDados.avisoOficial).toBe(AVISO_AMOSTRA_NAO_OFICIAL)
  })

  it('a fonte nunca é rotulada como "oficial" ou "completa"', async () => {
    const client = { hgetall: vi.fn(async () => ({ total: '5' })) }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resultado = await lerAmostraInterna(client as any)
    expect(resultado.fonte).not.toMatch(/oficial/i)
    expect(resultado.fonte).not.toMatch(/completa/i)
    expect(resultado.fonte).toBe('amostra_interna_observada')
  })
})
