// Monta o snapshot consolidado para GET /api/dev/infra: lê persistência +
// baselines manuais, roda o motor de saúde/tendência (puro) e a leitura seg-
// ura do WhatsApp, e devolve um objeto pronto para o painel. Nunca lança —
// qualquer falha de uma parte vira um campo "indisponível" isolado, sem
// derrubar o restante da resposta.

import {
  mergeHistoryWithBaselines,
  readInfraState,
  type CollectorStatusRecord,
} from "./persistence";
import {
  computeDailyGrowth,
  computeDelta,
  computeForecast,
  detectAnomaly,
  isCollectionStale,
  resolveDisplayState,
  severityFromPercent,
  sortHistoryChronologically,
  DAY_MS,
} from "./healthEngine";
import { readWhatsappConnectionStateSafe, type WhatsappStatusResult } from "./whatsappStatus";
import type { Alert, HistoryPoint } from "./types";

const MAX_HISTORY_MS = 180 * 24 * 60 * 60 * 1000;

function collectorStateFrom(status: CollectorStatusRecord | null, nowTs: number): "ok" | "error" | "stale" | "never" {
  if (!status) return "never";
  if (status.status === "error") return "error";
  if (isCollectionStale(status.lastRunAt, nowTs)) return "stale";
  return "ok";
}

export type InfraSnapshot = {
  configured: boolean;
  collector: { status: "ok" | "error" | "stale" | "never"; lastRunAt: number | null };
  postgresVolume: {
    usedBytes: number | null;
    capacityBytes: number | null;
    freeBytes: number | null;
    percentUsed: number | null;
    capacitySource: string | null;
    severity: string;
    delta24hBytes: number | null;
    delta7dBytes: number | null;
    delta30dBytes: number | null;
    dailyGrowthBytes: number | null;
    dailyGrowthConfidence: string | null;
    forecast: ReturnType<typeof computeForecast>;
    anomaly: ReturnType<typeof detectAnomaly> | null;
  };
  services: {
    postgres: "online" | "unknown";
    evolution: "online" | "unknown";
    redis: "online" | "unknown";
    whatsapp: WhatsappStatusResult;
  };
  history: HistoryPoint[];
  alerts: Alert[];
  redisAvailable: boolean;
};

function emptySnapshot(configured: boolean, whatsapp: WhatsappStatusResult, redisAvailable: boolean): InfraSnapshot {
  return {
    configured,
    collector: { status: "never", lastRunAt: null },
    postgresVolume: {
      usedBytes: null,
      capacityBytes: null,
      freeBytes: null,
      percentUsed: null,
      capacitySource: null,
      severity: "unavailable",
      delta24hBytes: null,
      delta7dBytes: null,
      delta30dBytes: null,
      dailyGrowthBytes: null,
      dailyGrowthConfidence: null,
      forecast: { status: "insufficient_data" },
      anomaly: null,
    },
    services: { postgres: "unknown", evolution: "unknown", redis: "unknown", whatsapp },
    history: [],
    alerts: [],
    redisAvailable,
  };
}

export async function buildInfraSnapshot(featureEnabled: boolean, nowTs: number = Date.now()): Promise<InfraSnapshot> {
  const whatsapp = await readWhatsappConnectionStateSafe().catch(
    (): WhatsappStatusResult => ({ connectionState: "unknown", checkedAt: nowTs, limitation: "Falha ao consultar estado." })
  );

  if (!featureEnabled) {
    return emptySnapshot(false, whatsapp, true);
  }

  const state = await readInfraState();
  if (!state.ok) {
    return emptySnapshot(true, whatsapp, false);
  }

  // sortHistoryChronologically é uma segunda garantia (mergeHistoryWithBaselines
  // já ordena) — nunca confiar cegamente que a ordem de escrita/leitura do
  // Redis + a união com as baselines preserva ordem cronológica.
  const rawHistory = sortHistoryChronologically(
    mergeHistoryWithBaselines(state.history).filter((p) => nowTs - p.ts <= MAX_HISTORY_MS)
  );
  const collectorState = collectorStateFrom(state.collectorStatus, nowTs);

  if (!state.latestSample || rawHistory.length === 0) {
    return { ...emptySnapshot(true, whatsapp, true), collector: { status: collectorState, lastRunAt: state.collectorStatus?.lastRunAt ?? null } };
  }

  const latest = state.latestSample;
  const usedBytes = latest.postgres.volumeUsedBytes;
  const capacityBytes = latest.postgres.volumeCapacityBytes;
  const percentUsed = latest.postgres.percentUsed;
  const severityBase = severityFromPercent(percentUsed);
  const displaySeverity = resolveDisplayState({ collectorState, severity: severityBase });

  const dailyGrowth = computeDailyGrowth(rawHistory, nowTs);
  const anomaly = detectAnomaly(rawHistory, nowTs);
  const forecast = computeForecast({
    history: rawHistory,
    nowTs,
    usedBytes,
    capacityBytes,
    dailyGrowth,
    isAnomaly: anomaly.isAnomaly,
  });

  return {
    configured: true,
    collector: { status: collectorState, lastRunAt: state.collectorStatus?.lastRunAt ?? null },
    postgresVolume: {
      usedBytes,
      capacityBytes,
      freeBytes: capacityBytes - usedBytes,
      percentUsed,
      capacitySource: latest.postgres.capacitySource,
      severity: displaySeverity,
      delta24hBytes: computeDelta(rawHistory, nowTs, DAY_MS)?.bytes ?? null,
      delta7dBytes: computeDelta(rawHistory, nowTs, 7 * DAY_MS)?.bytes ?? null,
      delta30dBytes: computeDelta(rawHistory, nowTs, 30 * DAY_MS)?.bytes ?? null,
      dailyGrowthBytes: dailyGrowth?.bytesPerDay ?? null,
      dailyGrowthConfidence: dailyGrowth?.confidence ?? null,
      forecast,
      anomaly,
    },
    services: {
      postgres: latest.services.postgres,
      evolution: latest.services.evolution,
      redis: latest.services.redis,
      whatsapp,
    },
    history: rawHistory,
    alerts: state.alerts,
    redisAvailable: true,
  };
}
