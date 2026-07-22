// Persistência do monitor Railway — único módulo que toca Redis para este
// recurso. Namespace isolado `infra:railway:*`; nunca lê/escreve qualquer
// outra chave (pedidos, sessões, Pix, WhatsApp, mcp:*). Nunca faz SCAN
// geral nem FLUSHDB — cada função só conhece as chaves fixas abaixo.
//
// Se o Redis falhar, toda função de leitura devolve um fallback seguro
// (nunca lança para o chamador de `/api/dev/infra`); toda função de escrita
// propaga o erro para o endpoint de ingestão decidir o 503, mas nunca
// derruba o bot nem o restante do `/dev/mcp`.

import { redis } from "@/lib/redis";
import { VERIFIED_BASELINES } from "./verifiedBaselines";
import type { Alert, CollectorErrorEvent, HistoryPoint, MetricSample, Severity } from "./types";

const NS = "infra:railway";
const KEY_HISTORY = `${NS}:postgres:history:v1`;
const KEY_LATEST = `${NS}:postgres:latest:v1`;
const KEY_SEVERITY = `${NS}:postgres:severity:v1`;
const KEY_ALERTS = `${NS}:postgres:alerts:v1`;
const KEY_COLLECTOR = `${NS}:collector:latest:v1`;
export const REPLAY_KEY_PREFIX = `${NS}:replay:v1:`;

const RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const MAX_SAMPLES = 1000;
const MAX_ALERTS = 100;

type HistoryEntry = {
  usedBytes: number;
  capacityBytes: number;
  percentUsed: number;
  sampleId: string;
};

export type CollectorStatusRecord = {
  status: "ok" | "error";
  lastRunAt: number;
  errorCode?: string;
};

export type SeverityStateRecord = {
  severity: Severity | null;
  isStale: boolean;
  consecutiveFailures: number;
  updatedAt: number;
};

/** Grava uma amostra válida: histórico (zset), latest e status do coletor. */
export async function recordMetricSample(sample: MetricSample): Promise<void> {
  const ts = Date.parse(sample.collectedAt);
  const entry: HistoryEntry = {
    usedBytes: sample.postgres.volumeUsedBytes,
    capacityBytes: sample.postgres.volumeCapacityBytes,
    percentUsed: sample.postgres.percentUsed,
    sampleId: sample.sampleId,
  };

  await Promise.all([
    redis.zadd(KEY_HISTORY, { score: ts, member: JSON.stringify(entry) }),
    redis.set(KEY_LATEST, sample),
    redis.set(KEY_COLLECTOR, { status: "ok", lastRunAt: ts } satisfies CollectorStatusRecord),
  ]);

  await enforceHistoryRetention();
}

/** Registra falha sanitizada do coletor — nunca toca histórico/latest. */
export async function recordCollectorError(event: CollectorErrorEvent): Promise<void> {
  const ts = Date.parse(event.collectedAt);
  await redis.set(KEY_COLLECTOR, {
    status: "error",
    lastRunAt: ts,
    errorCode: event.collector.errorCode,
  } satisfies CollectorStatusRecord);
}

/** Retenção: remove amostras com mais de 180 dias e mantém no máx. 1000. */
async function enforceHistoryRetention(): Promise<void> {
  const cutoff = Date.now() - RETENTION_MS;
  await redis.zremrangebyscore(KEY_HISTORY, 0, cutoff);
  const total = await redis.zcard(KEY_HISTORY);
  if (total > MAX_SAMPLES) {
    // zremrangebyrank remove os mais antigos (rank 0 = menor score = mais antigo).
    await redis.zremrangebyrank(KEY_HISTORY, 0, total - MAX_SAMPLES - 1);
  }
}

export async function readCollectorHistory(): Promise<HistoryPoint[]> {
  const raw = await redis.zrange<string[]>(KEY_HISTORY, 0, -1, { withScores: true });
  const points: HistoryPoint[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    const member = raw[i];
    const score = Number(raw[i + 1]);
    try {
      const parsed = typeof member === "string" ? (JSON.parse(member) as HistoryEntry) : (member as unknown as HistoryEntry);
      points.push({
        ts: score,
        usedBytes: parsed.usedBytes,
        capacityBytes: parsed.capacityBytes,
        percentUsed: parsed.percentUsed,
        origin: "collector",
      });
    } catch {
      // Entrada corrompida isolada nunca derruba a leitura inteira.
    }
  }
  return points;
}

