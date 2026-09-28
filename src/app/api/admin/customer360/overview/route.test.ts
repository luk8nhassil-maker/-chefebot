import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verifyToken: vi.fn(),
  behaviorAnalyticsConfig: vi.fn(),
  readBehaviorFunnelOverview: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ verifyToken: mocks.verifyToken }));
vi.mock("@/lib/behaviorAnalytics", () => ({
  behaviorAnalyticsConfig: mocks.behaviorAnalyticsConfig,
  readBehaviorFunnelOverview: mocks.readBehaviorFunnelOverview,
}));

import { GET } from "./route";

const OVERVIEW = {
  schemaVersion: 1,
  startMs: 1,
  endMs: 2,
  sessions: 10,
  identifiedCustomers: 6,
  identifiedCustomerSessions: 7,
  sessionsWithSearch: 5,
  sessionsWithCart: 4,
  sessionsReachedCheckout: 3,
  sessionsWithCheckoutExitObserved: 2,
  convertedSessions: 2,
  sessionsWithoutOrder: 8,
  cartSessionsWithoutOrder: 2,
  checkoutSessionsWithoutOrder: 1,
  conversionRatePct: 20,
};

function req(period = "30") {
  const request = new NextRequest("https://chefedapizza.com.br/api/admin/customer360/overview?periodo=" + period);
  request.cookies.set("auth-token", "token-test");
  return request;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.behaviorAnalyticsConfig.mockReturnValue({
    retentionDays: 120,
    retentionSeconds: 120 * 24 * 60 * 60,
    hmacSecret: "x".repeat(32),
  });
  mocks.verifyToken.mockResolvedValue({ username: "admin", name: "Admin", role: "admin" });
  mocks.readBehaviorFunnelOverview.mockResolvedValue(OVERVIEW);
});

describe("GET /api/admin/customer360/overview", () => {
  test("coleção desligada fecha o endpoint antes de autenticar", async () => {
    mocks.behaviorAnalyticsConfig.mockReturnValue(null);
    const res = await GET(req());
    expect(res.status).toBe(404);
    expect(mocks.verifyToken).not.toHaveBeenCalled();
  });

  test("exige admin/dev", async () => {
    mocks.verifyToken.mockResolvedValue({ username: "atendente", name: "Atendente", role: "atendente" });
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mocks.readBehaviorFunnelOverview).not.toHaveBeenCalled();
  });

  test("aceita apenas 7, 30 ou 90 dias", async () => {
    const res = await GET(req("365"));
    expect(res.status).toBe(400);
    expect(mocks.readBehaviorFunnelOverview).not.toHaveBeenCalled();
  });

  test("retorna somente overview agregado e retenção configurada", async () => {
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    const res = await GET(req("30"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-chefebot-customer360")).toBe("aggregate-read-only");
    expect(body.retentionDays).toBe(120);
    expect(body.overview).toEqual(OVERVIEW);
    expect(JSON.stringify(body)).not.toContain("telefone");
    expect(JSON.stringify(body)).not.toContain("clienteId");
    expect(mocks.readBehaviorFunnelOverview).toHaveBeenCalledWith({
      startMs: 1_800_000_000_000 - 30 * 24 * 60 * 60 * 1000,
      endMs: 1_800_000_000_000,
    });
    dateSpy.mockRestore();
  });
});
