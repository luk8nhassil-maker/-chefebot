import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fakeRedis } = vi.hoisted(() => {
  type ZMember = { score: number; member: string };
  const strings = new Map<string, unknown>();
  const zsets = new Map<string, ZMember[]>();
  const lists = new Map<string, string[]>();
  const counters = new Map<string, number>();

  const fakeRedis = {
    async get<T>(key: string): Promise<T | null> {
      return (strings.get(key) as T) ?? null;
    },
    async set(key: string, value: unknown, opts?: { nx?: boolean; ex?: number }): Promise<string | null> {
      if (opts?.nx && strings.has(key)) return null;
      strings.set(key, value);
      return "OK";
    },
    async incr(key: string): Promise<number> {
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return next;
    },
    async expire(): Promise<number> {
      return 1;
    },
    async zadd(key: string, entry: { score: number; member: string }): Promise<number> {
      const arr = zsets.get(key) ?? [];
      arr.push(entry);
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
      zsets.set(key, arr.filter((m) => !(m.score >= min && m.score <= max)));
      return 0;
    },
    async zremrangebyrank(key: string, start: number, stop: number): Promise<number> {
      const arr = zsets.get(key) ?? [];
      const end = stop === -1 ? arr.length : stop + 1;
      arr.splice(start, Math.max(0, end - start));
      zsets.set(key, arr);
      return 0;
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
      counters.clear();
    },
  };
  return { fakeRedis };
});

vi.mock("@/lib/redis", () => ({ redis: fakeRedis }));

import { POST } from "./route";

const SECRET = "hmac-secret-de-teste-com-entropia-suficiente";
const SAMPLE_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function goodBody(overrides: Record<string, unknown> = {}, sampleId = SAMPLE_ID) {
  return {
    schemaVersion: 1,
    eventType: "metric_sample",
    sampleId,
    collectedAt: new Date().toISOString(),
    source: "railway-cli",
    postgres: {
      volumeUsedBytes: 500 * 1024 * 1024,
      volumeCapacityBytes: 5 * 1024 * 1024 * 1024,
      percentUsed: 9.7,
      capacitySource: "railway",
    },
    services: { postgres: "online", evolution: "online", redis: "online" },
    collector: { version: 1, status: "ok" },
    ...overrides,
  };
}

function sign(timestamp: string, rawBody: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

function buildRequest(body: unknown, opts: Partial<{ timestamp: string; signature: string; sampleId: string; contentType: string }> = {}) {
  const rawBody = JSON.stringify(body);
  const timestamp = opts.timestamp ?? String(Date.now());
  const signature = opts.signature ?? sign(timestamp, rawBody);
  const sampleId = opts.sampleId ?? (body as { sampleId?: string })?.sampleId ?? SAMPLE_ID;
  const contentType = opts.contentType ?? "application/json";
  return {
    headers: {
      get: (name: string) => {
        const map: Record<string, string | null> = {
          "content-type": contentType,
          "x-chefebot-timestamp": timestamp,
          "x-chefebot-signature": signature,
          "x-chefebot-sample-id": sampleId,
        };
        return map[name.toLowerCase()] ?? null;
      },
    },
    text: async () => rawBody,
  } as unknown as import("next/server").NextRequest;
}

beforeEach(() => {
  fakeRedis.__reset();
  process.env.INFRA_METRICS_HMAC_SECRET = SECRET;
  process.env.DEV_INFRA_MONITOR_ENABLED = "true";
});

describe("POST /api/internal/infra/railway/metrics", () => {
  it("aceita uma amostra válida", async () => {
    const res = await POST(buildRequest(goodBody()));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it("rejeita sem secret configurado (503, sem detalhar motivo)", async () => {
    delete process.env.INFRA_METRICS_HMAC_SECRET;
    const res = await POST(buildRequest(goodBody()));
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toBe("unavailable");
  });

  it("rejeita assinatura inválida com 401 genérico", async () => {
    const res = await POST(buildRequest(goodBody(), { signature: "0".repeat(64) }));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("unauthorized");
  });

  it("rejeita timestamp expirado com 401", async () => {
    const oldTs = String(Date.now() - 10 * 60 * 1000);
    const body = goodBody();
    const rawBody = JSON.stringify(body);
    const res = await POST(
      buildRequest(body, { timestamp: oldTs, signature: sign(oldTs, rawBody) })
    );
    expect(res.status).toBe(401);
  });

  it("rejeita content-type diferente de application/json", async () => {
    const res = await POST(buildRequest(goodBody(), { contentType: "text/plain" }));
    expect(res.status).toBe(400);
  });

  it("é idempotente: reenviar o mesmo sampleId não reprocessa e responde ok", async () => {
    const body = goodBody();
    const res1 = await POST(buildRequest(body));
    expect((await res1.json()).ok).toBe(true);
    const res2 = await POST(buildRequest(body));
    const json2 = await res2.json();
    expect(res2.status).toBe(200);
    expect(json2.duplicate).toBe(true);
  });

  it("aplica rate limit conservador", async () => {
    let last;
    for (let i = 0; i < 31; i++) {
      const body = goodBody({}, `sample-${i}-aaaaaaaa`);
      last = await POST(buildRequest(body));
    }
    expect(last!.status).toBe(429);
  });

  it("aceita um collector_error sanitizado e não derruba a rota", async () => {
    const body = {
      schemaVersion: 1,
      eventType: "collector_error",
      sampleId: SAMPLE_ID,
      collectedAt: new Date().toISOString(),
      source: "railway-cli",
      collector: { version: 1, status: "error", errorCode: "cli_timeout" },
    };
    const res = await POST(buildRequest(body));
    expect(res.status).toBe(200);
  });

  it("nunca vaza detalhe de autenticação nas respostas de erro", async () => {
    const res = await POST(buildRequest(goodBody(), { signature: "0".repeat(64) }));
    const json = await res.json();
    expect(JSON.stringify(json)).not.toMatch(/signature|timestamp|hmac/i);
  });

  it("com a flag desligada, exige HMAC válido mas não persiste nada", async () => {
    process.env.DEV_INFRA_MONITOR_ENABLED = "false";
    const resBadSig = await POST(buildRequest(goodBody(), { signature: "0".repeat(64) }));
    expect(resBadSig.status).toBe(401);

    const res = await POST(buildRequest(goodBody()));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.stored).toBe(false);
  });
});
