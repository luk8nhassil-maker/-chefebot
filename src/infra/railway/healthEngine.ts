// Motor de saúde e tendência do monitor Railway — módulo PURO, sem I/O.
// Recebe histórico e estado anterior já lidos pela camada de persistência e
// devolve números/estados prontos para a API dev e o painel. Nada aqui toca
// Redis, Railway ou rede.

import type { Alert, AlertType, HistoryPoint, Severity } from "./types";

export const DAY_MS = 24 * 60 * 60 * 1000;
export const STALE_AFTER_MS = 18 * DAY_MS / 24; // 18 horas

const THRESHOLDS = [70, 80, 90, 95] as const;

export function severityFromPercent(percentUsed: number): Exclude<Severity, "stale" | "unavailable"> {
  if (percentUsed >= 95) return "imminent";
  if (percentUsed >= 90) return "emergency";
  if (percentUsed >= 80) return "critical";
  if (percentUsed >= 70) return "attention";
  return "healthy";
}

/**
 * Ordena qualquer histórico por `ts` — usado tanto na leitura (readModel) quanto
 * na UI (defesa em profundidade: nunca confiar que os dados já chegam
 * ordenados, mesmo que a camada de persistência já ordene). Não muta o array
 * de entrada.
 */
export function sortHistoryChronologically(history: readonly HistoryPoint[]): HistoryPoint[] {
  return [...history].sort((a, b) => a.ts - b.ts);
}

export type ServiceLikeStatus = "online" | "unknown" | "connected" | "disconnected";

/**
 * Rótulo seguro para exibição de um serviço/conexão: nunca trata ausência de
 * monitoramento ("unknown") como falha real — "não monitorado" é uma
 * categoria própria, distinta de "desconectado" (que É uma falha real
 * observada).
 */
export function describeServiceStatusLabel(status: ServiceLikeStatus): string {
  switch (status) {
    case "online":
      return "online";
    case "connected":
      return "conectado";
    case "disconnected":
      return "desconectado";
    case "unknown":
    default:
      return "não monitorado";
  }
}

/**
 * Guarda contra uma conclusão de saúde geral enganosa: mesmo com o volume
 * saudável, só permite uma leitura "tudo saudável" quando há pelo menos um
 * sinal real de serviço monitorado (não apenas o volume). Nunca usado para
 * ESCONDER o estado do volume — só para decidir se é seguro estendê-lo a uma
 * conclusão sobre "infraestrutura" como um todo.
 */
export function canClaimOverallHealthy(params: {
  volumeSeverity: Exclude<Severity, "stale" | "unavailable">;
  serviceStatuses: readonly ServiceLikeStatus[];
}): boolean {
  if (params.volumeSeverity !== "healthy") return false;
  return params.serviceStatuses.some((s) => s !== "unknown");
}

function sortedAscending(history: readonly HistoryPoint[]): HistoryPoint[] {
  return [...history].sort((a, b) => a.ts - b.ts);
}

/** Último ponto com ts <= referencia (ou null se não houver nenhum). */
function latestAtOrBefore(points: readonly HistoryPoint[], referenceTs: number): HistoryPoint | null {
  let found: HistoryPoint | null = null;
  for (const p of points) {
    if (p.ts <= referenceTs) found = p;
    else break;
  }
  return found;
}

/** Ponto mais próximo (antes ou depois) de um alvo, dentro de uma folga máxima. */
function closestWithinTolerance(
  points: readonly HistoryPoint[],
  targetTs: number,
  toleranceMs: number
): HistoryPoint | null {
  let best: HistoryPoint | null = null;
  let bestDiff = Infinity;
  for (const p of points) {
    const diff = Math.abs(p.ts - targetTs);
    if (diff <= toleranceMs && diff < bestDiff) {
      best = p;
      bestDiff = diff;
    }
  }
  return best;
}

export type DeltaResult = { bytes: number; fromTs: number; toTs: number } | null;

/**
 * Delta entre o ponto mais recente e o ponto mais próximo de `nowTs - windowMs`
 * (com folga de 20% da janela, para tolerar coleta a cada 6h). Retorna `null`
 * quando não há amostra suficiente — nunca inventa um valor.
 */
export function computeDelta(history: readonly HistoryPoint[], nowTs: number, windowMs: number): DeltaResult {
  const points = sortedAscending(history);
  const latest = latestAtOrBefore(points, nowTs);
  if (!latest) return null;
  const targetTs = nowTs - windowMs;
  const tolerance = Math.max(windowMs * 0.2, 3 * 60 * 60 * 1000);
  const past = closestWithinTolerance(points, targetTs, tolerance);
  if (!past || past.ts === latest.ts) return null;
  return { bytes: latest.usedBytes - past.usedBytes, fromTs: past.ts, toTs: latest.ts };
}