/** Histórico do coletor + baselines manuais verificadas, unidos só na leitura. */
export function mergeHistoryWithBaselines(collectorHistory: HistoryPoint[]): HistoryPoint[] {
  return [...collectorHistory, ...VERIFIED_BASELINES].sort((a, b) => a.ts - b.ts);
}

export async function readLatestSample(): Promise<MetricSample | null> {
  const v = await redis.get<MetricSample>(KEY_LATEST);
  return v ?? null;
}

export async function readCollectorStatus(): Promise<CollectorStatusRecord | null> {
  const v = await redis.get<CollectorStatusRecord>(KEY_COLLECTOR);
  return v ?? null;
}

export async function readSeverityState(): Promise<SeverityStateRecord | null> {
  const v = await redis.get<SeverityStateRecord>(KEY_SEVERITY);
  return v ?? null;
}

export async function writeSeverityState(state: SeverityStateRecord): Promise<void> {
  await redis.set(KEY_SEVERITY, state);
}

export async function readAlerts(limit = MAX_ALERTS): Promise<Alert[]> {
  const raw = await redis.lrange<string>(KEY_ALERTS, 0, limit - 1);
  const alerts: Alert[] = [];
  for (const item of raw) {
    try {
      alerts.push(typeof item === "string" ? (JSON.parse(item) as Alert) : (item as unknown as Alert));
    } catch {
      // ignora entrada corrompida isolada
    }
  }
  return alerts;
}

/** Acrescenta novos alertas (mais recentes primeiro) e mantém só os 100 últimos. */
export async function appendAlerts(alerts: Alert[]): Promise<void> {
  if (alerts.length === 0) return;
  const serialized = alerts.map((a) => JSON.stringify(a));
  await redis.lpush(KEY_ALERTS, ...serialized.reverse());
  await redis.ltrim(KEY_ALERTS, 0, MAX_ALERTS - 1);
}

/**
 * Verifica e marca um sampleId como já processado (idempotência + proteção
 * contra replay da assinatura HMAC, ver ingestValidation.ts). TTL de 20
 * minutos: folgado o bastante para cobrir retries de rede do coletor
 * (a cada 6h, sampleId é sempre um UUID novo) e maior que a janela de 5
 * minutos aceita para o timestamp da assinatura.
 */
export async function claimSampleId(sampleId: string): Promise<{ isNew: boolean }> {
  const key = `${REPLAY_KEY_PREFIX}${sampleId}`;
  const result = await redis.set(key, "1", { nx: true, ex: 20 * 60 });
  return { isNew: result === "OK" };
}

const KEY_RATE_LIMIT_PREFIX = `${NS}:ratelimit:v1:`;

/**
 * Rate limit conservador da ingestão: janela fixa de 10 minutos, limite bem
 * acima da cadência normal (a cada 6h) só para conter abuso caso a
 * assinatura vaze. Chave com TTL — nunca cresce sem limite.
 */
export async function checkAndIncrementIngestRateLimit(windowSeconds = 600, limit = 30): Promise<{ allowed: boolean; count: number }> {
  const bucket = Math.floor(Date.now() / 1000 / windowSeconds);
  const key = `${KEY_RATE_LIMIT_PREFIX}${bucket}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSeconds);
  return { allowed: count <= limit, count };
}

export type InfraReadResult = {
  ok: boolean;
  latestSample: MetricSample | null;
  collectorStatus: CollectorStatusRecord | null;
  history: HistoryPoint[];
  severityState: SeverityStateRecord | null;
  alerts: Alert[];
};

/**
 * Leitura agregada para a API dev. Nunca lança — se o Redis falhar, devolve
 * `ok: false` com tudo vazio/nulo, e o chamador mostra "monitor indisponível"
 * sem derrubar o resto do `/dev/mcp`.
 */
export async function readInfraState(): Promise<InfraReadResult> {
  try {
    const [latestSample, collectorStatus, history, severityState, alerts] = await Promise.all([
      readLatestSample(),
      readCollectorStatus(),
      readCollectorHistory(),
      readSeverityState(),
      readAlerts(),
    ]);
    return { ok: true, latestSample, collectorStatus, history, severityState, alerts };
  } catch (err) {
    console.error("[infra/railway/persistence] Redis indisponível:", err instanceof Error ? err.message : String(err));
    return { ok: false, latestSample: null, collectorStatus: null, history: [], severityState: null, alerts: [] };
  }
}
