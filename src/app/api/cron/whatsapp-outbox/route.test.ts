import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recover: vi.fn(), process: vi.fn(), summary: vi.fn(), sync: vi.fn(), schedule: vi.fn(),
}));

vi.mock("@/lib/whatsappMensagem", () => ({ executarJobWhatsapp: vi.fn() }));
vi.mock("@/lib/conversa", () => ({ registrarMensagem: vi.fn() }));
vi.mock("@/lib/whatsappOutbox", () => ({
  recuperarLeasesWhatsapp: mocks.recover,
  processarFilaWhatsapp: mocks.process,
  resumoFilaWhatsapp: mocks.summary,
  sincronizarHistoricoMensagensHumanas: mocks.sync,
  agendarDrenoWhatsapp: mocks.schedule,
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "cron-test";
  mocks.recover.mockResolvedValue({ reconciled: 2, unresolved: 0 });
  mocks.process.mockResolvedValue({ processed: 4, delivered: 4, failed: 0, ambiguous: 0 });
  mocks.sync.mockResolvedValue(1);
  mocks.summary.mockResolvedValue({ pending: 0, inFlight: 0 });
  mocks.schedule.mockResolvedValue(true);
});

describe("GET /api/cron/whatsapp-outbox", () => {
  test("exige autenticação do cron", async () => {
    expect((await GET(new Request("https://test.local"))).status).toBe(401);
    expect(mocks.process).not.toHaveBeenCalled();
  });

  test("reconcilia leases, drena lote e atualiza histórico humano", async () => {
    const response = await GET(new Request("https://test.local", { headers: { authorization: "Bearer cron-test" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, recovered: { reconciled: 2 }, processed: 4, humanHistorySynced: 1 });
    expect(mocks.process).toHaveBeenCalledWith(expect.any(Function), 8, 100);
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  test("reagenda apenas quando ainda há pendências", async () => {
    mocks.summary.mockResolvedValue({ pending: 1, inFlight: 0 });
    await GET(new Request("https://test.local", { headers: { authorization: "Bearer cron-test" } }));
    expect(mocks.schedule).toHaveBeenCalledTimes(1);
  });
});
