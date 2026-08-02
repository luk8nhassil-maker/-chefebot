import { describe, expect, it } from "vitest";
import { POST } from "./route";
import { SALAO_COOKIE } from "@/lib/salaoAuth";

describe("POST /api/salao/logout", () => {
  it("limpa o cookie de sessão do Salão", async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    const cookie = res.cookies.get(SALAO_COOKIE);
    expect(cookie?.value).toBe("");
    expect(cookie?.maxAge).toBe(0);
  });
});
