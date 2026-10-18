import { beforeEach, describe, expect, it, vi } from "vitest";

// Simulador hermético: nenhuma chamada a Redis, Evolution ou QStash reais.
const state = vi.hoisted(() => {
  const jobs = new Map<string, any>();
  const dedupe = new Map<string, string>();
  const conversations = new Map<string, number>();
  const queues = new Map<string, { id: string; seq: number }[]>();
  const locks = new Map<string, string>();
  const leases = new Map<string, number>();
  const metrics = new Map<string, number>();
  let sequence = 0;
  let pending = 0;
  let failEnqueue = false;
  const inc = (key: string) => metrics.set(key, (metrics.get(key) || 0) + 1);
  function clear() {
    jobs.clear(); dedupe.clear(); conversations.clear(); queues.clear();
    locks.clear(); leases.clear(); metrics.clear();
    sequence = 0; pending = 0; failEnqueue = false;
  }
  return {
    jobs, dedupe, conversations, queues, locks, leases, metrics, inc, clear,
    get pending() { return pending; },
    get failEnqueue() { return failEnqueue; },
    setFailEnqueue(value: boolean) { failEnqueue = value; },
    enqueue(keys: string[], args: string[]) {
      if (failEnqueue) throw new Error("redis_unavailable");
      if (dedupe.has(keys[0])) return ["duplicate", dedupe.get(keys[0])!];
      if (pending >= Number(args[3])) return ["full", ""];
      sequence++;
      const job = JSON.parse(args[1]);
      jobs.set(args[0], job);
      dedupe.set(keys[0], args[0]);
      const queue = queues.get(job.conversationId) || [];
      queue.push({ id: args[0], seq: sequence });
      queues.set(job.conversationId, queue);
      if (!conversations.has(job.conversationId)) conversations.set(job.conversationId, sequence);
      pending++; inc("queued");
      return ["queued", args[0]];
    },
    claim(args: string[]) {
      const all = [...conversations].sort((a, b) => a[1] - b[1]).slice(0, 250);
      for (const [conv] of all) {
        const queue = queues.get(conv) || [];
        const first = queue[0];
        if (!first) { conversations.delete(conv); continue; }
        if (locks.has(conv)) continue;
        const job = jobs.get(first.id);
        if (!job || job.state !== "pending") continue;
        locks.set(conv, args[3]); job.state = "leased";
        job.leaseToken = args[3]; job.updatedAt = Number(args[4]);
        leases.set(first.id, Number(args[4]) + Number(args[5]));
        inc("claimed");
        return { ...job };
      }
      return null;
    },
    finish(keys: string[], args: string[]) {
      const id = keys[0].split(":").at(-1)!;
      const job = jobs.get(id);
      if (!job || job.state !== "leased" || job.leaseToken !== args[0]) return 0;
      delete job.leaseToken; job.updatedAt = Number(args[1]);
      job.state = args[2]; job.motivo = args[3];
      leases.delete(id);
      if (locks.get(job.conversationId) === args[0]) locks.delete(job.conversationId);
      if (args[2] === "done") {
        const queue = queues.get(job.conversationId)!;
        queue.splice(queue.findIndex(x => x.id === id), 1);
        if (queue.length) conversations.set(job.conversationId, queue[0].seq);
        else conversations.delete(job.conversationId);
        pending--; inc("done");
      } else inc("ambiguous");
      return 1;
    },
    recover(args: string[]) {
      let total = 0;
      for (const [id, until] of leases) {
        if (until > Number(args[0])) continue;
        const job = jobs.get(id);
        if (job?.state === "leased") {
          job.state = "ambiguous"; job.motivo = "inbox_lease_expired_unknown_business_effects";
          delete job.leaseToken; inc("ambiguous"); total++;
        }
        leases.delete(id);
      }
      return total;
    },
    getPending() { return pending; },
  };
});
vi.mock("./redis", () => ({
  redis: {
    eval: vi.fn(async (script: string, keys: string[], args: string[]) => {
      if (script.includes("local previous = redis.call")) return state.enqueue(keys, args);
      if (script.includes("local convs = redis.call")) return state.claim(args);
      if (script.includes("local raw = redis.call") && script.includes("job.leaseToken = nil")) return state.finish(keys, args);
      if (script.includes("local ids = redis.call")) return state.recover(args);
      throw new Error("script_desconhecido");
    }),
    get: vi.fn(async () => state.getPending()),
    zcard: vi.fn(async (key: string) => key.endsWith("leases") ? state.leases.size : state.conversations.size),
    hgetall: vi.fn(async () => Object.fromEntries(state.metrics)),
    hset: vi.fn(async (_key: string, kv: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(kv)) state.metrics.set(k, Number(v));
    }),
  },
}));
vi.mock("@upstash/qstash", () => ({ Client: vi.fn() }));