export type GrowthConfidence = "insufficient" | "low" | "ok";

export type DailyGrowth = {
  bytesPerDay: number;
  confidence: GrowthConfidence;
  spanDays: number;
};

/**
 * Crescimento diário médio. Prefere a janela de 7 dias (confiança "ok");
 * cai para 24h (confiança "low") quando não há 7 dias de histórico ainda;
 * retorna null quando não há dado algum.
 */
export function computeDailyGrowth(history: readonly HistoryPoint[], nowTs: number): DailyGrowth | null {
  const delta7d = computeDelta(history, nowTs, 7 * DAY_MS);
  if (delta7d) {
    const spanDays = (delta7d.toTs - delta7d.fromTs) / DAY_MS;
    if (spanDays > 0) {
      return { bytesPerDay: delta7d.bytes / spanDays, confidence: "ok", spanDays };
    }
  }
  const delta24h = computeDelta(history, nowTs, DAY_MS);
  if (delta24h) {
    const spanDays = (delta24h.toTs - delta24h.fromTs) / DAY_MS;
    if (spanDays > 0) {
      return { bytesPerDay: delta24h.bytes / spanDays, confidence: "low", spanDays };
    }
  }
  return null;
}

export type ForecastEntry = { threshold: number; status: "already_reached" | "estimated"; days: number | null };

export type Forecast =
  | { status: "collecting_history" }
  | { status: "insufficient_data" }
  | { status: "no_growth" }
  | { status: "estimated"; reliable: boolean; distortedByRecentSpike: boolean; entries: ForecastEntry[] };

/**
 * Previsão para 70/80/90/95%. Regras (ver seção 7 do runbook):
 * - histórico com menos de 24h de amostras: "Coletando histórico";
 * - sem crescimento diário calculável: "insufficient_data";
 * - crescimento diário <= 0: "Sem crescimento detectável" (nunca projeta enchimento);
 * - previsão confiável (reliable=true) só com >= 7 dias de span;
 * - nunca divide por zero (dailyGrowth > 0 é garantido antes da divisão).
 */
export function computeForecast(params: {
  history: readonly HistoryPoint[];
  nowTs: number;
  usedBytes: number;
  capacityBytes: number;
  dailyGrowth: DailyGrowth | null;
  isAnomaly: boolean;
}): Forecast {
  const { history, nowTs, usedBytes, capacityBytes, dailyGrowth, isAnomaly } = params;
  const points = sortedAscending(history);
  if (points.length < 2) return { status: "collecting_history" };
  const oldestTs = points[0].ts;
  if (nowTs - oldestTs < DAY_MS) return { status: "collecting_history" };
  if (!dailyGrowth) return { status: "insufficient_data" };
  if (dailyGrowth.bytesPerDay <= 0) return { status: "no_growth" };

  const reliable = nowTs - oldestTs >= 7 * DAY_MS && dailyGrowth.confidence === "ok";
  const entries: ForecastEntry[] = THRESHOLDS.map((threshold) => {
    const thresholdBytes = capacityBytes * (threshold / 100);
    if (usedBytes >= thresholdBytes) return { threshold, status: "already_reached", days: 0 };
    const days = (thresholdBytes - usedBytes) / dailyGrowth.bytesPerDay;
    return { threshold, status: "estimated", days };
  });

  return { status: "estimated", reliable, distortedByRecentSpike: isAnomaly, entries };
}

export type AnomalyResult = {
  isAnomaly: boolean;
  last24hBytes: number | null;
  normalDailyBaselineBytes: number | null;
};

/**
 * Detecta salto anormal: crescimento das últimas 24h muito acima do padrão
 * recente (janela de 2 a 8 dias atrás, excluindo o próprio dia analisado).
 * Critério: last24hDelta > max(3x baseline, 50MB) — documentado aqui e
 * coberto por teste. Nunca marca com base numa amostra isolada sem baseline.
 */
