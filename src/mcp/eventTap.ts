// eventTap.ts — único ponto de entrada do MCP para a fila Redis.
// Escreve SOMENTE em mcp:fila:eventos. Nenhum outro write permitido aqui.
// Chamado pelo webhook via after() ou fire-and-forget; nunca bloqueia a resposta.

import { redis } from '@/lib/redis';
import type { McpEventoFila } from './types';

const CHAVE_FILA = 'mcp:fila:eventos';
const MAX_FILA = 1000;
const TTL_FILA_S = 2 * 60 * 60; // 2h — eventos velhos sem interesse

export async function enfileirarEventoMcp(evento: McpEventoFila): Promise<void> {
  await redis.rpush(CHAVE_FILA, JSON.stringify(evento));
  await redis.ltrim(CHAVE_FILA, -MAX_FILA, -1);
  await redis.expire(CHAVE_FILA, TTL_FILA_S);
}
