import { vi, describe, it, expect } from 'vitest';

vi.mock('@/lib/redis', () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    lrange: vi.fn().mockResolvedValue([]),
  },
}));

import { McpReadOnlyRedisClient, roRedis } from '../lib/readOnlyRedis';

describe('McpReadOnlyRedisClient — métodos permitidos', () => {
  it('expõe get()', () => {
    expect(typeof roRedis.get).toBe('function');
  });

  it('expõe lrange()', () => {
    expect(typeof roRedis.lrange).toBe('function');
  });
});

describe('McpReadOnlyRedisClient — métodos de escrita ausentes', () => {
  it('não tem set()', () => {
    expect((roRedis as unknown as Record<string, unknown>)['set']).toBeUndefined();
  });

  it('não tem del()', () => {
    expect((roRedis as unknown as Record<string, unknown>)['del']).toBeUndefined();
  });

  it('não tem rpush()', () => {
    expect((roRedis as unknown as Record<string, unknown>)['rpush']).toBeUndefined();
  });

  it('não tem expire()', () => {
    expect((roRedis as unknown as Record<string, unknown>)['expire']).toBeUndefined();
  });

  it('não tem ltrim()', () => {
    expect((roRedis as unknown as Record<string, unknown>)['ltrim']).toBeUndefined();
  });
});

describe('McpReadOnlyRedisClient — funcionalidade', () => {
  it('get() retorna null quando chave não existe', async () => {
    const result = await roRedis.get('qualquer:chave');
    expect(result).toBeNull();
  });

  it('lrange() retorna array vazio quando lista não existe', async () => {
    const result = await roRedis.lrange('qualquer:lista', 0, 9);
    expect(result).toEqual([]);
  });

  it('instâncias independentes têm o mesmo comportamento', () => {
    const outra = new McpReadOnlyRedisClient();
    expect(typeof outra.get).toBe('function');
    expect((outra as unknown as Record<string, unknown>)['set']).toBeUndefined();
  });
});
