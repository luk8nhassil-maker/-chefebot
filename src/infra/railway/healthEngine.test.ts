import { describe, expect, it } from "vitest";
import {
  canClaimOverallHealthy,
  computeDailyGrowth,
  computeDelta,
  computeForecast,
  describeServiceStatusLabel,
  detectAnomaly,
  evaluateAlerts,
  isCollectionStale,
  resolveDisplayState,
  severityFromPercent,
  sortHistoryChronologically,
  DAY_MS,
} from "./healthEngine";
import type { HistoryPoint } from "./types";

const MB = 1024 * 1024;
const CAP = 5 * 1024 * MB;
const NOW = Date.parse("2026-07-22T12:00:00-03:00");

function point(daysAgo: number, usedMb: number): HistoryPoint {
  return {
    ts: NOW - daysAgo * DAY_MS,
    usedBytes: usedMb * MB,
    capacityBytes: CAP,
    percentUsed: ((usedMb * MB) / CAP) * 100, // 0–100, nunca fração 0–1 (ver types.ts:HistoryPoint)
    origin: "collector",
  };
}

describe("severityFromPercent", () => {
  it("classifica as cinco faixas", () => {
    expect(severityFromPercent(10)).toBe("healthy");
    expect(severityFromPercent(69.9)).toBe("healthy");
    expect(severityFromPercent(70)).toBe("attention");
    expect(severityFromPercent(79.9)).toBe("attention");
    expect(severityFromPercent(80)).toBe("critical");
    expect(severityFromPercent(89.9)).toBe("critical");
    expect(severityFromPercent(90)).toBe("emergency");
    expect(severityFromPercent(94.9)).toBe("emergency");
    expect(severityFromPercent(95)).toBe("imminent");
    expect(severityFromPercent(100)).toBe("imminent");
  });
});

describe("computeDelta", () => {
  it("retorna null sem histórico", () => {
    expect(computeDelta([], NOW, DAY_MS)).toBeNull();
  });

  it("retorna null quando não há ponto na janela passada", () => {
    const history = [point(0, 500)];
    expect(computeDelta(history, NOW, 7 * DAY_MS)).toBeNull();
  });

  it("calcula delta de 24h corretamente", () => {
    const history = [point(1, 490), point(0, 500)];
    const d = computeDelta(history, NOW, DAY_MS);
    expect(d?.bytes).toBe(10 * MB);
  });
});

describe("computeDailyGrowth", () => {
  it("null sem dados", () => {
    expect(computeDailyGrowth([], NOW)).toBeNull();
  });

  it("usa janela de 7 dias quando disponível (confiança ok)", () => {
    const history = [point(7, 460), point(0, 500)];
    const growth = computeDailyGrowth(history, NOW);
    expect(growth?.confidence).toBe("ok");
    expect(growth?.bytesPerDay).toBeCloseTo((40 * MB) / 7, 0);
  });

  it("cai para 24h quando não há 7 dias (confiança low)", () => {
    const history = [point(1, 495), point(0, 500)];
    const growth = computeDailyGrowth(history, NOW);
    expect(growth?.confidence).toBe("low");
    expect(growth?.bytesPerDay).toBeCloseTo(5 * MB, 0);
  });
});

