// readOnlyRedis.ts — wrapper que expõe somente leitura do Redis.
// Nenhum método de escrita existe nesta classe: qualquer tentativa de chamar
// set(), del(), rpush() ou expire() resulta em erro de compilação TypeScript.
// Usado pelos resource readers da Fase 2+. Já criado na Fase 1 como infraestrutura.

import { redis } from '@/lib/redis';

export class McpReadOnlyRedisClient {
  async get<T>(key: string): Promise<T | null> {
    return redis.get<T>(key);
  }

  async lrange<T>(key: string, start: number, stop: number): Promise<T[]> {
    return redis.lrange<T>(key, start, stop);
  }

  async llen(key: string): Promise<number> {
    return redis.llen(key);
  }
}

export const roRedis = new McpReadOnlyRedisClient();
