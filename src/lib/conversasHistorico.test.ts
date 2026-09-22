import { vi, describe, test, expect, beforeEach } from 'vitest'
import type { MensagemRelevante } from './bot'
import type { ConversaMeta } from './conversasHistorico'

type ValorRedisHistorico = ConversaMeta | MensagemRelevante[] | { customerName?: string } | null

const { redisMock } = vi.hoisted(() => ({
  redisMock: {
    zadd: vi.fn<(key: string, scoreMember: { score: number; member: string }) => Promise<number>>(),
    get: vi.fn<(key: string) => Promise<ValorRedisHistorico>>(),
    set: vi.fn<(key: string, value: Exclude<ValorRedisHistorico, null>) => Promise<string>>(),
    zrange: vi.fn(),
    zcard: vi.fn(),
    keys: vi.fn(),
  },
}))

vi.mock('./redis', () => ({ redis: redisMock }))

import { atualizarHistorico, CONVERSAS_ZSET, MAX_FULL_MSGS } from './conversasHistorico'

function chamadaSet(chave: string) {
  return redisMock.set.mock.calls.find(([key]) => key === chave)
}

function ehMeta(valor: unknown): valor is ConversaMeta {
  return typeof valor === 'object'
    && valor !== null
    && !Array.isArray(valor)
    && 'phone' in valor
    && 'mensagensCount' in valor
}

function ehMensagens(valor: unknown): valor is MensagemRelevante[] {
  return Array.isArray(valor)
}

function valorMeta(chave: string): ConversaMeta {
  const valor = chamadaSet(chave)?.[1]
  expect(ehMeta(valor)).toBe(true)
  if (!ehMeta(valor)) throw new Error(`Valor Redis inválido para ${chave}`)
  return valor
}

function valorMensagens(chave: string): MensagemRelevante[] {
  const valor = chamadaSet(chave)?.[1]
  expect(ehMensagens(valor)).toBe(true)
  if (!ehMensagens(valor)) throw new Error(`Valor Redis inválido para ${chave}`)
  return valor
}

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
    const setCall = chamadaSet('conversa_meta:5586999990003')
    expect(setCall).toBeDefined()
    const meta = valorMeta('conversa_meta:5586999990003')
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
    expect(valorMeta('conversa_meta:5586999990004').nome).toBe('João')
  })

  test('usa customerName da session quando nome não está disponível', async () => {
    redisMock.get.mockImplementation(async (key: string) => {
      if (key === 'session:5586999990005') return { customerName: 'Maria', step: 'flavor' }
      return null
    })
    await atualizarHistorico('5586999990005', 'cliente', 'Calabresa', 3000)
    expect(valorMeta('conversa_meta:5586999990005').nome).toBe('Maria')
  })

  test('usa phone como fallback de nome quando nenhuma fonte está disponível', async () => {
    await atualizarHistorico('5586999990006', 'cliente', 'oi', 4000)
    expect(valorMeta('conversa_meta:5586999990006').nome).toBe('5586999990006')
  })

  test('trunca ultimaMensagem a 200 chars no meta', async () => {
    const longa = 'x'.repeat(300)
    await atualizarHistorico('5586999990007', 'cliente', longa, 5000)
    expect(valorMeta('conversa_meta:5586999990007').ultimaMensagem.length).toBe(200)
  })
})

describe('atualizarHistorico: conversa_full', () => {
  test('cria conversa_full com a primeira mensagem', async () => {
    const ts = 6000
    await atualizarHistorico('5586999990008', 'bot', 'Bem-vindo!', ts)
    const setCall = chamadaSet('conversa_full:5586999990008')
    expect(setCall).toBeDefined()
    const mensagens = valorMensagens('conversa_full:5586999990008')
    expect(mensagens).toHaveLength(1)
    expect(mensagens[0]?.texto).toBe('Bem-vindo!')
    expect(mensagens[0]?.autor).toBe('bot')
    expect(mensagens[0]?.ts).toBe(ts)
  })

  test('trunca texto a 400 chars no full history', async () => {
    const longa = 'y'.repeat(500)
    await atualizarHistorico('5586999990009', 'cliente', longa, 7000)
    expect(valorMensagens('conversa_full:5586999990009')[0]?.texto.length).toBe(400)
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
    const mensagens = valorMensagens('conversa_full:5586999990010')
    expect(mensagens).toHaveLength(MAX_FULL_MSGS)
    expect(mensagens[MAX_FULL_MSGS - 1]?.texto).toBe('nova msg')
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
    expect(valorMeta('conversa_meta:5586999990011').mensagensCount).toBe(6)
  })
})

describe('atualizarHistorico: histórico permanente (sem TTL)', () => {
  test('conversa_full é gravado SEM TTL (não expira com a session)', async () => {
    await atualizarHistorico('5586999990020', 'cliente', 'oi', 8000, 'Ana')
    const setCall = chamadaSet('conversa_full:5586999990020')
    expect(setCall).toBeDefined()
    // (key, value) apenas — sem 3º argumento { ex: TTL }
    expect(setCall?.length).toBe(2)
  })

  test('conversa_meta é gravado SEM TTL', async () => {
    await atualizarHistorico('5586999990021', 'cliente', 'oi', 9000, 'Ana')
    const setCall = chamadaSet('conversa_meta:5586999990021')
    expect(setCall).toBeDefined()
    expect(setCall?.length).toBe(2)
  })

  test('append-only preserva cliente, bot e atendente em ordem', async () => {
    let stored: MensagemRelevante[] = []
    redisMock.get.mockImplementation(async (key: string) =>
      key === 'conversa_full:5586999990022' ? stored : null,
    )
    redisMock.set.mockImplementation(async (key: string, value: unknown) => {
      if (key === 'conversa_full:5586999990022') {
        if (!ehMensagens(value)) throw new Error('Histórico Redis inválido')
        stored = value
      }
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
