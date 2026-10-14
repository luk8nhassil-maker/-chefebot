import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ verify: vi.fn(), process: vi.fn(), recover: vi.fn(), summary: vi.fn(), sync: vi.fn(), schedule: vi.fn() }));

vi.mock("@upstash/qstash", () => ({ Receiver: class { verify = mocks.verify; } }));
vi.mock("@/lib/whatsappMensagem", () => ({ executarJobWhatsapp: vi.fn() }));
vi.mock("@/lib/conversa", () => ({ registrarMensagem: vi.fn() }));
vi.mock("@/lib/conversaEcoPainel", () => ({ marcarEcoPainel: vi.fn() }));
vi.mock("@/lib/whatsappDiag", () => ({ marcarOutboundConfirmado: vi.fn() }));
vi.mock("@/lib/whatsappOutbox", () => ({
  urlWorkerWhatsappAssinada: vi.fn(() => "https://chefedapizza.com.br/api/interno/whatsapp-outbox/processar"),
  processarFilaWhatsapp: mocks.process, recuperarLeasesWhatsapp: mocks.recover,
  resumoFilaWhatsapp: mocks.summary, sincronizarHistoricoMensagensHumanas: mocks.sync,
  agendarDrenoWhatsapp: mocks.schedule,
}));

import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.QSTASH_CURRENT_SIGNING_KEY = "current";
  process.env.QSTASH_NEXT_SIGNING_KEY = "next";
  mocks.recover.mockResolvedValue({ reconciled: 0, unresolved: 0 });
  mocks.process.mockResolvedValue({ processed: 0, delivered: 0, failed: 0, ambiguous: 0 });
  mocks.sync.mockResolvedValue(0);
  mocks.summary.mockResolvedValue({ pending: 0, inFlight: 0, ambiguous: 0, unresolved: 0 });
});

describe("worker da outbox", () => {
  test("vincula a assinatura QStash à URL canônica, não só ao corpo", async () => {
    mocks.verify.mockResolvedValue(false);
    const response = await POST(new NextRequest("https://attacker.test/api/interno/whatsapp-outbox/processar", {
      method: "POST", headers: { "upstash-signature": "token" }, body: "{}",
    }));
    expect(response.status).toBe(401);
    expect(mocks.verify).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://chefedapizza.com.br/api/interno/whatsapp-outbox/processar",
    }));
    expect(mocks.process).not.toHaveBeenCalled();
  });
});
