import { describe, it, expect } from 'vitest'
import {
  isDesistencia,
  isNovaSaudacao,
  recortarMensagensRecentes,
  filtrarMensagensDoCiclo,
} from './ciclos'
import type { MensagemRelevante } from './bot'

function msg(autor: 'cliente' | 'atendente' | 'bot', texto: string, ts?: number): MensagemRelevante {
  return { autor, texto, ...(ts !== undefined ? { ts } : {}) }
}
function msgCiclo(autor: 'cliente' | 'atendente', texto: string, cicloId: string, ts?: number): MensagemRelevante & { cicloId: string } {
  return { autor, texto, cicloId, ...(ts !== undefined ? { ts } : {}) }
}

const MIN = 60 * 1000
const H = 60 * MIN

// ─── 1. Pedido finalizado abre novo ciclo na próxima mensagem ─────────────────
describe('recortarMensagensRecentes', () => {
  it('corta antes de desistência do cliente', () => {
    const agora = Date.now()
    const msgs: MensagemRelevante[] = [
      msg('cliente', 'quero uma pizza',       agora - 10 * MIN),
      msg('cliente', 'desisti',                agora - 9 * MIN),   // desistência
      msg('cliente', 'boa tarde',              agora - 2 * MIN),   // novo ciclo começa aqui
      msg('atendente', 'oi, como posso ajudar?', agora - 1 * MIN),
      msg('cliente', 'quero pizza de frango',  agora),
    ]
    const resultado = recortarMensagensRecentes(msgs, agora)
    // Deve cortar após a desistência — retorna mensagens a partir de 'boa tarde'
    expect(resultado[0].texto).toBe('boa tarde')
    expect(resultado.some(m => m.texto === 'desisti')).toBe(false)
    expect(resultado.some(m => m.texto === 'quero pizza de frango')).toBe(true)
  })

  // ─── 2. Conversa abandonada por tempo abre novo ciclo ─────────────────────
  it('corta ao encontrar gap > 2h com nova saudação', () => {
    const agora = Date.now()
    const msgs: MensagemRelevante[] = [
      msg('cliente', 'quero pizza',   agora - 5 * H),     // conversa antiga
      msg('atendente', 'claro!',       agora - 5 * H + MIN),
      msg('cliente', 'oi boa tarde',   agora - 1 * MIN),  // novo ciclo após gap > 2h
      msg('atendente', 'olá!',         agora),
    ]
    const resultado = recortarMensagensRecentes(msgs, agora)
    expect(resultado[0].texto).toBe('oi boa tarde')
    expect(resultado.some(m => m.texto === 'quero pizza')).toBe(false)
  })

  it('não corta quando gap é pequeno', () => {
    const agora = Date.now()
    const msgs: MensagemRelevante[] = [
      msg('cliente', 'quero pizza',    agora - 30 * MIN),
      msg('atendente', 'qual sabor?',  agora - 25 * MIN),
      msg('cliente', 'calabresa',      agora - 20 * MIN),
    ]
    const resultado = recortarMensagensRecentes(msgs, agora)
    expect(resultado).toHaveLength(3)
  })

  it('corta ao gap > 24h sem saudação', () => {
    const agora = Date.now()
    const msgs: MensagemRelevante[] = [
      msg('cliente', 'ontem pedi pizza',   agora - 25 * H),
      msg('cliente', 'hoje quero de novo', agora),
    ]
    const resultado = recortarMensagensRecentes(msgs, agora)
    expect(resultado).toHaveLength(1)
    expect(resultado[0].texto).toBe('hoje quero de novo')
  })
})

// ─── 3. Cliente desistiu fecha ciclo ─────────────────────────────────────────
describe('isDesistencia', () => {
  const casos = [
    'deixa pra depois', 'vou ver aqui', 'não quero mais', 'cancela',
    'desisti', 'mais tarde eu peço', 'depois eu falo', 'não vou querer',
    'obrigado era só isso', 'mudei de ideia',
  ]
  casos.forEach(txt => {
    it(`detecta: "${txt}"`, () => {
      expect(isDesistencia(txt)).toBe(true)
    })
  })
  it('não detecta mensagem normal', () => {
    expect(isDesistencia('quero uma pizza de calabresa')).toBe(false)
  })
})

