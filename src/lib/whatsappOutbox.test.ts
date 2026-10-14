import { beforeEach, describe, expect, test, vi } from "vitest";

const { values, scores, locks } = vi.hoisted(() => ({
  values: new Map<string, unknown>(), scores: new Map<string, Map<string, number>>(), locks: new Map<string, { value: string; until: number }>(),
}));

function zset(key: string) { const set = scores.get(key) ?? new Map<string, number>(); scores.set(key, set); return set; }
function zremrange(key: string, now: number) { for (const [id, score] of zset(key)) if (score <= now) zset(key).delete(id); }

vi.mock("./redis", () => ({
  redis: {
    eval: vi.fn(async (script: string, keys: string[], args: string[]) => {
      if (script.includes("local dedupe = ARGV[1]")) {
        const [dedupe, jobKey, queue, conversationQueue, conversationCounter] = keys; const [dedupeArg, raw, now, ttl, id] = args;
        if (dedupeArg && values.has(dedupe)) return values.get(dedupe);
        const sequence = Number(values.get(conversationCounter) ?? 0) + 1;
        values.set(conversationCounter, sequence);
        values.set(jobKey, JSON.parse(raw)); zset(queue).set(id, Number(now)); zset(conversationQueue).set(id, sequence);
        if (dedupeArg) values.set(dedupe, id);
        return id;
      }
      if (script.includes("local leaseUntil")) {
        const [leases, ...queues] = keys; const [nowRaw, untilRaw, limitRaw, token, jobPrefix, conversationPrefix, conversationQueuePrefix] = args;
        const now = Number(nowRaw); if (zset(leases).size >= Number(limitRaw)) return null;
        for (const queue of queues) for (const [id, due] of [...zset(queue)].sort((a, b) => a[1] - b[1])) {
          if (due > now) continue;
          const job = values.get(jobPrefix + id) as Record<string, unknown> | undefined;
          if (!job || job.state !== "pending") { zset(queue).delete(id); continue; }
          const first = [...zset(conversationQueuePrefix + job.conversationId)].sort((a, b) => a[1] - b[1])[0]?.[0];
          if (first !== id) continue;
          const ck = conversationPrefix + job.conversationId; const lock = locks.get(ck);
          if (lock && lock.until > now) continue;
          locks.set(ck, { value: id, until: Number(untilRaw) });
          job.state = "leased"; job.leaseToken = token; job.updatedAt = now; job.attempt = Number(job.attempt ?? 0) + 1;
          values.set(jobPrefix + id, job); zset(queue).delete(id); zset(leases).set(id, Number(untilRaw));
          return JSON.stringify(job);
        }
        return null;
      }
      if (script.includes("job.state ~= 'leased'")) {
        const [jobKey, leases, conversation, conversationQueue] = keys; const [token, state, now, raw] = args;
        const job = values.get(jobKey) as Record<string, unknown> | undefined;
        if (!job || job.state !== "leased" || job.leaseToken !== token) return 0;
        job.state = state; job.updatedAt = Number(now); delete job.leaseToken; job.result = JSON.parse(raw); values.set(jobKey, job);
        zset(leases).delete(String(job.id)); zset(conversationQueue).delete(String(job.id)); if (locks.get(conversation)?.value === job.id) locks.delete(conversation); return 1;
      }
      if (script.includes("lease_expired_without_provider_confirmation")) {
        const [leases, _reconciliation, unresolved] = keys; const [nowRaw, maxRaw, jobPrefix] = args; const now = Number(nowRaw);
        const ids = [...zset(leases)].filter(([, due]) => due <= now).slice(0, Number(maxRaw)).map(([id]) => id);
        let reconciled = 0, inconsistentes = 0;
        for (const id of ids) {
          const job = values.get(jobPrefix + id) as Record<string, unknown> | undefined;
          if (job?.state === "leased") { job.state = "ambiguous"; job.result = { motivo: "lease_expired_without_provider_confirmation" }; values.set(jobPrefix + id, job); zset(leases).delete(id); reconciled++; }
          else { zset(unresolved).set(id, now); zset(leases).delete(id); inconsistentes++; }
        }
        return [reconciled, inconsistentes];
      }
      throw new Error("script desconhecido");
    }),
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    zcard: vi.fn(async (key: string) => zset(key).size),
  },
}));

import { configuracaoOutboxWhatsapp, enfileirarImagemWhatsapp, enfileirarMensagemWhatsapp, obterJobWhatsapp, processarFilaWhatsapp, recuperarLeasesWhatsapp, resumoFilaWhatsapp } from "./whatsappOutbox";

