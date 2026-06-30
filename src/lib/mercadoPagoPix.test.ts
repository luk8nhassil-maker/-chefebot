import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { criarCobrancaPixMercadoPago, MercadoPagoPixError } from "./mercadoPagoPix";

const respostaOk = {
  id: 123456,
  status: "pending",
  point_of_interaction: {
    transaction_data: {
      qr_code: "pix-copia-e-cola",
      qr_code_base64: "base64-pix",
      ticket_url: "https://mercadopago.test/ticket",
    },
  },
};

function mockFetchOk() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => respostaOk,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function baseInput() {
  return {
    pedidoId: "pedido-1",
    txid: "chefebot_123",
    valorEsperado: 30,
    descricao: "Pedido ChefeBot #1",
    clienteNome: "Lucas",
    payerEmail: "cliente@example.com",
  };
}

beforeEach(() => {
  vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "token-123");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("criarCobrancaPixMercadoPago", () => {
  test("monta payload Pix correto", async () => {
    const fetchMock = mockFetchOk();

    await criarCobrancaPixMercadoPago(baseInput());

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      transaction_amount: 30,
      description: "Pedido ChefeBot #1",
      payment_method_id: "pix",
      external_reference: "chefebot_123",
      metadata: {
        pedidoId: "pedido-1",
        txid: "chefebot_123",
      },
      payer: {
        email: "cliente@example.com",
        first_name: "Lucas",
      },
    });
  });

  test("envia Authorization correto", async () => {
    const fetchMock = mockFetchOk();

    await criarCobrancaPixMercadoPago(baseInput());

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer token-123");
  });

  test("envia X-Idempotency-Key estavel", async () => {
    const fetchMock = mockFetchOk();

    const r1 = await criarCobrancaPixMercadoPago(baseInput());
    const r2 = await criarCobrancaPixMercadoPago(baseInput());

    expect(r1.idempotencyKey).toBe("chefebot_pix_chefebot_123");
    expect(r2.idempotencyKey).toBe("chefebot_pix_chefebot_123");
    expect(fetchMock.mock.calls[0][1].headers["X-Idempotency-Key"]).toBe("chefebot_pix_chefebot_123");
    expect(fetchMock.mock.calls[1][1].headers["X-Idempotency-Key"]).toBe("chefebot_pix_chefebot_123");
  });

  test("usa transaction_amount igual ao valorEsperado", async () => {
    const fetchMock = mockFetchOk();

    await criarCobrancaPixMercadoPago({ ...baseInput(), valorEsperado: 45.678 });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.transaction_amount).toBe(45.68);
  });

  test("usa external_reference igual ao txid", async () => {
    const fetchMock = mockFetchOk();

    await criarCobrancaPixMercadoPago({ ...baseInput(), txid: "txid-unico" });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.external_reference).toBe("txid-unico");
  });

  test("normaliza providerPaymentId, qrCode, qrCodeBase64 e ticketUrl", async () => {
    mockFetchOk();

    const resultado = await criarCobrancaPixMercadoPago(baseInput());

    expect(resultado).toEqual({
      provider: "mercadopago",
      providerPaymentId: "123456",
      qrCode: "pix-copia-e-cola",
      qrCodeBase64: "base64-pix",
      ticketUrl: "https://mercadopago.test/ticket",
      idempotencyKey: "chefebot_pix_chefebot_123",
      statusOriginal: "pending",
    });
  });

  test("falha com erro claro se MERCADOPAGO_ACCESS_TOKEN estiver ausente", async () => {
    vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "");
    const fetchMock = mockFetchOk();

    await expect(criarCobrancaPixMercadoPago(baseInput())).rejects.toThrow("MERCADOPAGO_ACCESS_TOKEN ausente");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("falha com erro claro se nao houver payerEmail nem fallback", async () => {
    const fetchMock = mockFetchOk();

    await expect(criarCobrancaPixMercadoPago({ ...baseInput(), payerEmail: undefined })).rejects.toThrow("payerEmail ausente");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("usa fallback de e-mail do ambiente quando payerEmail nao vem no input", async () => {
    vi.stubEnv("MERCADOPAGO_PAYER_EMAIL_FALLBACK", "fallback@example.com");
    const fetchMock = mockFetchOk();

    await criarCobrancaPixMercadoPago({ ...baseInput(), payerEmail: undefined });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.payer.email).toBe("fallback@example.com");
  });

  test("trata erro HTTP do Mercado Pago sem quebrar silenciosamente", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      statusText: "Bad Request",
      json: async () => ({ message: "invalid payer" }),
    }));

    await expect(criarCobrancaPixMercadoPago(baseInput())).rejects.toThrow(MercadoPagoPixError);
  });
});
