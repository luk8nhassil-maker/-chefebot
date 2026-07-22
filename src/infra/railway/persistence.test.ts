import { beforeEach, describe, expect, it, vi } from "vitest";

// Redis fake em memória — só implementa os comandos que persistence.ts usa
// (get/set com nx+ex, zadd/zrange/zcard/zremrangebyscore/zremrangebyrank,
// lpush/ltrim/lrange). Suficiente para testar retenção/limite/idempotência
// sem depender de uma instância Redis real.
const { fakeRedis } = vi.hoisted(() => {
  type ZMember = { score: number; member: string };
  const strings = new Map<string, unknown>();
  const zsets = new Map<string, ZMember[]>();
  const lists = new Map<string, string[]>();

  const fakeRedis = {
    async get<T>(key: string): Promise<T | null> {
      return (strings.get(key) as T) ?? null;
    },
    async set(key: string, value: unknown, opts?: { nx?: boolean; ex?: number }): Promise<string | null> {
      if (opts?.nx && strings.has(key)) return null;
      strings.set(key, value);
      return "OK";
    },
    async zadd(key: string, entry: { score: number; member: string }): Promise<number> {
      const arr = zsets.get(key) ?? [];
      const idx = arr.findIndex((m) => m.member === entry.member);
      if (idx >= 0) arr[idx] = entry;
      else arr.push(entry);
      arr.sort((a, b) => a.score - b.score);
      zsets.set(key, arr);
      return 1;
    },
    async zrange(key: string, start: number, stop: number, opts?: { withScores?: boolean }): Promise<unknown[]> {
      const arr = zsets.get(key) ?? [];
      const end = stop === -1 ? arr.length : stop + 1;
      const slice = arr.slice(start, end);
      if (opts?.withScores) return slice.flatMap((m) => [m.member, m.score]);
      return slice.map((m) => m.member);
    },
    async zcard(key: string): Promise<number> {
      return (zsets.get(key) ?? []).length;
    },
    async zremrangebyscore(key: string, min: number, max: number): Promise<number> {
      const arr = zsets.get(key) ?? [];
      const kept = arr.filter((m) => !(m.score >= min && m.score <= max));
      const removed = arr.length - kept.length;
      zsets.set(key, kept);
      return removed;
    },
    async zremrangebyrank(key: string, start: number, stop: number): Promise<number> {
      const arr = zsets.get(key) ?? [];
      const end = stop === -1 ? arr.length : stop + 1;
      const removedCount = Math.max(0, end - start);
      arr.splice(start, removedCount);
      zsets.set(key, arr);
      return removedCount;
    },
    async lpush(key: string, ...values: string[]): Promise<number> {
      const arr = lists.get(key) ?? [];
      arr.unshift(...values);
      lists.set(key, arr);
      return arr.length;
    },
    async ltrim(key: string, start: number, stop: number): Promise<string> {
      const arr = lists.get(key) ?? [];
      const end = stop === -1 ? arr.length : stop + 1;
      lists.set(key, arr.slice(start, end));
      return "OK";
    },
    async lrange(key: string, start: number, stop: number): Promise<string[]> {
      const arr = lists.get(key) ?? [];
      const end = stop === -1 ? arr.length : stop + 1;
      return arr.slice(start, end);
    },
    __reset() {
      strings.clear();
      zsets.clear();
      lists.clear();
    },
  };
  return { fakeRedis };
});

vi.mock("@/lib/redis", () => ({ redis: fakeRedis }));

import {
  appendAlerts,
  claimSampleId,
  mergeHistoryWithBaselines,
  readAlerts,
  readCollectorHistory,
  readCollectorStatus,
  readInfraState,
  readLatestSample,
  recordCollectorError,
  recordMetricSample,
} from "./persistence";
import type { Alert, CollectorErrorEvent, MetricSample } from "./types";

function sample(overrides: Partial<MetricSample["postgres"]> = {}, collectedAt = "2026-07-22T12:00:00.000Z", sampleId = "s1"): MetricSample {
  return {
    schemaVersion: 1,
    eventType: "metric_sample",
    sampleId,
    collectedAt,
    source: "railway-cli",
    postgres: {
      volumeUsedBytes: 500 * 1024 * 1024,
      volumeCapacityBytes: 5 * 1024 * 1024 * 1024,
      percentUsed: 10,
      capacitySource: "railway",
      ...overrides,
    },
    services: { postgres: "online", evolution: "online", redis: "online" },
    collector: { version: 1, status: "ok" },
  };
}

