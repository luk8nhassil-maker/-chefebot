import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { performance } from "node:perf_hooks";
import { NextRequest } from "next/server";

// REAL: Next POST handler, Redis EVAL scripts, Redis HTTP (SRH), HTTP sockets.
// FAKE: QStash wake-up, Evolution. No real WhatsApp, customer data or payments.
const calls = vi.hoisted(() => {
  const publish = vi.fn(async () => ({ messageId: "fake-qstash" }));
  const schedule = vi.fn(async () => ({ scheduleId: "fake-qstash" }));
  return { publish, schedule };
});
vi.mock("@upstash/qstash", () => ({
  Client: vi.fn().mockImplementation(() => ({
    schedules: { create: calls.schedule }, publishJSON: calls.publish,
  })),
  Receiver: vi.fn().mockImplementation(() => ({ verify: async () => true })),
}));

import { redis } from "@/lib/redis";
import { POST as webhook } from "@/app/api/whatsapp/route";
import {
  processarLoteInbox, resumoInboxWhatsapp, chaveConversaInbound,
} from "@/lib/whatsappInbox";

const NATIVE_FETCH = globalThis.fetch.bind(globalThis);
let server: Server;
let baseUrl = "";
const PHONE_PREFIX = "559988";
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const phone = (n: number) => PHONE_PREFIX + String(n).padStart(7, "0");

function evento(number: string, id: string, text = "oi") {
  return {
    event: "messages.upsert",
    data: {
      key: { remoteJid: number + "@s.whatsapp.net", id, fromMe: false },
      message: { conversation: text },
    },
  };
}
function p95(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  return Math.round(v[Math.max(0, Math.ceil(v.length * 0.95) - 1)] ?? 0);
}
async function publish(payload: unknown) {
  const begun = performance.now();
  const response = await fetch(baseUrl + "/api/whatsapp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: response.status, body: await response.json(), ms: performance.now() - begun };
}
async function drain(executor: (job: { id: string; messageId: string; conversationId: string }) => Promise<boolean>) {
  const started = performance.now();
  let batchCount = 0;
  for (; batchCount < 12; batchCount++) {
    const r = await processarLoteInbox(executor, 60, 4);
    if (r.queue.pending === 0 || r.processed === 0) {
      return { ...r, batches: batchCount + 1, drainedMs: Math.round(performance.now() - started) };
    }
  }
  throw new Error("inbox nao drenou em 12 lotes");
}
beforeAll(async () => {
  if (process.env.KV_REST_API_URL !== "http://srh:80" ||
      process.env.KV_REST_API_TOKEN !== "whatsapp-e2e-srh-only-local" ||
      process.env.CHEFEBOT_INBOX_HTTP_TEST !== "1") {
    throw new Error("REJECT: o teste requer Redis descartavel, nunca producao");
  }
  vi.stubEnv("VERCEL_ENV", "production"); // habilita SOMENTE o handler sob teste local
  vi.stubEnv("WHATSAPP_INBOX_ROLLOUT", "all");
  vi.stubEnv("WHATSAPP_OUTBOX_ROLLOUT", "off");
  vi.stubEnv("WHATSAPP_CANARY_PHONE", "5511900000666");
  vi.stubEnv("QSTASH_TOKEN", "qstash-falso-somente-ci");
  vi.stubEnv("QSTASH_URL", "https://qstash-us-east-1.upstash.io");
  vi.stubEnv("QSTASH_CURRENT_SIGNING_KEY", "fake-current");
  vi.stubEnv("QSTASH_NEXT_SIGNING_KEY", "fake-next");
  vi.stubEnv("WHATSAPP_OUTBOX_CALLBACK_URL",
    "https://chefedapizza.com.br/api/interno/whatsapp-outbox/processar");
  vi.stubGlobal("fetch", async (request: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof request === "string" ? request :
      request instanceof URL ? request.href : request.url;
    if (!["http://srh:80", "http://srh:80/"].includes(url) &&
        !url.startsWith("http://srh:80/") && !url.startsWith("http://127.0.0.1:")) {
      throw new Error("external_network_forbidden_in_load_test");
    }
    return NATIVE_FETCH(request, init);
  });
  server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const request = new NextRequest("http://127.0.0.1/api/whatsapp", {
        method: "POST", headers: { "content-type": "application/json" },
        body: Buffer.concat(chunks),
      });
      const result = await webhook(request);
      res.writeHead(result.status, { "content-type": "application/json" });
      res.end(await result.text());
    } catch (error) {
      console.error("[inbox-http-test] erro_local:", error instanceof Error ? error.name : "unknown");
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false }));
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no local HTTP listener");
  baseUrl = "http://127.0.0.1:" + address.port;
}, 15000);

beforeEach(async () => {
  await redis.flushdb();
  calls.publish.mockClear();
  calls.schedule.mockClear();
}, 15000);

