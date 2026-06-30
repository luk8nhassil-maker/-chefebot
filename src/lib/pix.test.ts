import { beforeEach, vi, describe, test, expect } from "vitest";

vi.mock("./redis", () => ({ redis: { get: vi.fn().mockResolvedValue(null) } }));

const { criarCobrancaPixMercadoPagoMock } = vi.hoisted(() => ({
  criarCobrancaPixMercadoPagoMock: vi.fn(),
}));

vi.mock("./mercadoPagoPix", () => ({
  criarCobrancaPixMercadoPago: criarCobrancaPixMercadoPagoMock,
}));

import { anexarPixMercadoPagoEmMensagens, criarPixMetadata, gerarTxidPixInterno, prepararPixProviderMercadoPago, sanitizarPedidoPixResposta, serializarPixCliente } from "./pix";

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("metadados internos de Pix", () => {
  test("gera txid interno deterministico a partir do pedido", () => {
    expect(gerarTxidPixInterno("123")).toBe("chefebot_123");
  });

  test("cria metadados para Pix puro usando o total do pedido", () => {
    expect(criarPixMetadata("123", "Pix", 50)).toEqual({
      txid: "chefebot_123",
      valorEsperado: 50,
      status: "pendente",
    });
  });

  test("cria metadados para Pix hibrido usando apenas a parte Pix", () => {
    expect(criarPixMetadata("123", "Pix (R$ 30,00) + Dinheiro (R$ 20,00)", 50)).toEqual({
      txid: "chefebot_123",
      valorEsperado: 30,
      status: "pendente",
    });
  });

  test("nao cria metadados quando o pagamento nao tem Pix", () => {
    expect(criarPixMetadata("123", "Dinheiro", 50)).toBeUndefined();
  });

  test("PIX_PROVIDER ausente nao chama Mercado Pago", async () => {
    const pix = criarPixMetadata("123", "Pix", 50);

    const resultado = await prepararPixProviderMercadoPago({ pedidoId: "123", pix });

    expect(criarCobrancaPixMercadoPagoMock).not.toHaveBeenCalled();
    expect(resultado).toEqual(pix);
  });

  test("PIX_PROVIDER diferente de mercadopago nao chama Mercado Pago", async () => {
    vi.stubEnv("PIX_PROVIDER", "manual");
    const pix = criarPixMetadata("123", "Pix", 50);

    const resultado = await prepararPixProviderMercadoPago({ pedidoId: "123", pix });

    expect(criarCobrancaPixMercadoPagoMock).not.toHaveBeenCalled();
    expect(resultado).toEqual(pix);
  });

  test("PIX_PROVIDER mercadopago com Pix puro salva dados do provider", async () => {
    vi.stubEnv("PIX_PROVIDER", "mercadopago");
    criarCobrancaPixMercadoPagoMock.mockResolvedValue({
      provider: "mercadopago",
      providerPaymentId: "mp-1",
      qrCode: "copia-e-cola",
      qrCodeBase64: "base64",
      ticketUrl: "https://mp.test/ticket",
      idempotencyKey: "chefebot_pix_chefebot_123",
      statusOriginal: "pending",
    });

    const pix = criarPixMetadata("123", "Pix", 50);
    const resultado = await prepararPixProviderMercadoPago({
      pedidoId: "123",
      pix,
      clienteNome: "Lucas",
      payerEmail: "lucas@example.com",
    });

    expect(criarCobrancaPixMercadoPagoMock).toHaveBeenCalledWith({
      pedidoId: "123",
      txid: "chefebot_123",
      valorEsperado: 50,
      descricao: undefined,
      clienteNome: "Lucas",
      payerEmail: "lucas@example.com",
    });
    expect(resultado).toMatchObject({
      txid: "chefebot_123",
      valorEsperado: 50,
      status: "pendente",
      provider: "mercadopago",
      providerPaymentId: "mp-1",
      qrCode: "copia-e-cola",
      qrCodeBase64: "base64",
      ticketUrl: "https://mp.test/ticket",
      idempotencyKey: "chefebot_pix_chefebot_123",
    });
  });

  test("PIX_PROVIDER mercadopago com Pix hibrido usa somente pix.valorEsperado", async () => {
    vi.stubEnv("PIX_PROVIDER", "mercadopago");
    criarCobrancaPixMercadoPagoMock.mockResolvedValue({
      provider: "mercadopago",
      providerPaymentId: "mp-hibrido",
      qrCode: "qr",
      qrCodeBase64: "base64",
      ticketUrl: "https://mp.test/hibrido",
      idempotencyKey: "chefebot_pix_chefebot_123",
      statusOriginal: "pending",
    });

    const pix = criarPixMetadata("123", "Pix (R$ 30,00) + Dinheiro (R$ 20,00)", 50);
    await prepararPixProviderMercadoPago({ pedidoId: "123", pix });

    expect(criarCobrancaPixMercadoPagoMock).toHaveBeenCalledWith(expect.objectContaining({
      valorEsperado: 30,
    }));
  });

  test("erro do Mercado Pago mantem fallback Pix interno", async () => {
    vi.stubEnv("PIX_PROVIDER", "mercadopago");
    criarCobrancaPixMercadoPagoMock.mockRejectedValue(new Error("mp fora"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const pix = criarPixMetadata("123", "Pix", 50);
    const resultado = await prepararPixProviderMercadoPago({ pedidoId: "123", pix });

    expect(resultado).toEqual(pix);
    expect(resultado?.provider).toBeUndefined();
    warnSpy.mockRestore();
  });

  test("pedido sem Pix nao chama Mercado Pago", async () => {
    vi.stubEnv("PIX_PROVIDER", "mercadopago");

    const resultado = await prepararPixProviderMercadoPago({ pedidoId: "123", pix: undefined });

    expect(resultado).toBeUndefined();
    expect(criarCobrancaPixMercadoPagoMock).not.toHaveBeenCalled();
  });

  test("helper publico retorna Pix somente quando provider e mercadopago e existe qrCode", () => {
    expect(serializarPixCliente(undefined)).toBeUndefined();
    expect(serializarPixCliente({ txid: "tx", valorEsperado: 50, status: "pendente" })).toBeUndefined();
    expect(serializarPixCliente({ provider: "mercadopago", valorEsperado: 50, status: "pendente" })).toBeUndefined();

    expect(serializarPixCliente({
      provider: "mercadopago",
      qrCode: " copia-e-cola ",
      qrCodeBase64: "base64-nao-deve-sair",
      ticketUrl: " https://mp.test/ticket ",
      valorEsperado: 30,
      status: "pendente",
    })).toEqual({
      provider: "mercadopago",
      qrCode: "copia-e-cola",
      ticketUrl: "https://mp.test/ticket",
      valorEsperado: 30,
    });
  });

  test("helper publico nao retorna qrCodeBase64", () => {
    const pixCliente = serializarPixCliente({
      provider: "mercadopago",
      qrCode: "copia-e-cola",
      qrCodeBase64: "base64-nao-deve-sair",
      status: "pendente",
    });

    expect(pixCliente).toEqual({ provider: "mercadopago", qrCode: "copia-e-cola" });
    expect(pixCliente).not.toHaveProperty("qrCodeBase64");
  });

  test("helper de resposta de pedido remove somente qrCodeBase64", () => {
    const pedido = {
      id: "pedido-1",
      pix: {
        provider: "mercadopago" as const,
        providerPaymentId: "mp-1",
        qrCode: "copia-e-cola",
        qrCodeBase64: "base64-nao-deve-sair",
        ticketUrl: "https://mp.test/ticket",
        status: "pendente" as const,
      },
    };

    const sanitizado = sanitizarPedidoPixResposta(pedido);

    expect(sanitizado.pix).toEqual({
      provider: "mercadopago",
      providerPaymentId: "mp-1",
      qrCode: "copia-e-cola",
      ticketUrl: "https://mp.test/ticket",
      status: "pendente",
    });
    expect(sanitizado.pix).not.toHaveProperty("qrCodeBase64");
    expect(pedido.pix.qrCodeBase64).toBe("base64-nao-deve-sair");
  });

  test("WhatsApp mantem mensagem atual quando nao ha Mercado Pago", () => {
    const messages = ["Ótimo! Para finalizar, envie o comprovante do Pix.\n\nChave Pix: (configurada pelo admin)"];

    expect(anexarPixMercadoPagoEmMensagens(messages, undefined)).toBe(messages);
  });

  test("WhatsApp anexa copia e cola quando ha Pix Mercado Pago valido", () => {
    const messages = ["Ótimo! Para finalizar, envie o comprovante do Pix.\n\nChave Pix: (configurada pelo admin)"];

    const resultado = anexarPixMercadoPagoEmMensagens(messages, {
      provider: "mercadopago",
      qrCode: "000201-copia-e-cola",
      ticketUrl: "https://mp.test/ticket",
      valorEsperado: 30,
    });

    expect(resultado[0]).toContain("Chave Pix: (configurada pelo admin)");
    expect(resultado[0]).toContain("Pix Mercado Pago copia e cola");
    expect(resultado[0]).toContain("Valor do Pix: R$ 30,00");
    expect(resultado[0]).toContain("000201-copia-e-cola");
    expect(resultado[0]).toContain("https://mp.test/ticket");
  });
});
