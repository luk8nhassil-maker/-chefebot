import { afterEach, describe, expect, test, vi } from "vitest";

// Integração opt-in com Redis/SRH descartáveis no GitHub Actions.
// Nenhum dado, token ou serviço de produção entra neste teste.
const enabled = process.env.CHEFEBOT_OUTBOX_REDIS_INTEGRATION === "1";
const PHONE = "5511900000666";

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
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (!url.startsWith("https://evolution.invalid/message/sendText/")) {
        throw new Error("external_request_blocked_in_hermetic_test");
      }
      return { ok: true, status: 200, json: async () => ({ key: { id: "fake-provider-ack" } }) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
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
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
