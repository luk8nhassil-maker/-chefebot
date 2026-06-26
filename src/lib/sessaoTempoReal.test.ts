import { describe, test, expect } from 'vitest'
import { montarSessaoManualMinima } from './sessaoTempoReal'

describe('montarSessaoManualMinima', () => {
  test('reconstrói sessão manual sem inventar carrinho/Pix/pedido/pagamento', () => {
    const s = montarSessaoManualMinima('5586988887777', {
      ultimaMensagem: 'Oi, tudo bem?',
      customerName: 'Ana',
    })
    expect(s.manual).toBe(true)
    expect(s.step).toBe('manual')
    expect(s.stepLabel).toBe('atendimento humano')
    expect(s.cart).toEqual([])
    expect(s.resumoRapido).toBeNull()
    expect(s.postOrderPriority).toBe(false)
    expect(s.lastDigits).toBe('7777')
    expect(s.ultimaMensagem).toBe('Oi, tudo bem?')
    expect(s.customerName).toBe('Ana')
  })

  test('usa defaults seguros quando faltam dados', () => {
    const s = montarSessaoManualMinima('5586988887777')
    expect(s.manual).toBe(true)
    expect(s.ultimaMensagem).toBeNull()
    expect(s.customerName).toBeNull()
    expect(s.conversationAlert).toBe(false)
    expect(s.novaMsgManual).toBe(false)
    expect(s.cart).toEqual([])
    expect(s.resumoRapido).toBeNull()
  })

  test('propaga flags de alerta e nova mensagem', () => {
    const s = montarSessaoManualMinima('5586988887777', {
      conversationAlert: true,
      novaMsgManual: true,
    })
    expect(s.conversationAlert).toBe(true)
    expect(s.novaMsgManual).toBe(true)
  })
})