export function detectAnomaly(history: readonly HistoryPoint[], nowTs: number): AnomalyResult {
  const last24h = computeDelta(history, nowTs, DAY_MS);
  if (!last24h || last24h.bytes <= 0) {
    return { isAnomaly: false, last24hBytes: last24h?.bytes ?? null, normalDailyBaselineBytes: null };
  }

  const points = sortedAscending(history);
  const baselineStart = closestWithinTolerance(points, nowTs - 8 * DAY_MS, DAY_MS);
  const baselineEnd = closestWithinTolerance(points, nowTs - 1 * DAY_MS, DAY_MS);
  if (!baselineStart || !baselineEnd || baselineEnd.ts <= baselineStart.ts) {
    return { isAnomaly: false, last24hBytes: last24h.bytes, normalDailyBaselineBytes: null };
  }

  const spanDays = (baselineEnd.ts - baselineStart.ts) / DAY_MS;
  const baselineDaily = (baselineEnd.usedBytes - baselineStart.usedBytes) / spanDays;
  const MIN_ABSOLUTE_SPIKE_BYTES = 50 * 1024 * 1024;
  const threshold = Math.max(baselineDaily * 3, MIN_ABSOLUTE_SPIKE_BYTES);
  const isAnomaly = baselineDaily > 0 ? last24h.bytes > threshold : last24h.bytes > MIN_ABSOLUTE_SPIKE_BYTES;

  return { isAnomaly, last24hBytes: last24h.bytes, normalDailyBaselineBytes: baselineDaily };
}

export type CollectorState = "ok" | "error" | "stale" | "never";

/** Estado de exibição consolidado (prioridade: never > error/stale > severidade). */
export function resolveDisplayState(params: {
  collectorState: CollectorState;
  severity: Exclude<Severity, "stale" | "unavailable"> | null;
}): Severity | "never" {
  const { collectorState, severity } = params;
  if (collectorState === "never") return "never";
  if (collectorState === "error") return "unavailable";
  if (collectorState === "stale") return "stale";
  return severity ?? "unavailable";
}

export function isCollectionStale(lastCollectedAt: number | null, nowTs: number): boolean {
  if (lastCollectedAt === null) return false;
  return nowTs - lastCollectedAt > STALE_AFTER_MS;
}

// ---------------------------------------------------------------------------
// Alertas — nunca repete o mesmo alerta em coletas consecutivas sem mudança.
// ---------------------------------------------------------------------------

export type AlertInput = {
  previousSeverity: Severity | null;
  currentSeverity: Exclude<Severity, "stale" | "unavailable">;
  wasStale: boolean;
  isStale: boolean;
  anomaly: AnomalyResult;
  collectorConsecutiveFailures: number;
  nowTs: number;
  idFactory?: () => string;
};

function defaultId(nowTs: number, type: AlertType): string {
  return `${type}:${nowTs}`;
}

export function evaluateAlerts(input: AlertInput): Alert[] {
  const {
    previousSeverity,
    currentSeverity,
    wasStale,
    isStale,
    anomaly,
    collectorConsecutiveFailures,
    nowTs,
  } = input;
  const makeId = input.idFactory ?? ((type: AlertType) => defaultId(nowTs, type));
  const alerts: Alert[] = [];

  if (isStale && !wasStale) {
    alerts.push({
      id: makeId("collector_stale"),
      ts: nowTs,
      type: "collector_stale",
      severity: "stale",
      description: "Coleta atrasada: nenhuma amostra nova nas últimas 18 horas.",
    });
  }

  if (!isStale && previousSeverity !== null && previousSeverity !== currentSeverity) {
    if (currentSeverity === "healthy" && previousSeverity !== "healthy") {
      alerts.push({
        id: makeId("back_to_normal"),
        ts: nowTs,
        type: "back_to_normal",
        severity: currentSeverity,
        description: "Uso do volume voltou à faixa saudável (abaixo de 70%).",
      });
    } else {
      alerts.push({
        id: makeId("severity_change"),
        ts: nowTs,
        type: "severity_change",
        severity: currentSeverity,
        description: `Uso do volume mudou de faixa: ${previousSeverity} → ${currentSeverity}.`,
      });
    }
  }

  if (anomaly.isAnomaly) {
    alerts.push({
      id: makeId("anomalous_spike"),
      ts: nowTs,
      type: "anomalous_spike",
      severity: currentSeverity,
      description: "Salto anormal de armazenamento detectado nas últimas 24 horas.",
    });
  }

  if (collectorConsecutiveFailures === 3) {
    alerts.push({
      id: makeId("collector_repeated_failure"),
      ts: nowTs,
      type: "collector_repeated_failure",
      severity: currentSeverity,
      description: "O coletor falhou 3 vezes seguidas.",
    });
  }

  return alerts;
}
