import { afterEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

afterEach(() => {
  vi.unstubAllEnvs();
});

function req(url: string) {
  const parsed = new URL(url);
  return new NextRequest(url, { headers: { host: parsed.host } });
}

describe("proxy — Preview do Cofre do Chefe", () => {
  test("Preview libera a fixture sem autenticação", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const res = await proxy(req("https://branch-preview.vercel.app/dev/cofre-chefe"));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  test("produção não libera /dev/cofre-chefe anonimamente", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const res = await proxy(req("https://chefedapizza.com.br/dev/cofre-chefe"));

    expect(res.status).toBe(307);
    const location = res.headers.get("location");
    expect(location).toContain("/login");
    expect(location).toContain("callbackUrl=%2Fdev%2Fcofre-chefe");
  });
});
