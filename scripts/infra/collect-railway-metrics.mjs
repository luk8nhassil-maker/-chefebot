#!/usr/bin/env node
// Coletor do monitor preventivo de infraestrutura Railway (ver
// docs/operations/railway-infra-monitor.md). Executado só pelo workflow
// .github/workflows/railway-infra-monitor.yml, nunca localmente com
// credenciais reais fora do CI.
//
// Regras inegociáveis deste arquivo:
// - Só executa comandos de LEITURA da Railway CLI (railway status, railway
//   volume list, railway metrics) via execFile (nunca shell:true, nunca
//   concatenação de string em um comando de shell).
// - Nunca imprime stdout/stderr bruto da CLI, nem em erro.
// - Nunca envia RAILWAY_TOKEN, DATABASE_URL ou qualquer segredo para o
//   ChefeBot — só o objeto normalizado definido em src/infra/railway/types.ts.
// - Falha de qualquer etapa vira, no máximo, um evento `collector_error` com
//   um código sanitizado da lista permitida — nunca stack trace/comando.

import { execFile } from "node:child_process";
import { randomUUID, createHmac } from "node:crypto";

const RAILWAY_CLI_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_BYTES = 256 * 1024;
const HTTP_TIMEOUT_MS = 10_000;

const ALLOWED_ERROR_CODES = new Set([
  "cli_not_found",
  "cli_timeout",
  "cli_exit_nonzero",
  "cli_output_too_large",
  "cli_invalid_json",
  "cli_missing_fields",
  "auth_failed",
  "network_error",
  "unknown_error",
]);

/** Executa a Railway CLI por execFile — nunca por shell, nunca concatenando argumentos numa string. */
export function runRailwayCli(args, { timeoutMs = RAILWAY_CLI_TIMEOUT_MS, maxBytes = MAX_OUTPUT_BYTES } = {}) {
  return new Promise((resolve) => {
    execFile(
      "railway",
      args,
      { timeout: timeoutMs, maxBuffer: maxBytes, shell: false, windowsHide: true },
      (error, stdout) => {
        if (error) {
          if (error.killed || error.signal === "SIGTERM") return resolve({ ok: false, errorCode: "cli_timeout" });
          if (error.code === "ENOENT") return resolve({ ok: false, errorCode: "cli_not_found" });
          if (typeof error.code === "number" && error.code !== 0) return resolve({ ok: false, errorCode: "cli_exit_nonzero" });
          return resolve({ ok: false, errorCode: "unknown_error" });
        }
        if (Buffer.byteLength(stdout, "utf8") > maxBytes) return resolve({ ok: false, errorCode: "cli_output_too_large" });
        resolve({ ok: true, stdout });
      }
    );
  });
}

function isFiniteNonNegative(n) {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

/**
 * Extrai uso/capacidade do postgres-volume da saída de `railway volume list
 * --json`. Formato real ainda não calibrado com uma execução manual (ver
 * seção "Como ajustar o parser" em docs/operations/railway-infra-monitor.md)
 * — tenta várias chaves plausíveis (bytes ou MB) e nunca inventa um valor:
 * se não encontrar campo numérico reconhecível, devolve null.
 */
export function parseVolumeListOutput(raw, volumeNameHint = "postgres-volume") {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.volumes) ? parsed.volumes : null;
  if (!list) return null;

  const entry =
    list.find((v) => typeof v?.name === "string" && v.name.toLowerCase().includes(volumeNameHint.toLowerCase())) ??
    list[0] ??
    null;
  if (!entry || typeof entry !== "object") return null;

  const MB = 1024 * 1024;
  const usedBytes = firstFiniteBytes(entry, ["usedBytes", "sizeBytes"]) ?? firstFiniteMb(entry, ["usedMb", "sizeMb", "currentSizeMb"], MB);
  const capacityBytes =
    firstFiniteBytes(entry, ["capacityBytes", "totalBytes"]) ?? firstFiniteMb(entry, ["capacityMb", "totalMb", "maxSizeMb"], MB);

  if (!isFiniteNonNegative(usedBytes) || !isFiniteNonNegative(capacityBytes) || capacityBytes <= 0) return null;
  return { usedBytes, capacityBytes };
}

function firstFiniteBytes(obj, keys) {
  for (const k of keys) if (isFiniteNonNegative(obj[k])) return obj[k];
  return null;
}
function firstFiniteMb(obj, keys, mb) {
  for (const k of keys) if (isFiniteNonNegative(obj[k])) return obj[k] * mb;
  return null;
}

/** Extrai status online/unknown de cada serviço da saída de `railway status --json`. */
export function parseStatusOutput(raw, serviceNames) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const services = Array.isArray(parsed?.services) ? parsed.services : Array.isArray(parsed) ? parsed : null;
  if (!services) return null;

  const statusFor = (nameSubstring) => {
    const found = services.find((s) => typeof s?.name === "string" && s.name.toLowerCase().includes(nameSubstring.toLowerCase()));
    const state = typeof found?.status === "string" ? found.status.toLowerCase() : "";
    return state.includes("active") || state.includes("running") || state.includes("online") ? "online" : "unknown";
  };

  return {
    postgres: statusFor(serviceNames.postgres),
    evolution: statusFor(serviceNames.evolution ?? "evolution"),
    redis: statusFor(serviceNames.redis ?? "redis"),
  };
}

