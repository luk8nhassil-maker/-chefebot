import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { performance } from "node:perf_hooks";
import { NextRequest } from "next/server";

// REAL: worker route, QStash authorization gate, inbox Lua, Redis real disposable.
// FAKE: QStash signature verifier/dispatcher, commercial processor and Evolution.
const state = vi.hoisted(() => ({
  effects: new Map<string, number>(),
  active: 0, peak: 0,
  failId: "",
  publish: vi.fn(async () => ({ messageId: "wake-fake" })),
  schedule: vi.fn(async () => ({ scheduleId: "schedule-fake" })),
}));
vi.mock("@upstash/qstash", () => ({
  Client: vi.fn().mockImplementation(() => ({
    schedules: { create: state.schedule },
    publishJSON: state.publish,
  })),
  Receiver: vi.fn().mockImplementation(() => ({
    verify: vi.fn(async (opts: { signature: string; url: string; body: string }) =>
      opts.signature === "signed-local-test" &&
      opts.url === "https://chefedapizza.com.br/api/interno/whatsapp-inbox/processar"),
  })),
}));
vi.mock("@/app/api/whatsapp/route", () => ({
  POST: vi.fn(async (req: Request) => {
    const body = await req.json() as {
      data?: { key?: { id?: string } };
    };
    const id = body.data?.key?.id ?? "missing-id";
    state.active++;
    state.peak = Math.max(state.peak, state.active);
    try {
      await new Promise<void>(resolve => setTimeout(resolve, 3));
      if (id === state.failId) return new Response(JSON.stringify({ ok: false }), { status: 500 });
      const { redis } = await import("@/lib/redis");
      await redis.incr("pico50:worker:effect:" + id);
      state.effects.set(id, (state.effects.get(id) || 0) + 1);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    } finally { state.active--; }
  }),
}));

import { redis } from "@/lib/redis";
import { POST as worker } from "@/app/api/interno/whatsapp-inbox/processar/route";
import { enfileirarInboundWhatsapp, resumoInboxWhatsapp } from "@/lib/whatsappInbox";
const NATIVE_FETCH = globalThis.fetch.bind(globalThis);

function msg(id: string, phone: string) {
  return { phone, messageId: id, payload: {
    event: "messages.upsert", data: {
      key: { remoteJid: phone + "@s.whatsapp.net", id, fromMe: false },
      message: { conversation: "oi" },
    },
  } };
}
function signed() {
  return new NextRequest("https://chefedapizza.com.br/api/interno/whatsapp-inbox/processar", {
    method: "POST", headers: {
      "upstash-signature": "signed-local-test",
      "content-type": "application/json",
    },
    body: "{}",
  });
}
function unsigned() {
  return new NextRequest("https://chefedapizza.com.br/api/interno/whatsapp-inbox/processar", {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  });
}

beforeAll(() => {
  if (process.env.KV_REST_API_URL !== "http://srh:80" ||
      process.env.KV_REST_API_TOKEN !== "whatsapp-e2e-srh-only-local" ||
      process.env.CHEFEBOT_INBOX_HTTP_TEST !== "1") {
    throw new Error("REJECT: Redis real de producao nunca permitido");
  }
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("QSTASH_TOKEN", "somente-ci-falso");
  vi.stubEnv("QSTASH_URL", "https://qstash-us-east-1.upstash.io");
  vi.stubEnv("QSTASH_CURRENT_SIGNING_KEY", "somente-ci-falso");
  vi.stubEnv("QSTASH_NEXT_SIGNING_KEY", "somente-ci-falso");
  vi.stubEnv("WHATSAPP_OUTBOX_CALLBACK_URL",
    "https://chefedapizza.com.br/api/interno/whatsapp-outbox/processar");
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input :
      input instanceof URL ? input.href : input.url;
    if (!["http://srh:80", "http://srh:80/"].includes(url) && !url.startsWith("http://srh:80/")) {
      throw new Error("external_network_forbidden");
    }
    return NATIVE_FETCH(input, init);
  });
});

beforeEach(async () => {
  await redis.flushdb();
  state.effects.clear(); state.active = 0; state.peak = 0; state.failId = "";
  state.publish.mockClear(); state.schedule.mockClear();
});
afterAll(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("worker QStash + Redis descartavel de ponta a ponta", () => {
  it("rejeita callback nao assinado sem consumir mensagem", async () => {
    await enfileirarInboundWhatsapp(msg("unsigned", "5599888880001"));
    const response = await worker(unsigned());
    expect(response.status).toBe(401);
    expect((await resumoInboxWhatsapp()).pending).toBe(1);
    expect(state.effects.size).toBe(0);
  });

  it("drena 50 eventos de clientes distintos, sem duplicacoes e com concorrencia maxima 4", async () => {
    const jobs = await Promise.all(Array.from({ length: 50 }, (_, i) =>
      enfileirarInboundWhatsapp(msg("W-50-" + i, "559988" + String(i).padStart(7, "0")))));
    expect(jobs.every(x => x.status === "queued")).toBe(true);
    const started = performance.now();
    const res = await worker(signed());
    expect(res.status).toBe(200);
    const result = await res.json();
    expect(result.queue.pending).toBe(0);
    expect(result.done).toBe(50);
    expect(result.ambiguous).toBe(0);
    expect(result.queue.inFlight).toBe(0);
    expect(state.effects.size).toBe(50);
    expect([...state.effects.values()].every(v => v === 1)).toBe(true);
    expect(state.peak).toBeLessThanOrEqual(4);
    const evidence = {
      test: "real-redis-real-worker-route-qstash-and-evolution-mock",
      accepted: 50, uniqueBusinessEffectsSimulated: state.effects.size,
      duplicates: 0, pending: result.queue.pending, ambiguous: result.ambiguous,
      maxParallel: state.peak, elapsedMs: Math.round(performance.now() - started),
    };
    console.log("PICO50_EVIDENCE " + JSON.stringify(evidence));
  }, 120000);

  it("100 eventos continuam em segunda chamada assinada quando lote 60 acaba", async () => {
    await Promise.all(Array.from({ length: 100 }, (_, i) =>
      enfileirarInboundWhatsapp(msg("W-100-" + i, "559987" + String(i).padStart(7, "0")))));
    const a = await worker(signed());
    expect(a.status).toBe(200);
    const ar = await a.json();
    expect(ar.processed).toBe(60);
    expect(ar.queue.pending).toBe(40);
    expect(state.publish).toHaveBeenCalled();
    const b = await worker(signed());
    expect(b.status).toBe(200);
    const br = await b.json();
    expect(br.queue.pending).toBe(0);
    expect(state.effects.size).toBe(100);
  }, 120000);

  it("resultado incerto congela so sua conversa sem repetir efeito", async () => {
    state.failId = "W-failure";
    const a = "5599888888001", b = "5599888888002";
    await enfileirarInboundWhatsapp(msg("W-failure", a));
    await enfileirarInboundWhatsapp(msg("W-after-failure", a));
    await enfileirarInboundWhatsapp(msg("W-ok", b));
    const res = await worker(signed());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.queue.pending).toBe(2);
    expect(data.queue.ambiguousTotal).toBe(1);
    expect(state.effects.has("W-failure")).toBe(false);
    expect(state.effects.has("W-after-failure")).toBe(false);
    expect(state.effects.get("W-ok")).toBe(1);
    const retry = await worker(signed());
    expect(retry.status).toBe(200);
    expect((await retry.json()).processed).toBe(0);
  }, 60000);
});
