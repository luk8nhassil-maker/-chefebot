import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ monitor: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/apiAuth", async () => {
  const { NextResponse } = await import("next/server");
  return {
    autenticarRequisicao: mocks.auth,
    exigirRole: (u: { role?: string } | null, allowed: string[]) =>
      !u ? NextResponse.json({ error: "sem login" }, { status: 401 }) :
        !allowed.includes(u.role ?? "") ? NextResponse.json({ error: "sem permissão" }, { status: 403 }) : null,
  };
});
vi.mock("@/lib/whatsappMonitoramento", () => ({ lerMonitorWhatsapp: mocks.monitor }));
import { GET } from "./route";
const req = () => new NextRequest("http://localhost/api/dev/whatsapp/monitoramento");
beforeEach(() => { mocks.auth.mockReset(); mocks.monitor.mockReset(); });
describe("API DEV WhatsApp - isolamento", () => {
  test("nega não autenticado sem ler Redis/Evolution", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await GET(req())).status).toBe(401);
    expect(mocks.monitor).not.toHaveBeenCalled();
  });
  test("nega admin e atendente", async () => {
    for (const role of ["admin", "atendente"]) {
      mocks.auth.mockResolvedValue({ role });
      expect((await GET(req())).status).toBe(403);
    }
    expect(mocks.monitor).not.toHaveBeenCalled();
  });
  test("DEV lê dados sem cache público", async () => {
    mocks.auth.mockResolvedValue({ role: "dev" });
    mocks.monitor.mockResolvedValue({ stage: 1, metrics: null });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(await res.json()).toEqual({ stage: 1, metrics: null });
  });
  test("falha de observabilidade não expõe stack ou segredos", async () => {
    mocks.auth.mockResolvedValue({ role: "dev" });
    mocks.monitor.mockRejectedValue(new Error("token-super-secreto"));
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("token-super-secreto");
  });
});
