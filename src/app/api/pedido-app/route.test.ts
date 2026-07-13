import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return "OK";
    }),
    incr: vi.fn(async (key: string) => {
      const next = Number(store.get(key) || 0) + 1;
      store.set(key, next);
      return next;
    }),
    expire: vi.fn(async () => 1),
  };
  return { store, redisMock };
});

const { criarCobrancaPixMercadoPagoMock } = vi.hoisted(() => ({
  criarCobrancaPixMercadoPagoMock: vi.fn(),
}));

vi.mock("@/lib/redis", () => ({ redis: redisMock }));
vi.mock("@/lib/mercadoPagoPix", () => ({
  criarCobrancaPixMercadoPago: criarCobrancaPixMercadoPagoMock,
}));

import { POST } from "./route";
import { encryptMercadoPagoToken } from "@/lib/mercadoPagoIntegracao";

function postReq(body: unknown) {
  return {
    json: async () => body,
  } as never;
}

const basePayload = {
  cliente: "Lucas Brito",
  telefone: "(99) 99999-9999",
  itens: [
    {
      kind: "simple",
      name: "Refrigerante 2L",
      detail: "",
      price: 1,
      qty: 2,
    },
  ],
  tipoEntrega: "delivery",
  bairro: "Centro",
  rua: "Rua das Flores",
  numero: "123",
  pagamento: "Pix",
};

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
  criarCobrancaPixMercadoPagoMock.mockResolvedValue({
    provider: "mercadopago",
    providerPaymentId: "mp-123",
    qrCode: "pix-copia-e-cola",
    qrCodeBase64: "base64-pix",
    ticketUrl: "https://mp.test/ticket",
    idempotencyKey: "chefebot_pix_chefebot_123",
    statusOriginal: "pending",
  });
});

