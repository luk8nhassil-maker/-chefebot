// Validação da ingestão do monitor Railway — módulo PURO (sem Redis/rede).
// Verifica assinatura HMAC, janela de tempo e schema do corpo antes de
// qualquer gravação. A checagem de replay/idempotência por sampleId fica em
// persistence.ts (claimSampleId), porque exige Redis.

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  COLLECTOR_ERROR_CODES,
  type CollectorErrorEvent,
  type IngestPayload,
  type MetricSample,
} from "./types";

export const MAX_BODY_BYTES = 16 * 1024;
export const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000;

export type ValidationError =
  | "not_configured"
  | "body_too_large"
  | "missing_headers"
  | "timestamp_invalid"
  | "timestamp_expired"
  | "invalid_signature"
  | "sample_id_mismatch"
  | "invalid_json"
  | "invalid_schema";

export type ValidationResult = { ok: true; payload: IngestPayload } | { ok: false; error: ValidationError };

function computeSignature(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

/** Compara duas strings hex em tempo constante. Tamanhos diferentes = inválido, sem early-exit em conteúdo. */
export function safeCompareHex(expectedHex: string, providedHex: string): boolean {
  const expected = Buffer.from(expectedHex, "utf8");
  const provided = Buffer.from(providedHex, "utf8");
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

export function verifyHmacSignature(params: {
  secret: string;
  timestamp: string;
  rawBody: string;
  signature: string;
}): boolean {
  const expected = computeSignature(params.secret, params.timestamp, params.rawBody);
  return safeCompareHex(expected, params.signature);
}

export function isTimestampFresh(timestampHeader: string, nowMs: number, maxSkewMs = MAX_TIMESTAMP_SKEW_MS): boolean {
  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts)) return false;
  return Math.abs(nowMs - ts) <= maxSkewMs;
}