describe("computeForecast", () => {
  it("coletando histórico quando span < 24h", () => {
    const history = [point(0.1, 490), point(0, 500)];
    const f = computeForecast({
      history,
      nowTs: NOW,
      usedBytes: 500 * MB,
      capacityBytes: CAP,
      dailyGrowth: computeDailyGrowth(history, NOW),
      isAnomaly: false,
    });
    expect(f.status).toBe("collecting_history");
  });

  it("sem crescimento detectável quando delta <= 0", () => {
    const history = [point(7, 500), point(0, 490)];
    const f = computeForecast({
      history,
      nowTs: NOW,
      usedBytes: 490 * MB,
      capacityBytes: CAP,
      dailyGrowth: computeDailyGrowth(history, NOW),
      isAnomaly: false,
    });
    expect(f.status).toBe("no_growth");
  });

  it("estimated não confiável com menos de 7 dias de span", () => {
    const history = [point(1, 495), point(0, 500)];
    const f = computeForecast({
      history,
      nowTs: NOW,
      usedBytes: 500 * MB,
      capacityBytes: CAP,
      dailyGrowth: computeDailyGrowth(history, NOW),
      isAnomaly: false,
    });
    expect(f.status).toBe("estimated");
    if (f.status === "estimated") expect(f.reliable).toBe(false);
  });

  it("estimated confiável com >= 7 dias e projeta cada limiar sem dividir por zero", () => {
    const history = [point(7, 3000), point(0, 3500)];
    const f = computeForecast({
      history,
      nowTs: NOW,
      usedBytes: 3500 * MB,
      capacityBytes: CAP,
      dailyGrowth: computeDailyGrowth(history, NOW),
      isAnomaly: false,
    });
    expect(f.status).toBe("estimated");
    if (f.status === "estimated") {
      expect(f.reliable).toBe(true);
      expect(f.entries).toHaveLength(4);
      for (const e of f.entries) {
        expect(Number.isFinite(e.days)).toBe(true);
      }
    }
  });

  it("marca already_reached quando limiar já foi ultrapassado", () => {
    const history = [point(7, 4000), point(0, 4900)];
    const f = computeForecast({
      history,
      nowTs: NOW,
      usedBytes: 4900 * MB,
      capacityBytes: CAP,
      dailyGrowth: computeDailyGrowth(history, NOW),
      isAnomaly: false,
    });
    expect(f.status).toBe("estimated");
    if (f.status === "estimated") {
      const e70 = f.entries.find((e) => e.threshold === 70);
      expect(e70?.status).toBe("already_reached");
    }
  });
});

describe("detectAnomaly", () => {
  it("sem anomalia em crescimento normal e estável", () => {
    const history = [point(8, 400), point(1, 407), point(0, 412)];
    const a = detectAnomaly(history, NOW);
    expect(a.isAnomaly).toBe(false);
  });

  it("detecta salto muito acima do padrão recente (caso do incidente)", () => {
    const history = [point(8, 480), point(1, 495.4), point(0, 765.21)];
    const a = detectAnomaly(history, NOW);
    expect(a.isAnomaly).toBe(true);
  });

  it("não classifica isoladamente sem baseline suficiente", () => {
    const history = [point(0, 500)];
    const a = detectAnomaly(history, NOW);
    expect(a.isAnomaly).toBe(false);
  });
});

describe("isCollectionStale / resolveDisplayState", () => {
  it("stale após 18h sem coleta", () => {
    expect(isCollectionStale(NOW - 19 * 60 * 60 * 1000, NOW)).toBe(true);
    expect(isCollectionStale(NOW - 10 * 60 * 60 * 1000, NOW)).toBe(false);
    expect(isCollectionStale(null, NOW)).toBe(false);
  });

  it("prioriza never > error > stale > severidade", () => {
    expect(resolveDisplayState({ collectorState: "never", severity: null })).toBe("never");
    expect(resolveDisplayState({ collectorState: "error", severity: "healthy" })).toBe("unavailable");
    expect(resolveDisplayState({ collectorState: "stale", severity: "healthy" })).toBe("stale");
    expect(resolveDisplayState({ collectorState: "ok", severity: "critical" })).toBe("critical");
  });
});

