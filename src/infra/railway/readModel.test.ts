import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryPoint, MetricSample } from "./types";

const { mockReadInfraState } = vi.hoisted(() => ({
  mockReadInfraState: vi.fn(),
}));

vi.mock("./persistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./persistence")>();
  return { ...actual, readInfraState: mockReadInfraState };
});

vi.mock("./whatsappStatus", () => ({
  readWhatsappConnectionStateSafe: vi.fn().mockResolvedValue({ connectionState: "unknown", checkedAt: 0 }),
}));

import { buildInfraSnapshot } from "./readModel";

const MB = 1024 * 1024;
const CAP = 5 * 1024 * MB;
const NOW = Date.parse("2026-07-22T12:00:00-03:00");

function sample(usedMb: number): MetricSample {
  return {
    schemaVersion: 1,
    eventType: "metric_sample",
    sampleId: "s1",
    collectedAt: new Date(NOW).toISOString(),
    source: "railway-cli",
    postgres: { volumeUsedBytes: usedMb * MB, volumeCapacityBytes: CAP, percentUsed: (usedMb * MB * 100) / CAP, capacitySource: "railway" },
    services: { postgres: "online", evolution: "online", redis: "online" },
    collector: { version: 1, status: "ok" },
  };
}

function historyPoint(daysAgo: number, usedMb: number): HistoryPoint {
  return {
    ts: NOW - daysAgo * 24 * 60 * 60 * 1000,
    usedBytes: usedMb * MB,
    capacityBytes: CAP,
    percentUsed: ((usedMb * MB) / CAP) * 100, // 0–100, nunca fração 0–1
    origin: "collector",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildInfraSnapshot", () => {
  it("monitor ainda não ativado quando a flag está desligada", async () => {
    const snap = await buildInfraSnapshot(false, NOW);
    expect(snap.configured).toBe(false);
    expect(mockReadInfraState).not.toHaveBeenCalled();
  });

  it("indisponível quando o Redis falha (ok:false)", async () => {
    mockReadInfraState.mockResolvedValue({ ok: false, latestSample: null, collectorStatus: null, history: [], severityState: null, alerts: [] });
    const snap = await buildInfraSnapshot(true, NOW);
    expect(snap.configured).toBe(true);
    expect(snap.redisAvailable).toBe(false);
  });

  it("coletando primeiro histórico quando nunca houve amostra", async () => {
    mockReadInfraState.mockResolvedValue({ ok: true, latestSample: null, collectorStatus: null, history: [], severityState: null, alerts: [] });
    const snap = await buildInfraSnapshot(true, NOW);
    expect(snap.collector.status).toBe("never");
    expect(snap.postgresVolume.usedBytes).toBeNull();
  });

  it("retorna estado saudável com histórico suficiente", async () => {
    mockReadInfraState.mockResolvedValue({
      ok: true,
      latestSample: sample(500),
      collectorStatus: { status: "ok", lastRunAt: NOW },
      history: [historyPoint(7, 460), historyPoint(0, 500)],
      severityState: { severity: "healthy", isStale: false, consecutiveFailures: 0, updatedAt: NOW },
      alerts: [],
    });
    const snap = await buildInfraSnapshot(true, NOW);
    expect(snap.postgresVolume.severity).toBe("healthy");
    expect(snap.postgresVolume.freeBytes).toBe(CAP - 500 * MB);
    expect(snap.history.length).toBeGreaterThan(0);
  });

  it("marca stale quando coletor está atrasado", async () => {
    const oldTs = NOW - 20 * 60 * 60 * 1000;
    mockReadInfraState.mockResolvedValue({
      ok: true,
      latestSample: sample(500),
      collectorStatus: { status: "ok", lastRunAt: oldTs },
      history: [historyPoint(7, 460), historyPoint(0, 500)],
      severityState: null,
      alerts: [],
    });
    const snap = await buildInfraSnapshot(true, NOW);
    expect(snap.collector.status).toBe("stale");
    expect(snap.postgresVolume.severity).toBe("stale");
  });

  it("inclui as baselines manuais no histórico consolidado", async () => {
    mockReadInfraState.mockResolvedValue({
      ok: true,
      latestSample: sample(765.21),
      collectorStatus: { status: "ok", lastRunAt: NOW },
      history: [historyPoint(1, 495.4), historyPoint(0, 765.21)],
      severityState: null,
      alerts: [],
    });
    const snap = await buildInfraSnapshot(true, NOW);
    expect(snap.history.some((h) => h.origin === "railway-ui-manual")).toBe(true);
  });

  it("devolve o histórico sempre ordenado cronologicamente, mesmo que a persistência entregue fora de ordem", async () => {
    mockReadInfraState.mockResolvedValue({
      ok: true,
      latestSample: sample(765.21),
      collectorStatus: { status: "ok", lastRunAt: NOW },
      // Fora de ordem de propósito: o ponto mais recente vem primeiro no array.
      history: [historyPoint(0, 765.21), historyPoint(10, 700), historyPoint(1, 495.4)],
      severityState: null,
      alerts: [],
    });
    const snap = await buildInfraSnapshot(true, NOW);
    for (let i = 1; i < snap.history.length; i++) {
      expect(snap.history[i].ts).toBeGreaterThanOrEqual(snap.history[i - 1].ts);
    }
  });

  it("percentUsed é comparável (mesma escala 0–100) entre pontos de origem collector e railway-ui-manual", async () => {
    mockReadInfraState.mockResolvedValue({
      ok: true,
      latestSample: sample(500), // 500MB / 5GB = 9.77%
      collectorStatus: { status: "ok", lastRunAt: NOW },
      history: [historyPoint(0, 500)],
      severityState: null,
      alerts: [],
    });
    const snap = await buildInfraSnapshot(true, NOW);
    const collectorPoint = snap.history.find((h) => h.origin === "collector")!;
    const baselinePoint = snap.history.find((h) => h.origin === "railway-ui-manual")!;
    // Ambos precisam estar na faixa 0–100 (porcentagem) — nunca um em fração 0–1.
    expect(collectorPoint.percentUsed).toBeGreaterThan(1);
    expect(collectorPoint.percentUsed).toBeLessThanOrEqual(100);
    expect(baselinePoint.percentUsed).toBeGreaterThan(1);
    expect(baselinePoint.percentUsed).toBeLessThanOrEqual(100);
  });
});
