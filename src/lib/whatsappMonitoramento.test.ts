import { beforeEach, describe, expect, test, vi } from "vitest";

const fake = vi.hoisted(() => ({
  checkRedis: vi.fn(), configEvolution: vi.fn(), canary: vi.fn(), outboxConfig: vi.fn(),
  getJob: vi.fn(), summary: vi.fn(), redis: {
    hgetall: vi.fn(), zrange: vi.fn(),
  },
}));
vi.mock("./healthChecks", () => ({ checkRedisHealth: fake.checkRedis }));
vi.mock("./evolutionApi", () => ({ obterConfigEvolution: fake.configEvolution }));
vi.mock("./whatsappCanary", () => ({ lerCanarioAtual: fake.canary }));
vi.mock("./whatsappOutbox", () => ({
  configuracaoOutboxWhatsapp: fake.outboxConfig,
  obterJobWhatsapp: fake.getJob,
  resumoFilaWhatsapp: fake.summary,
}));
vi.mock("./redis", () => ({ redis: fake.redis }));
import { lerMonitorWhatsapp } from "./whatsappMonitoramento";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WHATSAPP_OUTBOX_ROLLOUT", "canary");
  vi.stubEnv("WHATSAPP_MONITOR_STAGE", "1");
  fake.checkRedis.mockResolvedValue({ status: "ok" });
  fake.configEvolution.mockReturnValue(null);
  fake.canary.mockResolvedValue({ state: "roundtrip_ok", createdAt: Date.now(), outboundHttpStatus: 200, outboundOutboxJobId: "canary-id" });
  fake.outboxConfig.mockReturnValue({ ready: true, missing: [] });
  fake.summary.mockResolvedValue({ pending: 2, inFlight: 0, ambiguous: 1, unresolved: 0 });
  fake.redis.hgetall.mockResolvedValue({ since: "1760000000000", queued: "8", delivered: "5", recovered: "1", failed: "1", lastWorkerOkAt: String(Date.now()) });
  fake.redis.zrange.mockResolvedValue([]);
  fake.getJob.mockResolvedValue({ id: "canary-id", state: "delivered" });
});

describe("Centro DEV: leitura segura", () => {
  test("retorna dados reais agregados e não envia mensagens ou altera etapa", async () => {
    const s = await lerMonitorWhatsapp();
    expect(s.metrics).toMatchObject({ pending: 2, queued: 8, accepted: 5, ambiguous: 1, recovered: 1 });
    expect(s.health.lastSignedWorkerSuccessAt).toBeTypeOf("number");
    expect(s.stages[0].passed).toBe(false); // Evolution não configurada e pendências
    expect(s.stages[1].passed).toBe(false);
    expect(fake.redis.hgetall).toHaveBeenCalledTimes(1);
    expect(fake.redis.zrange).toHaveBeenCalledTimes(4);
    expect(fake.redis).not.toHaveProperty("set");
  });

  test("não divulga telefone, conteúdo nem IDs do job na resposta", async () => {
    fake.redis.zrange.mockImplementation(async (key: string) =>
      key.endsWith("monitor:incidents") ? ["id-confidencial"] : []);
    fake.getJob.mockImplementation(async (id: string) => id === "id-confidencial"
      ? { id, phone: "5511999998888", text: "conteúdo privado", state: "failed", updatedAt: Date.now(), result: { motivo: "network_error", statusHttp: 503 } }
      : { id, state: "delivered" });
    const s = await lerMonitorWhatsapp();
    const json = JSON.stringify(s);
    expect(json).not.toContain("5511999998888");
    expect(json).not.toContain("conteúdo privado");
    expect(json).not.toContain("id-confidencial");
    expect(s.incidents[0]).toMatchObject({ reason: "network_error", statusHttp: 503 });
  });

  test("com Redis indisponível, não inventa zeros de produção", async () => {
    fake.checkRedis.mockResolvedValue({ status: "down" });
    const s = await lerMonitorWhatsapp();
    expect(s.metrics).toBeNull();
    expect(s.health.redis).toBe("down");
    expect(s.stages[0].passed).toBe(false);
    expect(fake.redis.hgetall).not.toHaveBeenCalled();
  });

  test("não inventa estado da Evolution ou custo de serviço", async () => {
    const s = await lerMonitorWhatsapp();
    expect(s.health.evolution).toBe("disconnected");
    expect(s.limits.actualServiceCost).toBeNull();
    expect(s.limits.actualServiceUsage).toBeNull();
    expect(s.health.qstashScheduleVerified).toBe(false);
  });
});
