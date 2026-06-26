import { vi, describe, it, expect, beforeEach } from 'vitest';

const { mockRpush, mockLtrim, mockExpire } = vi.hoisted(() => ({
  mockRpush: vi.fn().mockResolvedValue(1),
  mockLtrim: vi.fn().mockResolvedValue('OK'),
  mockExpire: vi.fn().mockResolvedValue(1),
}));

vi.mock('@/lib/redis', () => ({
  redis: { rpush: mockRpush, ltrim: mockLtrim, expire: mockExpire },
}));

import { enfileirarEventoMcp } from '../eventTap';
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
  mockRpush.mockClear();
  mockLtrim.mockClear();
  mockExpire.mockClear();
});

describe('enfileirarEventoMcp', () => {
  it('chama rpush na chave correta com JSON do evento', async () => {
    await enfileirarEventoMcp(eventoBase);

    expect(mockRpush).toHaveBeenCalledTimes(1);
    const [chave, payload] = mockRpush.mock.calls[0];
    expect(chave).toBe('mcp:fila:eventos');
    const parsed = JSON.parse(payload as string);
    expect(parsed.phoneHash).toBe('***4821');
    expect(parsed.msgId).toBe('MSG001');
    expect(parsed.stepAntes).toBe('flavor');
  });

  it('payload não contém phone cru, nome, endereco, mensagem ou valor', async () => {
    await enfileirarEventoMcp(eventoBase);
    const payload = JSON.parse(mockRpush.mock.calls[0][1] as string);
    expect(payload).not.toHaveProperty('phone');
    expect(payload).not.toHaveProperty('nome');
    expect(payload).not.toHaveProperty('endereco');
    expect(payload).not.toHaveProperty('mensagem');
    expect(payload).not.toHaveProperty('valor');
    expect(payload).not.toHaveProperty('itens');
  });

  it('chama ltrim para limitar fila a 1000 entradas', async () => {
    await enfileirarEventoMcp(eventoBase);
    expect(mockLtrim).toHaveBeenCalledWith('mcp:fila:eventos', -1000, -1);
  });

  it('chama expire com TTL de 2h', async () => {
    await enfileirarEventoMcp(eventoBase);
    expect(mockExpire).toHaveBeenCalledWith('mcp:fila:eventos', 7200);
  });

  it('funciona sem deliveryType (campo opcional)', async () => {
    const semEntrega: McpEventoFila = { ...eventoBase, deliveryType: undefined };
    await expect(enfileirarEventoMcp(semEntrega)).resolves.toBeUndefined();
  });
});