beforeEach(() => { values.clear(); scores.clear(); locks.clear(); delete process.env.WHATSAPP_OUTBOX_CONCURRENCY; });

async function drenar(executar: Parameters<typeof processarFilaWhatsapp>[0]) {
  let total = 0, max = 0;
  for (;;) { const r = await processarFilaWhatsapp(executar, 16); total += r.processed; max = Math.max(max, r.processed); if (!r.processed) return { total, max }; }
}

describe("whatsappOutbox", () => {
  test("expõe apenas nomes das configurações QStash ausentes", () => {
    delete process.env.QSTASH_TOKEN;
    delete process.env.QSTASH_CURRENT_SIGNING_KEY;
    delete process.env.QSTASH_NEXT_SIGNING_KEY;
    delete process.env.WHATSAPP_OUTBOX_CALLBACK_URL;
    delete process.env.VERCEL_URL;
    delete process.env.VERCEL_ENV;
    expect(configuracaoOutboxWhatsapp()).toEqual({
      ready: false,
      missing: ["QSTASH_TOKEN", "QSTASH_CURRENT_SIGNING_KEY", "QSTASH_NEXT_SIGNING_KEY", "WHATSAPP_OUTBOX_CALLBACK_URL (ou VERCEL_URL em production)"],
    });
  });

  test("prioriza crítica, limita globalmente a quatro e preserva ordem da conversa", async () => {
    const ordem: string[] = []; let emVoo = 0, maxEmVoo = 0;
    await enfileirarMensagemWhatsapp({ phone: "5511999990001", text: "normal", priority: "normal" });
    await enfileirarMensagemWhatsapp({ phone: "5511999990002", text: "promo", priority: "promocional" });
    await enfileirarMensagemWhatsapp({ phone: "5511999990001", text: "critica-1", priority: "critica" });
    await enfileirarMensagemWhatsapp({ phone: "5511999990001", text: "critica-2", priority: "critica" });
    const resultado = await drenar(async (job) => { emVoo++; maxEmVoo = Math.max(maxEmVoo, emVoo); await new Promise(r => setTimeout(r, 2)); ordem.push(job.text); emVoo--; return { ok: true, latenciaMs: 2, tentativas: 1 }; });
    expect(resultado.total).toBe(4); expect(maxEmVoo).toBeLessThanOrEqual(4);
    expect(ordem.indexOf("normal")).toBeLessThan(ordem.indexOf("critica-1"));
    expect(ordem.indexOf("critica-1")).toBeLessThan(ordem.indexOf("critica-2"));
  });

  test.each([50, 100, 200])("aceita e entrega %i mensagens sem duplicar", async (total) => {
    const ids = await Promise.all(Array.from({ length: total }, (_, i) => enfileirarMensagemWhatsapp({ phone: `5511${String(i).padStart(8, "0")}`, text: `m${i}`, priority: "normal", idempotencyKey: `event-${i}` })));
    let entregues = 0, emVoo = 0, maxEmVoo = 0; const inicio = performance.now();
    const drenado = await drenar(async () => {
      entregues++; emVoo++; maxEmVoo = Math.max(maxEmVoo, emVoo);
      await new Promise(r => setTimeout(r, 1)); emVoo--;
      return { ok: true, latenciaMs: 1, tentativas: 1 };
    });
    const fila = await resumoFilaWhatsapp();
    console.log(JSON.stringify({ benchmark: "outbox-isolada", total, enfileiradas: ids.length, entregues, processadas: drenado.total, concorrenciaMaxima: maxEmVoo, esperaMs: Math.round(performance.now() - inicio) }));
    expect(new Set(ids.map(x => x.jobId)).size).toBe(total); expect(entregues).toBe(total); expect(maxEmVoo).toBeLessThanOrEqual(4); expect(fila.pending).toBe(0);
  });

  test("resultado ambíguo não é reenviado automaticamente e permanece identificável", async () => {
    const { jobId } = await enfileirarMensagemWhatsapp({ phone: "5511999990001", text: "critica", priority: "critica" });
    let chamadas = 0;
    await drenar(async () => { chamadas++; return { ok: false, motivo: "timeout", latenciaMs: 10, tentativas: 1 }; });
    const job = await obterJobWhatsapp(jobId);
    expect(chamadas).toBe(1); expect(job?.state).toBe("ambiguous");
    await drenar(async () => { chamadas++; return { ok: true, latenciaMs: 1, tentativas: 1 }; });
    expect(chamadas).toBe(1);
  });

  test("pausa global suprime promoção já enfileirada antes do contato com provider", async () => {
    values.set("bot_ativo", false);
    const { jobId } = await enfileirarMensagemWhatsapp({ phone: "5511999990001", text: "promo", priority: "promocional" });
    const executar = vi.fn(async () => ({ ok: true, latenciaMs: 1, tentativas: 1 }));
    await drenar(executar);
    expect(executar).not.toHaveBeenCalled();
    expect((await obterJobWhatsapp(jobId))?.state).toBe("suppressed");
    expect(await resumoFilaWhatsapp()).toEqual({ pending: 0, inFlight: 0, ambiguous: 0, unresolved: 0 });
  });

  test("imagem usa a mesma fila, prioridade e ordem da conversa", async () => {
    await enfileirarImagemWhatsapp({ phone: "5511999990001", mediaUrl: "https://cdn.test/comprovante.jpg" });
    await enfileirarMensagemWhatsapp({ phone: "5511999990001", text: "imagem recebida", priority: "critica" });
    const tipos: string[] = [];
    await drenar(async (job) => { tipos.push(job.kind); return { ok: true, latenciaMs: 1, tentativas: 1 }; });
    expect(tipos).toEqual(["image", "text"]);
  });

  test("lease expirado vira pendência ambígua para reconciliação, nunca retry cego", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const { jobId } = await enfileirarMensagemWhatsapp({ phone: "5511999990001", text: "pedido confirmado" });
    let liberar!: () => void;
    const emExecucao = processarFilaWhatsapp(async () => new Promise((resolve) => { liberar = () => resolve({ ok: true, latenciaMs: 1, tentativas: 1 }); }), 1);
    await vi.waitFor(() => expect(liberar).toBeTypeOf("function"));
    clock.mockReturnValue(32_000);
    expect(await recuperarLeasesWhatsapp()).toEqual({ reconciled: 1, unresolved: 0 });
    expect((await obterJobWhatsapp(jobId))?.state).toBe("ambiguous");
    liberar();
    await emExecucao;
    clock.mockRestore();
  });

  test("lease expirado mantém a barreira da conversa e não confirma resultado tardio", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    await enfileirarMensagemWhatsapp({ phone: "5511999990001", text: "primeira" });
    await enfileirarMensagemWhatsapp({ phone: "5511999990001", text: "segunda" });
    let liberar!: () => void;
    const primeira = processarFilaWhatsapp(async () => new Promise((resolve) => { liberar = () => resolve({ ok: true, latenciaMs: 1, tentativas: 1 }); }), 1);
    await vi.waitFor(() => expect(liberar).toBeTypeOf("function"));
    clock.mockReturnValue(32_000);
    await recuperarLeasesWhatsapp();
    const segunda = vi.fn(async () => ({ ok: true, latenciaMs: 1, tentativas: 1 }));
    await processarFilaWhatsapp(segunda, 1);
    expect(segunda).not.toHaveBeenCalled();
    liberar();
    expect((await primeira).delivered).toBe(0);
    clock.mockRestore();
  });

  test("job vencido é suprimido antes do provider", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const { jobId } = await enfileirarMensagemWhatsapp({ phone: "5511999990001", text: "otp", expiresAt: 1_001 });
    clock.mockReturnValue(1_002);
    const executar = vi.fn(async () => ({ ok: true, latenciaMs: 1, tentativas: 1 }));
    await processarFilaWhatsapp(executar, 1);
    expect(executar).not.toHaveBeenCalled();
    expect((await obterJobWhatsapp(jobId))?.state).toBe("expired");
    clock.mockRestore();
  });

  test("lease sem job vira inconsistência visível e libera capacidade global", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    for (let i = 0; i < 4; i++) zset("whatsapp:outbox:leases").set(`perdido-${i}`, 999);
    expect(await recuperarLeasesWhatsapp()).toEqual({ reconciled: 0, unresolved: 4 });
    const executar = vi.fn(async () => ({ ok: true, latenciaMs: 1, tentativas: 1 }));
    await enfileirarMensagemWhatsapp({ phone: "5511999990001", text: "nova" });
    await processarFilaWhatsapp(executar, 1);
    expect(executar).toHaveBeenCalledTimes(1);
    expect((await resumoFilaWhatsapp()).unresolved).toBe(4);
    clock.mockRestore();
  });
});