afterAll(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("pico HTTP com handler Next real e Redis EVAL real (Evolution falsa)", () => {
  it.each([50, 100, 200])("aceita %i webhooks HTTP simultaneos, processa uma vez e zera fila", async total => {
    const started = performance.now();
    const received = await Promise.all(Array.from({ length: total }, (_, i) =>
      publish(evento(phone(i), "pico-" + total + "-" + i))));
    const inbox = await resumoInboxWhatsapp();
    expect(received.every(r => r.status === 200 && r.body?.inbox === "queued")).toBe(true);
    expect(inbox.pending).toBe(total);
    let maxConcurrency = 0;
    let inFlight = 0;
    const events: string[] = [];
    const exec = async (job: { messageId: string }) => {
      inFlight++;
      maxConcurrency = Math.max(maxConcurrency, inFlight);
      try {
        await wait(2);
        events.push(job.messageId);
        return true;
      } finally { inFlight--; }
    };
    const drained = await drain(exec);
    expect(drained.queue.pending).toBe(0);
    expect(drained.queue.inFlight).toBe(0);
    expect(drained.queue.ambiguousTotal).toBe(0);
    expect(events.length).toBe(total);
    expect(new Set(events).size).toBe(total);
    expect(maxConcurrency).toBeLessThanOrEqual(4);
    const latency95 = p95(received.map(x => x.ms));
    expect(latency95).toBeLessThan(10_000);
    const evidence = {
      test: "real-http-next-handler-disposable-redis-evolution-mock",
      simultaneous: total, httpAccepted: received.length, httpRejected: 0,
      p95AcceptMs: latency95, drainedMs: drained.drainedMs, batches: drained.batches,
      uniqueProcessed: events.length, duplicates: 0, pending: drained.queue.pending,
      ambiguous: drained.queue.ambiguousTotal, peakWorkerConcurrency: maxConcurrency,
      totalMs: Math.round(performance.now() - started), qstashWakeMock: calls.publish.mock.calls.length,
    };
    console.log("PICO50_EVIDENCE " + JSON.stringify(evidence));
  }, 120000);

  it("20 mensagens de uma conversa mantem ordem mesmo com 30 conversas paralelas", async () => {
    const targetPhone = phone(3000);
    const input = [
      ...Array.from({ length: 20 }, (_, i) => evento(targetPhone, "ord-" + i)),
      ...Array.from({ length: 30 }, (_, i) => evento(phone(4000 + i), "out-" + i)),
    ];
    const responses = await Promise.all(input.map(publish));
    expect(responses.every(r => r.status === 200)).toBe(true);
    const conversation = chaveConversaInbound(targetPhone);
    const ids = await redis.zrange<string[]>("whatsapp:inbox:v1:queue:" + conversation, 0, -1);
    expect(ids).toHaveLength(20);
    let activeSame = 0, peakSame = 0;
    const seen: string[] = [];
    const result = await drain(async job => {
      if (job.conversationId === conversation) {
        activeSame++;
        peakSame = Math.max(activeSame, peakSame);
        seen.push(job.id);
        await wait(3);
        activeSame--;
      }
      return true;
    });
    expect(peakSame).toBe(1);
    expect(seen).toEqual(ids);
    expect(result.queue.pending).toBe(0);
    console.log("PICO50_EVIDENCE " + JSON.stringify({
      test: "same-conversation-serial", incoming: 50,
      sameConversation: 20, maxSameInFlight: peakSame, remaining: result.queue.pending,
    }));
  }, 120000);

  it("20 repeticoes HTTP do mesmo messageId geram um unico efeito de pedido/PIX simulado", async () => {
    const payload = evento(phone(9000), "same-id", "PIX pago");
    const answers = await Promise.all(Array.from({ length: 20 }, () => publish(payload)));
    expect(answers.filter(x => x.body.inbox === "queued")).toHaveLength(1);
    expect(answers.filter(x => x.body.inbox === "duplicate")).toHaveLength(19);
    let sideEffects = 0;
    const result = await drain(async () => { sideEffects++; return true; });
    expect(sideEffects).toBe(1);
    expect(result.queue.pending).toBe(0);
    console.log("PICO50_EVIDENCE " + JSON.stringify({
      test: "duplicate-commercial-event-simulated", incoming: 20,
      queued: 1, duplicate: 19, simulatedCommercialEffects: sideEffects,
    }));
  }, 30000);

  it("falha de processamento nao reenvia efeitos, quarentena bloqueia somente sua conversa", async () => {
    const a = phone(9200), b = phone(9201);
    const answers = await Promise.all([
      publish(evento(a, "risky-1")), publish(evento(a, "risky-2")),
      publish(evento(b, "healthy-1")),
    ]);
    expect(answers.every(x => x.status === 200)).toBe(true);
    const done: string[] = [];
    const result = await drain(async job => {
      if (job.messageId === "risky-1") throw new Error("simulated-outcome-unknown");
      done.push(job.messageId);
      return true;
    });
    expect(done).toEqual(["healthy-1"]);
    expect(result.queue.pending).toBe(2);
    expect(result.queue.ambiguousTotal).toBe(1);
    expect(result.queue.doneTotal).toBe(1);
  }, 30000);
});