beforeEach(() => {
  fakeRedis.__reset();
});

describe("recordMetricSample / leitura", () => {
  it("grava e lê a amostra mais recente e o histórico", async () => {
    await recordMetricSample(sample());
    const latest = await readLatestSample();
    expect(latest?.sampleId).toBe("s1");
    const history = await readCollectorHistory();
    expect(history).toHaveLength(1);
    expect(history[0].usedBytes).toBe(500 * 1024 * 1024);
    const status = await readCollectorStatus();
    expect(status?.status).toBe("ok");
  });

  it("mantém no máximo 1000 amostras (retenção por quantidade)", async () => {
    for (let i = 0; i < 1005; i++) {
      const ts = new Date(Date.parse("2020-01-01T00:00:00.000Z") + i * 60_000).toISOString();
      await recordMetricSample(sample({}, ts, `s${i}`));
    }
    const history = await readCollectorHistory();
    expect(history.length).toBeLessThanOrEqual(1000);
  });

  it("remove amostras com mais de 180 dias", async () => {
    const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date().toISOString();
    await recordMetricSample(sample({}, old, "old"));
    await recordMetricSample(sample({}, recent, "recent"));
    const history = await readCollectorHistory();
    expect(history.map((h) => h.origin)).toEqual(["collector"]);
    expect(history).toHaveLength(1);
  });
});

describe("recordCollectorError", () => {
  it("registra erro sem tocar no histórico/latest", async () => {
    await recordMetricSample(sample());
    const event: CollectorErrorEvent = {
      schemaVersion: 1,
      eventType: "collector_error",
      sampleId: "err1",
      collectedAt: new Date().toISOString(),
      source: "railway-cli",
      collector: { version: 1, status: "error", errorCode: "cli_timeout" },
    };
    await recordCollectorError(event);
    const status = await readCollectorStatus();
    expect(status?.status).toBe("error");
    expect(status?.errorCode).toBe("cli_timeout");
    const history = await readCollectorHistory();
    expect(history).toHaveLength(1); // não duplicou/alterou
  });
});

describe("claimSampleId (idempotência)", () => {
  it("primeira reivindicação é nova; repetição não é", async () => {
    const first = await claimSampleId("abc");
    const second = await claimSampleId("abc");
    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(false);
  });
});

describe("appendAlerts / readAlerts", () => {
  it("mantém só os 100 alertas mais recentes", async () => {
    for (let i = 0; i < 120; i++) {
      const alert: Alert = { id: `a${i}`, ts: i, type: "severity_change", severity: "attention", description: "x" };
      await appendAlerts([alert]);
    }
    const alerts = await readAlerts();
    expect(alerts).toHaveLength(100);
    expect(alerts[0].id).toBe("a119"); // mais recente primeiro
  });
});

describe("mergeHistoryWithBaselines", () => {
  it("une histórico do coletor com as baselines manuais, ordenado por tempo", () => {
    const merged = mergeHistoryWithBaselines([
      { ts: Date.parse("2026-07-22T00:00:00Z"), usedBytes: 1, capacityBytes: 1, percentUsed: 1, origin: "collector" },
    ]);
    const origins = merged.map((m) => m.origin);
    expect(origins).toContain("railway-ui-manual");
    expect(origins).toContain("collector");
    for (let i = 1; i < merged.length; i++) {
      expect(merged[i].ts).toBeGreaterThanOrEqual(merged[i - 1].ts);
    }
  });
});

describe("readInfraState — Redis indisponível", () => {
  it("nunca lança; devolve ok:false com fallback seguro", async () => {
    const original = fakeRedis.get;
    fakeRedis.get = vi.fn(async () => {
      throw new Error("boom");
    });
    const state = await readInfraState();
    expect(state.ok).toBe(false);
    expect(state.latestSample).toBeNull();
    expect(state.history).toEqual([]);
    fakeRedis.get = original;
  });
});
