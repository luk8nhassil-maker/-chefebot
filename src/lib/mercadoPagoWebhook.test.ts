import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("./mercadoPagoIntegracao", () => ({
  resolveActiveMercadoPagoToken: vi.fn(async () => tokenAtual),
}));

let tokenAtual: string | null = "token-123";

import {
  isMercadoPagoWebhook,
  extrairPaymentIdMercadoPago,
  parseXSignature,
  validarAssinaturaMercadoPago,
  buscarPagamentoMercadoPago,
  mapearStatusMercadoPago,
  mapearPagamentoParaPayloadInterno,
} from "./mercadoPagoWebhook";

const SECRET = "webhook-secret-xyz";

function assinar(dataId: string, requestId: string, ts: string, secret = SECRET): string {
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac("sha256", secret).update(manifest).digest("hex");
  return `ts=${ts},v1=${v1}`;
}

beforeEach(() => {
  tokenAtual = "token-123";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("isMercadoPagoWebhook — deteccao", () => {
  test("payload MP com type=payment e data.id numerico e detectado", () => {
    expect(isMercadoPagoWebhook({ type: "payment", data: { id: 123456 } })).toBe(true);
  });

  test("payload MP com data.id string e detectado", () => {
    expect(isMercadoPagoWebhook({ type: "payment", data: { id: "123456" } })).toBe(true);
  });

  test("type diferente de payment nao e detectado", () => {
    expect(isMercadoPagoWebhook({ type: "plan", data: { id: 1 } })).toBe(false);
    expect(isMercadoPagoWebhook({ type: "merchant_order", data: { id: 1 } })).toBe(false);
  });

  test("payload generico (txid/valor/status) nao e detectado como MP", () => {
    expect(isMercadoPagoWebhook({ txid: "tx-1", valor: 50, status: "pago" })).toBe(false);
  });

  test("valores nao-objeto ou sem data.id nao sao detectados", () => {
    expect(isMercadoPagoWebhook(null)).toBe(false);
    expect(isMercadoPagoWebhook("payment")).toBe(false);
    expect(isMercadoPagoWebhook({ type: "payment" })).toBe(false);
    expect(isMercadoPagoWebhook({ type: "payment", data: {} })).toBe(false);
  });
});

describe("extrairPaymentIdMercadoPago", () => {
  test("normaliza id numerico e string", () => {
    expect(extrairPaymentIdMercadoPago({ type: "payment", data: { id: 987 } })).toBe("987");
    expect(extrairPaymentIdMercadoPago({ type: "payment", data: { id: " abc " } })).toBe("abc");
  });

  test("id ausente/vazio retorna null", () => {
    expect(extrairPaymentIdMercadoPago({ type: "payment", data: {} })).toBeNull();
    expect(extrairPaymentIdMercadoPago({ type: "payment", data: { id: "" } })).toBeNull();
  });
});

describe("parseXSignature", () => {
  test("extrai ts e v1", () => {
    expect(parseXSignature("ts=1700000000,v1=abcdef")).toEqual({ ts: "1700000000", v1: "abcdef" });
  });

  test("aceita espacos e ordem trocada", () => {
    expect(parseXSignature(" v1=abc , ts=123 ")).toEqual({ ts: "123", v1: "abc" });
  });

  test("header ausente ou incompleto retorna null", () => {
    expect(parseXSignature(null)).toBeNull();
    expect(parseXSignature("ts=123")).toBeNull();
    expect(parseXSignature("v1=abc")).toBeNull();
  });
});

describe("validarAssinaturaMercadoPago", () => {
  const dataId = "123456";
  const requestId = "req-abc";
  const ts = "1700000000";

  test("assinatura valida passa", () => {
    const xSignature = assinar(dataId, requestId, ts);
    expect(validarAssinaturaMercadoPago({ dataId, xSignature, xRequestId: requestId, secret: SECRET })).toBe(true);
  });

  test("assinatura com secret errado falha", () => {
    const xSignature = assinar(dataId, requestId, ts, "outro-secret");
    expect(validarAssinaturaMercadoPago({ dataId, xSignature, xRequestId: requestId, secret: SECRET })).toBe(false);
  });

  test("manifest adulterado (data.id diferente) falha", () => {
    const xSignature = assinar(dataId, requestId, ts);
    expect(validarAssinaturaMercadoPago({ dataId: "999999", xSignature, xRequestId: requestId, secret: SECRET })).toBe(false);
  });

  test("assinatura ausente falha", () => {
    expect(validarAssinaturaMercadoPago({ dataId, xSignature: null, xRequestId: requestId, secret: SECRET })).toBe(false);
  });

  test("secret ausente falha (nunca valida sem segredo configurado)", () => {
    const xSignature = assinar(dataId, requestId, ts);
    expect(validarAssinaturaMercadoPago({ dataId, xSignature, xRequestId: requestId, secret: undefined })).toBe(false);
  });

  test("request-id divergente falha", () => {
    const xSignature = assinar(dataId, requestId, ts);
    expect(validarAssinaturaMercadoPago({ dataId, xSignature, xRequestId: "req-outro", secret: SECRET })).toBe(false);
  });
});

describe("mapearStatusMercadoPago", () => {
  test("approved -> pago", () => {
    expect(mapearStatusMercadoPago("approved")).toBe("pago");
    expect(mapearStatusMercadoPago("APPROVED")).toBe("pago");
  });

  test("pending/in_process -> pendente", () => {
    expect(mapearStatusMercadoPago("pending")).toBe("pendente");
    expect(mapearStatusMercadoPago("in_process")).toBe("pendente");
  });

  test("rejected/cancelled/refunded e outros -> rejeitado", () => {
    for (const s of ["rejected", "cancelled", "refunded", "charged_back", "qualquer"]) {
      expect(mapearStatusMercadoPago(s)).toBe("rejeitado");
    }
  });
});

describe("mapearPagamentoParaPayloadInterno", () => {
  test("mapeia external_reference->txid, transaction_amount->valor, id->providerPaymentId", () => {
    const payload = mapearPagamentoParaPayloadInterno({
      id: "pay-1",
      status: "approved",
      transactionAmount: 50,
      externalReference: "chefebot_123",
    });
    expect(payload).toEqual({ txid: "chefebot_123", valor: 50, status: "pago", providerPaymentId: "pay-1" });
  });

  test("campos ausentes viram undefined (valor invalido nao confirma depois)", () => {
    const payload = mapearPagamentoParaPayloadInterno({
      id: "pay-2",
      status: "pending",
      transactionAmount: null,
      externalReference: null,
    });
    expect(payload).toEqual({ txid: undefined, valor: undefined, status: "pendente", providerPaymentId: "pay-2" });
  });
});

describe("buscarPagamentoMercadoPago", () => {
  test("aprovado: normaliza id, status, transaction_amount e external_reference", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 123456, status: "approved", transaction_amount: 30, external_reference: "chefebot_9" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const pgto = await buscarPagamentoMercadoPago("123456");

    expect(pgto).toEqual({ id: "123456", status: "approved", transactionAmount: 30, externalReference: "chefebot_9" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.mercadopago.com/v1/payments/123456");
    expect((init as { headers: Record<string, string> }).headers.Authorization).toBe("Bearer token-123");
  });

  test("sem token resolvido: nao chama a API e retorna null", async () => {
    tokenAtual = null;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const pgto = await buscarPagamentoMercadoPago("123456");

    expect(pgto).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("resposta HTTP nao-ok retorna null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    expect(await buscarPagamentoMercadoPago("123456")).toBeNull();
  });
});
