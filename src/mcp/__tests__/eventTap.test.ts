import { vi, describe, it, expect, beforeEach } from 'vitest';

const { mockEval } = vi.hoisted(() => ({
  mockEval: vi.fn().mockResolvedValue(0),
}));

vi.mock('@/lib/redis', () => ({
  redis: { eval: mockEval },
}));

import { enfileirarEventoMcp, MAX_FILA, TTL_FILA_S } from '../eventTap';
import { resetarCircuitoParaTeste } from '../lib/circuitBreaker';
import type { McpEventoFila } from '../types';

const eventoBase: McpEventoFila = {
  phoneHash: '***4821',
  msgId: 'MSG001',
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

beforeEach(() => {
  mockEval.mockClear();
  mockEval.mockResolvedValue(0);
  resetarCircuitoParaTeste();
});

describe('enfileirarEventoMcp', () => {
  it('chama um único EVAL com a chave da fila, evento serializado, limite e TTLs', async () => {
    await enfileirarEventoMcp(eventoBase);

    expect(mockEval).toHaveBeenCalledTimes(1);
    const [script, keys, args] = mockEval.mock.calls[0];
    expect(typeof script).toBe('string');
    expect(keys[0]).toBe('mcp:fila:eventos');
    expect(keys[1]).toBe('mcp:meta:fila:descartados');
    const parsed = JSON.parse(args[0] as string);
    expect(parsed.phoneHash).toBe('***4821');
    expect(parsed.msgId).toBe('MSG001');
    expect(args[1]).toBe(String(MAX_FILA));
    expect(args[2]).toBe(String(TTL_FILA_S));
  });

  it('limite de fila é 10.000 e TTL é 72h', () => {
    expect(MAX_FILA).toBe(10_000);
    expect(TTL_FILA_S).toBe(72 * 60 * 60);
  });

  it('payload não contém phone cru, nome, endereco, mensagem ou valor', async () => {
    await enfileirarEventoMcp(eventoBase);
    const payload = JSON.parse(mockEval.mock.calls[0][2][0] as string);
    expect(payload).not.toHaveProperty('phone');
    expect(payload).not.toHaveProperty('nome');
    expect(payload).not.toHaveProperty('endereco');
    expect(payload).not.toHaveProperty('mensagem');
    expect(payload).not.toHaveProperty('valor');
    expect(payload).not.toHaveProperty('itens');
  });

  it('funciona sem deliveryType (campo opcional)', async () => {
    const semEntrega: McpEventoFila = { ...eventoBase, deliveryType: undefined };
    await expect(enfileirarEventoMcp(semEntrega)).resolves.toBeUndefined();
  });

  it('propaga o erro do Redis para o chamador isolar (fail-open é responsabilidade de quem chama)', async () => {
    mockEval.mockRejectedValueOnce(new Error('redis indisponivel'));
    await expect(enfileirarEventoMcp(eventoBase)).rejects.toThrow('redis indisponivel');
  });

  it('abre o circuito após falhas consecutivas e passa a pular o Redis sem tentar', async () => {
    mockEval.mockRejectedValue(new Error('timeout'));
    for (let i = 0; i < 5; i++) {
      await expect(enfileirarEventoMcp(eventoBase)).rejects.toThrow();
    }
    expect(mockEval).toHaveBeenCalledTimes(5);

    // Circuito aberto: nem chama o Redis.
    await expect(enfileirarEventoMcp(eventoBase)).resolves.toBeUndefined();
    expect(mockEval).toHaveBeenCalledTimes(5);
  });

  it('sucesso depois de falhas reseta o contador do circuito', async () => {
    mockEval.mockRejectedValueOnce(new Error('timeout'));
    await expect(enfileirarEventoMcp(eventoBase)).rejects.toThrow();
    mockEval.mockResolvedValueOnce(0);
    await expect(enfileirarEventoMcp(eventoBase)).resolves.toBeUndefined();

    mockEval.mockRejectedValue(new Error('timeout'));
    for (let i = 0; i < 4; i++) {
      await expect(enfileirarEventoMcp(eventoBase)).rejects.toThrow();
    }
    // Só 4 falhas consecutivas desde o reset — ainda abaixo do limite de 5, continua tentando.
    await expect(enfileirarEventoMcp(eventoBase)).rejects.toThrow();
    expect(mockEval).toHaveBeenCalledTimes(7);
  });
});
