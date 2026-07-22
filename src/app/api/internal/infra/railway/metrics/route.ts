// POST /api/internal/infra/railway/metrics — único ponto de escrita do
// monitor preventivo de infraestrutura Railway. Autenticação por assinatura
// HMAC (x-chefebot-signature), não por sessão de admin — quem chama é o
// workflow do GitHub Actions, nunca o navegador. Sem GET/PUT/PATCH/DELETE.
//
// Esta rota nunca toca fluxo de pedidos, webhook de mensagens, Guardião Pix,
// Postgres/Redis operacionais da Railway ou sessão do WhatsApp — só grava
// métricas sanitizadas no namespace isolado `infra:railway:*` (ver
// persistence.ts). Continua exigindo HMAC válido mesmo quando
// DEV_INFRA_MONITOR_ENABLED estiver desligada (essa flag só afeta o coletor
// e a leitura do painel /dev/infra).

import { NextRequest, NextResponse } from "next/server";
import {
  appendAlerts,
  checkAndIncrementIngestRateLimit,
  claimSampleId,
  readCollectorHistory,
  readSeverityState,
  recordCollectorError,
  recordMetricSample,
  writeSeverityState,
} from "@/infra/railway/persistence";
import { validateIngestRequest } from "@/infra/railway/ingestValidation";
import { detectAnomaly, evaluateAlerts, isCollectionStale, severityFromPercent } from "@/infra/railway/healthEngine";
import { isMetricSample } from "@/infra/railway/types";

function genericErrorResponse(status: number, error: string): NextResponse {
  // Nunca detalha qual checagem de autenticação falhou (spec: "nunca
  // retornar detalhes internos de autenticação") — só uma categoria ampla.
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return genericErrorResponse(400, "invalid_body");
  }

  let rateLimit: { allowed: boolean };
  try {
    rateLimit = await checkAndIncrementIngestRateLimit();
  } catch (err) {
    console.error("[internal/infra/railway/metrics] Redis indisponível (rate limit):", err instanceof Error ? err.message : String(err));
    return genericErrorResponse(503, "unavailable");
  }
  if (!rateLimit.allowed) return genericErrorResponse(429, "rate_limited");

  const rawBody = await req.text();
  const validation = validateIngestRequest({
    secret: process.env.INFRA_METRICS_HMAC_SECRET,
    rawBody,
    timestampHeader: req.headers.get("x-chefebot-timestamp"),
    signatureHeader: req.headers.get("x-chefebot-signature"),
    sampleIdHeader: req.headers.get("x-chefebot-sample-id"),
    nowMs: Date.now(),
  });

  if (!validation.ok) {
    switch (validation.error) {
      case "not_configured":
        return genericErrorResponse(503, "unavailable");
      case "body_too_large":
        return genericErrorResponse(413, "payload_too_large");
      case "invalid_json":
      case "invalid_schema":
        return genericErrorResponse(400, "invalid_body");
      default:
        return genericErrorResponse(401, "unauthorized");
    }
  }

  const payload = validation.payload;

  // A flag DEV_INFRA_MONITOR_ENABLED só controla se a amostra é PERSISTIDA
  // (spec: "código não coleta" quando desligada). A assinatura HMAC já foi
  // validada acima e continua obrigatória independente da flag — só não
  // gravamos nada em `infra:railway:*` enquanto o monitor está desligado.
  if (process.env.DEV_INFRA_MONITOR_ENABLED !== "true") {
    return NextResponse.json({ ok: true, stored: false });
  }

  try {
    const claim = await claimSampleId(payload.sampleId);
    if (!claim.isNew) {
      // Idempotente: mesma amostra já processada — sucesso sem reprocessar.
      return NextResponse.json({ ok: true, duplicate: true });
    }

    const nowTs = Date.parse(payload.collectedAt);
    const prevSeverityState = await readSeverityState();

    if (isMetricSample(payload)) {
      await recordMetricSample(payload);
      const history = await readCollectorHistory();
      const currentSeverity = severityFromPercent(payload.postgres.percentUsed);
      const anomaly = detectAnomaly(history, nowTs);
      const wasStale = prevSeverityState?.isStale ?? false;

      const alerts = evaluateAlerts({
        previousSeverity: prevSeverityState?.severity ?? null,
        currentSeverity,
        wasStale,
        isStale: false,
        anomaly,
        collectorConsecutiveFailures: 0,
        nowTs,
      });

      await appendAlerts(alerts);
      await writeSeverityState({ severity: currentSeverity, isStale: false, consecutiveFailures: 0, updatedAt: nowTs });
    } else {
      await recordCollectorError(payload);
      const consecutiveFailures = (prevSeverityState?.consecutiveFailures ?? 0) + 1;
      const previousSeverity = prevSeverityState?.severity ?? null;
      const currentSeverity = previousSeverity && previousSeverity !== "stale" && previousSeverity !== "unavailable" ? previousSeverity : "healthy";
      const isStale = prevSeverityState ? isCollectionStale(prevSeverityState.updatedAt, nowTs) : false;

      const alerts = evaluateAlerts({
        previousSeverity,
        currentSeverity,
        wasStale: prevSeverityState?.isStale ?? false,
        isStale,
        anomaly: { isAnomaly: false, last24hBytes: null, normalDailyBaselineBytes: null },
        collectorConsecutiveFailures: consecutiveFailures,
        nowTs,
      });

      await appendAlerts(alerts);
      await writeSeverityState({ severity: previousSeverity, isStale, consecutiveFailures, updatedAt: nowTs });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[internal/infra/railway/metrics] Falha inesperada:", err instanceof Error ? err.message : String(err));
    return genericErrorResponse(503, "unavailable");
  }
}

// Nenhum GET, PUT, DELETE ou PATCH — único ponto de escrita, e só por assinatura.
