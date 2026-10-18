import { beforeEach, describe, expect, test, vi } from "vitest";

const { values, scores, locks, hashes, claimFormat } = vi.hoisted(() => ({
  values: new Map<string, unknown>(), scores: new Map<string, Map<string, number>>(), locks: new Map<string, { value: string; until: number }>(), hashes: new Map<string, Map<string, string>>(), claimFormat: { asObject: false },
}));

function zset(key: string) { const set = scores.get(key) ?? new Map<string, number>(); scores.set(key, set); return set; }
function hash(key: string) { const map = hashes.get(key) ?? new Map<string, string>(); hashes.set(key, map); return map; }
function zremrange(key: string, now: number) { for (const [id, score] of zset(key)) if (score <= now) zset(key).delete(id); }

vi.mock("./redis", () => ({
  redis: {
    eval: vi.fn(async (script: string, keys: string[], args: string[]) => {
      if (script.includes("local dedupe = ARGV[1]")) {
        const [dedupe, jobKey, queue, conversationQueue, conversationCounter, jobConversations] = keys; const [dedupeArg, raw, now, ttl, id, conversationId] = args;
        if (dedupeArg && values.has(dedupe)) return values.get(dedupe);
        const sequence = Number(values.get(conversationCounter) ?? 0) + 1;
        values.set(conversationCounter, sequence);
        values.set(jobKey, JSON.parse(raw)); zset(queue).set(id, Number(now)); zset(conversationQueue).set(id, sequence); hash(jobConversations).set(id, conversationId);
        if (dedupeArg) values.set(dedupe, id);
        return id;
      }
      if (script.includes("local leaseUntil")) {
        const [leases, ...queues] = keys; const [nowRaw, untilRaw, limitRaw, token, jobPrefix, conversationPrefix, conversationQueuePrefix, _leaseMs, _ttl, rateLimitRaw] = args;
        const now = Number(nowRaw); if (zset(leases).size >= Number(limitRaw)) return null;
        const rateLimit = Number(rateLimitRaw ?? 0);
        const rateKey = keys[4];
        if (rateLimit > 0) {
          zremrange(rateKey, now - 60_000);
          if (zset(rateKey).size >= rateLimit) return null;
        }
        for (const queue of queues.slice(0, 3)) for (const [id, due] of [...zset(queue)].sort((a, b) => a[1] - b[1])) {
          if (due > now) continue;
          const job = values.get(jobPrefix + id) as Record<string, unknown> | undefined;
          if (!job) {
            zset(queue).delete(id);
            const conversationId = hash(keys[5]).get(id);
            if (conversationId) { zset(conversationQueuePrefix + conversationId).delete(id); hash(keys[5]).delete(id); }
            zset(keys[6]).set(id, now);
            continue;
          }
          if (job.state !== "pending") { zset(queue).delete(id); continue; }
          const first = [...zset(conversationQueuePrefix + job.conversationId)].sort((a, b) => a[1] - b[1])[0]?.[0];
          if (first !== id) continue;
          const ck = conversationPrefix + job.conversationId; const lock = locks.get(ck);
          if (lock && lock.until > now) continue;
          locks.set(ck, { value: id, until: Number(untilRaw) });
          job.state = "leased"; job.leaseToken = token; job.updatedAt = now; job.attempt = Number(job.attempt ?? 0) + 1;
          values.set(jobPrefix + id, job); zset(queue).delete(id); zset(leases).set(id, Number(untilRaw));
          if (rateLimit > 0) zset(rateKey).set(token, now);
          return claimFormat.asObject ? { ...job } : JSON.stringify(job);
        }
        return null;
      }
      if (script.includes("job.state ~= 'leased'")) {
        const [jobKey, leases, conversation, conversationQueue, _history, reconciliation, jobConversations] = keys; const [token, state, now, raw] = args;
        const job = values.get(jobKey) as Record<string, unknown> | undefined;
        if (!job || job.state !== "leased" || job.leaseToken !== token) return 0;
        job.state = state; job.updatedAt = Number(now); delete job.leaseToken; job.result = JSON.parse(raw); values.set(jobKey, job);
        zset(leases).delete(String(job.id));
        if (state === "ambiguous") zset(reconciliation).set(String(job.id), Number(now));
        else { zset(conversationQueue).delete(String(job.id)); zset(reconciliation).delete(String(job.id)); hash(jobConversations).delete(String(job.id)); }
        if (locks.get(conversation)?.value === job.id) locks.delete(conversation); return 1;
      }
      if (script.includes("lease_expired_without_provider_confirmation")) {
        const [leases, _reconciliation, unresolved, jobConversations] = keys; const [nowRaw, maxRaw, jobPrefix, _ttl, _conversationPrefix, conversationQueuePrefix] = args; const now = Number(nowRaw);
        const ids = [...zset(leases)].filter(([, due]) => due <= now).slice(0, Number(maxRaw)).map(([id]) => id);
        let reconciled = 0, inconsistentes = 0;
        for (const id of ids) {
          const job = values.get(jobPrefix + id) as Record<string, unknown> | undefined;
          if (job?.state === "leased") { job.state = "ambiguous"; job.result = { motivo: "lease_expired_without_provider_confirmation" }; values.set(jobPrefix + id, job); zset(leases).delete(id); reconciled++; }
          else {
            const conversationId = hash(jobConversations).get(id);
            if (conversationId) { zset(conversationQueuePrefix + conversationId).delete(id); hash(jobConversations).delete(id); }
            zset(unresolved).set(id, now); zset(leases).delete(id); inconsistentes++;
          }
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

beforeEach(() => { values.clear(); scores.clear(); locks.clear(); hashes.clear(); claimFormat.asObject = false; delete process.env.WHATSAPP_OUTBOX_CONCURRENCY; delete process.env.WHATSAPP_OUTBOX_RATE_LIMIT_PER_MINUTE; });

async function drenar(executar: Parameters<typeof processarFilaWhatsapp>[0]) {
  let total = 0, max = 0;
  for (;;) { const r = await processarFilaWhatsapp(executar, 16); total += r.processed; max = Math.max(max, r.processed); if (!r.processed) return { total, max }; }
}

describe("whatsappOutbox", () => {
  test("expõe apenas nomes das configurações QStash ausentes", () => {
    delete process.env.QSTASH_TOKEN;
    delete process.env.QSTASH_URL;
    delete process.env.QSTASH_CURRENT_SIGNING_KEY;
    delete process.env.QSTASH_NEXT_SIGNING_KEY;
    delete process.env.WHATSAPP_OUTBOX_CALLBACK_URL;
    delete process.env.VERCEL_URL;
    delete process.env.VERCEL_ENV;
    expect(configuracaoOutboxWhatsapp()).toEqual({
      ready: false,
      missing: ["QSTASH_TOKEN", "QSTASH_CURRENT_SIGNING_KEY", "QSTASH_NEXT_SIGNING_KEY", "QSTASH_URL (endpoint HTTPS da região Upstash)", "WHATSAPP_OUTBOX_CALLBACK_URL (ou VERCEL_URL em production)"],
    });
  });

  test("rejeita endpoint QStash ausente ou de domínio externo, sem cair no EU padrão", () => {
    const previous = process.env.QSTASH_URL;
    try {
      process.env.QSTASH_URL = "http://qstash-us-east-1.upstash.io";
      expect(configuracaoOutboxWhatsapp().missing).toContain("QSTASH_URL (endpoint HTTPS da região Upstash)");
      process.env.QSTASH_URL = "https://example.com";
      expect(configuracaoOutboxWhatsapp().missing).toContain("QSTASH_URL (endpoint HTTPS da região Upstash)");
      process.env.QSTASH_URL = "https://qstash-us-east-1.upstash.io";
      expect(configuracaoOutboxWhatsapp().missing).not.toContain("QSTASH_URL (endpoint HTTPS da região Upstash)");
    } finally {
      if (previous === undefined) delete process.env.QSTASH_URL;
      else process.env.QSTASH_URL = previous;
    }
  });

  test("processa claim de Lua já desserializado pelo SDK Upstash sem erro 500 ou lease órfão", async () => {
    claimFormat.asObject = true;
    const { jobId } = await enfileirarMensagemWhatsapp({
      phone: "5511999990900", text: "canario-e2e", priority: "critica",
    });
    const executar = vi.fn(async () => ({ ok: true, statusHttp: 200, latenciaMs: 1, tentativas: 1 }));
    const resultado = await processarFilaWhatsapp(executar, 1, 1);
    expect(executar).toHaveBeenCalledTimes(1);
    expect(executar).toHaveBeenCalledWith(expect.objectContaining({ id: jobId, text: "canario-e2e", state: "leased" }));
    expect(resultado).toEqual({ processed: 1, delivered: 1, failed: 0, ambiguous: 0 });
    expect((await obterJobWhatsapp(jobId))?.state).toBe("delivered");
    expect(await resumoFilaWhatsapp()).toEqual({ pending: 0, inFlight: 0, ambiguous: 0, unresolved: 0 });
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

  test("não deixa 32 pendências bloqueadas de uma conversa esconderem outra conversa apta", async () => {
    const phoneBloqueado = "5511999990099";
    // O primeiro job fica em voo; restam exatamente 32 pendências desta
    // conversa à frente de uma segunda conversa independente.
    await Promise.all(Array.from({ length: 33 }, (_, i) => enfileirarMensagemWhatsapp({ phone: phoneBloqueado, text: `bloqueada-${i}` })));
    let liberar!: () => void;
    const primeiro = processarFilaWhatsapp(async () => new Promise((resolve) => { liberar = () => resolve({ ok: true, latenciaMs: 1, tentativas: 1 }); }), 1, 1);
    await vi.waitFor(() => expect(liberar).toBeTypeOf("function"));
    await enfileirarMensagemWhatsapp({ phone: "5511999990100", text: "conversa-apta" });
    const executarApta = vi.fn(async () => ({ ok: true, latenciaMs: 1, tentativas: 1 }));
    await processarFilaWhatsapp(executarApta, 1, 1);
    expect(executarApta).toHaveBeenCalledWith(expect.objectContaining({ text: "conversa-apta" }));
    liberar();
    await primeiro;
  });

  test("aplica teto distribuído de velocidade separado da concorrência", async () => {
    process.env.WHATSAPP_OUTBOX_CONCURRENCY = "4";
    process.env.WHATSAPP_OUTBOX_RATE_LIMIT_PER_MINUTE = "2";
    await Promise.all(Array.from({ length: 3 }, (_, i) => enfileirarMensagemWhatsapp({ phone: `55119999902${i}`, text: `rate-${i}` })));
    const executar = vi.fn(async () => ({ ok: true, latenciaMs: 1, tentativas: 1 }));
    await processarFilaWhatsapp(executar, 4, 3);
    expect(executar).toHaveBeenCalledTimes(2);
    expect(await resumoFilaWhatsapp()).toMatchObject({ pending: 1, inFlight: 0 });
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

  test("resultado ambíguo mantém a cabeça da conversa até reconciliação", async () => {
    await enfileirarMensagemWhatsapp({ phone: "5511999990040", text: "primeira" });
    await enfileirarMensagemWhatsapp({ phone: "5511999990040", text: "segunda" });

    await processarFilaWhatsapp(async () => ({ ok: false, motivo: "timeout", latenciaMs: 1, tentativas: 1 }), 1, 1);

    const enviarPosterior = vi.fn(async () => ({ ok: true, latenciaMs: 1, tentativas: 1 }));
    await processarFilaWhatsapp(enviarPosterior, 1, 1);

    expect(enviarPosterior).not.toHaveBeenCalled();
    expect(await resumoFilaWhatsapp()).toMatchObject({ pending: 1, ambiguous: 1 });
  });

  test("cabeça de conversa sem job é removida para não bloquear a mensagem posterior", async () => {
    const phone = "5511999990041";
    const { jobId } = await enfileirarMensagemWhatsapp({ phone, text: "órfã" });
    await enfileirarMensagemWhatsapp({ phone, text: "posterior" });
    values.delete(`whatsapp:outbox:job:${jobId}`);

    const executar = vi.fn(async () => ({ ok: true, latenciaMs: 1, tentativas: 1 }));
    await processarFilaWhatsapp(executar, 1, 1);

    expect(executar).toHaveBeenCalledWith(expect.objectContaining({ text: "posterior" }));
    expect(await resumoFilaWhatsapp()).toMatchObject({ unresolved: 1 });
  });

  test("lease expirado sem job remove sua própria cabeça e preserva a quarentena", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const phone = "5511999990042";
    const { jobId } = await enfileirarMensagemWhatsapp({ phone, text: "órfã-em-lease" });
    await enfileirarMensagemWhatsapp({ phone, text: "posterior-ao-lease" });
    let liberar!: () => void;
    const primeiro = processarFilaWhatsapp(async () => new Promise((resolve) => { liberar = () => resolve({ ok: true, latenciaMs: 1, tentativas: 1 }); }), 1, 1);
    await vi.waitFor(() => expect(liberar).toBeTypeOf("function"));
    values.delete(`whatsapp:outbox:job:${jobId}`);
    clock.mockReturnValue(32_000);
    expect(await recuperarLeasesWhatsapp()).toEqual({ reconciled: 0, unresolved: 1 });

    const enviarPosterior = vi.fn(async () => ({ ok: true, latenciaMs: 1, tentativas: 1 }));
    await processarFilaWhatsapp(enviarPosterior, 1, 1);
    expect(enviarPosterior).toHaveBeenCalledWith(expect.objectContaining({ text: "posterior-ao-lease" }));
    expect(await resumoFilaWhatsapp()).toMatchObject({ unresolved: 1 });

    liberar();
    await primeiro;
    clock.mockRestore();
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
