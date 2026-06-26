import { describe, test, expect } from 'vitest'
import { deveExibirNoTempoReal } from './permanenciaTempoReal'

const MIN = 60 * 1000
const H   = 60 * MIN

// Âncora de tempo fixa para os testes (evita flakiness por clock real)
const agora = new Date('2026-01-01T12:00:00.000Z').getTime()
const passado = (delta: number) => agora - delta

describe('deveExibirNoTempoReal', () => {
  // ── sem timestamp ──────────────────────────────────────────────────────────
  describe('ultimaTs ausente', () => {
    test('exibe conservadoramente quando ultimaTs=0', () => {
      expect(deveExibirNoTempoReal({ step: 'name', manual: false, postOrderPriority: false, ultimaTs: 0, now: agora })).toBe(true)
    })
  })

  // ── pedido finalizado (30 min) ─────────────────────────────────────────────
  describe('step done (30 min)', () => {
    test('exibe quando done há 25 min', () => {
      expect(deveExibirNoTempoReal({ step: 'done', manual: false, postOrderPriority: false, ultimaTs: passado(25 * MIN), now: agora })).toBe(true)
    })

    test('oculta quando done há 31 min', () => {
      expect(deveExibirNoTempoReal({ step: 'done', manual: false, postOrderPriority: false, ultimaTs: passado(31 * MIN), now: agora })).toBe(false)
    })

    test('exatamente no limite de 30 min permanece visível', () => {
      expect(deveExibirNoTempoReal({ step: 'done', manual: false, postOrderPriority: false, ultimaTs: passado(30 * MIN), now: agora })).toBe(true)
    })

    test('1 ms além do limite some', () => {
      expect(deveExibirNoTempoReal({ step: 'done', manual: false, postOrderPriority: false, ultimaTs: passado(30 * MIN + 1), now: agora })).toBe(false)
    })

    test('done+postOrderPriority usa regra de bot (40 min)', () => {
      expect(deveExibirNoTempoReal({ step: 'done', manual: false, postOrderPriority: true, ultimaTs: passado(35 * MIN), now: agora })).toBe(true)
    })

    test('done+postOrderPriority some após 40 min', () => {
      expect(deveExibirNoTempoReal({ step: 'done', manual: false, postOrderPriority: true, ultimaTs: passado(41 * MIN), now: agora })).toBe(false)
    })
  })

  // ── aguardando Pix (60 min) ────────────────────────────────────────────────
  describe('step aguardando_pix (60 min)', () => {
    test('exibe quando pix há 55 min', () => {
      expect(deveExibirNoTempoReal({ step: 'aguardando_pix', manual: false, postOrderPriority: false, ultimaTs: passado(55 * MIN), now: agora })).toBe(true)
    })

    test('oculta quando pix há 61 min', () => {
      expect(deveExibirNoTempoReal({ step: 'aguardando_pix', manual: false, postOrderPriority: false, ultimaTs: passado(61 * MIN), now: agora })).toBe(false)
    })

    test('exatamente no limite de 60 min permanece visível', () => {
      expect(deveExibirNoTempoReal({ step: 'aguardando_pix', manual: false, postOrderPriority: false, ultimaTs: passado(60 * MIN), now: agora })).toBe(true)
    })
  })

  // ── bot em andamento (40 min) ──────────────────────────────────────────────
  describe('bot em andamento (40 min)', () => {
    test('exibe quando conversa há 35 min', () => {
      expect(deveExibirNoTempoReal({ step: 'category', manual: false, postOrderPriority: false, ultimaTs: passado(35 * MIN), now: agora })).toBe(true)
    })

    test('oculta quando conversa há 41 min', () => {
      expect(deveExibirNoTempoReal({ step: 'category', manual: false, postOrderPriority: false, ultimaTs: passado(41 * MIN), now: agora })).toBe(false)
    })

    test('exatamente no limite de 40 min permanece visível', () => {
      expect(deveExibirNoTempoReal({ step: 'payment', manual: false, postOrderPriority: false, ultimaTs: passado(40 * MIN), now: agora })).toBe(true)
    })

    test('escalado sem manual=true segue regra de 40 min', () => {
      expect(deveExibirNoTempoReal({ step: 'escalado', manual: false, postOrderPriority: false, ultimaTs: passado(35 * MIN), now: agora })).toBe(true)
      expect(deveExibirNoTempoReal({ step: 'escalado', manual: false, postOrderPriority: false, ultimaTs: passado(41 * MIN), now: agora })).toBe(false)
    })
  })

  // ── atendimento humano (2 h) ───────────────────────────────────────────────
  describe('manual=true (2 h)', () => {
    test('exibe quando manual há 1h50min', () => {
      expect(deveExibirNoTempoReal({ step: 'escalado', manual: true, postOrderPriority: false, ultimaTs: passado(110 * MIN), now: agora })).toBe(true)
    })

    test('oculta quando manual há 2h1min', () => {
      expect(deveExibirNoTempoReal({ step: 'escalado', manual: true, postOrderPriority: false, ultimaTs: passado(121 * MIN), now: agora })).toBe(false)
    })

    test('exatamente em 2h permanece visível', () => {
      expect(deveExibirNoTempoReal({ step: 'escalado', manual: true, postOrderPriority: false, ultimaTs: passado(2 * H), now: agora })).toBe(true)
    })

    test('manual sobrepõe regra de done (não aplica 30 min)', () => {
      // step=done mas manual=true → regra de 2h prevalece
      expect(deveExibirNoTempoReal({ step: 'done', manual: true, postOrderPriority: false, ultimaTs: passado(35 * MIN), now: agora })).toBe(true)
    })

    test('manual sem timestamp exibe conservadoramente', () => {
      expect(deveExibirNoTempoReal({ step: 'manual', manual: true, postOrderPriority: false, ultimaTs: 0, now: agora })).toBe(true)
    })
  })
})
