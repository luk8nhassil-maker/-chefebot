// mcpLogger.ts — único arquivo do módulo MCP autorizado a escrever no Redis além
// de mcp:fila:eventos. Escreve exclusivamente em mcp:log:obs e mcp:log:erros.
// Todas as entradas de erro são sanitizadas antes de persistir.

import { redis } from '@/lib/redis';
import type { McpLogEntryObs, McpLogEntryErro } from '../types';

const CHAVE_OBS = 'mcp:log:obs';
const CHAVE_ERROS = 'mcp:log:erros';
const MAX_OBS = 500;
const MAX_ERROS = 200;
const TTL_LOG_S = 30 * 24 * 60 * 60; // 30 dias

// Remove sequências longas de dígitos e valores monetários para não salvar PII.
export function sanitizarMensagemErro(raw: unknown): string {
  const str = raw instanceof Error ? raw.message : String(raw);
  return str
    .replace(/\d{8,}/g, '[numero]')
    .replace(/r\$\s*\d[\d.,]*/gi, '[valor]')
    .slice(0, 200);
}

export async function logObservacaoMcp(entrada: McpLogEntryObs): Promise<void> {
  try {
    await redis.rpush(CHAVE_OBS, JSON.stringify(entrada));
    await redis.ltrim(CHAVE_OBS, -MAX_OBS, -1);
    await redis.expire(CHAVE_OBS, TTL_LOG_S);
  } catch {
    // último nó da cadeia de erro do MCP — silencioso por design
  }
}

// Persiste várias observações de uma vez. RPUSH aceita múltiplos valores —
// então um lote de 500 observações continua custando só 3 comandos Redis
// (RPUSH + LTRIM + EXPIRE), igual a um lote de 1. Lança em caso de falha
// (diferente de logObservacaoMcp) porque o cron precisa saber se o lote
// realmente foi persistido antes de remover os eventos correspondentes da
// fila — engolir o erro aqui faria o cron achar que persistiu e perder dados.
export async function logObservacoesEmLoteMcp(entradas: McpLogEntryObs[]): Promise<void> {
  if (entradas.length === 0) return;
  const valores = entradas.map((e) => JSON.stringify(e));
  await redis.rpush(CHAVE_OBS, ...valores);
  await redis.ltrim(CHAVE_OBS, -MAX_OBS, -1);
  await redis.expire(CHAVE_OBS, TTL_LOG_S);
}

export async function logErroMcp(origem: string, err: unknown): Promise<void> {
  try {
    const entry: McpLogEntryErro = {
      ts: Date.now(),
      origem,
      mensagem: sanitizarMensagemErro(err),
    };
    await redis.rpush(CHAVE_ERROS, JSON.stringify(entry));
    await redis.ltrim(CHAVE_ERROS, -MAX_ERROS, -1);
    await redis.expire(CHAVE_ERROS, TTL_LOG_S);
  } catch {
    // último nó da cadeia de erro do MCP — silencioso por design
  }
}