export function buildMetricSample({ sampleId, collectedAt, usedBytes, capacityBytes, capacitySource, services }) {
  if (!isFiniteNonNegative(usedBytes)) return null;
  if (!isFiniteNonNegative(capacityBytes) || capacityBytes <= 0) return null;
  const percentUsed = (usedBytes / capacityBytes) * 100;
  if (!Number.isFinite(percentUsed) || percentUsed < 0 || percentUsed > 100.000001) return null;

  return {
    schemaVersion: 1,
    eventType: "metric_sample",
    sampleId,
    collectedAt,
    source: "railway-cli",
    postgres: { volumeUsedBytes: usedBytes, volumeCapacityBytes: capacityBytes, percentUsed, capacitySource },
    services: {
      postgres: services?.postgres === "online" ? "online" : "unknown",
      evolution: services?.evolution === "online" ? "online" : "unknown",
      redis: services?.redis === "online" ? "online" : "unknown",
    },
    collector: { version: 1, status: "ok" },
  };
}

export function buildCollectorErrorEvent({ sampleId, collectedAt, errorCode }) {
  const code = ALLOWED_ERROR_CODES.has(errorCode) ? errorCode : "unknown_error";
  return {
    schemaVersion: 1,
    eventType: "collector_error",
    sampleId,
    collectedAt,
    source: "railway-cli",
    collector: { version: 1, status: "error", errorCode: code },
  };
}

export function signPayload(secret, timestamp, rawBody) {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

async function sendToChefebot(payload, { ingestUrl, hmacSecret }) {
  const rawBody = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const signature = signPayload(hmacSecret, timestamp, rawBody);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(ingestUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-chefebot-timestamp": timestamp,
        "x-chefebot-signature": signature,
        "x-chefebot-sample-id": payload.sampleId,
      },
      body: rawBody,
      signal: controller.signal,
    });
    // Nunca loga o corpo da resposta — só status, para não vazar detalhe interno.
    console.log(`[infra-monitor] ingestão respondeu HTTP ${res.status}`);
    return res.ok;
  } catch {
    console.log("[infra-monitor] falha de rede ao enviar amostra (sanitizado)");
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function collectSample() {
  const volumeRes = await runRailwayCli(["volume", "list", "--json"]);
  if (!volumeRes.ok) return { ok: false, errorCode: volumeRes.errorCode };

  const volumeMetrics = parseVolumeListOutput(volumeRes.stdout);
  const fallbackCapacityBytes = Number(process.env.RAILWAY_VOLUME_FALLBACK_CAPACITY_BYTES || 0);

  let usedBytes = volumeMetrics?.usedBytes;
  let capacityBytes = volumeMetrics?.capacityBytes;
  let capacitySource = "railway";
  if (!isFiniteNonNegative(usedBytes) || !isFiniteNonNegative(capacityBytes) || capacityBytes <= 0) {
    if (isFiniteNonNegative(usedBytes) && isFiniteNonNegative(fallbackCapacityBytes) && fallbackCapacityBytes > 0) {
      capacityBytes = fallbackCapacityBytes;
      capacitySource = "configured";
    } else {
      return { ok: false, errorCode: "cli_missing_fields" };
    }
  }

  const statusRes = await runRailwayCli(["status", "--json"]);
  const services = statusRes.ok
    ? parseStatusOutput(statusRes.stdout, {
        postgres: process.env.RAILWAY_POSTGRES_SERVICE || "Postgres",
        evolution: "evolution",
        redis: "redis",
      })
    : null;

  return { ok: true, usedBytes, capacityBytes, capacitySource, services: services ?? undefined };
}

async function main() {
  const ingestUrl = process.env.CHEFEBOT_INFRA_INGEST_URL;
  const hmacSecret = process.env.INFRA_METRICS_HMAC_SECRET;
  if (!ingestUrl || !hmacSecret) {
    console.log("[infra-monitor] ingestUrl/hmacSecret ausentes — coleta desativada, nada será enviado.");
    return;
  }

  const sampleId = randomUUID();
  const collectedAt = new Date().toISOString();

  let payload;
  try {
    const result = await collectSample();
    payload = result.ok
      ? buildMetricSample({
          sampleId,
          collectedAt,
          usedBytes: result.usedBytes,
          capacityBytes: result.capacityBytes,
          capacitySource: result.capacitySource,
          services: result.services,
        })
      : buildCollectorErrorEvent({ sampleId, collectedAt, errorCode: result.errorCode });
  } catch {
    payload = null;
  }

  if (!payload) {
    payload = buildCollectorErrorEvent({ sampleId, collectedAt, errorCode: "unknown_error" });
  }

  const ok = await sendToChefebot(payload, { ingestUrl, hmacSecret });
  if (!ok) process.exitCode = 0; // heartbeat de erro já foi tentado; nunca falha o job por isso.
}

// Só executa quando chamado diretamente (permite import em teste sem rodar main()).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
