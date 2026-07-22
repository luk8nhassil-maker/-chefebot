import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MAX_BODY_BYTES, validateIngestRequest, validateSchema } from "./ingestValidation";

const SECRET = "test-secret-with-strong-entropy";

function goodMetricSampleBody(overrides: Record<string, unknown> = {}, sampleId = "01234567-89ab-cdef-0123-456789abcdef") {
  return {
    schemaVersion: 1,
    eventType: "metric_sample",
    sampleId,
    collectedAt: "2026-07-22T12:00:00.000Z",
    source: "railway-cli",
    postgres: {
      volumeUsedBytes: 500 * 1024 * 1024,
      volumeCapacityBytes: 5 * 1024 * 1024 * 1024,
      percentUsed: 9.7,
      capacitySource: "railway",
    },
    services: { postgres: "online", evolution: "online", redis: "unknown" },
    collector: { version: 1, status: "ok" },
    ...overrides,
  };
}

function sign(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

function makeRequest(body: unknown, opts: Partial<{ secret: string; nowMs: number; timestamp: string; sampleIdHeader: string; badSignature: boolean }> = {}) {
  const rawBody = JSON.stringify(body);
  const nowMs = opts.nowMs ?? Date.now();
  const timestamp = opts.timestamp ?? String(nowMs);
  const secret = opts.secret ?? SECRET;
  const signature = opts.badSignature ? "0".repeat(64) : sign(secret, timestamp, rawBody);
  const sampleIdHeader = opts.sampleIdHeader ?? (body as { sampleId?: string })?.sampleId ?? "";
  return { rawBody, secret, timestampHeader: timestamp, signatureHeader: signature, sampleIdHeader, nowMs };
}

describe("validateSchema", () => {
  it("aceita uma metric_sample válida", () => {
    expect(validateSchema(goodMetricSampleBody())).not.toBeNull();
  });

  it("rejeita propriedade desconhecida no topo", () => {
    expect(validateSchema(goodMetricSampleBody({ extra: "x" }))).toBeNull();
  });

  it("rejeita propriedade desconhecida dentro de postgres", () => {
    const body = goodMetricSampleBody();
    (body.postgres as Record<string, unknown>).railwayInternalId = "abc";
    expect(validateSchema(body)).toBeNull();
  });

  it("rejeita valores negativos", () => {
    const body = goodMetricSampleBody();
    (body.postgres as Record<string, unknown>).volumeUsedBytes = -5;
    expect(validateSchema(body)).toBeNull();
  });

  it("rejeita NaN/Infinity", () => {
    const body1 = goodMetricSampleBody();
    (body1.postgres as Record<string, unknown>).percentUsed = NaN;
    expect(validateSchema(body1)).toBeNull();

    const body2 = goodMetricSampleBody();
    (body2.postgres as Record<string, unknown>).volumeUsedBytes = Infinity;
    expect(validateSchema(body2)).toBeNull();
  });

  it("rejeita percentual impossível (> 100)", () => {
    const body = goodMetricSampleBody();
    (body.postgres as Record<string, unknown>).percentUsed = 150;
    expect(validateSchema(body)).toBeNull();
  });

  it("rejeita capacitySource fora do permitido", () => {
    const body = goodMetricSampleBody();
    (body.postgres as Record<string, unknown>).capacitySource = "guessed";
    expect(validateSchema(body)).toBeNull();
  });

  it("aceita um collector_error válido", () => {
    const body = {
      schemaVersion: 1,
      eventType: "collector_error",
      sampleId: "01234567-89ab-cdef-0123-456789abcdef",
      collectedAt: "2026-07-22T12:00:00.000Z",
      source: "railway-cli",
      collector: { version: 1, status: "error", errorCode: "cli_timeout" },
    };
    expect(validateSchema(body)).not.toBeNull();
  });

  it("rejeita errorCode fora da lista permitida", () => {
    const body = {
      schemaVersion: 1,
      eventType: "collector_error",
      sampleId: "01234567-89ab-cdef-0123-456789abcdef",
      collectedAt: "2026-07-22T12:00:00.000Z",
      source: "railway-cli",
      collector: { version: 1, status: "error", errorCode: "algo_nao_permitido" },
    };
    expect(validateSchema(body)).toBeNull();
  });

  it("rejeita JSON que não é objeto", () => {
    expect(validateSchema("string")).toBeNull();
    expect(validateSchema([1, 2, 3])).toBeNull();
    expect(validateSchema(null)).toBeNull();
  });
});

describe("validateIngestRequest", () => {
  it("aceita uma requisição válida", () => {
    const body = goodMetricSampleBody();
    const req = makeRequest(body);
    const result = validateIngestRequest(req);
    expect(result.ok).toBe(true);
  });

  it("rejeita quando o secret não está configurado", () => {
    const req = makeRequest(goodMetricSampleBody(), { secret: undefined as unknown as string });
    const result = validateIngestRequest({ ...req, secret: undefined });
    expect(result).toEqual({ ok: false, error: "not_configured" });
  });

  it("rejeita corpo maior que o limite", () => {
    const body = goodMetricSampleBody({ padding: "x".repeat(MAX_BODY_BYTES) });
    const req = makeRequest(body);
    const result = validateIngestRequest(req);
    expect(result).toEqual({ ok: false, error: "body_too_large" });
  });

  it("rejeita headers ausentes", () => {
    const req = makeRequest(goodMetricSampleBody());
    const result = validateIngestRequest({ ...req, signatureHeader: null });
    expect(result).toEqual({ ok: false, error: "missing_headers" });
  });

  it("rejeita timestamp expirado (> 5 minutos)", () => {
    const now = Date.now();
    const req = makeRequest(goodMetricSampleBody(), { timestamp: String(now - 6 * 60 * 1000), nowMs: now });
    const result = validateIngestRequest(req);
    expect(result).toEqual({ ok: false, error: "timestamp_expired" });
  });

  it("rejeita assinatura inválida", () => {
    const req = makeRequest(goodMetricSampleBody(), { badSignature: true });
    const result = validateIngestRequest(req);
    expect(result).toEqual({ ok: false, error: "invalid_signature" });
  });

  it("rejeita JSON inválido mesmo com assinatura correta do texto cru", () => {
    const rawBody = "{ isso não é json";
    const nowMs = Date.now();
    const timestamp = String(nowMs);
    const signature = sign(SECRET, timestamp, rawBody);
    const result = validateIngestRequest({
      secret: SECRET,
      rawBody,
      timestampHeader: timestamp,
      signatureHeader: signature,
      sampleIdHeader: "qualquer",
      nowMs,
    });
    expect(result).toEqual({ ok: false, error: "invalid_json" });
  });

  it("rejeita quando sampleId do header não bate com o do corpo", () => {
    const req = makeRequest(goodMetricSampleBody(), { sampleIdHeader: "outro-id-diferente" });
    const result = validateIngestRequest(req);
    expect(result).toEqual({ ok: false, error: "sample_id_mismatch" });
  });

  it("rejeita schema inválido", () => {
    const req = makeRequest(goodMetricSampleBody({ eventType: "algo_invalido" }));
    const result = validateIngestRequest(req);
    expect(result).toEqual({ ok: false, error: "invalid_schema" });
  });
});