describe("evaluateAlerts", () => {
  const base = {
    previousSeverity: "healthy" as const,
    currentSeverity: "healthy" as const,
    wasStale: false,
    isStale: false,
    anomaly: { isAnomaly: false, last24hBytes: null, normalDailyBaselineBytes: null },
    collectorConsecutiveFailures: 0,
    nowTs: NOW,
  };

  it("nenhum alerta quando nada muda", () => {
    expect(evaluateAlerts(base)).toEqual([]);
  });

  it("gera severity_change ao subir de faixa", () => {
    const alerts = evaluateAlerts({ ...base, previousSeverity: "healthy", currentSeverity: "attention" });
    expect(alerts.map((a) => a.type)).toEqual(["severity_change"]);
  });

  it("gera back_to_normal ao voltar para healthy", () => {
    const alerts = evaluateAlerts({ ...base, previousSeverity: "critical", currentSeverity: "healthy" });
    expect(alerts.map((a) => a.type)).toEqual(["back_to_normal"]);
  });

  it("não gera severity_change no primeiro ciclo (previousSeverity null)", () => {
    const alerts = evaluateAlerts({ ...base, previousSeverity: null, currentSeverity: "attention" });
    expect(alerts).toEqual([]);
  });

  it("gera collector_stale só na transição", () => {
    const alerts1 = evaluateAlerts({ ...base, wasStale: false, isStale: true });
    expect(alerts1.map((a) => a.type)).toContain("collector_stale");
    const alerts2 = evaluateAlerts({ ...base, wasStale: true, isStale: true });
    expect(alerts2.map((a) => a.type)).not.toContain("collector_stale");
  });

  it("gera anomalous_spike quando anomaly.isAnomaly", () => {
    const alerts = evaluateAlerts({
      ...base,
      anomaly: { isAnomaly: true, last24hBytes: 999, normalDailyBaselineBytes: 1 },
    });
    expect(alerts.map((a) => a.type)).toContain("anomalous_spike");
  });

  it("gera collector_repeated_failure exatamente na 3ª falha seguida, não repete depois", () => {
    const at3 = evaluateAlerts({ ...base, collectorConsecutiveFailures: 3 });
    expect(at3.map((a) => a.type)).toContain("collector_repeated_failure");
    const at4 = evaluateAlerts({ ...base, collectorConsecutiveFailures: 4 });
    expect(at4.map((a) => a.type)).not.toContain("collector_repeated_failure");
  });

  it("não duplica alerta em coletas repetidas sem mudança", () => {
    const s1 = evaluateAlerts({ ...base, previousSeverity: "attention", currentSeverity: "attention" });
    expect(s1).toEqual([]);
  });
});

describe("sortHistoryChronologically", () => {
  it("ordena pontos fora de ordem, misturando origem collector e railway-ui-manual", () => {
    const p1 = { ...point(0, 500), origin: "collector" as const };
    const p2 = { ...point(30, 300), origin: "railway-ui-manual" as const };
    const p3 = { ...point(15, 400), origin: "collector" as const };
    const sorted = sortHistoryChronologically([p1, p2, p3]);
    expect(sorted.map((p) => p.ts)).toEqual([p2.ts, p3.ts, p1.ts]);
  });

  it("nunca muta o array de entrada", () => {
    const p1 = point(0, 500);
    const p2 = point(10, 400);
    const input = [p1, p2];
    sortHistoryChronologically(input);
    expect(input).toEqual([p1, p2]);
  });

  it("é estável mesmo já ordenado", () => {
    const p1 = point(10, 400);
    const p2 = point(0, 500);
    expect(sortHistoryChronologically([p1, p2]).map((p) => p.ts)).toEqual([p1.ts, p2.ts]);
  });
});

describe("describeServiceStatusLabel", () => {
  it("mapeia unknown para 'não monitorado', nunca tratando como falha", () => {
    expect(describeServiceStatusLabel("unknown")).toBe("não monitorado");
  });

  it("mapeia os estados reais sem alterar seu significado", () => {
    expect(describeServiceStatusLabel("online")).toBe("online");
    expect(describeServiceStatusLabel("connected")).toBe("conectado");
    expect(describeServiceStatusLabel("disconnected")).toBe("desconectado");
  });
});

describe("canClaimOverallHealthy", () => {
  it("nunca declara saudável geral quando o volume não está saudável", () => {
    expect(
      canClaimOverallHealthy({ volumeSeverity: "attention", serviceStatuses: ["online", "connected"] })
    ).toBe(false);
  });

  it("nunca declara saudável geral quando todos os serviços são 'unknown' (sem dado suficiente)", () => {
    expect(
      canClaimOverallHealthy({ volumeSeverity: "healthy", serviceStatuses: ["unknown", "unknown", "unknown", "unknown"] })
    ).toBe(false);
  });

  it("permite a declaração só quando o volume está saudável E há ao menos um serviço com sinal real", () => {
    expect(
      canClaimOverallHealthy({ volumeSeverity: "healthy", serviceStatuses: ["unknown", "unknown", "online", "unknown"] })
    ).toBe(true);
  });
});
