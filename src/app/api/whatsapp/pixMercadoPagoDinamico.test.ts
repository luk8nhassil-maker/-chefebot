import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Nível 6.7 — pedido WhatsApp com Pix deve gerar cobrança Mercado Pago dinâmica
// (provider mercadopago, providerPaymentId, txid, valorEsperado, copia-e-cola)
// e enviar o payload completo ao cliente, em vez de só a chave Pix estática.
// Cobre especificamente o fluxo de retirada (finalizarPedidoPickup, em bot.ts),
// que fecha o pedido direto sem passar pelo step "confirm" — a causa raiz real
// do pedido #17 (Lucas, R$ 1,00): salvarPedido() só era chamado quando o
// comprovante chegava, tarde demais para o cliente ver o Pix dinâmico.
// ─────────────────────────────────────────────────────────────────────────────

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    incr: vi.fn(async (key: string) => {
      const atual = (store.get(key) as number) || 0;
      const novo = atual + 1;
      store.set(key, novo);
      return novo;
    }),
    expire: vi.fn(async () => 1),
    keys: vi.fn(async () => []),
    eval: vi.fn(async () => 0),
  };
  return { store, redisMock };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));

const { criarCobrancaPixMercadoPagoMock } = vi.hoisted(() => ({
  criarCobrancaPixMercadoPagoMock: vi.fn(),
}));

vi.mock("@/lib/mercadoPagoPix", () => ({
  criarCobrancaPixMercadoPago: criarCobrancaPixMercadoPagoMock,
}));

import { POST } from "./route";
import type { BotSession, CartItem } from "@/lib/bot";

const PHONE = "5599974000691";

function webhook(texto: string) {
  return {
    json: async () => ({
      event: "messages.upsert",
      data: {
        key: { remoteJid: `${PHONE}@s.whatsapp.net`, id: `id-${Math.random()}`, fromMe: false },
        message: { conversation: texto },
      },
    }),
  } as never;
}

function itemTeste(price: number): CartItem {
  return { category: "pizza", name: "Pizza Teste", price };
}

function sessaoAguardandoPagamento(overrides: Partial<BotSession> = {}): BotSession {
  return {
    step: "payment",
    cart: [itemTeste(1)],
    deliveryFee: 0,
    customerName: "Lucas",
    deliveryType: "pickup",
    tentativasInvalidas: 0,
    ...overrides,
  } as BotSession;
}

type PedidoSalvo = {
  origem?: string;
  pix: {
    provider?: "mercadopago";
    providerPaymentId?: string;
    txid?: string;
    valorEsperado?: number;
    qrCode?: string;
    status?: string;
  };
};

function pedidosSalvos(): PedidoSalvo[] {
  return (store.get("pedidos") as PedidoSalvo[]) || [];
}

// Extrai, em ordem, o texto de cada chamada sendText feita ao Evolution API —
// usado para validar quantas mensagens o bot mandou e o conteúdo de cada uma.
function textosSendTextEnviados(): string[] {
  const chamadas = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][];
  return chamadas
    .filter((call) => typeof call[0] === "string" && call[0].includes("sendText"))
    .map((call) => JSON.parse(call[1].body as string).text as string);
}

