import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/whatsappMonitoramento", () => ({ lerMonitorWhatsapp: mocks.read }));
import { GET } from "./route";
const request = (token?: string) => new NextRequest("https://chefedapizza.com.br/api/dev/observability/jornada", {
  headers: token === undefined ? {} : { Authorization: "Bearer " + token },
});
const saved = process.env.CHEFEBOT_JORNADA_MONITOR_TOKEN;
const env = process.env.VERCEL_ENV;
beforeEach(() => {
  mocks.read.mockReset();
  process.env.CHEFEBOT_JORNADA_MONITOR_TOKEN = "test-only-".repeat(6);
  delete process.env.VERCEL_ENV;
});
afterAll(() => {
  if (saved === undefined) delete process.env.CHEFEBOT_JORNADA_MONITOR_TOKEN;
  else process.env.CHEFEBOT_JORNADA_MONITOR_TOKEN = saved;
  if (env === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = env;
});
describe("Jornada: exportação DEV exclusivamente leitura", () => {
  test("sem segredo válido nega antes de consultar o monitor", async () => {
    delete process.env.CHEFEBOT_JORNADA_MONITOR_TOKEN;
    expect((await GET(request())).status).toBe(503);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  test("nega sem token, token errado, header excessivo e preview", async () => {
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request("invalido"))).status).toBe(401);
    expect((await GET(request("A".repeat(512)))).status).toBe(401);
    process.env.VERCEL_ENV = "preview";
    expect((await GET(request(process.env.CHEFEBOT_JORNADA_MONITOR_TOKEN))).status).toBe(503);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  test("identidade válida recebe apenas allowlist sem dados sensíveis", async () => {
    mocks.read.mockResolvedValue({
      checkedAt: 123,
      metrics: { pending: 0, inFlight: 0, ambiguous: 0, unresolved: 0 },
      health: { redis: "ok", evolution: "connected", qstash: "configured_not_verified",
        qstashScheduleVerified: false, lastSignedWorkerSuccessAt: 121, qstashMissing: ["private"] },
      diagnostics: { acceptedCounter: "available", canaryOutbox: "delivered" },
      canary: { state: "roundtrip_ok", testedAt: 100, phone: "private" },
      incidents: [{ phone: "private", reason: "secret" }],
      recommendation: { token: "private" },
    });
    const res = await GET(request(process.env.CHEFEBOT_JORNADA_MONITOR_TOKEN));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    const body = await res.json();
    expect(body.metrics.pending).toBe(0);
    expect(body.diagnostics.canaryOutbox).toBe("delivered");
    expect(JSON.stringify(body)).not.toContain("private");
    expect(JSON.stringify(body)).not.toContain("incidents");
  });
  test("falha do monitor não expõe credenciais", async () => {
    mocks.read.mockRejectedValue(new Error("token-secret"));
    const res = await GET(request(process.env.CHEFEBOT_JORNADA_MONITOR_TOKEN));
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("token-secret");
  });
});