describe("POST /api/pedido-app", () => {
  it("rejeita delivery sem bairro", async () => {
    const res = await POST(postReq({
      ...basePayload,
      bairro: "",
    }));

    expect(res.status).toBe(400);
    expect(store.get("pedidos")).toBeUndefined();
  });

  it("rejeita delivery sem rua", async () => {
    const res = await POST(postReq({
      ...basePayload,
      rua: "",
    }));

    expect(res.status).toBe(400);
    expect(store.get("pedidos")).toBeUndefined();
  });

  it("rejeita delivery sem numero", async () => {
    const res = await POST(postReq({
      ...basePayload,
      numero: "",
    }));

    expect(res.status).toBe(400);
    expect(store.get("pedidos")).toBeUndefined();
  });

  it("rejeita dinheiro sem escolher troco", async () => {
    const res = await POST(postReq({
      ...basePayload,
      pagamento: "Dinheiro",
    }));

    expect(res.status).toBe(400);
    expect(store.get("pedidos")).toBeUndefined();
  });

  it("aceita dinheiro com Sem troco", async () => {
    const res = await POST(postReq({
      ...basePayload,
      pagamento: "Dinheiro",
      troco: "Sem troco",
    }));

    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as PedidoSalvo[];
    expect(pedidos[0].troco).toBe("Sem troco");
  });

  it("aceita dinheiro com valor de troco", async () => {
    const res = await POST(postReq({
      ...basePayload,
      pagamento: "Dinheiro",
      troco: "50",
    }));

    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as PedidoSalvo[];
    expect(pedidos[0].troco).toBe("50");
  });

  it("aceita Pix sem troco", async () => {
    const res = await POST(postReq({
      ...basePayload,
      pagamento: "Pix",
      troco: undefined,
    }));

    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as PedidoSalvo[];
    expect(pedidos[0].troco).toBeUndefined();
  });

  it("PIX_PROVIDER ausente nao chama Mercado Pago", async () => {
    const res = await POST(postReq(basePayload));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(criarCobrancaPixMercadoPagoMock).not.toHaveBeenCalled();
    expect(data.pix).toBeUndefined();
  });

  it("Pix manual retorna chave, beneficiario, WhatsApp e token publico de status", async () => {
    store.set("config:pizzaria", {
      nomePizzaria: "Chefe da Pizza",
      chavePix: "99974000691",
      nomeTitularPix: "Kellyne Pizzaria",
      whatsappPizzaria: "(99) 97400-0691",
    });

    const res = await POST(postReq(basePayload));
    const data = await res.json();
    const pedidos = store.get("pedidos") as PedidoSalvo[];

    expect(res.status).toBe(200);
    expect(criarCobrancaPixMercadoPagoMock).not.toHaveBeenCalled();
    expect(typeof data.statusToken).toBe("string");
    expect(pedidos[0].statusToken).toBe(data.statusToken);
    expect(data.pix).toMatchObject({
      provider: "manual",
      chavePix: "99974000691",
      beneficiario: "Kellyne Pizzaria",
      whatsappPizzaria: "5599974000691",
      valorEsperado: 33,
    });
    expect(data.pix.copiaECola).toContain("99974000691");
    expect(data.pix.copiaECola).toMatch(/6304[0-9A-F]{4}$/);
  });

  it("PIX_PROVIDER diferente de mercadopago nao chama Mercado Pago", async () => {
    vi.stubEnv("PIX_PROVIDER", "manual");

    const res = await POST(postReq(basePayload));

    expect(res.status).toBe(200);
    expect(criarCobrancaPixMercadoPagoMock).not.toHaveBeenCalled();
  });

  it("PIX_PROVIDER mercadopago com Pix puro chama adaptador e salva dados do provider", async () => {
    vi.stubEnv("PIX_PROVIDER", "mercadopago");

    const res = await POST(postReq({ ...basePayload, email: "cliente@example.com" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(criarCobrancaPixMercadoPagoMock).toHaveBeenCalledWith(expect.objectContaining({
      pedidoId: expect.any(String),
      txid: expect.stringMatching(/^chefebot_/),
      valorEsperado: 33,
      clienteNome: "Lucas Brito",
      payerEmail: "cliente@example.com",
    }));
    const pedidos = store.get("pedidos") as PedidoSalvo[];
    expect(pedidos[0].pix).toMatchObject({
      provider: "mercadopago",
      providerPaymentId: "mp-123",
      qrCode: "pix-copia-e-cola",
      qrCodeBase64: "base64-pix",
      ticketUrl: "https://mp.test/ticket",
      idempotencyKey: "chefebot_pix_chefebot_123",
      status: "pendente",
      valorEsperado: 33,
    });
    expect(pedidos[0].pixConfirmado).toBeUndefined();
    expect(pedidos[0].status).toBe("novo");
    expect(data.pix).toEqual({
      provider: "mercadopago",
      qrCode: "pix-copia-e-cola",
      ticketUrl: "https://mp.test/ticket",
      valorEsperado: 33,
    });
    expect(data.pix).not.toHaveProperty("qrCodeBase64");
  });

  it("integracao Mercado Pago ativa no painel admin chama adaptador sem depender de PIX_PROVIDER", async () => {
    store.set("integracao:mercadopago", {
      provider: "mercadopago",
      enabled: true,
      accessTokenEncrypted: encryptMercadoPagoToken("token-painel-admin"),
      accessTokenLast4: "dmin",
      payerEmailFallback: "loja@example.com",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const res = await POST(postReq(basePayload));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(criarCobrancaPixMercadoPagoMock).toHaveBeenCalledWith(expect.objectContaining({
      accessTokenOverride: "token-painel-admin",
      payerEmailFallbackOverride: "loja@example.com",
    }));
    const pedidos = store.get("pedidos") as PedidoSalvo[];
    expect(pedidos[0].pix).toMatchObject({ provider: "mercadopago", qrCode: "pix-copia-e-cola" });
    expect(data.pix).toMatchObject({ provider: "mercadopago", qrCode: "pix-copia-e-cola" });
  });

  it("PIX_PROVIDER mercadopago com Pix hibrido usa somente pix.valorEsperado", async () => {
    vi.stubEnv("PIX_PROVIDER", "mercadopago");

    const res = await POST(postReq({
      ...basePayload,
      pagamento: "Pix (R$ 20,00) + Dinheiro (R$ 13,00)",
      troco: "20",
    }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(criarCobrancaPixMercadoPagoMock).toHaveBeenCalledWith(expect.objectContaining({
      valorEsperado: 20,
    }));
    const pedidos = store.get("pedidos") as PedidoSalvo[];
    expect(pedidos[0].total).toBe(33);
    expect(pedidos[0].pix.valorEsperado).toBe(20);
    expect(data.pix.valorEsperado).toBe(20);
  });

  it("rejeita hibrido Pix + Dinheiro sem informar troco", async () => {
    const res = await POST(postReq({
      ...basePayload,
      pagamento: "Pix (R$ 20,00) + Dinheiro (R$ 13,00)",
    }));

    expect(res.status).toBe(400);
    expect(store.get("pedidos")).toBeUndefined();
  });

  it("aceita hibrido Pix + Dinheiro com troco valido sobre a parte em dinheiro", async () => {
    // total 33 (2x Refrigerante 2L + taxa Centro), parte em dinheiro = 13
    const res = await POST(postReq({
      ...basePayload,
      pagamento: "Pix (R$ 20,00) + Dinheiro (R$ 13,00)",
      troco: "20",
    }));

    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as PedidoSalvo[];
    expect(pedidos[0].troco).toBe("20");
  });

  it("rejeita hibrido Pix + Dinheiro com troco menor que a parte em dinheiro", async () => {
    // parte em dinheiro = 13, troco para 10 é insuficiente
    const res = await POST(postReq({
      ...basePayload,
      pagamento: "Pix (R$ 20,00) + Dinheiro (R$ 13,00)",
      troco: "10",
    }));

    expect(res.status).toBe(400);
    expect(store.get("pedidos")).toBeUndefined();
  });

  it("aceita hibrido Pix + Dinheiro com Sem troco", async () => {
    const res = await POST(postReq({
      ...basePayload,
      pagamento: "Pix (R$ 20,00) + Dinheiro (R$ 13,00)",
      troco: "Sem troco",
    }));

    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as PedidoSalvo[];
    expect(pedidos[0].troco).toBe("Sem troco");
  });

  it("erro do Mercado Pago salva pedido com fallback Pix atual", async () => {
    vi.stubEnv("PIX_PROVIDER", "mercadopago");
    criarCobrancaPixMercadoPagoMock.mockRejectedValue(new Error("mp fora"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await POST(postReq(basePayload));
    const data = await res.json();

    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as PedidoSalvo[];
    expect(pedidos[0].pix).toMatchObject({
      txid: expect.stringMatching(/^chefebot_/),
      valorEsperado: 33,
      status: "pendente",
    });
    expect(pedidos[0].pix.provider).toBeUndefined();
    expect(pedidos[0].pixConfirmado).toBeUndefined();
    expect(pedidos[0].status).toBe("novo");
    expect(data.pix).toBeUndefined();
    warnSpy.mockRestore();
  });

  it("pedido sem Pix nao chama Mercado Pago", async () => {
    vi.stubEnv("PIX_PROVIDER", "mercadopago");

    const res = await POST(postReq({
      ...basePayload,
      pagamento: "Cartao",
    }));

    expect(res.status).toBe(200);
    expect(criarCobrancaPixMercadoPagoMock).not.toHaveBeenCalled();
    const pedidos = store.get("pedidos") as PedidoSalvo[];
    expect(pedidos[0].pix).toBeUndefined();
    expect(pedidos[0].status).toBe("novo");
  });

  it("aceita cartao sem troco", async () => {
    const res = await POST(postReq({
      ...basePayload,
      pagamento: "Cartao",
      troco: undefined,
    }));

    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as PedidoSalvo[];
    expect(pedidos[0].troco).toBeUndefined();
  });

  it("recalcula item simples com preco oficial do servidor quando o browser manda preco manipulado", async () => {
    const res = await POST(postReq(basePayload));

    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as PedidoSalvo[];
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].itens).toEqual(["2x Refrigerante 2L"]);
    expect(pedidos[0].taxaEntrega).toBe(3);
    expect(pedidos[0].total).toBe(33);
  });

  it("recalcula pizza com tamanho e borda oficiais mais taxa de entrega", async () => {
    const res = await POST(postReq({
      ...basePayload,
      itens: [
        {
          kind: "pizza",
          name: "Pizza G",
          detail: "Calabresa · borda Catupiry",
          price: 1,
          qty: 1,
        },
      ],
    }));

    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as PedidoSalvo[];
    expect(pedidos[0].itens).toEqual(["Pizza G Calabresa · borda Catupiry"]);
    expect(pedidos[0].taxaEntrega).toBe(3);
    expect(pedidos[0].total).toBe(63);
  });

  it("retirada nao cobra taxa e ainda ignora preco manipulado", async () => {
    const res = await POST(postReq({
      ...basePayload,
      tipoEntrega: "retirada",
      bairro: undefined,
      rua: undefined,
      numero: undefined,
      pagamento: "Dinheiro",
      troco: "50",
    }));

    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as PedidoSalvo[];
    expect(pedidos[0].endereco).toBe("Retirada na loja");
    expect(pedidos[0].taxaEntrega).toBeUndefined();
    expect(pedidos[0].total).toBe(30);
    expect(pedidos[0].troco).toBe("50");
  });

  it("consumo no local nao cobra taxa e ainda ignora preco manipulado", async () => {
    const res = await POST(postReq({
      ...basePayload,
      tipoEntrega: "dine_in",
      bairro: undefined,
      rua: undefined,
      numero: undefined,
      pagamento: "Cartao",
    }));

    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as PedidoSalvo[];
    expect(pedidos[0].endereco).toBe("Consumo no local");
    expect(pedidos[0].taxaEntrega).toBeUndefined();
    expect(pedidos[0].total).toBe(30);
  });


  it("aceita lanche simples com preco oficial mesmo se o browser manda preco manipulado", async () => {
    const res = await POST(postReq({
      ...basePayload,
      itens: [{ kind: "simple", name: "X-Burguer", detail: "", price: 1, qty: 1 }],
    }));

    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as PedidoSalvo[];
    expect(pedidos[0].itens).toEqual(["X-Burguer"]);
    expect(pedidos[0].total).toBe(18);
  });

  it("aceita suco com leite usando preco oficial mais adicional mesmo se o browser manda preco manipulado", async () => {
    const res = await POST(postReq({
      ...basePayload,
      itens: [{ kind: "simple", name: "Caja", detail: "Com leite", price: 1, qty: 1 }],
    }));

    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as PedidoSalvo[];
    expect(pedidos[0].itens).toEqual(["Caja Com leite"]);
    expect(pedidos[0].taxaEntrega).toBe(3);
    expect(pedidos[0].total).toBe(11);
  });

  it("aceita suco sem leite usando preco base oficial", async () => {
    const res = await POST(postReq({
      ...basePayload,
      itens: [{ kind: "simple", name: "Caja", detail: "Sem leite", price: 1, qty: 1 }],
    }));

    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as PedidoSalvo[];
    expect(pedidos[0].itens).toEqual(["Caja Sem leite"]);
    expect(pedidos[0].total).toBe(10);
  });

  it("rejeita suco com detail invalido", async () => {
    const res = await POST(postReq({
      ...basePayload,
      itens: [{ kind: "simple", name: "Caja", detail: "Pouco leite", price: 8, qty: 1 }],
    }));

    expect(res.status).toBe(400);
    expect(store.get("pedidos")).toBeUndefined();
  });
  it("aceita macarronada P com preco oficial mesmo se o browser manda preco manipulado", async () => {
    const res = await POST(postReq({
      ...basePayload,
      itens: [{ kind: "simple", name: "Macarronada de Carne", detail: "Tamanho P", price: 1, qty: 1 }],
    }));

    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as PedidoSalvo[];
    expect(pedidos[0].itens).toEqual(["Macarronada de Carne Tamanho P"]);
    expect(pedidos[0].taxaEntrega).toBe(3);
    expect(pedidos[0].total).toBe(31);
  });

  it("aceita macarronada M e G com precos oficiais", async () => {
    const resM = await POST(postReq({
      ...basePayload,
      itens: [{ kind: "simple", name: "Macarronada de Frango", detail: "Tamanho M", price: 1, qty: 1 }],
    }));
    expect(resM.status).toBe(200);
    expect((store.get("pedidos") as PedidoSalvo[])[0].total).toBe(43);

    store.clear();
    const resG = await POST(postReq({
      ...basePayload,
      itens: [{ kind: "simple", name: "Macarronada de Frango", detail: "Tamanho G", price: 1, qty: 1 }],
    }));
    expect(resG.status).toBe(200);
    expect((store.get("pedidos") as PedidoSalvo[])[0].total).toBe(53);
  });

  it("rejeita macarronada sem tamanho", async () => {
    const res = await POST(postReq({
      ...basePayload,
      itens: [{ kind: "simple", name: "Macarronada de Carne", detail: "", price: 1, qty: 1 }],
    }));

    expect(res.status).toBe(400);
    expect(store.get("pedidos")).toBeUndefined();
  });

  it("rejeita macarronada com tamanho invalido", async () => {
    const res = await POST(postReq({
      ...basePayload,
      itens: [{ kind: "simple", name: "Macarronada de Carne", detail: "Tamanho X", price: 1, qty: 1 }],
    }));

    expect(res.status).toBe(400);
    expect(store.get("pedidos")).toBeUndefined();
  });
  it("rejeita item que nao existe no cardapio oficial", async () => {
    const res = await POST(postReq({
      ...basePayload,
      itens: [{ kind: "simple", name: "Produto Fake", detail: "", price: 1, qty: 1 }],
    }));

    expect(res.status).toBe(400);
    expect(store.get("pedidos")).toBeUndefined();
  });
});
