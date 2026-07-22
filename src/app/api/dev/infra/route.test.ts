import { vi, describe, it, expect, beforeEach } from "vitest";

const { mockBuildInfraSnapshot } = vi.hoisted(() => ({
  mockBuildInfraSnapshot: vi.fn().mockResolvedValue({ configured: false }),
}));

vi.mock("@/infra/railway/readModel", () => ({
  buildInfraSnapshot: mockBuildInfraSnapshot,
}));

import { GET } from "./route";
import { createToken } from "@/lib/auth";

function makeReq(token?: string | null) {
  return {
    cookies: {
      get: (name: string) => (name === "auth-token" && token ? { value: token } : undefined),
    },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/dev/infra — autenticação", () => {
  it("401 sem cookie", async () => {
    const res = await GET(makeReq(null));
    expect(res.status).toBe(401);
    expect(mockBuildInfraSnapshot).not.toHaveBeenCalled();
  });

  it("401 com token inválido", async () => {
    const res = await GET(makeReq("token-invalido"));
    expect(res.status).toBe(401);
  });

  it("403 com role diferente de dev", async () => {
    const token = await createToken({ username: "brito", name: "Brito", role: "admin" });
    const res = await GET(makeReq(token));
    expect(res.status).toBe(403);
  });

  it("200 com role dev", async () => {
    const token = await createToken({ username: "ominix", name: "Ominix Dev", role: "dev" });
    const res = await GET(makeReq(token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.configured).toBe(false);
    expect(mockBuildInfraSnapshot).toHaveBeenCalledTimes(1);
  });

  it("503 quando buildInfraSnapshot lança (nunca derruba a resposta)", async () => {
    mockBuildInfraSnapshot.mockRejectedValueOnce(new Error("boom"));
    const token = await createToken({ username: "ominix", name: "Ominix Dev", role: "dev" });
    const res = await GET(makeReq(token));
    expect(res.status).toBe(503);
  });
});
