import { describe, expect, it, vi } from "vitest";
import { POST } from "./route";

describe("POST /api/entregador/auth/logout", () => {
  it("é idempotente e expira o cookie exclusivo", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const primeira = await POST();
    const segunda = await POST();
    expect(primeira.status).toBe(200);
    expect(segunda.status).toBe(200);
    const cookie = primeira.headers.get("set-cookie")!;
    expect(cookie).toContain("entregador-token=");
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("HttpOnly");
  });
});
