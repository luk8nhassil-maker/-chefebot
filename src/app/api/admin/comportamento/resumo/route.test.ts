import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verifyToken: vi.fn(),
  behaviorAnalyticsEnabled: vi.fn(),
  resumirFunilComportamental: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ verifyToken: mocks.verifyToken }));
vi.mock("@/lib/behaviorAnalytics", () => ({
  behaviorAnalyticsEnabled: mocks.behaviorAnalyticsEnabled,
}));
vi.mock("@/lib/behaviorAnalyticsRead", () => ({
  resumirFunilComportamental: mocks.resumirFunilComportamental,
}));

import { GET } from "./route";

function req(periodo = "30") {
  const r = new NextRequest("https://chefedapizza.com.br/api/admin/comportamento/resumo?periodo=" + periodo);
  r.cookies.set("auth-token", "token");
  return r;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.behaviorAnalyticsEnabled.mockReturnValue(true);
  mocks.verifyToken.mockResolvedValue({ username: "ominix", role: "dev" });
  mocks.resumirFunilComportamental.mockResolvedValue({
    schemaVersion: 1,
    mode: "behavior_summary_read_only",
    period: { startMs: 1, endMs: 2 },
    truncated: false,
    events: 10,
    sessions: 4,
    sessionsWithCheckout: 2,
    sessionsWithOrder: 1,
    sessionsWithoutOrder: 3,
    checkoutToOrderRate: 50,
    sessionToOrderRate: 25,
    medianMinutesFirstOpenToOrder: 12,
    byType: { app_open: 4, order_created: 1 },
  });
});

describe("GET /api/admin/comportamento/resumo", () => {
  test("release gate fechado retorna 404", async () => {
    mocks.behaviorAnalyticsEnabled.mockReturnValue(false);
    const res = await GET(req());
    expect(res.status).toBe(404);
    expect(mocks.verifyToken).not.toHaveBeenCalled();
  });

  test("somente dev acessa o resumo", async () => {
    mocks.verifyToken.mockResolvedValue({ username: "admin", role: "admin" });
    expect((await GET(req())).status).toBe(401);
    expect(mocks.resumirFunilComportamental).not.toHaveBeenCalled();
  });

  test("aceita somente janelas fechadas", async () => {
    expect((await GET(req("365"))).status).toBe(400);
  });

  test("retorna somente agregado e no-store", async () => {
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(1_000_000_000);
    const res = await GET(req("30"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-chefebot-analytics")).toBe("behavior-summary-v1");
    expect(body.summary.sessions).toBe(4);
    expect(mocks.resumirFunilComportamental).toHaveBeenCalledTimes(1);
    dateSpy.mockRestore();
  });
});