function cobranca(overrides: Record<string, unknown> = {}) {
  return {
    provider: "mercadopago" as const,
    providerPaymentId: "MP-987",
    qrCode: "000201010212...copia-e-cola-completo...6304ABCD",
    qrCodeBase64: "base64img",
    ticketUrl: "https://mp.example/ticket",
    idempotencyKey: "chefebot_pix_chefebot_x",
    statusOriginal: "pending",
    ...overrides,
  };
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("EVOLUTION_API_URL", "https://evolution.exemplo.com");
  vi.stubEnv("EVOLUTION_API_KEY", "chave-teste");
  // Resolve tudo com sucesso: cobre sendText (mensagem ao cliente) e o fetch
  // best-effort de Web Push dentro de salvarPedido (que já é isolado em try/catch).
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  store.set(`session:${PHONE}`, sessaoAguardandoPagamento());
  store.set("config:pizzaria", {
    nomePizzaria: "Chefe da Pizza",
    horaAbertura: 0,
    horaFechamento: 23,
    chavePix: "99984430294",
    nomeTitularPix: "Chefe da Pizza",
    limitePico: 0,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Nível 6.7 — Pix dinâmico Mercado Pago no fluxo de retirada (pickup)", () => {
  test("Mercado Pago ativo: pedido salvo com provider mercadopago, providerPaymentId, txid, valorEsperado e copia-e-cola", async () => {
    vi.stubEnv("PIX_PROVIDER", "mercadopago");
    criarCobrancaPixMercadoPagoMock.mockResolvedValue(cobranca());

    await POST(webhook("Pix"));

    const pedidos = pedidosSalvos();
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].origem).toBe("whatsapp");
    expect(pedidos[0].pix).toMatchObject({
      provider: "mercadopago",
      providerPaymentId: "MP-987",
      txid: expect.stringContaining("chefebot_"),
      valorEsperado: 1,
      qrCode: "000201010212...copia-e-cola-completo...6304ABCD",
    });
  });

  test("mensagem com o payload Pix completo contém o código (não só a chave estática)", async () => {
    vi.stubEnv("PIX_PROVIDER", "mercadopago");
    criarCobrancaPixMercadoPagoMock.mockResolvedValue(cobranca());

    await POST(webhook("Pix"));

    const textosEnviados = textosSendTextEnviados();
    const mensagemComPayload = textosEnviados.find((texto) => texto.includes("000201010212...copia-e-cola-completo...6304ABCD"));
    expect(mensagemComPayload).toBeDefined();
    expect(mensagemComPayload).not.toBe("Chave Pix: 99984430294");
    expect(pedidosSalvos()[0].pix.provider).toBe("mercadopago");
  });

  test("Nível 6.7A: envia exatamente 3 mensagens separadas, na ordem correta, com o payload isolado na segunda", async () => {
    vi.stubEnv("PIX_PROVIDER", "mercadopago");
    criarCobrancaPixMercadoPagoMock.mockResolvedValue(cobranca());

    await POST(webhook("Pix"));

    const textosEnviados = textosSendTextEnviados();
    expect(textosEnviados).toHaveLength(3);

    // Mensagem 1: aviso — pedido só liberado após confirmação, sem o payload.
    expect(textosEnviados[0]).toContain("Pagamento via Pix");
    expect(textosEnviados[0]).toContain("só será liberado após a confirmação do pagamento");
    expect(textosEnviados[0]).not.toContain("000201010212");

    // Mensagem 2: SOMENTE o payload Pix, nada mais — fácil de copiar.
    expect(textosEnviados[1]).toBe("000201010212...copia-e-cola-completo...6304ABCD");

    // Mensagem 3: instrução final, sem o payload.
    expect(textosEnviados[2]).toContain("Copie o código acima");
    expect(textosEnviados[2]).toContain("liberado automaticamente");
    expect(textosEnviados[2]).not.toContain("000201010212");
  });

  test("falha do Mercado Pago cai no Pix manual e mantém o pedido pedindo comprovante", async () => {
    vi.stubEnv("PIX_PROVIDER", "mercadopago");
    criarCobrancaPixMercadoPagoMock.mockRejectedValue(new Error("mp indisponivel"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await POST(webhook("Pix"));

    const pedidos = pedidosSalvos();
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].pix.provider).toBeUndefined();
    expect(pedidos[0].pix.status).toBe("pendente");
    expect(pedidos[0].pix.txid).toContain("chefebot_");
    // Erro estruturado com pedidoId, sem token.
    expect(errorSpy).toHaveBeenCalledWith(
      "[Pix] Falha ao criar cobranca Mercado Pago — usando Pix manual",
      expect.objectContaining({ pedidoId: expect.any(String), motivo: "mp indisponivel" })
    );
    // Fallback manual: continua pedindo comprovante, nunca finge automação —
    // mensagem única (não as 3 do fluxo dinâmico) com a chave estática do admin.
    const textosEnviados = textosSendTextEnviados();
    expect(textosEnviados).toHaveLength(1);
    expect(textosEnviados[0]).toContain("envie o comprovante do Pix");
    expect(textosEnviados[0]).toContain("Chave Pix: 99984430294");
    errorSpy.mockRestore();
  });

  test("Mercado Pago inativo (sem integração): cai no Pix manual sem erro (fallback esperado)", async () => {
    // PIX_PROVIDER não setado e sem config admin — resolveActiveMercadoPagoAuth().active === false.
    criarCobrancaPixMercadoPagoMock.mockResolvedValue(cobranca());
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await POST(webhook("Pix"));

    expect(criarCobrancaPixMercadoPagoMock).not.toHaveBeenCalled();
    const pedidos = pedidosSalvos();
    expect(pedidos[0].pix.provider).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      "[Pix] Mercado Pago nao configurado/ativo — usando Pix manual",
      expect.objectContaining({ pedidoId: expect.any(String) })
    );
    warnSpy.mockRestore();
  });

  test("pagamento híbrido (Pix + Dinheiro) na retirada preserva o valor parcial correto do Pix", async () => {
    vi.stubEnv("PIX_PROVIDER", "mercadopago");
    criarCobrancaPixMercadoPagoMock.mockResolvedValue(cobranca());
    store.set(`session:${PHONE}`, sessaoAguardandoPagamento({
      step: "troco",
      cart: [itemTeste(1.5)],
      paymentMethod: "Pix (R$ 1,00) + Dinheiro (R$ 0,50)",
    }));

    await POST(webhook("não"));

    const pedidos = pedidosSalvos();
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].pix.valorEsperado).toBe(1);
    expect(criarCobrancaPixMercadoPagoMock).toHaveBeenCalledWith(
      expect.objectContaining({ valorEsperado: 1 })
    );
  });

  test("pedido criado uma única vez mesmo que a sessão permaneça em aguardando_pix em turnos seguintes", async () => {
    vi.stubEnv("PIX_PROVIDER", "mercadopago");
    criarCobrancaPixMercadoPagoMock.mockResolvedValue(cobranca());

    await POST(webhook("Pix"));
    expect(pedidosSalvos()).toHaveLength(1);

    // Cliente manda outra mensagem enquanto aguardando_pix (ex.: "oi") — não deve
    // criar um segundo pedido nem chamar o Mercado Pago de novo.
    await POST(webhook("oi"));

    expect(pedidosSalvos()).toHaveLength(1);
    expect(criarCobrancaPixMercadoPagoMock).toHaveBeenCalledTimes(1);
  });
});
