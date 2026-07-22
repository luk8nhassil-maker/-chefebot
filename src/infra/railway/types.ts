// Tipos compartilhados do monitor preventivo de infraestrutura Railway.
// Nenhum tipo aqui carrega segredo, token, host privado ou saída bruta de
// CLI — só o formato normalizado que atravessa coletor -> ingestão -> painel.

export type ServiceStatus = "online" | "unknown";

export type CapacitySource = "railway" | "configured";

export type CollectorStatus = "ok" | "error";

/** Amostra válida de métrica, já normalizada pelo coletor. */
export type MetricSample = {
  schemaVersion: 1;
  eventType: "metric_sample";
  sampleId: string;
  collectedAt: string; // ISO-8601
  source: "railway-cli";
  postgres: {
    volumeUsedBytes: number;
    volumeCapacityBytes: number;
    percentUsed: number;
    capacitySource: CapacitySource;
  };
  services: {
    postgres: ServiceStatus;
    evolution: ServiceStatus;
    redis: ServiceStatus;
  };
  collector: {
    version: 1;
    status: "ok";
  };
};

/** Código de erro sanitizado permitido — nunca stack trace/stderr/comando. */
export const COLLECTOR_ERROR_CODES = [
  "cli_not_found",
  "cli_timeout",
  "cli_exit_nonzero",
  "cli_output_too_large",
  "cli_invalid_json",
  "cli_missing_fields",
  "auth_failed",
  "network_error",
  "unknown_error",
] as const;

export type CollectorErrorCode = (typeof COLLECTOR_ERROR_CODES)[number];

export type CollectorErrorEvent = {
  schemaVersion: 1;
  eventType: "collector_error";
  sampleId: string;
  collectedAt: string;
  source: "railway-cli";
  collector: {
    version: 1;
    status: "error";
    errorCode: CollectorErrorCode;
  };
};

export type IngestPayload = MetricSample | CollectorErrorEvent;

export function isMetricSample(p: IngestPayload): p is MetricSample {
  return p.eventType === "metric_sample";
}

/** Ponto de histórico já unificado (coleta automática ou baseline manual). */
export type HistoryPoint = {
  ts: number; // epoch ms
  usedBytes: number;
  capacityBytes: number;
  percentUsed: number;
  origin: "collector" | "railway-ui-manual";
};

export type Severity =
  | "healthy"
  | "attention"
  | "critical"
  | "emergency"
  | "imminent"
  | "stale"
  | "unavailable";

export type AlertType =
  | "severity_change"
  | "collector_stale"
  | "back_to_normal"
  | "anomalous_spike"
  | "collector_repeated_failure";

export type Alert = {
  id: string;
  ts: number;
  type: AlertType;
  severity: Severity;
  description: string;
};