import {
  enfileirarInboundWhatsapp, processarLoteInbox,
  claimInboundWhatsapp, finalizarInboundWhatsapp, recuperarInboundWhatsapp,
  chaveConversaInbound, resumoInboxWhatsapp,
} from "./whatsappInbox";

beforeEach(() => { state.clear(); vi.clearAllMocks(); });

const put = async (id: string, phone: string) => enfileirarInboundWhatsapp({
  messageId: id, phone,
  payload: { event: "messages.upsert", data: { key: { id } } },
});

describe("inbox WhatsApp: carga e falhas sem clientes reais", () => {
  it.each([50, 100, 200])("aceita %i eventos e drena sem perdas (Redis mock)", async (total) => {
    const entries = await Promise.all(Array.from({ length: total },
      (_, i) => put("MSG-" + i, "55" + String(i).padStart(11, "0"))));
    expect(entries.every(x => x.status === "queued")).toBe(true);
    expect(new Set(entries.map(x => x.jobId)).size).toBe(total);
    let effects = 0;
    let inFlight = 0;
    let peak = 0;
    const executor = async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise(resolve => setTimeout(resolve, 1));
      effects++;
      inFlight--;
      return true;
    };
    for (let i = 0; i < 10; i++) {
      const res = await processarLoteInbox(executor, 60, 4);
      if (res.queue.pending === 0) break;
    }
    expect(effects).toBe(total);
    expect((await resumoInboxWhatsapp()).pending).toBe(0);
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("20 reentregas de um mesmo ID produzem exatamente um efeito", async () => {
    const messages = await Promise.all(Array.from({ length: 20 }, () => put("same-id", "5511990000011")));
    expect(messages.filter(x => x.status === "queued")).toHaveLength(1);
    expect(messages.filter(x => x.status === "duplicate")).toHaveLength(19);
    const effect = vi.fn(async () => true);
    await processarLoteInbox(effect);
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it("serializa 20 mensagens do mesmo cliente, sem bloquear 50 clientes distintos", async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => put("A-" + i, "5511990000011")));
    await Promise.all(Array.from({ length: 50 }, (_, i) => put("B-" + i, "551188" + String(i).padStart(7, "0"))));
    let active = 0, maxA = 0;
    const seen: string[] = [];
    const executor = async (job: { messageId: string }) => {
      if (job.messageId.startsWith("A-")) {
        active++; maxA = Math.max(maxA, active);
        await new Promise(resolve => setTimeout(resolve, 1));
        seen.push(job.messageId); active--;
      }
      return true;
    };
    for (let i = 0; i < 5; i++) await processarLoteInbox(executor, 60, 4);
    expect(maxA).toBe(1);
    expect(seen).toEqual(Array.from({ length: 20 }, (_, i) => "A-" + i));
    expect((await resumoInboxWhatsapp()).pending).toBe(0);
  });

  it("não confirma enfileiramento se Redis falha", async () => {
    state.setFailEnqueue(true);
    await expect(put("redis-down", "5511990000011")).rejects.toThrow("redis_unavailable");
  });

  it("job ambíguo permanece na cabeça; nenhum outro job do cliente passa", async () => {
    await put("1", "5511990000011");
    await put("2", "5511990000011");
    const first = await processarLoteInbox(async () => false);
    expect(first.ambiguous).toBe(1);
    const next = vi.fn(async () => true);
    const res = await processarLoteInbox(next);
    expect(next).not.toHaveBeenCalled();
    expect(res.queue.pending).toBe(2);
  });

  it("lease expirado não executa novamente efeitos de negócio", async () => {
    await put("crash", "5511990000011");
    const job = await claimInboundWhatsapp();
    expect(job?.state).toBe("leased");
    if (!job) throw new Error("job_ausente");
    state.leases.set(job.id, Date.now() - 1);
    expect(await recuperarInboundWhatsapp()).toBe(1);
    const effect = vi.fn(async () => true);
    await processarLoteInbox(effect);
    expect(effect).not.toHaveBeenCalled();
    expect(state.jobs.get(job.id).state).toBe("ambiguous");
    expect(await finalizarInboundWhatsapp(job, true, "late")).toBe(false);
  });

  it("identificador da conversa não revela telefone", () => {
    expect(chaveConversaInbound("5511990000011")).toMatch(/^[a-f0-9]{32}$/);
    expect(chaveConversaInbound("5511990000011")).not.toContain("5511990000011");
  });
});
