import { describe, it, expect } from 'vitest';
import type { McpEventoFila, McpLogEntryObs, McpLogEntryErro } from '../types';

describe('McpEventoFila — campos obrigatórios e proibidos', () => {
  const eventoValido: McpEventoFila = {
    phoneHash: '***4821',
    msgId: 'ABC123',
    stepAntes: 'flavor',
    stepDepois: 'border_escolha',
    houveMudancaStep: true,
    cartLength: 1,
    deliveryType: 'delivery',
    precisouIA: false,
    escalou: false,
    foiFallbackSeco: false,
    timestamp: 1700000000000,
  };

  it('aceita evento válido com todos os campos', () => {
    expect(eventoValido.phoneHash).toBe('***4821');
    expect(eventoValido.msgId).toBe('ABC123');
  });

  it('phoneHash nunca é um número de telefone cru', () => {
    expect(eventoValido.phoneHash).not.toMatch(/^\d{10,}/);
  });

  it('não há campo phone, nome, endereco, mensagem ou itens', () => {
    const keys = Object.keys(eventoValido);
    expect(keys).not.toContain('phone');
    expect(keys).not.toContain('nome');
    expect(keys).not.toContain('endereco');
    expect(keys).not.toContain('mensagem');
    expect(keys).not.toContain('itens');
    expect(keys).not.toContain('valor');
  });

  it('cartLength é número, não array de itens', () => {
    expect(typeof eventoValido.cartLength).toBe('number');
  });

  it('deliveryType é opcional', () => {
    const semEntrega: McpEventoFila = { ...eventoValido, deliveryType: undefined };
    expect(semEntrega.deliveryType).toBeUndefined();
  });
});

describe('McpLogEntryObs — sem PII', () => {
  const obs: McpLogEntryObs = {
    ts: Date.now(),
    phoneHash: '***4821',
    stepAntes: 'flavor',
    stepDepois: 'border_escolha',
    houveMudancaStep: true,
    cartLength: 1,
    precisouIA: false,
    escalou: false,
    foiFallbackSeco: false,
    padraoObservado: 'avanco_normal',
    confiancaEstrutura: 0.9,
  };

  it('não tem campo phone, nome, endereco ou mensagem', () => {
    const keys = Object.keys(obs);
    expect(keys).not.toContain('phone');
    expect(keys).not.toContain('nome');
    expect(keys).not.toContain('endereco');
    expect(keys).not.toContain('mensagem');
  });

  it('confiancaEstrutura está entre 0 e 1', () => {
    expect(obs.confiancaEstrutura).toBeGreaterThanOrEqual(0);
    expect(obs.confiancaEstrutura).toBeLessThanOrEqual(1);
  });
});

describe('McpLogEntryErro — estrutura mínima', () => {
  const erro: McpLogEntryErro = {
    ts: Date.now(),
    origem: 'enfileirarEventoMcp',
    mensagem: 'timeout',
  };

  it('tem ts, origem e mensagem', () => {
    expect(erro.ts).toBeTypeOf('number');
    expect(erro.origem).toBeTypeOf('string');
    expect(erro.mensagem).toBeTypeOf('string');
  });
});
