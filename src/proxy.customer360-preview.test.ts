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

describe("proxy — Preview Customer 360", () => {
  test("Preview libera fixture sem autenticação", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const res = await proxy(req("https://branch-preview.vercel.app/dev/customer360"));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  test("produção não libera /dev/customer360 anonimamente", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const res = await proxy(req("https://chefedapizza.com.br/dev/customer360"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });
});
