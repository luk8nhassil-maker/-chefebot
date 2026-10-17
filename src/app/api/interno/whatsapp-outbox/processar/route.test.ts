import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ verify: vi.fn(), process: vi.fn(), recover: vi.fn(), summary: vi.fn(), sync: vi.fn(), schedule: vi.fn(), markEco: vi.fn(), registrarOutbox: vi.fn(), markOutbound: vi.fn(), executarJob: vi.fn() }));

vi.mock("@upstash/qstash", () => ({ Receiver: class { verify = mocks.verify; } }));
vi.mock("@/lib/whatsappMensagem", () => ({ executarJobWhatsapp: mocks.executarJob }));
vi.mock("@/lib/conversa", () => ({ registrarMensagemOutbox: mocks.registrarOutbox }));
vi.mock("@/lib/conversaEcoPainel", () => ({ marcarEcoPainel: mocks.markEco }));
vi.mock("@/lib/whatsappDiag", () => ({ marcarOutboundConfirmado: mocks.markOutbound }));
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

  test("marca o eco de bot assíncrono antes do histórico", async () => {
    mocks.verify.mockResolvedValue(true);
    mocks.registrarOutbox.mockResolvedValue(true);
    mocks.summary.mockResolvedValue({ pending: 0, inFlight: 0, ambiguous: 0, unresolved: 0 });
    mocks.sync.mockImplementation(async (callback: (job: Record<string, unknown>) => Promise<void>) => {
      await callback({
        id: "bot-job-1", phone: "5511999990001",
        history: { autor: "bot", texto: "Pedido confirmado", markOutbound: true },
        result: { messageIdInterno: "EVO-BOT-1" },
      });
      return 1;
    });
    const response = await POST(new NextRequest("https://chefedapizza.com.br/api/interno/whatsapp-outbox/processar", {
      method: "POST", headers: { "upstash-signature": "token" }, body: "{}",
    }));
    expect(response.status).toBe(200);
    expect(mocks.markEco).toHaveBeenCalledWith("EVO-BOT-1");
    expect(mocks.markEco.mock.invocationCallOrder[0]).toBeLessThan(mocks.registrarOutbox.mock.invocationCallOrder[0]);
    expect(mocks.markOutbound).toHaveBeenCalledTimes(1);
  });

  test("falha no marcador de eco não invalida entrega já confirmada pela Evolution", async () => {
    mocks.verify.mockResolvedValue(true);
    mocks.executarJob.mockResolvedValue({
      ok: true, messageIdInterno: "EVO-CONFIRMADO", latenciaMs: 1, tentativas: 1,
    });
    mocks.markEco.mockRejectedValue(new Error("Redis temporariamente indisponível"));
    mocks.process.mockImplementation(async (executor: (job: Record<string, unknown>) => Promise<unknown>) => {
      const transport = await executor({
        id: "bot-job-confirmado", phone: "5511999990001",
        history: { autor: "bot", texto: "ok" },
      });
      expect(transport).toEqual(expect.objectContaining({ ok: true }));
      return { processed: 1, delivered: 1, failed: 0, ambiguous: 0 };
    });
    const response = await POST(new NextRequest("https://chefedapizza.com.br/api/interno/whatsapp-outbox/processar", {
      method: "POST", headers: { "upstash-signature": "token" }, body: "{}",
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({ delivered: 1, ambiguous: 0 }));
    expect(mocks.markEco).toHaveBeenCalledWith("EVO-CONFIRMADO");
  });

  test("marca o eco assim que o executor confirma, antes de finalizar o job", async () => {
    mocks.verify.mockResolvedValue(true);
    mocks.executarJob.mockResolvedValue({ ok: true, messageIdInterno: "EVO-ANTES-DO-FINALIZE", latenciaMs: 1, tentativas: 1 });
    mocks.process.mockImplementation(async (executor: (job: Record<string, unknown>) => Promise<unknown>) => {
      await executor({ id: "bot-job-cedo", phone: "5511999990001", history: { autor: "bot", texto: "ok" } });
      return { processed: 1, delivered: 1, failed: 0, ambiguous: 0 };
    });
    const response = await POST(new NextRequest("https://chefedapizza.com.br/api/interno/whatsapp-outbox/processar", {
      method: "POST", headers: { "upstash-signature": "token" }, body: "{}",
    }));
    expect(response.status).toBe(200);
    expect(mocks.markEco).toHaveBeenCalledWith("EVO-ANTES-DO-FINALIZE");
  });
});
