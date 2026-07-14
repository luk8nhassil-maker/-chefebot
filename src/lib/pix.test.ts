import { beforeEach, vi, describe, test, expect } from "vitest";

const { criarCobrancaPixMercadoPagoMock, redisGetMock } = vi.hoisted(() => ({
  criarCobrancaPixMercadoPagoMock: vi.fn(),
  redisGetMock: vi.fn().mockResolvedValue(null),
}));

vi.mock("./redis", () => ({ redis: { get: redisGetMock } }));

vi.mock("./mercadoPagoPix", () => ({
  criarCobrancaPixMercadoPago: criarCobrancaPixMercadoPagoMock,
}));

import { anexarPixMercadoPagoEmMensagens, clientePediuChavePixManual, criarPixMetadata, gerarTxidPixInterno, montarMensagensChavePixManual, montarMensagensPixMercadoPagoWhatsApp, prepararPixProviderMercadoPago, sanitizarPedidoPixResposta, serializarPixCliente } from "./pix";
import { encryptMercadoPagoToken } from "./mercadoPagoIntegracao";

function configAdminAtiva(overrides?: { accessToken?: string; payerEmailFallback?: string }) {
  return {
    provider: "mercadopago" as const,
    enabled: true,
    accessTokenEncrypted: encryptMercadoPagoToken(overrides?.accessToken || "token-admin-123"),
    accessTokenLast4: "1123",
    ...(overrides?.payerEmailFallback ? { payerEmailFallback: overrides.payerEmailFallback } : {}),
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  redisGetMock.mockResolvedValue(null);
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

  test("integracao admin ativa com token salvo chama Mercado Pago mesmo sem PIX_PROVIDER", async () => {
    redisGetMock.mockResolvedValue(configAdminAtiva({ payerEmailFallback: "loja@example.com" }));
    criarCobrancaPixMercadoPagoMock.mockResolvedValue({
      provider: "mercadopago",
      providerPaymentId: "mp-admin",
      qrCode: "copia-e-cola-admin",
      qrCodeBase64: "base64",
      ticketUrl: "https://mp.test/admin",
      idempotencyKey: "chefebot_pix_chefebot_123",
      statusOriginal: "pending",
    });

    const pix = criarPixMetadata("123", "Pix", 50);
    const resultado = await prepararPixProviderMercadoPago({ pedidoId: "123", pix });

    expect(criarCobrancaPixMercadoPagoMock).toHaveBeenCalledWith(expect.objectContaining({
      accessTokenOverride: "token-admin-123",
      payerEmailFallbackOverride: "loja@example.com",
    }));
    expect(resultado).toMatchObject({ provider: "mercadopago", qrCode: "copia-e-cola-admin" });
  });

  test("integracao admin desativada e sem env nao chama Mercado Pago", async () => {
    redisGetMock.mockResolvedValue({
      provider: "mercadopago",
      enabled: false,
      accessTokenEncrypted: encryptMercadoPagoToken("token-desativado"),
      accessTokenLast4: "vado",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

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
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const pix = criarPixMetadata("123", "Pix", 50);
    const resultado = await prepararPixProviderMercadoPago({ pedidoId: "123", pix });

    expect(resultado).toEqual(pix);
    expect(resultado?.provider).toBeUndefined();
    // Nivel 6.7: erro estruturado com pedidoId e motivo, sem expor token.
    expect(errorSpy).toHaveBeenCalledWith(
      "[Pix] Falha ao criar cobranca Mercado Pago — usando Pix manual",
      { pedidoId: "123", motivo: "mp fora" }
    );
    errorSpy.mockRestore();
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

  test("helper publico retorna Pix manual com chave, beneficiario e copia e cola local", () => {
    const pixCliente = serializarPixCliente(
      { txid: "chefebot_123", valorEsperado: 30, status: "pendente" },
      {
        chavePix: "99974000691",
        nomeTitularPix: "Kellyne Pizzaria",
        whatsappPizzaria: "(99) 97400-0691",
      }
    );

    expect(pixCliente).toMatchObject({
      provider: "manual",
      chavePix: "99974000691",
      beneficiario: "Kellyne Pizzaria",
      whatsappPizzaria: "5599974000691",
      valorEsperado: 30,
    });
    expect(pixCliente?.copiaECola).toContain("99974000691");
    expect(pixCliente?.copiaECola).toMatch(/6304[0-9A-F]{4}$/);
  });

  test("helper publico com Pix manual sem titular retorna so chave e nao gera copia e cola", () => {
    const pixCliente = serializarPixCliente(
      { txid: "chefebot_123", valorEsperado: 30, status: "pendente" },
      { chavePix: "99974000691" }
    );

    expect(pixCliente).toEqual({
      provider: "manual",
      chavePix: "99974000691",
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

  test("montarMensagensPixMercadoPagoWhatsApp retorna undefined sem Pix Mercado Pago valido", () => {
    expect(montarMensagensPixMercadoPagoWhatsApp(undefined)).toBeUndefined();
    expect(montarMensagensPixMercadoPagoWhatsApp({ provider: "manual", chavePix: "123" })).toBeUndefined();
    expect(montarMensagensPixMercadoPagoWhatsApp({ provider: "mercadopago" })).toBeUndefined();
  });

  test("montarMensagensPixMercadoPagoWhatsApp retorna exatamente 4 mensagens, com o payload isolado na segunda", () => {
    const mensagens = montarMensagensPixMercadoPagoWhatsApp({
      provider: "mercadopago",
      qrCode: "000201010212...copia-e-cola-completo...6304ABCD",
      valorEsperado: 30,
    });

    expect(mensagens).toHaveLength(4);
    // Mensagem 1: aviso, sem o payload, com o emoji 👇 indicando o próximo passo.
    expect(mensagens![0]).toContain("Pagamento via Pix");
    expect(mensagens![0]).toContain("só será liberado após a confirmação do pagamento");
    expect(mensagens![0]).toContain("👇");
    expect(mensagens![0]).not.toContain("000201010212");
    // Mensagem 2: SOMENTE o payload, nada mais.
    expect(mensagens![1]).toBe("000201010212...copia-e-cola-completo...6304ABCD");
    // Mensagem 3: instrução final, curta e direta, sem o payload.
    expect(mensagens![2]).toBe("Copie o código acima e pague no app do seu banco.\n\nPagamento confirmado, pedido liberado automaticamente ✅");
    expect(mensagens![2]).not.toContain("000201010212");
    // Mensagem 4: convite discreto ao fallback de chave Pix manual.
    expect(mensagens![3]).toContain("Se preferir a chave Pix");
    expect(mensagens![3]).toContain("envie o comprovante");
  });
});

describe("fallback opcional de chave Pix manual (Nível 6.7B)", () => {
  test("clientePediuChavePixManual detecta pedidos explicitos pela chave", () => {
    expect(clientePediuChavePixManual("quero a chave pix")).toBe(true);
    expect(clientePediuChavePixManual("prefiro a chave")).toBe(true);
    expect(clientePediuChavePixManual("me manda a chave por favor")).toBe(true);
    expect(clientePediuChavePixManual("não está copiando o código")).toBe(true);
    expect(clientePediuChavePixManual("Chave Pix, por favor")).toBe(true);
  });

  test("clientePediuChavePixManual nao reconhece mensagens sem pedido explicito", () => {
    expect(clientePediuChavePixManual("oi")).toBe(false);
    expect(clientePediuChavePixManual("já paguei")).toBe(false);
    expect(clientePediuChavePixManual("obrigado")).toBe(false);
  });

  test("montarMensagensChavePixManual retorna nome, chave e instrucao de comprovante, em mensagens separadas", () => {
    const mensagens = montarMensagensChavePixManual({
      chavePix: "99984430294",
      nomeTitularPix: "Chefe da Pizza",
    });

    expect(mensagens).toHaveLength(3);
    expect(mensagens![0]).toBe("Nome: Chefe da Pizza");
    expect(mensagens![1]).toBe("Chave Pix: 99984430294");
    expect(mensagens![2]).toBe("Envie o comprovante aqui na conversa para confirmar seu pedido.");
  });

  test("montarMensagensChavePixManual usa nomePizzaria quando nao ha nomeTitularPix configurado", () => {
    const mensagens = montarMensagensChavePixManual({
      chavePix: "99984430294",
      nomePizzaria: "Chefe da Pizza",
    });

    expect(mensagens![0]).toBe("Nome: Chefe da Pizza");
  });

  test("montarMensagensChavePixManual retorna undefined sem chave Pix configurada", () => {
    expect(montarMensagensChavePixManual({})).toBeUndefined();
    expect(montarMensagensChavePixManual({ chavePix: "" })).toBeUndefined();
  });
});
