// Ranking de Clientes — projeção tenant+temporada de saldo de estrelas/pontos.
// Domínio próprio; NÃO reutiliza /api/ranking (que é ranking de produtos).
// A projeção é rebuildable a partir do ledger canônico de pontos.
//
// Pesos de ranking por tipo de ação estão PENDENTES de decisão comercial.
// Por enquanto o score é o saldo de estrelas/pontos creditados na temporada.
// Sem PII exposta no ranking público (só ID interno e posição/score).

import { redis } from "./redis";

const TAMANHO_MAXIMO = 50;

// Sorted set: `ranking:clientes:{tenantId}:{temporadaId}`
// score = saldo acumulado na temporada; member = clienteId
function chaveRanking(tenantId: string, temporadaId: string): string {
  return `ranking:clientes:${tenantId}:${temporadaId}`;
}

export type EntradaRanking = {
  clienteId: string;
  score: number;
  posicao: number;
};

type RedisComZset = typeof redis & {
  zadd: (key: string, opts: { score: number; member: string } | Array<{ score: number; member: string }>) => Promise<number>;
  zrange: (key: string, start: number | string, stop: number | string, opts?: { rev?: boolean; withScores?: boolean }) => Promise<string[]>;
  zscore: (key: string, member: string) => Promise<number | null>;
  zrevrank: (key: string, member: string) => Promise<number | null>;
};

const zredis = redis as RedisComZset;

export async function atualizarScoreRanking(
  tenantId: string,
  temporadaId: string,
  clienteId: string,
  score: number,
): Promise<void> {
  if (!tenantId || !temporadaId || !clienteId) return;
  const s = Number.isFinite(score) && score >= 0 ? Math.round(score) : 0;
  await zredis.zadd(chaveRanking(tenantId, temporadaId), { score: s, member: clienteId });
}

export async function obterTopRanking(
  tenantId: string,
  temporadaId: string,
  limite = 10,
): Promise<EntradaRanking[]> {
  if (!tenantId || !temporadaId) return [];
  const n = Math.min(Math.max(1, Math.round(limite)), TAMANHO_MAXIMO);
  const chave = chaveRanking(tenantId, temporadaId);
  const membros = (await zredis.zrange(chave, 0, n - 1, { rev: true })) as string[];
  if (!membros || membros.length === 0) return [];
  const entradas: EntradaRanking[] = await Promise.all(
    membros.map(async (clienteId: string, idx: number) => {
      const s = await zredis.zscore(chave, clienteId);
      return { clienteId, score: s ?? 0, posicao: idx + 1 };
    }),
  );
  return entradas;
}

export async function posicaoClienteRanking(
  tenantId: string,
  temporadaId: string,
  clienteId: string,
): Promise<{ posicao: number; score: number } | null> {
  if (!tenantId || !temporadaId || !clienteId) return null;
  const chave = chaveRanking(tenantId, temporadaId);
  const score = await zredis.zscore(chave, clienteId);
  if (score === null || score === undefined) return null;
  const rank = await zredis.zrevrank(chave, clienteId);
  if (rank === null || rank === undefined) return null;
  return { posicao: rank + 1, score };
}
