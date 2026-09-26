// Lock exclusivo reutilizável para seções críticas da Gamificação V2 que
// fazem leitura-decisão-escrita de estado (missão semanal, missão de
// indicação) — sem isso, dois pedidos concorrentes podem observar o mesmo
// estado "desbloqueada"/"pendente" e ambos tentarem consumir/concluir a
// mesma missão (blocker crítico apontado na auditoria do #446). Mesmo
// padrão SET NX + token + compare-and-delete já usado em
// rankingBonusTemporada.ts e fidelidadeEfeitos.ts, extraído aqui porque
// mais de um módulo de missão precisa dele.
import "server-only";
import { redis } from "./redis";

const LOCK_TTL_SEGUNDOS = 10;
const LOCK_MAX_TENTATIVAS = 5;
const LOCK_ESPERA_MS = 80;

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tokenLock(): string {
  return `${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

const LIBERAR_LOCK_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

async function liberarLock(chave: string, token: string): Promise<void> {
  const clienteComEval = redis as typeof redis & {
    eval?: (script: string, keys: string[], args: string[]) => Promise<unknown>;
  };
  if (clienteComEval.eval) {
    await clienteComEval.eval(LIBERAR_LOCK_LUA, [chave], [token]);
  } else if ((await redis.get<string>(chave)) === token) {
    await redis.del(chave);
  }
}

/**
 * Executa `fn` sob lock exclusivo de `chave`. Tentativas curtas com backoff
 * fixo; lança se não conseguir o lock em nenhuma tentativa (o chamador trata
 * como falha best-effort, igual ao resto do pipeline de efeitos do pedido —
 * nunca reporta sucesso sem ter executado `fn`).
 */
/**
 * Chave de lock compartilhada entre TODOS os caminhos que recalculam e
 * escrevem a projeção de score de um cliente (fidelidade.ts após um crédito
 * de pontos, rankingScoreTemporadaSync.ts após um crédito/estorno de bônus).
 * Sem ela, duas leituras concorrentes do extrato/bônus podiam terminar com a
 * mais lenta escrevendo por cima da mais rápida com uma base desatualizada
 * (residual de concorrência apontado na auditoria do #446, seção 16).
 */
export function chaveLockScoreRanking(tenantId: string, temporadaId: string, clienteId: string): string {
  return `ranking:score:lock:${tenantId}:${temporadaId}:${clienteId}`;
}

/**
 * Igual a `comBloqueioGamificacao`, mas expõe o TOKEN desta aquisição a
 * `fn` — usado por transições que precisam de uma escrita CAS (compare-and-
 * -set condicionada ao dono do lock, nunca só "rodar dentro da seção
 * crítica") para nunca escrever/apagar o estado depois que o TTL do lock
 * expirou e outro worker já assumiu a mesma chave (ver
 * rankingIndicacaoConversao.ts / BLOCKER 8).
 */
export async function comBloqueioGamificacaoComToken<T>(chave: string, fn: (token: string) => Promise<T>): Promise<T> {
  for (let tentativa = 0; tentativa < LOCK_MAX_TENTATIVAS; tentativa++) {
    const token = tokenLock();
    const adquirido = await redis.set(chave, token, { nx: true, ex: LOCK_TTL_SEGUNDOS });
    if (adquirido) {
      try {
        return await fn(token);
      } finally {
        await liberarLock(chave, token);
      }
    }
    await esperar(LOCK_ESPERA_MS);
  }
  throw new Error(`ranking_gamificacao_lock_indisponivel:${chave}`);
}

export async function comBloqueioGamificacao<T>(chave: string, fn: () => Promise<T>): Promise<T> {
  return comBloqueioGamificacaoComToken(chave, () => fn());
}
