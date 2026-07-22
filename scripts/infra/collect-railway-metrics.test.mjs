import { describe, expect, it } from "vitest";
import {
  buildCollectorErrorEvent,
  buildMetricSample,
  describeJsonShape,
  parseStatusOutput,
  parseVolumeListOutput,
  signPayload,
} from "./collect-railway-metrics.mjs";

describe("parseVolumeListOutput", () => {
  it("extrai bytes de um array com volumeBytes", () => {
    const raw = JSON.stringify([{ name: "postgres-volume", usedBytes: 500 * 1024 * 1024, capacityBytes: 5 * 1024 * 1024 * 1024 }]);
    const r = parseVolumeListOutput(raw);
    expect(r.usedBytes).toBe(500 * 1024 * 1024);
    expect(r.capacityBytes).toBe(5 * 1024 * 1024 * 1024);
  });

  it("extrai MB e converte para bytes", () => {
    const raw = JSON.stringify([{ name: "postgres-volume", usedMb: 500, capacityMb: 5120 }]);
    const r = parseVolumeListOutput(raw);
    expect(r.usedBytes).toBe(500 * 1024 * 1024);
  });

  it("reconhece o formato real da Railway CLI 5.27.2 ({ environment, project, volumes: [...] } com currentSizeMB/sizeMB)", () => {
    const raw = JSON.stringify({
      environment: "production",
      project: "zestful-liberation",
      volumes: [
        {
          currentSizeMB: 765.21,
          deletedAt: null,
          id: "vol_abc",
          isPendingDeletion: false,
          mountPath: "/var/lib/postgresql/data",
          name: "postgres-volume",
          serviceName: "Postgres",
          sizeMB: 5120,
          status: "active",
        },
      ],
    });
    const r = parseVolumeListOutput(raw, "postgres-volume", "Postgres");
    expect(r.usedBytes).toBeCloseTo(765.21 * 1024 * 1024, 0);
    expect(r.capacityBytes).toBe(5120 * 1024 * 1024);
  });

  it("ignora volumes deletados/pendentes de exclusão ao escolher o volume certo", () => {
    const raw = JSON.stringify({
      volumes: [
        { name: "postgres-volume-antigo", serviceName: "Postgres", currentSizeMB: 1, sizeMB: 500, deletedAt: "2026-01-01T00:00:00Z" },
        { name: "postgres-volume", serviceName: "Postgres", currentSizeMB: 765.21, sizeMB: 5120, deletedAt: null, isPendingDeletion: false },
      ],
    });
    const r = parseVolumeListOutput(raw, "postgres-volume", "Postgres");
    expect(r.capacityBytes).toBe(5120 * 1024 * 1024);
  });

  it("retorna null para JSON inválido", () => {
    expect(parseVolumeListOutput("não é json")).toBeNull();
  });

  it("retorna null quando não há campo numérico reconhecível", () => {
    const raw = JSON.stringify([{ name: "postgres-volume", foo: "bar" }]);
    expect(parseVolumeListOutput(raw)).toBeNull();
  });
});

describe("parseStatusOutput", () => {
  it("mapeia serviços online/unknown", () => {
    const raw = JSON.stringify({ services: [{ name: "Postgres", status: "ACTIVE" }, { name: "Redis", status: "crashed" }] });
    const r = parseStatusOutput(raw, { postgres: "Postgres", evolution: "evolution", redis: "Redis" });
    expect(r.postgres).toBe("online");
    expect(r.redis).toBe("unknown");
    expect(r.evolution).toBe("unknown");
  });
});

describe("buildMetricSample", () => {
  it("constrói uma amostra válida", () => {
    const s = buildMetricSample({
      sampleId: "id1",
      collectedAt: new Date().toISOString(),
      usedBytes: 500 * 1024 * 1024,
      capacityBytes: 5 * 1024 * 1024 * 1024,
      capacitySource: "railway",
      services: { postgres: "online", evolution: "online", redis: "online" },
    });
    expect(s.eventType).toBe("metric_sample");
    expect(s.postgres.percentUsed).toBeGreaterThan(0);
  });

  it("rejeita capacidade zero (evita divisão por zero)", () => {
    const s = buildMetricSample({ sampleId: "id1", collectedAt: new Date().toISOString(), usedBytes: 1, capacityBytes: 0, capacitySource: "railway" });
    expect(s).toBeNull();
  });

  it("rejeita valores negativos", () => {
    const s = buildMetricSample({ sampleId: "id1", collectedAt: new Date().toISOString(), usedBytes: -1, capacityBytes: 100, capacitySource: "railway" });
    expect(s).toBeNull();
  });
});

describe("buildCollectorErrorEvent", () => {
  it("normaliza para unknown_error quando o código não é permitido", () => {
    const e = buildCollectorErrorEvent({ sampleId: "id1", collectedAt: new Date().toISOString(), errorCode: "algo_nao_permitido" });
    expect(e.collector.errorCode).toBe("unknown_error");
  });

  it("mantém um errorCode permitido", () => {
    const e = buildCollectorErrorEvent({ sampleId: "id1", collectedAt: new Date().toISOString(), errorCode: "cli_timeout" });
    expect(e.collector.errorCode).toBe("cli_timeout");
  });
});

describe("describeJsonShape", () => {
  it("nunca expõe valores, só nomes de chave", () => {
    const raw = JSON.stringify([{ id: "vol_segredo123", name: "postgres-volume", weirdField: 999999 }]);
    const shape = describeJsonShape(raw);
    expect(shape.parseable).toBe(true);
    expect(shape.isArray).toBe(true);
    expect(shape.firstItemKeys).toEqual(["id", "name", "weirdField"]);
    expect(JSON.stringify(shape)).not.toContain("vol_segredo123");
    expect(JSON.stringify(shape)).not.toContain("999999");
  });

  it("marca parseable:false para JSON inválido", () => {
    expect(describeJsonShape("não é json")).toEqual({ parseable: false });
  });

  it("reconhece formato { volumes: [...] }", () => {
    const raw = JSON.stringify({ volumes: [{ mountPath: "/data" }], meta: 1 });
    const shape = describeJsonShape(raw);
    expect(shape.topKeys).toEqual(["volumes", "meta"]);
    expect(shape.firstItemKeys).toEqual(["mountPath"]);
  });
});

describe("signPayload", () => {
  it("gera assinatura hex determinística", () => {
    const sig1 = signPayload("secret", "123", "{}");
    const sig2 = signPayload("secret", "123", "{}");
    expect(sig1).toBe(sig2);
    expect(sig1).toMatch(/^[0-9a-f]{64}$/);
  });
});
