import { redis } from "./redis";
import { checkRedisHealth } from "./healthChecks";
import { obterConfigEvolution } from "./evolutionApi";
import { lerCanarioAtual } from "./whatsappCanary";
import { configuracaoOutboxWhatsapp, obterJobWhatsapp, resumoFilaWhatsapp } from "./whatsappOutbox";
import { avaliarGatesWhatsApp, recomendarAcaoWhatsApp, type MonitorEvidence, type MonitorMetrics } from "./whatsappMonitorGates";

const PREFIX = "whatsapp:outbox:";
const METRICS_KEY = PREFIX + "monitor:metrics";
const INCIDENTS_KEY = PREFIX + "monitor:incidents";

function nonNegative(input: unknown): number | null {
  if (input === null || input === undefined || input === "") return null;
  const n = Number(input);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function getStage(): number {
  const n = Number(process.env.WHATSAPP_MONITOR_STAGE || "1");
  return Number.isInteger(n) && n >= 1 && n <= 4 ? n : 1;
}

async function evolutionState(): Promise<boolean | null> {
  const config = obterConfigEvolution();
  if (!config) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(config.baseUrl + "/instance/connectionState/" + encodeURIComponent(config.instanceName), {
      headers: { apikey: config.apiKey }, cache: "no-store", signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = await res.json() as { instance?: { state?: string } };
    if (body?.instance?.state === "open") return true;
    if (typeof body?.instance?.state === "string") return false;
    return null;
  } catch { return null; }
  finally { clearTimeout(timer); }
}

// Dados agregados e sem identificadores pessoais. Read-only: GET não reconcilia leases nem
// altera estado, dispara QStash, executa worker ou inicia o canário.
export async function lerMonitorWhatsapp() {
  const [health, evolution, canaryRead, outboxConfig] = await Promise.all([
    checkRedisHealth(), evolutionState(),
    lerCanarioAtual().then(record => ({ record, failed: false }), () => ({ record: null, failed: true })),
    Promise.resolve(configuracaoOutboxWhatsapp()),
  ]);
  const canary = canaryRead.record;
  const redisOk = health.status === "ok";
  let queue: Awaited<ReturnType<typeof resumoFilaWhatsapp>> | null = null;
  let canaryOutboxAccepted: boolean | null = null;
  let counters: Record<string, unknown> | null = null;
  let acceptedCounter = redisOk ? "not_recorded" : "read_failed";
  let canaryOutbox: string = redisOk && !canaryRead.failed ? "not_linked" : "read_failed";
  let oldestWaitingMs: number | null = null;
  let incidents: Array<{ state: string; at: number; reason: string; statusHttp: number | null }> = [];
  if (redisOk && canary?.outboundOutboxJobId) {
    try {
      const canaryJob = await obterJobWhatsapp(canary.outboundOutboxJobId);
      canaryOutboxAccepted = canaryJob ? canaryJob.state === "delivered" : null;
      canaryOutbox = !canaryJob ? "job_missing" :
        ["pending", "leased", "delivered", "failed", "ambiguous", "suppressed", "expired"].includes(canaryJob.state)
          ? canaryJob.state : "invalid_state";
    } catch { canaryOutboxAccepted = null; canaryOutbox = "read_failed"; }
  }
  if (redisOk) {
    // Cada fonte pode falhar independentemente. Falha de telemetria não prova
    // indisponibilidade da fila, nem ausência de envios.
    const [queueRead, countersRead] = await Promise.allSettled([
      resumoFilaWhatsapp(), redis.hgetall<Record<string, unknown>>(METRICS_KEY),
    ]);
    if (queueRead.status === "fulfilled") queue = queueRead.value;
    if (countersRead.status === "fulfilled") {
      counters = countersRead.value;
      acceptedCounter = nonNegative(counters?.delivered) === null ? "not_recorded" : "available";
    } else acceptedCounter = "read_failed";
    try {
      const [ids, critical, normal, promo] = await Promise.all([
        redis.zrange<string[]>(INCIDENTS_KEY, -15, -1),
        redis.zrange<string[]>(PREFIX + "due:critica", 0, 0),
        redis.zrange<string[]>(PREFIX + "due:normal", 0, 0),
        redis.zrange<string[]>(PREFIX + "due:promocional", 0, 0),
      ]);
      const candidates = [...critical, ...normal, ...promo].filter((id): id is string => typeof id === "string");
      const jobs = await Promise.all(candidates.map(id => obterJobWhatsapp(id)));
      for (const job of jobs) if (job?.state === "pending" && Number.isFinite(job.createdAt)) {
        oldestWaitingMs = Math.max(oldestWaitingMs ?? 0, Math.max(0, Date.now() - job.createdAt));
      }
      const incidentJobs = await Promise.all(ids.slice(-15).map(id => obterJobWhatsapp(id)));
      incidents = incidentJobs.filter(job => job && (job.state === "failed" || job.state === "ambiguous"))
        .map(job => {
          const j = job!;
          const result = j.result as { motivo?: unknown; statusHttp?: unknown } | undefined;
          const reason = typeof result?.motivo === "string" && /^[a-z_]{1,64}$/.test(result.motivo) ? result.motivo : "erro_protegido";
          const status = nonNegative(result?.statusHttp);
          return { state: j.state, at: j.updatedAt, reason, statusHttp: status !== null && status >= 400 && status <= 599 ? status : null };
        }).reverse();
    } catch {
      oldestWaitingMs = null;
      incidents = [];
    }
  }
  const metrics: MonitorMetrics = {
    pending: queue?.pending ?? 0,
    inFlight: queue?.inFlight ?? 0,
    ambiguous: queue?.ambiguous ?? 0,
    unresolved: queue?.unresolved ?? 0,
    queued: nonNegative(counters?.queued),
    accepted: nonNegative(counters?.delivered),
    failed: nonNegative(counters?.failed),
    recovered: nonNegative(counters?.recovered),
    closedCanaryNoRetry: nonNegative(counters?.closedCanaryNoRetry),
    oldestWaitingMs,
  };
  const workerAt = nonNegative(counters?.lastWorkerOkAt);
  const workerRecentlyConfirmed = workerAt === null ? null : Date.now() - workerAt <= 15 * 60_000;
  const modeRaw = process.env.WHATSAPP_OUTBOX_ROLLOUT?.trim();
  const mode = modeRaw === "all" || modeRaw === "off" || modeRaw === "canary" ? modeRaw : "canary";
  const stage = getStage();
  const evidence: MonitorEvidence = {
    stage, mode, redisOk: redisOk && queue !== null, evolutionConnected: evolution, workerRecentlyConfirmed,
    qstashConfigured: outboxConfig.ready,
    canary: { state: canary?.state ?? null, outboundHttpStatus: canary?.outboundHttpStatus ?? null, outboxAccepted: canaryOutboxAccepted },
    metrics,
  };
  return {
    checkedAt: Date.now(), stage, mode,
    metrics: queue ? metrics : null,
    since: nonNegative(counters?.since),
    incidents,
    diagnostics: { acceptedCounter, canaryOutbox },
    canary: { state: canary?.state ?? null, testedAt: canary?.createdAt ?? null },
    health: {
      redis: queue !== null && redisOk ? "ok" : "down",
      evolution: evolution === true ? "connected" : evolution === false ? "disconnected" : "unverified",
      qstash: outboxConfig.ready ? "configured_not_verified" : "missing_configuration",
      qstashMissing: outboxConfig.missing,
      qstashScheduleVerified: false,
      lastSignedWorkerSuccessAt: workerAt,
    },
    stages: avaliarGatesWhatsApp(evidence),
    recommendation: recomendarAcaoWhatsApp(evidence),
    limits: {
      actualServiceUsage: null,
      actualServiceCost: null,
      qstashRecoveryScheduleCallsPerDayIfActive: 288,
      note: "288/dia é apenas a previsão de 1 execução a cada 5 min. Não comprova agenda ativa, faturamento nem quota.",
    },
    glossary: {
      accepted: "Aceita por HTTP 2xx pela Evolution; não equivale a entregue no aparelho.",
      recovered: "Lease vencido recuperado para quarentena: não foi reenviado automaticamente.",
      counters: "Contadores cumulativos a partir da instrumentação; não incluem o histórico anterior.",
    },
  };
}
