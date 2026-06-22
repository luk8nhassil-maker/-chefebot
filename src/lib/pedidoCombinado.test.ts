import { describe, it, expect } from 'vitest'
import { extrairDaConversa } from './pedidoCombinado'
import type { MensagemRelevante } from './bot'

function cliente(texto: string): MensagemRelevante { return { autor: 'cliente', texto } }
function atendente(texto: string): MensagemRelevante { return { autor: 'atendente', texto } }

describe('extrairDaConversa', () => {
  it('detecta pizza família, sabores, endereço, bairro, dinheiro e sem troco', () => {
    const msgs: MensagemRelevante[] = [
      atendente('Olá! O que vai querer?'),
      cliente('quero uma pizza tamanho familia sabor calabresa e 3 queijo'),
      atendente('Quer bebida?'),
      cliente('não'),
      atendente('Qual o endereço de entrega?'),
      cliente('rua do caju, 24 próximo ao bar do bide'),
      atendente('Qual o bairro?'),
      cliente('tucum'),
      atendente('Qual a forma de pagamento?'),
      cliente('dinheiro'),
      atendente('Vai precisar de troco?'),
      cliente('nao'),
    ]
    const resultado = extrairDaConversa(msgs)

    expect(resultado.itens.length).toBeGreaterThan(0)
    expect(resultado.itens[0]).toContain('pizza')
    expect(resultado.endereco).toBe('rua do caju, 24 próximo ao bar do bide')
    expect(resultado.bairro).toBe('tucum')
    expect(resultado.pagamento).toBe('Dinheiro')
    expect(resultado.troco).toBe('Sem troco')
    expect(resultado.tipoEntrega).toBe('delivery')
  })

  it('não confunde negação de bebida com pagamento', () => {
    const msgs: MensagemRelevante[] = [
      atendente('Quer bebida?'),
      cliente('não'),
      atendente('Qual a forma de pagamento?'),
      cliente('pix'),
    ]
    const resultado = extrairDaConversa(msgs)
    expect(resultado.pagamento).toBe('Pix')
    expect(resultado.itens).toHaveLength(0)
  })

  it('detecta endereço sem atendente perguntar (fallback)', () => {
    const msgs: MensagemRelevante[] = [
      cliente('pizza grande calabresa'),
      cliente('rua das flores, 100 perto do mercado'),
      cliente('centro'),
      cliente('cartão'),
    ]
    const resultado = extrairDaConversa(msgs)
    expect(resultado.itens).toContain('pizza grande calabresa')
    expect(resultado.endereco).toBe('rua das flores, 100 perto do mercado')
    expect(resultado.bairro).toBe('centro')
    expect(resultado.pagamento).toBe('Cartão')
    expect(resultado.tipoEntrega).toBe('delivery')
  })

  it('detecta retirada', () => {
    const msgs: MensagemRelevante[] = [
      cliente('pizza média de frango'),
      cliente('vou buscar no local'),
    ]
    const resultado = extrairDaConversa(msgs)
    expect(resultado.tipoEntrega).toBe('retirada')
  })

  it('retorna campos vazios quando sem informações', () => {
    const resultado = extrairDaConversa([])
    expect(resultado.itens).toHaveLength(0)
    expect(resultado.endereco).toBe('')
    expect(resultado.bairro).toBe('')
    expect(resultado.pagamento).toBe('')
    expect(resultado.troco).toBe('')
    expect(resultado.tipoEntrega).toBe('')
  })

  it('detecta cartão de crédito', () => {
    const msgs: MensagemRelevante[] = [
      atendente('Qual a forma de pagamento?'),
      cliente('crédito'),
    ]
    const resultado = extrairDaConversa(msgs)
    expect(resultado.pagamento).toBe('Cartão de Crédito')
  })

  it('detecta pix', () => {
    const msgs: MensagemRelevante[] = [
      atendente('Qual a forma de pagamento?'),
      cliente('pix'),
    ]
    const resultado = extrairDaConversa(msgs)
    expect(resultado.pagamento).toBe('Pix')
  })

  it('detecta troco com valor', () => {
    const msgs: MensagemRelevante[] = [
      atendente('Precisa de troco?'),
      cliente('para 50 reais'),
    ]
    const resultado = extrairDaConversa(msgs)
    expect(resultado.troco).toBe('para 50 reais')
  })
})
