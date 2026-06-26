import { vi, describe, test, expect, beforeEach } from 'vitest'

vi.mock('./redis', () => ({
  redis: {
    zadd: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
    zrange: vi.fn(),
    zcard: vi.fn(),
    keys: vi.fn(),
  },
}))

import { redis as redisMock } from './redis'

import { atualizarHistorico, CONVERSAS_ZSET, MAX_FULL_MSGS } from './conversasHistorico'

beforeEach(() => {
  vi.clearAllMocks()
  redisMock.zadd.mockResolvedValue(1)
  redisMock.get.mockResolvedValue(null)
  redisMock.set.mockResolvedValue('OK')
})

describe('atualizarHistorico: ZSET', () => {
  test('registra phone no ZSET com score igual ao ts', async () => {
    const ts = 1700000000000
    await atualizarHistorico('5586999990001', 'cliente', 'Oi', ts)
    expect(redisMock.zadd).toHaveBeenCalledWith(CONVERSAS_ZSET, { score: ts, member: '5586999990001' })
  })

  test('atualiza ZSET a cada nova mensagem do mesmo telefone', async () => {
    const ts1 = 1700000000000
    const ts2 = 1700000001000
    await atualizarHistorico('5586999990002', 'bot', 'Olá!', ts1)
    await atualizarHistorico('5586999990002', 'cliente', 'Quero pizza', ts2)
    expect(redisMock.zadd).toHaveBeenCalledTimes(2)
    expect(redisMock.zadd).toHaveBeenLastCalledWith(CONVERSAS_ZSET, { score: ts2, member: '5586999990002' })
  })
})

describe('atualizarHistorico: conversa_meta', () => {
  test('cria meta com campos corretos na primeira mensagem', async () => {
    const ts = 1700000000000
    await atualizarHistorico('5586999990003', 'cliente', 'Quero um lanche', ts, 'Ana')
    const setCall = redisMock.set.mock.calls.find(c => c[0] === 'conversa_meta:5586999990003')
    expect(setCall).toBeDefined()
    const meta = setCall[1]
    expect(meta.phone).toBe('5586999990003')
    expect(meta.nome).toBe('Ana')
    expect(meta.ultimaMensagem).toBe('Quero um lanche')
    expect(meta.ultimaTs).toBe(ts)
  })

  test('mantém nome existente quando nomeCliente não é fornecido', async () => {
    redisMock.get.mockImplementation(async (key: string) => {
      if (key === 'conversa_meta:5586999990004') {
        return { phone: '5586999990004', nome: 'João', ultimaMensagem: 'oi', ultimaTs: 1000, mensagensCount: 1 }
      }
      return null
    })
    await atualizarHistorico('5586999990004', 'bot', 'Como posso ajudar?', 2000)
    const setCall = redisMock.set.mock.calls.find(c => c[0] === 'conversa_meta:5586999990004')
    expect(setCall[1].nome).toBe('João')
  })

  test('usa customerName da session quando nome não está disponível', async () => {
    redisMock.get.mockImplementation(async (key: string) => {
      if (key === 'session:5586999990005') return { customerName: 'Maria', step: 'flavor' }
      return null
    })
    await atualizarHistorico('5586999990005', 'cliente', 'Calabresa', 3000)
    const setCall = redisMock.set.mock.calls.find(c => c[0] === 'conversa_meta:5586999990005')
    expect(setCall[1].nome).toBe('Maria')
  })

  test('usa phone como fallback de nome quando nenhuma fonte está disponível', async () => {
    await atualizarHistorico('5586999990006', 'cliente', 'oi', 4000)
    const setCall = redisMock.set.mock.calls.find(c => c[0] === 'conversa_meta:5586999990006')
    expect(setCall[1].nome).toBe('5586999990006')
  })

  test('trunca ultimaMensagem a 200 chars no meta', async () => {
    const longa = 'x'.repeat(300)
    await atualizarHistorico('5586999990007', 'cliente', longa, 5000)
    const setCall = redisMock.set.mock.calls.find(c => c[0] === 'conversa_meta:5586999990007')
    expect(setCall[1].ultimaMensagem.length).toBe(200)
  })
})

