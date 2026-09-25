// Histórico seguro de posição no ranking — permite mostrar "subiu"/"desceu"
// sem inventar movimento. A única fonte de verdade é um snapshot diário
// real, gravado no próprio dia (nunca reescrito depois). Sem cron dedicado:
// a primeira leitura do painel no dia grava o snapshot de hoje (SET NX,
// mesmo espírito do auto-expiry lazy de temporadas.ts); leituras seguintes
// no mesmo dia só comparam contra o snapshot mais recente ANTERIOR a hoje.
// Se não existir snapshot anterior, a variação é `null` — nunca um valor
// inventado (nem "0", que afirmaria falsamente "manteve a posição").

import { redis } from "./redis";

type RedisComZsetHistorico = typeof redis & {
  zadd: (key: string, opts: { score: number; member: string }) => Promise<number>;
  zrange: (key: string, start: number | string, stop: number | string, opts?: { rev?: boolean }) => Promise<string[]>;
};

const zredis = redis as RedisComZsetHistorico;

export type PosicaoDoDia = { geral: number; participantes: number | null };
export type SnapshotPosicoesDoDia = Record<string, PosicaoDoDia>;

function chaveSnapshot(tenantId: string, temporadaId: string, data: string): string {
  return `ranking:snapshot:${tenantId}:${temporadaId}:${data}`;
}

function chaveDatasSnapshot(tenantId: string, temporadaId: string): string {
  return `ranking:snapshot:datas:${tenantId}:${temporadaId}`;
}

// Data de referência em UTC (YYYY-MM-DD) — estável independente do fuso do
// servidor, e testável via injeção de `agora`.
export function dataReferenciaUtc(agora: Date): string {
  return agora.toISOString().slice(0, 10);
}

/**
 * Garante que existe um snapshot de posições para "hoje". Só grava na
 * primeira chamada do dia (SET NX) — chamadas seguintes são no-op, então o
 * snapshot do dia nunca é sobrescrito por uma leitura posterior.
 */
export async function garantirSnapshotDiario(
  tenantId: string,
  temporadaId: string,
  posicoesAtuais: SnapshotPosicoesDoDia,
  agora: Date = new Date(),
): Promise<void> {
  if (!tenantId || !temporadaId || Object.keys(posicoesAtuais).length === 0) return;
  const data = dataReferenciaUtc(agora);
  const gravado = await redis.set(chaveSnapshot(tenantId, temporadaId, data), posicoesAtuais, { nx: true });
  if (gravado) {
    const score = Number(data.replaceAll("-", ""));
    await zredis.zadd(chaveDatasSnapshot(tenantId, temporadaId), { score, member: data });
  }
}

/**
 * Posições registradas para um cliente no snapshot mais recente ANTERIOR a
 * hoje. `null` quando não existe nenhum snapshot anterior — condição que o
 * chamador deve tratar como "sem histórico ainda", nunca como "manteve".
 */
export async function obterPosicaoAnterior(
  tenantId: string,
  temporadaId: string,
  clienteId: string,
  agora: Date = new Date(),
): Promise<PosicaoDoDia | null> {
  if (!tenantId || !temporadaId || !clienteId) return null;
  const hoje = dataReferenciaUtc(agora);
  const datas = (await zredis.zrange(chaveDatasSnapshot(tenantId, temporadaId), 0, -1, { rev: true })) as string[];
  const anterior = datas.find((data) => data < hoje);
  if (!anterior) return null;
  const snapshot = await redis.get<SnapshotPosicoesDoDia>(chaveSnapshot(tenantId, temporadaId, anterior));
  return snapshot?.[clienteId] ?? null;
}

export type VariacaoPosicao = { direcao: "subiu" | "desceu" | "manteve"; casas: number };

/**
 * Pura: número menor de posição é melhor, então "subiu" = ficou com um
 * número de posição menor que antes. `null` quando não há posição anterior
 * para comparar — nunca infere "manteve" na ausência de dado.
 */
export function calcularVariacaoPosicao(
  posicaoAnterior: number | null | undefined,
  posicaoAtual: number,
): VariacaoPosicao | null {
  if (posicaoAnterior === null || posicaoAnterior === undefined) return null;
  const casas = posicaoAnterior - posicaoAtual;
  if (casas === 0) return { direcao: "manteve", casas: 0 };
  return { direcao: casas > 0 ? "subiu" : "desceu", casas: Math.abs(casas) };
}
