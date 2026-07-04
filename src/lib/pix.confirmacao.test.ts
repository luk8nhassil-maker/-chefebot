import { vi, describe, test, expect } from "vitest";

vi.mock("./redis", () => ({ redis: { get: vi.fn().mockResolvedValue(null) } }));
vi.mock("./mercadoPagoPix", () => ({ criarCobrancaPixMercadoPago: vi.fn() }));

import { confirmarPixMetadata, registrarPixEvidencia, type PixMetadata } from "./pix";

describe("confirmarPixMetadata — auditoria da confirmação de Pix", () => {
  test("confirma Pix pendente preenchendo status, origem e horário", () => {
    const pix: PixMetadata = { txid: "chefebot_1", valorEsperado: 50, status: "pendente" };
    const confirmado = confirmarPixMetadata(pix, "comprovante", "2026-07-04T20:00:00.000Z");
    expect(confirmado).toEqual({
      txid: "chefebot_1",
      valorEsperado: 50,
      status: "confirmado",
      confirmadoPor: "comprovante",
      confirmadoEm: "2026-07-04T20:00:00.000Z",
    });
  });

  test("pedido antigo sem metadata de pix ganha o mínimo auditável", () => {
    const confirmado = confirmarPixMetadata(undefined, "manual", "2026-07-04T20:00:00.000Z");
    expect(confirmado).toEqual({
      status: "confirmado",
      confirmadoPor: "manual",
      confirmadoEm: "2026-07-04T20:00:00.000Z",
    });
  });

  test("não sobrescreve confirmação anterior (clique manual não apaga webhook)", () => {
    const pix: PixMetadata = {
      txid: "chefebot_2",
      status: "confirmado",
      confirmadoPor: "webhook",
      confirmadoEm: "2026-07-04T19:00:00.000Z",
    };
    expect(confirmarPixMetadata(pix, "manual", "2026-07-04T20:00:00.000Z")).toBe(pix);
  });

  test("pedido legado confirmado sem origem ganha origem/horário sem perder o resto", () => {
    const pix: PixMetadata = { txid: "chefebot_3", valorEsperado: 40, status: "confirmado" };
    const confirmado = confirmarPixMetadata(pix, "manual", "2026-07-04T20:00:00.000Z");
    expect(confirmado).toEqual({
      txid: "chefebot_3",
      valorEsperado: 40,
      status: "confirmado",
      confirmadoPor: "manual",
      confirmadoEm: "2026-07-04T20:00:00.000Z",
    });
  });

  test("preserva campos existentes do metadata (txid, valorEsperado, provider)", () => {
    const pix: PixMetadata = {
      txid: "chefebot_4",
      valorEsperado: 62.5,
      status: "pendente",
      provider: "mercadopago",
      providerPaymentId: "mp-1",
    };
    const confirmado = confirmarPixMetadata(pix, "webhook", "2026-07-04T20:00:00.000Z");
    expect(confirmado.txid).toBe("chefebot_4");
    expect(confirmado.valorEsperado).toBe(62.5);
    expect(confirmado.provider).toBe("mercadopago");
    expect(confirmado.providerPaymentId).toBe("mp-1");
    expect(confirmado.confirmadoPor).toBe("webhook");
  });

  test("horário default é ISO válido quando não informado", () => {
    const confirmado = confirmarPixMetadata({ status: "pendente" }, "comprovante");
    expect(confirmado.confirmadoEm).toBeTruthy();
    expect(Number.isNaN(Date.parse(confirmado.confirmadoEm!))).toBe(false);
  });

  test("registra evidencia E2E/codigo sem alterar confirmacao do Pix", () => {
    const pix: PixMetadata = {
      status: "confirmado",
      confirmadoPor: "comprovante",
      confirmadoEm: "2026-07-04T20:00:00.000Z",
    };

    expect(
      registrarPixEvidencia(
        pix,
        { e2eId: "E1234567890ABCDEF1234567890ABCD", origem: "midia" },
        "2026-07-04T20:05:00.000Z",
      ),
    ).toEqual({
      status: "confirmado",
      confirmadoPor: "comprovante",
      confirmadoEm: "2026-07-04T20:00:00.000Z",
      evidencia: {
        e2eId: "E1234567890ABCDEF1234567890ABCD",
        origem: "midia",
        registradoEm: "2026-07-04T20:05:00.000Z",
      },
    });
  });

  test("sem E2E/codigo visivel preserva o metadata atual", () => {
    const pix: PixMetadata = { status: "confirmado", confirmadoPor: "comprovante" };

    expect(registrarPixEvidencia(pix, { origem: "texto" })).toBe(pix);
  });

  test("registra evidencia de horario suspeito sem alterar status", () => {
    const pix: PixMetadata = { status: "pendente", txid: "chefebot_5" };

    expect(
      registrarPixEvidencia(
        pix,
        { dataHoraPagamento: "2026-07-04T19:00:00", motivo: "pagamento_anterior", origem: "texto" },
        "2026-07-04T22:05:00.000Z",
      ),
    ).toEqual({
      status: "pendente",
      txid: "chefebot_5",
      evidencia: {
        dataHoraPagamento: "2026-07-04T19:00:00",
        motivo: "pagamento_anterior",
        origem: "texto",
        registradoEm: "2026-07-04T22:05:00.000Z",
      },
    });
  });
});