describe('atualizarHistorico: conversa_full', () => {
  test('cria conversa_full com a primeira mensagem', async () => {
    const ts = 6000
    await atualizarHistorico('5586999990008', 'bot', 'Bem-vindo!', ts)
    const setCall = redisMock.set.mock.calls.find(c => c[0] === 'conversa_full:5586999990008')
    expect(setCall).toBeDefined()
    expect(setCall[1]).toHaveLength(1)
    expect(setCall[1][0].texto).toBe('Bem-vindo!')
    expect(setCall[1][0].autor).toBe('bot')
    expect(setCall[1][0].ts).toBe(ts)
  })

  test('trunca texto a 400 chars no full history', async () => {
    const longa = 'y'.repeat(500)
    await atualizarHistorico('5586999990009', 'cliente', longa, 7000)
    const setCall = redisMock.set.mock.calls.find(c => c[0] === 'conversa_full:5586999990009')
    expect(setCall[1][0].texto.length).toBe(400)
  })

  test(`limita histórico a ${MAX_FULL_MSGS} mensagens`, async () => {
    const existing = Array.from({ length: MAX_FULL_MSGS }, (_, i) => ({
      autor: 'cliente' as const,
      texto: `msg ${i}`,
      ts: i * 1000,
    }))
    redisMock.get.mockImplementation(async (key: string) => {
      if (key === 'conversa_full:5586999990010') return existing
      return null
    })
    await atualizarHistorico('5586999990010', 'bot', 'nova msg', MAX_FULL_MSGS * 1000)
    const setCall = redisMock.set.mock.calls.find(c => c[0] === 'conversa_full:5586999990010')
    expect(setCall[1]).toHaveLength(MAX_FULL_MSGS)
    expect(setCall[1][MAX_FULL_MSGS - 1].texto).toBe('nova msg')
  })

  test('mensagensCount no meta reflete o tamanho do histórico trimado', async () => {
    const existing = Array.from({ length: 5 }, (_, i) => ({
      autor: 'cliente' as const,
      texto: `m${i}`,
      ts: i * 100,
    }))
    redisMock.get.mockImplementation(async (key: string) => {
      if (key === 'conversa_full:5586999990011') return existing
      return null
    })
    await atualizarHistorico('5586999990011', 'bot', 'resposta', 600)
    const setCall = redisMock.set.mock.calls.find(c => c[0] === 'conversa_meta:5586999990011')
    expect(setCall[1].mensagensCount).toBe(6)
  })
})

describe('atualizarHistorico: histórico permanente (sem TTL)', () => {
  test('conversa_full é gravado SEM TTL (não expira com a session)', async () => {
    await atualizarHistorico('5586999990020', 'cliente', 'oi', 8000, 'Ana')
    const setCall = redisMock.set.mock.calls.find(c => c[0] === 'conversa_full:5586999990020')
    expect(setCall).toBeDefined()
    // (key, value) apenas — sem 3º argumento { ex: TTL }
    expect(setCall.length).toBe(2)
  })

  test('conversa_meta é gravado SEM TTL', async () => {
    await atualizarHistorico('5586999990021', 'cliente', 'oi', 9000, 'Ana')
    const setCall = redisMock.set.mock.calls.find(c => c[0] === 'conversa_meta:5586999990021')
    expect(setCall).toBeDefined()
    expect(setCall.length).toBe(2)
  })

  test('append-only preserva cliente, bot e atendente em ordem', async () => {
    let stored: Array<{ autor: string; texto: string; ts: number }> = []
    redisMock.get.mockImplementation(async (key: string) =>
      key === 'conversa_full:5586999990022' ? stored : null,
    )
    redisMock.set.mockImplementation(async (key: string, value: unknown) => {
      if (key === 'conversa_full:5586999990022') stored = value as typeof stored
      return 'OK'
    })
    await atualizarHistorico('5586999990022', 'cliente', 'm1', 1, 'Ana')
    await atualizarHistorico('5586999990022', 'bot', 'm2', 2, 'Ana')
    await atualizarHistorico('5586999990022', 'atendente', 'm3', 3, 'Ana')
    expect(stored.map(m => m.texto)).toEqual(['m1', 'm2', 'm3'])
    expect(stored.map(m => m.autor)).toEqual(['cliente', 'bot', 'atendente'])
  })
})

describe('atualizarHistorico: guards', () => {
  test('não faz nada quando phone é vazio', async () => {
    await atualizarHistorico('', 'cliente', 'texto', Date.now())
    expect(redisMock.zadd).not.toHaveBeenCalled()
  })

  test('não faz nada quando texto é vazio', async () => {
    await atualizarHistorico('5586999990012', 'cliente', '', Date.now())
    expect(redisMock.zadd).not.toHaveBeenCalled()
  })

  test('nunca lança erro mesmo com Redis falhando', async () => {
    redisMock.zadd.mockRejectedValue(new Error('Redis down'))
    await expect(atualizarHistorico('5586999990013', 'bot', 'oi', Date.now())).resolves.toBeUndefined()
  })
})
