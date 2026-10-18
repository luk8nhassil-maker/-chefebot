import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Integração opt-in com Redis/SRH descartáveis no GitHub Actions.
// Nenhum dado, token ou serviço de produção entra neste teste.
const enabled = process.env.CHEFEBOT_OUTBOX_REDIS_INTEGRATION === "1";
const PHONE = "5511900000666";
const nativeFetch = globalThis.fetch.bind(globalThis);
let evolutionCalls = 0;

beforeEach(() => {
  // Falhe fechado se alguem apontar acidentalmente o teste para a producao.
  if (process.env.KV_REST_API_URL !== "http://srh:80" ||
      process.env.KV_REST_API_TOKEN !== "whatsapp-e2e-srh-only-local") {
    throw new Error("isolated_redis_required");
  }
  evolutionCalls = 0;
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("http://srh:80/")) return nativeFetch(input, init);
    if (url.startsWith("https://evolution.invalid/message/sendText/")) {
      evolutionCalls++;
      return { ok: true, status: 200, json: async () => ({ key: { id: "fake-provider-ack" } }) } as Response;
    }
    throw new Error("external_request_blocked_in_hermetic_test");
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe.skipIf(!enabled)("outbox + canário com Redis real isolado e Evolution simulada", () => {
  test("Lua reserva objeto desserializado, finaliza e não reenvia", async () => {
    const { enfileirarMensagemWhatsapp, processarFilaWhatsapp, obterJobWhatsapp, resumoFilaWhatsapp } = await import("./whatsappOutbox");
    const { jobId } = await enfileirarMensagemWhatsapp({ phone: PHONE, text: "teste-dry-run", priority: "critica" });
    const executor = vi.fn(async () => ({ ok: true, statusHttp: 200, latenciaMs: 1, tentativas: 1 }));
    const result = await processarFilaWhatsapp(executor, 1, 1);
    expect(result).toEqual({ processed: 1, delivered: 1, failed: 0, ambiguous: 0 });
    expect(executor).toHaveBeenCalledTimes(1);
    expect((await obterJobWhatsapp(jobId))?.state).toBe("delivered");
    expect(await resumoFilaWhatsapp()).toEqual({ pending: 0, inFlight: 0, ambiguous: 0, unresolved: 0 });
    await processarFilaWhatsapp(executor, 1, 1);
    expect(executor).toHaveBeenCalledTimes(1);
  });

  test("falha de executor é isolada em quarentena e nunca reenviada", async () => {
    const { enfileirarMensagemWhatsapp, processarFilaWhatsapp, obterJobWhatsapp, resumoFilaWhatsapp } = await import("./whatsappOutbox");
    const { jobId } = await enfileirarMensagemWhatsapp({ phone: PHONE + "1", text: "teste-falha-controlada", priority: "critica" });
    const executor = vi.fn(async () => { throw new Error("falha_simulada"); });
    const result = await processarFilaWhatsapp(executor, 1, 1);
    expect(result.ambiguous).toBe(1);
    expect((await obterJobWhatsapp(jobId))?.state).toBe("ambiguous");
    expect((await resumoFilaWhatsapp()).ambiguous).toBeGreaterThanOrEqual(1);
    await processarFilaWhatsapp(executor, 1, 1);
    expect(executor).toHaveBeenCalledTimes(1);
  });

  test("canário completo com Redis real e Evolution falsa preserva jobId", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("EVOLUTION_API_URL", "https://evolution.invalid");
    vi.stubEnv("EVOLUTION_API_KEY", "fake-local-not-a-secret");
    vi.stubEnv("WHATSAPP_CANARY_PHONE", PHONE);
    vi.stubEnv("WHATSAPP_OUTBOX_ROLLOUT", "canary");
    const { iniciarCanario, processarPossivelInboundCanario, lerCanarioAtual } = await import("./whatsappCanary");
    const { obterJobWhatsapp } = await import("./whatsappOutbox");

    const started = await iniciarCanario();
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.record.outboundHttpStatus).toBe(200);
    expect(started.record.outboundOutboxJobId).toEqual(expect.any(String));
    expect((await obterJobWhatsapp(started.record.outboundOutboxJobId!))?.state).toBe("delivered");

    expect(await processarPossivelInboundCanario(PHONE, started.record.token, "fake-inbound-1")).toBe(true);
    const done = await lerCanarioAtual();
    expect(done?.state).toBe("roundtrip_ok");
    expect(done?.outboundOutboxJobId).toBe(started.record.outboundOutboxJobId);
    expect(evolutionCalls).toBe(2);
  });
});
