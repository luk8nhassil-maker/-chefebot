// eventTap.ts — único ponto de entrada do MCP para a fila Redis.
// Escreve SOMENTE em mcp:fila:eventos (+ contador sanitizado de descarte).
// Chamado pelo webhook via after() ou fire-and-forget; nunca bloqueia a resposta.
//
// Capacidade (evolução Fase 1 — noites movimentadas): enfileirar é 1 único
// round-trip Redis (EVAL), não 3 comandos separados, e nunca podem faltar
// vagas silenciosamente sem contagem — todo descarte por fila cheia é
// somado num contador sanitizado (mcp:meta:fila:descartados) que o painel
// /dev/mcp expõe. Protegido por circuit breaker + timeout curto: uma falha
// ou lentidão do Redis aqui nunca pode propagar para o webhook do WhatsApp.

import { redis } from '@/lib/redis';
import type { McpEventoFila } from './types';
import { comTimeout } from './lib/withTimeout';
import { circuitoPermiteTentativa, registrarSucessoCircuito, registrarFalhaCircuito } from './lib/circuitBreaker';

const CHAVE_FILA = 'mcp:fila:eventos';
const CHAVE_DESCARTADOS = 'mcp:meta:fila:descartados';
export const MAX_FILA = 10_000;
export const TTL_FILA_S = 72 * 60 * 60; // 72h — cobre um fim de semana inteiro de pico
const TTL_DESCARTADOS_S = 7 * 24 * 60 * 60;
const TIMEOUT_ENFILEIRAR_MS = 1500;

// RPUSH + LLEN + (LTRIM condicional + INCRBY descarte) + EXPIRE em um único
// round-trip. Só trunca/descarta quando a fila realmente estourou o limite —
// no dia a dia (fila << MAX_FILA) o script não faz LTRIM nenhum.
const LUA_ENFILEIRAR = `
local fila = KEYS[1]
local chaveDescartados = KEYS[2]
local evento = ARGV[1]
local maxFila = tonumber(ARGV[2])
local ttlFila = tonumber(ARGV[3])
local ttlDescartados = tonumber(ARGV[4])

redis.call('RPUSH', fila, evento)
local tamanho = redis.call('LLEN', fila)
local descartadosAgora = 0
if tamanho > maxFila then
  descartadosAgora = tamanho - maxFila
  redis.call('LTRIM', fila, descartadosAgora, -1)
  redis.call('INCRBY', chaveDescartados, descartadosAgora)
  redis.call('EXPIRE', chaveDescartados, ttlDescartados)
end
redis.call('EXPIRE', fila, ttlFila)
return descartadosAgora
`;

export async function enfileirarEventoMcp(evento: McpEventoFila): Promise<void> {
  if (!circuitoPermiteTentativa()) return; // fail-open: circuito aberto, nem tenta

  try {
    await comTimeout(
      redis.eval(
        LUA_ENFILEIRAR,
        [CHAVE_FILA, CHAVE_DESCARTADOS],
        [JSON.stringify(evento), String(MAX_FILA), String(TTL_FILA_S), String(TTL_DESCARTADOS_S)],
      ),
      TIMEOUT_ENFILEIRAR_MS,
      'enfileirarEventoMcp',
    );
    registrarSucessoCircuito();
  } catch (err) {
    registrarFalhaCircuito();
    throw err; // caller (webhook) já isola e loga via logErroMcp — fail-open preservado
  }
}
