// Projeção rebuildable do ranking de clientes por temporada.
// Regra operacional: saldo de Estrelas V1 dentro da temporada ativa.
// Desempate: quem atingiu o score atual primeiro; depois, ID estável.

import { redis } from "./redis";
import { REGRA_ESTRELAS_V1 } from "./estrelas";
import type { MovimentoPontos } from "./fidelidade";

const TAMANHO_MAXIMO = 50;

// Sorted set: `ranking:clientes:{tenantId}:{temporadaId}`
// score = saldo acumulado na temporada; member = clienteId
function chaveRanking(tenantId: string, temporadaId: string): string {
  return `ranking:clientes:${tenantId}:${temporadaId}`;
}

function chaveOrdem(tenantId: string, temporadaId: string): string {
  return `ranking:clientes:ordem:${tenantId}:${temporadaId}`;
}

export type EntradaRanking = {
  clienteId: string;
  score: number;
  posicao: number;
};

type RedisComZset = typeof redis & {
  zadd: (key: string, opts: { score: number; member: string }) => Promise<number>;
  zrange: (key: string, start: number | string, stop: number | string, opts?: { rev?: boolean }) => Promise<string[]>;
  zscore: (key: string, member: string) => Promise<number | null>;
  zrevrank: (key: string, member: string) => Promise<number | null>;
};

const zredis = redis as RedisComZset;

type CandidatoOrden = { clienteId: string; score: number; primeiroAtingidoEm: number | null };

async function ordenarMembros(tenantId: string, temporadaId: string, membros: string[]): Promise<CandidatoOrden[]> {
  const rankingKey = chaveRanking(tenantId, temporadaId);
  const ordemKey = chaveOrdem(tenantId, temporadaId);
  const candidatos = await Promise.all(membros.map(async (clienteId) => ({
    clienteId,
    score: (await zredis.zscore(rankingKey, clienteId)) ?? 0,
    primeiroAtingidoEm: await zredis.zscore(ordemKey, clienteId),
  })));
  return candidatos.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.primeiroAtingidoEm !== null && b.primeiroAtingidoEm !== null && a.primeiroAtingidoEm !== b.primeiroAtingidoEm) {
      return a.primeiroAtingidoEm - b.primeiroAtingidoEm;
    }
    if (a.primeiroAtingidoEm !== null) return -1;
    if (b.primeiroAtingidoEm !== null) return 1;
    return a.clienteId.localeCompare(b.clienteId);
  });
}

export async function atualizarScoreRanking(
  tenantId: string,
  temporadaId: string,
  clienteId: string,
  score: number,
  primeiroAtingidoEm: number = Date.now(),
): Promise<void> {
  if (!tenantId || !temporadaId || !clienteId) return;
  const s = Number.isFinite(score) && score >= 0 ? Math.round(score) : 0;
  const rankingKey = chaveRanking(tenantId, temporadaId);
  const anterior = await zredis.zscore(rankingKey, clienteId);
  await zredis.zadd(rankingKey, { score: s, member: clienteId });
  // Reconstruções repetidas preservam a ordem original do desempate.
  if (anterior === null || anterior !== s) {
    const ordem = Number.isFinite(primeiroAtingidoEm) ? primeiroAtingidoEm : Date.now();
    await zredis.zadd(chaveOrdem(tenantId, temporadaId), { score: ordem, member: clienteId });
  }
}

export async function obterTopRanking(
  tenantId: string,
  temporadaId: string,
  limite = 10,
): Promise<EntradaRanking[]> {
  if (!tenantId || !temporadaId) return [];
  const n = Math.min(Math.max(1, Math.round(limite)), TAMANHO_MAXIMO);
  const membros = (await zredis.zrange(chaveRanking(tenantId, temporadaId), 0, -1, { rev: true })) as string[];
  const ordenados = await ordenarMembros(tenantId, temporadaId, membros);
  return ordenados.slice(0, n).map((e, index) => ({ clienteId: e.clienteId, score: e.score, posicao: index + 1 }));
}

export async function posicaoClienteRanking(
  tenantId: string,
  temporadaId: string,
  clienteId: string,
): Promise<{ posicao: number; score: number } | null> {
  if (!tenantId || !temporadaId || !clienteId) return null;
  const membros = (await zredis.zrange(chaveRanking(tenantId, temporadaId), 0, -1, { rev: true })) as string[];
  const ordenados = await ordenarMembros(tenantId, temporadaId, membros);
  const index = ordenados.findIndex((e) => e.clienteId === clienteId);
  if (index < 0) return null;
  return { posicao: index + 1, score: ordenados[index].score };
}

/** Calcula o score da temporada sem depender do estado do ranking. */
export function calcularScoreDaTemporada(
  movimentos: MovimentoPontos[],
  inicioMs: number,
  fimMs: number,
): { score: number; primeiroAtingidoEm: number | null } {
  const elegiveis = movimentos
    .filter((m) => m.regraVersao === REGRA_ESTRELAS_V1)
    .map((m) => ({ movimento: m, ms: new Date(m.createdAt).getTime() }))
    .filter(({ ms }) => Number.isFinite(ms) && ms >= inicioMs && ms <= fimMs)
    .sort((a, b) => a.ms - b.ms);
  let score = 0;
  let primeiroAtingidoEm: number | null = null;
  for (const { movimento, ms } of elegiveis) {
    if (movimento.tipo === "confirmado" || movimento.tipo === "ajuste") score += movimento.pontos;
    if (movimento.tipo === "resgatado" || movimento.tipo === "estornado") score -= movimento.pontos;
    score = Math.max(0, Math.round(score));
    if (score > 0 && primeiroAtingidoEm === null) primeiroAtingidoEm = ms;
  }
  return { score, primeiroAtingidoEm };
}