function isFiniteNonNegative(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

const ALLOWED_SERVICE_STATUS = new Set(["online", "unknown"]);
const ALLOWED_CAPACITY_SOURCE = new Set(["railway", "configured"]);

function validateMetricSample(body: Record<string, unknown>): MetricSample | null {
  const { postgres, services, collector } = body as { postgres?: unknown; services?: unknown; collector?: unknown };
  if (!postgres || typeof postgres !== "object") return null;
  if (!services || typeof services !== "object") return null;
  if (!collector || typeof collector !== "object") return null;

  const pg = postgres as Record<string, unknown>;
  const svc = services as Record<string, unknown>;
  const col = collector as Record<string, unknown>;

  const pgKeys = ["volumeUsedBytes", "volumeCapacityBytes", "percentUsed", "capacitySource"];
  if (Object.keys(pg).some((k) => !pgKeys.includes(k))) return null;
  if (!isFiniteNonNegative(pg.volumeUsedBytes)) return null;
  if (!isFiniteNonNegative(pg.volumeCapacityBytes) || pg.volumeCapacityBytes <= 0) return null;
  if (typeof pg.percentUsed !== "number" || !Number.isFinite(pg.percentUsed) || pg.percentUsed < 0 || pg.percentUsed > 100.000001) return null;
  if (typeof pg.capacitySource !== "string" || !ALLOWED_CAPACITY_SOURCE.has(pg.capacitySource)) return null;

  const svcKeys = ["postgres", "evolution", "redis"];
  if (Object.keys(svc).some((k) => !svcKeys.includes(k))) return null;
  for (const k of svcKeys) {
    if (typeof svc[k] !== "string" || !ALLOWED_SERVICE_STATUS.has(svc[k] as string)) return null;
  }

  const colKeys = ["version", "status"];
  if (Object.keys(col).some((k) => !colKeys.includes(k))) return null;
  if (col.version !== 1 || col.status !== "ok") return null;

  return {
    schemaVersion: 1,
    eventType: "metric_sample",
    sampleId: body.sampleId as string,
    collectedAt: body.collectedAt as string,
    source: "railway-cli",
    postgres: {
      volumeUsedBytes: pg.volumeUsedBytes as number,
      volumeCapacityBytes: pg.volumeCapacityBytes as number,
      percentUsed: pg.percentUsed as number,
      capacitySource: pg.capacitySource as "railway" | "configured",
    },
    services: {
      postgres: svc.postgres as "online" | "unknown",
      evolution: svc.evolution as "online" | "unknown",
      redis: svc.redis as "online" | "unknown",
    },
    collector: { version: 1, status: "ok" },
  };
}

function validateCollectorError(body: Record<string, unknown>): CollectorErrorEvent | null {
  const { collector } = body as { collector?: unknown };
  if (!collector || typeof collector !== "object") return null;
  const col = collector as Record<string, unknown>;
  const colKeys = ["version", "status", "errorCode"];
  if (Object.keys(col).some((k) => !colKeys.includes(k))) return null;
  if (col.version !== 1 || col.status !== "error") return null;
  if (typeof col.errorCode !== "string" || !(COLLECTOR_ERROR_CODES as readonly string[]).includes(col.errorCode)) return null;

  return {
    schemaVersion: 1,
    eventType: "collector_error",
    sampleId: body.sampleId as string,
    collectedAt: body.collectedAt as string,
    source: "railway-cli",
    collector: { version: 1, status: "error", errorCode: col.errorCode as CollectorErrorEvent["collector"]["errorCode"] },
  };
}

const TOP_LEVEL_KEYS = ["schemaVersion", "eventType", "sampleId", "collectedAt", "source", "postgres", "services", "collector"];

/** Valida o schema do corpo já parseado. Rejeita propriedade desconhecida, valor impossível ou tipo errado. */
export function validateSchema(parsed: unknown): IngestPayload | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const body = parsed as Record<string, unknown>;

  if (Object.keys(body).some((k) => !TOP_LEVEL_KEYS.includes(k))) return null;
  if (body.schemaVersion !== 1) return null;
  if (body.source !== "railway-cli") return null;
  if (typeof body.sampleId !== "string" || body.sampleId.length < 8 || body.sampleId.length > 128) return null;
  if (typeof body.collectedAt !== "string" || !Number.isFinite(Date.parse(body.collectedAt))) return null;

  if (body.eventType === "metric_sample") return validateMetricSample(body);
  if (body.eventType === "collector_error") return validateCollectorError(body);
  return null;
}

/**
 * Pipeline completo de validação (ordem importa: secret -> tamanho -> headers
 * -> timestamp -> assinatura -> JSON -> schema -> consistência de sampleId).
 * Nunca decodifica o JSON antes de validar a assinatura contra o corpo cru.
 */
export function validateIngestRequest(params: {
  secret: string | undefined;
  rawBody: string;
  timestampHeader: string | null;
  signatureHeader: string | null;
  sampleIdHeader: string | null;
  nowMs: number;
}): ValidationResult {
  const { secret, rawBody, timestampHeader, signatureHeader, sampleIdHeader, nowMs } = params;

  if (!secret) return { ok: false, error: "not_configured" };
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) return { ok: false, error: "body_too_large" };
  if (!timestampHeader || !signatureHeader || !sampleIdHeader) return { ok: false, error: "missing_headers" };
  if (!/^\d+$/.test(timestampHeader)) return { ok: false, error: "timestamp_invalid" };
  if (!isTimestampFresh(timestampHeader, nowMs)) return { ok: false, error: "timestamp_expired" };
  if (!verifyHmacSignature({ secret, timestamp: timestampHeader, rawBody, signature: signatureHeader })) {
    return { ok: false, error: "invalid_signature" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false, error: "invalid_json" };
  }

  const payload = validateSchema(parsed);
  if (!payload) return { ok: false, error: "invalid_schema" };
  if (payload.sampleId !== sampleIdHeader) return { ok: false, error: "sample_id_mismatch" };

  return { ok: true, payload };
}