// ─── 4. Pedido combinado usa apenas ciclo atual ───────────────────────────────
describe('filtrarMensagensDoCiclo', () => {
  it('retorna somente mensagens do cicloId informado', () => {
    const msgs = [
      msgCiclo('cliente', 'pizza ontem',  'ciclo-antigo'),
      msgCiclo('cliente', 'pizza hoje',   'ciclo-novo'),
      msgCiclo('atendente', 'qual bairro?', 'ciclo-novo'),
      msgCiclo('cliente', 'centro',       'ciclo-novo'),
    ]
    const resultado = filtrarMensagensDoCiclo(msgs as MensagemRelevante[], 'ciclo-novo')
    expect(resultado).toHaveLength(3)
    expect(resultado.every(m => (m as any).cicloId === 'ciclo-novo')).toBe(true)
    expect(resultado.some(m => m.texto === 'pizza ontem')).toBe(false)
  })

  // ─── 7. Conversa antiga não contamina pedido atual ────────────────────────
  it('exclui mensagens de ciclos anteriores', () => {
    const msgs = [
      msgCiclo('cliente', 'pedi pizza na sexta',  'ciclo-semana-passada'),
      msgCiclo('cliente', 'agora quero hamburguer', 'ciclo-atual'),
    ]
    const resultado = filtrarMensagensDoCiclo(msgs as MensagemRelevante[], 'ciclo-atual')
    expect(resultado).toHaveLength(1)
    expect(resultado[0].texto).toBe('agora quero hamburguer')
  })
})

// ─── 5. Histórico antigo sem cicloId ainda funciona por fallback ──────────────
describe('filtrarMensagensDoCiclo — fallback sem cicloId', () => {
  it('usa recortarMensagensRecentes quando nenhuma mensagem tem cicloId', () => {
    const agora = Date.now()
    const msgs: MensagemRelevante[] = [
      msg('cliente', 'pedido de ontem',    agora - 25 * H),
      msg('cliente', 'pedido de hoje',     agora),
    ]
    const resultado = filtrarMensagensDoCiclo(msgs, null)
    expect(resultado).toHaveLength(1)
    expect(resultado[0].texto).toBe('pedido de hoje')
  })

  it('usa fallback quando cicloId não casa com nenhuma mensagem', () => {
    const agora = Date.now()
    const msgs: MensagemRelevante[] = [
      msg('cliente', 'pizza grande', agora - 5 * MIN),
      msg('cliente', 'dinheiro',     agora - 2 * MIN),
    ]
    // cicloId que não existe nas mensagens → fallback
    const resultado = filtrarMensagensDoCiclo(msgs, 'ciclo-inexistente')
    expect(resultado).toHaveLength(2)
  })
})

// ─── 6. Modo manual continua salvando mensagens do cliente ───────────────────
describe('isNovaSaudacao', () => {
  it('detecta saudações comuns', () => {
    expect(isNovaSaudacao('oi')).toBe(true)
    expect(isNovaSaudacao('boa tarde')).toBe(true)
    expect(isNovaSaudacao('bom dia tudo bem')).toBe(true)
  })
  it('não detecta pedido como saudação', () => {
    expect(isNovaSaudacao('quero pizza de calabresa')).toBe(false)
    expect(isNovaSaudacao('dinheiro')).toBe(false)
  })
})

// ─── 8. Conversa atual incompleta mostra pendências ──────────────────────────
describe('filtrarMensagensDoCiclo — conversa incompleta', () => {
  it('retorna mensagens incompletas do ciclo atual (sem endereço/bairro)', () => {
    const msgs = [
      msgCiclo('cliente', 'quero pizza de frango',  'ciclo-atual'),
      msgCiclo('atendente', 'qual o endereço?',      'ciclo-atual'),
      // cliente não respondeu ainda
    ]
    const resultado = filtrarMensagensDoCiclo(msgs as MensagemRelevante[], 'ciclo-atual')
    expect(resultado).toHaveLength(2)
    // O resultado não tem endereço — pendências serão geradas pelo GET do pedido-combinado
    expect(resultado.some(m => m.texto === 'qual o endereço?')).toBe(true)
  })
})
