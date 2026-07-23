import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, redisMock, defaultSetImpl, defaultGetImpl } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  // Respeita semântica NX real (SET NX falha se a chave já existe) — sem
  // isso, um teste de corrida com o mock passaria mesmo com um bug real de
  // "check-then-set" na rota. Extraído como função nomeada (não só inline no
  // vi.fn) para que testes que substituem temporariamente a implementação
  // (ex.: simular falha do Redis num ponto específico) consigam restaurar
  // o comportamento padrão depois, sem vazar estado para outros testes.
  const defaultSetImpl = async (key: string, value: unknown, opts?: { nx?: boolean }) => {
    if (opts?.nx && store.has(key)) return null;
    store.set(key, value);
    return "OK";
  };
  const defaultGetImpl = async (key: string) => store.get(key) ?? null;
  const redisMock = {
    get: vi.fn(defaultGetImpl),
    set: vi.fn(defaultSetImpl),
    del: vi.fn(async (key: string) => {
      const existia = store.has(key);
      store.delete(key);
      return existia ? 1 : 0;
    }),
    incr: vi.fn(async (key: string) => {
      const next = Number(store.get(key) || 0) + 1;
      store.set(key, next);
      return next;
    }),
    expire: vi.fn(async () => 1),
    // Simula os TRÊS scripts Lua reais usados pela rota, dispatch por
    // keys.length + args.length (as duas chaves de result/invalidação têm o
    // mesmo número de KEYS, mas número de ARGV diferente):
    // - 1 chave: LIBERAR_CLAIM_SE_DONO_SCRIPT — só apaga KEYS[0] se o valor
    //   atual for exatamente ARGV[0] (compare-and-delete simples).
    // - 2 chaves + 3 args: GRAVAR_RESULTADO_E_TOKEN_SCRIPT — grava
    //   KEYS[0]=registro (JSON, ARGV[0]) e KEYS[1]=token (ARGV[1]) juntos.
    // - 2 chaves + 1 arg: INVALIDAR_RESULTADO_SE_TOKEN_SCRIPT —
    //   compare-and-delete atômico da chave-token (KEYS[0]) + registro
    //   principal (KEYS[1]), devolvendo
    //   "removido"/"ja_ausente"/"incerto"/"substituido_por_outro".
    eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
      if (keys.length === 2 && args.length === 3) {
        const [chaveResultado, chaveToken] = keys;
        const [registroJson, token] = args;
        store.set(chaveResultado, JSON.parse(registroJson));
        store.set(chaveToken, token);
        return 1;
      }
      if (keys.length === 2) {
        const [chaveToken, chaveResultado] = keys;
        const [tokenEsperado] = args;
        const tokenAtual = store.has(chaveToken) ? store.get(chaveToken) : undefined;
        const resultadoAtual = store.has(chaveResultado) ? store.get(chaveResultado) : undefined;
        if (tokenAtual === undefined && resultadoAtual === undefined) return "ja_ausente";
        if (resultadoAtual === undefined) {
          store.delete(chaveToken);
          return "ja_ausente";
        }
        if (tokenAtual === undefined) return "incerto";
        if (tokenAtual === tokenEsperado) {
          store.delete(chaveToken);
          store.delete(chaveResultado);
          return "removido";
        }
        return "substituido_por_outro";
      }
      const [chave] = keys;
      const [valorEsperado] = args;
      if (store.get(chave) === valorEsperado) {
        store.delete(chave);
        return 1;
      }
      return 0;
    }),
  };
  return { store, redisMock, defaultSetImpl, defaultGetImpl };
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
  redisMock.set.mockImplementation(defaultSetImpl);
  redisMock.get.mockImplementation(defaultGetImpl);
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
  it("aceita calzone com 1 sabor salgado usando preco oficial do cardapio", async () => {
    const res = await POST(postReq({
      ...basePayload,
      itens: [{ kind: "simple", name: "Calzone", detail: "Sabor: Calabresa", price: 1, qty: 1 }],
    }));

    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as PedidoSalvo[];
    expect(pedidos[0].itens).toEqual(["Calzone Sabor: Calabresa"]);
    expect(pedidos[0].total).toBe(38);
  });

  it("aceita calzone com sabor doce — mesma lista de sabores da pizza, nao um subconjunto proprio", async () => {
    const res = await POST(postReq({
      ...basePayload,
      itens: [{ kind: "simple", name: "Calzone", detail: "Sabor: Chocolate", price: 1, qty: 1 }],
    }));

    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as PedidoSalvo[];
    expect(pedidos[0].total).toBe(38);
  });

  it("rejeita calzone adulterado com 2 sabores (meio a meio nao existe para calzone)", async () => {
    const res = await POST(postReq({
      ...basePayload,
      itens: [{ kind: "simple", name: "Calzone", detail: "Sabor: Calabresa / Portuguesa", price: 1, qty: 1 }],
    }));

    expect(res.status).toBe(400);
    expect(store.get("pedidos")).toBeUndefined();
  });

  it("rejeita calzone sem sabor", async () => {
    const res = await POST(postReq({
      ...basePayload,
      itens: [{ kind: "simple", name: "Calzone", detail: "", price: 1, qty: 1 }],
    }));

    expect(res.status).toBe(400);
    expect(store.get("pedidos")).toBeUndefined();
  });

  it("rejeita calzone com sabor inventado (fora da lista oficial de sabores)", async () => {
    const res = await POST(postReq({
      ...basePayload,
      itens: [{ kind: "simple", name: "Calzone", detail: "Sabor: Sabor Que Nao Existe", price: 1, qty: 1 }],
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

describe("POST /api/pedido-app — idempotência (Modo Sobrevivência)", () => {
  // Todo clientRequestId de teste tem >=16 caracteres — o mínimo exigido por
  // sanitizeClientRequestId (proteção contra força bruta/baixa entropia).

  function chaveClaim(id: string) {
    return `survival:idempotencia:pedido:${id}:claim`;
  }
  function chaveResultado(id: string) {
    return `survival:idempotencia:pedido:${id}:result`;
  }

  it("[cenário 1] primeiro pedido é criado normalmente, com a flag ligada e clientRequestId válido", async () => {
    vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
    const clientRequestId = "primeiro-pedido-normal-001";
    const res = await POST(postReq({ ...basePayload, clientRequestId }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.pedidoId).toBeTruthy();
    expect((store.get("pedidos") as unknown[]).length).toBe(1);
    // O claim é liberado ao final (best-effort) — o registro durável de
    // resultado é a única fonte que sobra, nunca o claim.
    expect(store.has(chaveClaim(clientRequestId))).toBe(false);
    expect(store.has(chaveResultado(clientRequestId))).toBe(true);
  });

  it("com a flag desligada (padrão), clientRequestId é ignorado e dois envios criam dois pedidos", async () => {
    const payload = { ...basePayload, clientRequestId: "retry-abc123456789012" };
    const r1 = await POST(postReq(payload));
    const r2 = await POST(postReq(payload));
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const body1 = await r1.json();
    const body2 = await r2.json();
    expect(body1.pedidoId).not.toBe(body2.pedidoId);
    expect((store.get("pedidos") as unknown[]).length).toBe(2);
  });

  it("[cenário 2/3] reenviar o mesmo clientRequestId + mesmo payload (retry após timeout de rede) devolve o pedido já criado, reconstruído a partir do dado FRESCO, sem duplicar", async () => {
    vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
    const payload = { ...basePayload, clientRequestId: "retry-abc123456789012" };

    const r1 = await POST(postReq(payload));
    expect(r1.status).toBe(200);
    const body1 = await r1.json();
    expect((store.get("pedidos") as unknown[]).length).toBe(1);

    // Muda a config da pizzaria ENTRE a criação original e o retry — prova
    // que a resposta do retry é reconstruída na hora (nunca um Pix/valor
    // cacheado às cegas, ver ponto 6 da revisão): o novo whatsappPizzaria
    // deve aparecer no Pix reconstruído.
    store.set("config:pizzaria", { chavePix: "nova-chave-pix", nomeTitularPix: "Novo Titular", whatsappPizzaria: "5599888887777" });

    // Simula o cliente reenviando porque não recebeu a resposta original
    // (timeout do fetch) — mesmo clientRequestId, mesmo payload.
    const r2 = await POST(postReq(payload));
    expect(r2.status).toBe(200);
    const body2 = await r2.json();

    expect(body2.pedidoId).toBe(body1.pedidoId);
    expect(body2.numero).toBe(body1.numero);
    expect(body2.statusToken).toBe(body1.statusToken);
    expect(body2.total).toBe(body1.total);
    expect((store.get("pedidos") as unknown[]).length).toBe(1);
  });

  it("[cenário 6] duas requisições com o MESMO clientRequestId chegando simultaneamente nunca criam dois pedidos (claim atômico SET NX)", async () => {
    vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
    const payload = { ...basePayload, clientRequestId: "concorrencia-simultanea-x1" };

    const [r1, r2] = await Promise.all([POST(postReq(payload)), POST(postReq(payload))]);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const body1 = await r1.json();
    const body2 = await r2.json();
    // A requisição que perdeu a corrida pelo claim nunca cria um pedido —
    // ou recebe o mesmo resultado (via polling) ou um 409 pedindo para
    // aguardar; neste teste a criação é rápida o bastante (só mocks, sem
    // timers reais no caminho feliz) para o polling encontrar o resultado.
    expect(body1.pedidoId).toBe(body2.pedidoId);
    expect((store.get("pedidos") as unknown[]).length).toBe(1);
  }, 10_000);

  describe("[ponto 1] claim com resultado incerto — nunca prossegue sem proteção", () => {
    it("SET NX do claim lança exceção (pode ou não ter aplicado no servidor): NÃO cria pedido, devolve resposta recuperável 503", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      const clientRequestId = "claim-timeout-no-set-nx-1";
      redisMock.set.mockImplementationOnce(async () => {
        throw new Error("Timeout de rede (simulado) — resultado do SET NX desconhecido");
      });

      const res = await POST(postReq({ ...basePayload, clientRequestId }));

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.unresolved).toBe(true);
      expect(store.get("pedidos")).toBeUndefined();
      expect(store.has(chaveResultado(clientRequestId))).toBe(false);
    });

    it("SET NX retorna null (chave já existe) e o GET seguinte falha: NÃO cria pedido, devolve resposta recuperável 503", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      const clientRequestId = "claim-existe-get-falha-1";
      // Simula que já existe uma reivindicação (SET NX vai falhar
      // naturalmente), e o GET de inspeção subsequente lança.
      store.set(chaveClaim(clientRequestId), "algum-dono::" + "a".repeat(64));
      redisMock.get.mockImplementation(async (key: string) => {
        if (key === chaveClaim(clientRequestId)) throw new Error("Redis indisponível (simulado) — leitura do claim");
        return defaultGetImpl(key);
      });

      const res = await POST(postReq({ ...basePayload, clientRequestId }));

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.unresolved).toBe(true);
      expect(store.get("pedidos")).toBeUndefined();
    });

    it("leitura do resultado durável (fast path) falha: NÃO cria pedido, devolve resposta recuperável 503", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      const clientRequestId = "leitura-resultado-falha-1";
      redisMock.get.mockImplementation(async (key: string) => {
        if (key === chaveResultado(clientRequestId)) throw new Error("Redis indisponível (simulado) — leitura do resultado");
        return defaultGetImpl(key);
      });

      const res = await POST(postReq({ ...basePayload, clientRequestId }));

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.unresolved).toBe(true);
      expect(store.get("pedidos")).toBeUndefined();
    });

    it("distingue claramente 'claim de outra execução' (409, mesmo fingerprint, ainda processando) de 'resultado incerto' (503)", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      const clientRequestId = "distincao-incerto-vs-processando-1";
      const fingerprintPlaceholder = "0".repeat(64); // valor arbitrário só para o formato

      // "outra execução possui o claim" — formato válido, sem erro de leitura.
      store.set(chaveClaim(clientRequestId), `outro-dono::${fingerprintPlaceholder}`);
      // Fingerprint real desta tentativa não bate com o placeholder acima —
      // portanto é tratado como CONFLITO (409 genérico), não "processando".
      const resConflito = await POST(postReq({ ...basePayload, clientRequestId }));
      expect(resConflito.status).toBe(409);
      const bodyConflito = await resConflito.json();
      expect(bodyConflito.unresolved).toBeUndefined();
    });
  });

  describe("[ponto 2] fingerprint vincula a idempotência ao conteúdo real da tentativa", () => {
    const clientRequestId = "mesmo-id-payloads-diferentes-1";

    it("mesmo ID + mesmo payload: tratado como retry legítimo", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      const r1 = await POST(postReq({ ...basePayload, clientRequestId }));
      const r2 = await POST(postReq({ ...basePayload, clientRequestId }));
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      expect((store.get("pedidos") as unknown[]).length).toBe(1);
    });

    it("mesmo ID + cliente diferente: 409 genérico, sem duplicar, sem vazar dado do pedido anterior", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      await POST(postReq({ ...basePayload, clientRequestId }));
      const res = await POST(postReq({ ...basePayload, clientRequestId, cliente: "Outra Pessoa" }));
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(Object.keys(body).sort()).toEqual(["error", "ok"]);
      expect((store.get("pedidos") as unknown[]).length).toBe(1);
    });

    it("mesmo ID + itens diferentes: 409 genérico, sem duplicar", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      await POST(postReq({ ...basePayload, clientRequestId }));
      const res = await POST(postReq({
        ...basePayload,
        clientRequestId,
        itens: [{ kind: "simple", name: "Refrigerante 2L", detail: "", price: 1, qty: 5 }],
      }));
      expect(res.status).toBe(409);
      expect((store.get("pedidos") as unknown[]).length).toBe(1);
    });

    it("mesmo ID + endereço diferente: 409 genérico, sem duplicar", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      await POST(postReq({ ...basePayload, clientRequestId }));
      const res = await POST(postReq({ ...basePayload, clientRequestId, numero: "999" }));
      expect(res.status).toBe(409);
      expect((store.get("pedidos") as unknown[]).length).toBe(1);
    });

    it("mesmo ID + forma de pagamento diferente: 409 genérico, sem duplicar", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      await POST(postReq({ ...basePayload, clientRequestId }));
      const res = await POST(postReq({ ...basePayload, clientRequestId, pagamento: "Dinheiro", troco: "Sem troco" }));
      expect(res.status).toBe(409);
      expect((store.get("pedidos") as unknown[]).length).toBe(1);
    });
  });

  describe("[ponto 3] TTL separado do claim e do resultado + ownerToken", () => {
    it("execução antiga nunca apaga uma reivindicação nova (compare-and-delete por ownerToken)", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      const clientRequestId = "execucao-antiga-nao-apaga-1";

      // Força a persistência do pedido a falhar DEPOIS do claim adquirido,
      // para a rota tentar liberar (apagar) o claim no caminho de erro.
      redisMock.set.mockImplementation(async (key: string, value: unknown, opts?: { nx?: boolean }) => {
        if (key === "pedidos") throw new Error("Redis indisponível (simulado) — persistência");
        return defaultSetImpl(key, value, opts);
      });

      // No exato momento em que a rota chamaria o EVAL para liberar o claim,
      // simula que OUTRA execução (TTL já expirado) reivindicou a mesma
      // chave com um ownerToken diferente — o compare-and-delete real,
      // rodando contra o Redis de verdade, veria exatamente essa foto.
      const valorNovoDono = "novo-dono-token::" + "f".repeat(64);
      redisMock.eval.mockImplementationOnce(async (_script: string, keys: string[], args: string[]) => {
        store.set(keys[0], valorNovoDono);
        if (store.get(keys[0]) === args[0]) {
          store.delete(keys[0]);
          return 1;
        }
        return 0;
      });

      const res = await POST(postReq({ ...basePayload, clientRequestId }));
      expect(res.status).toBe(500);
      // A chave do "novo dono" continua intacta — a execução antiga NÃO
      // conseguiu apagá-la nem sobrescrevê-la.
      expect(store.get(chaveClaim(clientRequestId))).toBe(valorNovoDono);
    });

    it("claim ausente (TTL já expirado / execução anterior nunca reivindicou) permite que uma tentativa nova reivindique e crie o pedido normalmente", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      const clientRequestId = "claim-expirado-retry-legitimo-1";
      // Nenhum claim nem resultado pré-existentes — equivalente ao estado
      // depois de um TTL expirado sem que nada tenha sido finalizado.
      const res = await POST(postReq({ ...basePayload, clientRequestId }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect((store.get("pedidos") as unknown[]).length).toBe(1);
    });

    it("nenhuma duplicidade e nenhum bloqueio de 24h: depois de concluído, o claim é liberado (não fica até o TTL do resultado)", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      const clientRequestId = "sem-bloqueio-24h-1";
      await POST(postReq({ ...basePayload, clientRequestId }));
      expect(store.has(chaveClaim(clientRequestId))).toBe(false);
      expect(store.has(chaveResultado(clientRequestId))).toBe(true);
    });
  });

  describe("[ponto 4] rollback do resgate libera a idempotência corretamente", () => {
    // O teste completo (reserva válida + confirmarResgatePontos falhando
    // DEPOIS da persistência + retry legítimo criando um pedido novo) exige
    // a infraestrutura de fidelidade por pontos já montada em
    // route.resgate.test.ts (reserva real, config real) — ver o teste
    // "[Modo Sobrevivência] falha ao confirmar resgate libera claim e
    // resultado de idempotência — retry legítimo cria um pedido novo" nesse
    // arquivo. Aqui, cobrimos o caso mais simples (resgateId inválido, sem
    // reserva) que já comprova, por si só, que nenhuma chave de idempotência
    // é tocada quando a validação rejeita ANTES do claim (reforça o ponto 7).
    it("resgateId sem reserva válida é rejeitado antes do claim: nenhuma chave de idempotência é criada", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      const clientRequestId = "rollback-resgate-sem-reserva-1";
      const payload = { ...basePayload, clientRequestId, resgateId: "resgate-inexistente-simulado" };
      const res = await POST(postReq(payload));
      expect(res.status).toBe(400);
      expect(store.has(chaveClaim(clientRequestId))).toBe(false);
      expect(store.has(chaveResultado(clientRequestId))).toBe(false);
    });
  });

  describe("[ponto 5] recuperação após persistência — nunca um 500 cru quando o pedido já existe", () => {
    it("pedido persistido + getConfigPix falha depois: resposta ainda é ok:true, sinalizada como degradada, sem duplicar", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      const clientRequestId = "config-pix-falha-depois-1";
      redisMock.get.mockImplementation(async (key: string) => {
        if (key === "config:pizzaria") throw new Error("Redis indisponível (simulado) — config pix");
        return defaultGetImpl(key);
      });

      const res = await POST(postReq({ ...basePayload, clientRequestId }));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.degradado).toBe(true);
      expect(body.pedidoId).toBeTruthy();
      expect((store.get("pedidos") as unknown[]).length).toBe(1);
    });

    it("falha secundária totalmente inesperada depois de persistir (exceção não tratada): catch externo devolve confirmação recuperável, nunca 500 cru", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      const clientRequestId = "falha-inesperada-pos-persistir-1";
      // Simula uma falha inesperada em qualquer passo posterior à
      // persistência (ex.: notificação push) que escape de seu próprio
      // try/catch — aqui, forçando o fetch (usado só depois de persistir)
      // a lançar de um jeito que escaparia de um catch mal colocado não
      // existe hoje; em vez disso, simula-se diretamente via getConfigPix
      // lançando algo que não é um Error comum (edge case de log sanitizado).
      redisMock.get.mockImplementation(async (key: string) => {
        if (key === "config:pizzaria") throw "falha nao padrao (nao é instancia de Error)";
        return defaultGetImpl(key);
      });

      const res = await POST(postReq({ ...basePayload, clientRequestId }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.degradado).toBe(true);
      expect((store.get("pedidos") as unknown[]).length).toBe(1);
    });

    it("retry recupera o mesmo pedido (pedidoId/numero/statusToken) mesmo depois de uma resposta degradada", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      const clientRequestId = "retry-recupera-apos-degradado-1";
      redisMock.get.mockImplementationOnce(async (key: string) => {
        if (key === "config:pizzaria") throw new Error("Redis indisponível (simulado)");
        return defaultGetImpl(key);
      });
      // A implementação acima só falha na 1ª chamada a redis.get — mas
      // config:pizzaria pode não ser a 1ª chamada; para garantir a falha
      // apenas na config, usamos mockImplementation completo:
      redisMock.get.mockImplementation(async (key: string) => {
        const deveFalhar = key === "config:pizzaria" && (store.get("__falhou_uma_vez__") ?? false) === false;
        if (deveFalhar) {
          store.set("__falhou_uma_vez__", true);
          throw new Error("Redis indisponível (simulado) — só na 1ª tentativa");
        }
        return defaultGetImpl(key);
      });

      const r1 = await POST(postReq({ ...basePayload, clientRequestId }));
      const body1 = await r1.json();
      expect(body1.degradado).toBe(true);

      const r2 = await POST(postReq({ ...basePayload, clientRequestId }));
      const body2 = await r2.json();
      expect(body2.pedidoId).toBe(body1.pedidoId);
      expect(body2.numero).toBe(body1.numero);
      expect(body2.statusToken).toBe(body1.statusToken);
      expect((store.get("pedidos") as unknown[]).length).toBe(1);
    });
  });

  describe("[ponto 6] nunca cacheia Pix cegamente por 24h", () => {
    it("o registro durável de idempotência nunca contém total nem pix — só pedidoId/numero/statusToken", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      const clientRequestId = "resultado-sem-pix-cacheado-1";
      await POST(postReq({ ...basePayload, clientRequestId }));
      const registro = store.get(chaveResultado(clientRequestId)) as Record<string, unknown>;
      expect(registro).not.toHaveProperty("total");
      expect(registro).not.toHaveProperty("pix");
      expect(registro).toHaveProperty("pedidoId");
      expect(registro).toHaveProperty("numero");
      expect(registro).toHaveProperty("statusToken");
    });

    it("Pix indisponível na reconstrução (retry): nunca gera uma segunda cobrança, resposta vem sem pix (degradada) em vez de inventar dado", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      const clientRequestId = "pix-indisponivel-no-retry-1";
      await POST(postReq({ ...basePayload, clientRequestId }));

      // No retry, getConfigPix (usado na reconstrução) falha.
      redisMock.get.mockImplementation(async (key: string) => {
        if (key === "config:pizzaria") throw new Error("Redis indisponível (simulado) — reconstrução");
        return defaultGetImpl(key);
      });
      const r2 = await POST(postReq({ ...basePayload, clientRequestId }));
      expect(r2.status).toBe(200);
      const body2 = await r2.json();
      expect(body2.ok).toBe(true);
      expect(body2.pix).toBeUndefined();
      expect((store.get("pedidos") as unknown[]).length).toBe(1);
    });
  });

  describe("[3ª revisão — ponto 1] recuperação quando :claim e :result já expiraram/nunca foram gravados", () => {
    it("gravação de :result falha (pedido já persistido); claim expira depois (simulado); retry recupera o MESMO pedido via hash gravado nele — pedidos.length permanece 1, nenhuma segunda cobrança Pix", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      const clientRequestId = "gap-apos-expiracao-claim-001";
      const chaveResultadoKey = chaveResultado(clientRequestId);
      const chaveClaimKey = chaveClaim(clientRequestId);

      // Falha SÓ a gravação do :result (agora um EVAL atômico, não um SET) —
      // simula exatamente o cenário do relatório: pedido persistido, :result
      // nunca chega a existir.
      const chamadaOriginalEval = redisMock.eval.getMockImplementation()!;
      redisMock.eval.mockImplementation(async (script: string, keys: string[], args: string[]) => {
        if (keys.length === 2 && args.length === 3 && keys[0] === chaveResultadoKey) {
          throw new Error("Redis indisponível (simulado) — :result nunca gravado");
        }
        return chamadaOriginalEval(script, keys, args);
      });

      const r1 = await POST(postReq({ ...basePayload, clientRequestId }));
      expect(r1.status).toBe(200);
      const body1 = await r1.json();
      // A resposta original é considerada PERDIDA a partir daqui (timeout) —
      // o teste não a usa mais, só confirma que o pedido existe de verdade.
      expect((store.get("pedidos") as unknown[]).length).toBe(1);
      expect(store.has(chaveResultadoKey)).toBe(false);

      // Restaura o comportamento normal do eval para o retry.
      redisMock.eval.mockImplementation(chamadaOriginalEval);
      // Simula o claim expirando (TTL de 30s decorrido, retry "mais de 30s depois").
      store.delete(chaveClaimKey);

      const r2 = await POST(postReq({ ...basePayload, clientRequestId }));
      expect(r2.status).toBe(200);
      const body2 = await r2.json();
      expect(body2.pedidoId).toBe(body1.pedidoId);
      expect((store.get("pedidos") as unknown[]).length).toBe(1);
      expect(criarCobrancaPixMercadoPagoMock).not.toHaveBeenCalled(); // Pix manual por padrão neste teste — nenhuma cobrança criada em nenhuma das duas chamadas
    }, 10_000);

    it("[encerramento simulado] pedido persistido, mas nem :claim nem :result sobrevivem (processo encerrado/TTL) — retry recupera via hash no pedido real, sem duplicar", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      const clientRequestId = "encerramento-simulado-001";

      const r1 = await POST(postReq({ ...basePayload, clientRequestId }));
      expect(r1.status).toBe(200);
      const body1 = await r1.json();
      expect((store.get("pedidos") as unknown[]).length).toBe(1);

      // Simula: resposta perdida, :result nunca sobreviveu (gravado e já
      // expirado independentemente, ou nunca gravado), :claim já expirou —
      // nada resta em Redis exceto o pedido real já persistido.
      store.delete(chaveResultado(clientRequestId));
      store.delete(chaveClaim(clientRequestId));

      const r2 = await POST(postReq({ ...basePayload, clientRequestId }));
      expect(r2.status).toBe(200);
      const body2 = await r2.json();
      expect(body2.pedidoId).toBe(body1.pedidoId);
      expect((store.get("pedidos") as unknown[]).length).toBe(1);
    });

    it("clientRequestId com fingerprint diferente do pedido real já persistido: 409 genérico, nunca duplica, nunca vaza dado do pedido anterior", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      const clientRequestId = "conflito-apos-expiracao-001";

      await POST(postReq({ ...basePayload, clientRequestId }));
      store.delete(chaveResultado(clientRequestId));
      store.delete(chaveClaim(clientRequestId));

      const r2 = await POST(postReq({ ...basePayload, clientRequestId, cliente: "Outra Pessoa" }));
      expect(r2.status).toBe(409);
      const body2 = await r2.json();
      expect(Object.keys(body2).sort()).toEqual(["error", "ok"]);
      expect((store.get("pedidos") as unknown[]).length).toBe(1);
    });

    it("pedido real não encontrado por hash (nunca existiu): segue para reivindicar o claim e cria normalmente", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      const res = await POST(postReq({ ...basePayload, clientRequestId: "nunca-existiu-antes-001" }));
      expect(res.status).toBe(200);
      expect((store.get("pedidos") as unknown[]).length).toBe(1);
    });

    it("falha ao ler 'pedidos' durante a busca por hash é tratada como incerta — nunca cria pedido", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      const clientRequestId = "busca-por-hash-falha-leitura-001";
      // Revisão de segurança, 6ª rodada, ponto 1: a busca por hash agora
      // roda na FASE 2 (recuperação antecipada de idempotência), antes de
      // qualquer leitura de "pedidos" na FASE 3 — é a PRIMEIRA (e, neste
      // teste, única) leitura de "pedidos" da requisição.
      redisMock.get.mockImplementation(async (key: string) => {
        if (key === "pedidos") throw new Error("Redis indisponível (simulado) — busca por hash");
        return defaultGetImpl(key);
      });

      const res = await POST(postReq({ ...basePayload, clientRequestId }));
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.unresolved).toBe(true);
      expect(store.get("pedidos")).toBeUndefined();
    });
  });

  describe("[3ª revisão — ponto 2] fingerprint completo (observação, e-mail, sabor da recompensa)", () => {
    const clientRequestId = "fingerprint-completo-001";

    it("observação diferente: 409 genérico, sem duplicar", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      await POST(postReq({ ...basePayload, clientRequestId, observacao: "Sem cebola" }));
      const res = await POST(postReq({ ...basePayload, clientRequestId, observacao: "Capricha no queijo" }));
      expect(res.status).toBe(409);
      expect((store.get("pedidos") as unknown[]).length).toBe(1);
    });

    it("e-mail diferente: 409 genérico, sem duplicar", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      await POST(postReq({ ...basePayload, clientRequestId, email: "a@teste.com" }));
      const res = await POST(postReq({ ...basePayload, clientRequestId, email: "b@teste.com" }));
      expect(res.status).toBe(409);
      expect((store.get("pedidos") as unknown[]).length).toBe(1);
    });

    it("mesmos dados normalizados (observação/e-mail com espaços/caixa diferentes) continuam sendo retry legítimo", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      const r1 = await POST(postReq({ ...basePayload, clientRequestId, observacao: "Capricha!  ", email: "Fulano@Teste.com" }));
      const r2 = await POST(postReq({ ...basePayload, clientRequestId, observacao: "Capricha!", email: "fulano@teste.com" }));
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      const body1 = await r1.json();
      const body2 = await r2.json();
      expect(body2.pedidoId).toBe(body1.pedidoId);
      expect((store.get("pedidos") as unknown[]).length).toBe(1);
    });

    it("conflito nunca devolve pedidoId, statusToken, total ou pix do pedido anterior", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      await POST(postReq({ ...basePayload, clientRequestId, observacao: "original" }));
      const res = await POST(postReq({ ...basePayload, clientRequestId, observacao: "diferente" }));
      const body = await res.json();
      expect(body).not.toHaveProperty("pedidoId");
      expect(body).not.toHaveProperty("statusToken");
      expect(body).not.toHaveProperty("total");
      expect(body).not.toHaveProperty("pix");
    });
  });

  describe("[3ª revisão — ponto 3] reconstrução do Pix no retry: válido, confirmado, sem QR, indisponível", () => {
    function configurarIntegracaoMercadoPagoAtiva() {
      store.set("integracao:mercadopago", {
        provider: "mercadopago",
        enabled: true,
        accessTokenEncrypted: encryptMercadoPagoToken("token-teste-idempotencia"),
        accessTokenLast4: "test",
        payerEmailFallback: "loja@example.com",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
    }

    it("Pix válido/pendente: retry reconstrói com o qrCode atual do pedido real, sem gerar segunda cobrança", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      configurarIntegracaoMercadoPagoAtiva();
      const clientRequestId = "pix-valido-retry-001";

      const r1 = await POST(postReq({ ...basePayload, clientRequestId }));
      const body1 = await r1.json();
      expect(body1.pix).toMatchObject({ provider: "mercadopago", qrCode: "pix-copia-e-cola" });

      const r2 = await POST(postReq({ ...basePayload, clientRequestId }));
      const body2 = await r2.json();
      expect(body2.pix).toMatchObject({ provider: "mercadopago", qrCode: "pix-copia-e-cola" });
      expect(criarCobrancaPixMercadoPagoMock).toHaveBeenCalledTimes(1);
    });

    it("Pix confirmado por caminho independente (webhook/Sentinela) entre a criação e o retry: reconstrução reflete o dado ATUAL, nunca uma cópia antiga, sem segunda cobrança", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      configurarIntegracaoMercadoPagoAtiva();
      const clientRequestId = "pix-confirmado-retry-001";

      await POST(postReq({ ...basePayload, clientRequestId }));
      const pedidosAntes = store.get("pedidos") as Array<Record<string, unknown>>;
      pedidosAntes[0].pix = { ...(pedidosAntes[0].pix as object), status: "confirmado" };
      pedidosAntes[0].pixConfirmado = true;
      store.set("pedidos", pedidosAntes);

      const r2 = await POST(postReq({ ...basePayload, clientRequestId }));
      const body2 = await r2.json();
      expect(body2.pix).toMatchObject({ provider: "mercadopago", qrCode: "pix-copia-e-cola" });
      expect(criarCobrancaPixMercadoPagoMock).toHaveBeenCalledTimes(1);
    });

    it("Pix sem QR (mercadopago com qrCode vazio): retry cai para Pix manual (comportamento existente de serializarPixCliente), nunca gera segunda cobrança", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      configurarIntegracaoMercadoPagoAtiva();
      const clientRequestId = "pix-sem-qr-retry-001";

      await POST(postReq({ ...basePayload, clientRequestId }));
      store.set("config:pizzaria", { chavePix: "chave-manual-teste", nomeTitularPix: "Titular Teste" });
      const pedidosAntes = store.get("pedidos") as Array<Record<string, unknown>>;
      pedidosAntes[0].pix = { ...(pedidosAntes[0].pix as object), qrCode: "" };
      store.set("pedidos", pedidosAntes);

      const r2 = await POST(postReq({ ...basePayload, clientRequestId }));
      const body2 = await r2.json();
      expect(body2.pix?.provider).toBe("manual");
      expect(body2.pix?.qrCode).toBeUndefined();
      expect(criarCobrancaPixMercadoPagoMock).toHaveBeenCalledTimes(1);
    });

    it("Pix indisponível (forma de pagamento não-Pix): retry nunca inclui o campo pix", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      const clientRequestId = "pix-indisponivel-retry-001";
      const payload = { ...basePayload, clientRequestId, pagamento: "Dinheiro", troco: "Sem troco" };

      await POST(postReq(payload));
      const r2 = await POST(postReq(payload));
      const body2 = await r2.json();
      expect(body2.pix).toBeUndefined();
      expect(criarCobrancaPixMercadoPagoMock).not.toHaveBeenCalled();
    });
  });

  describe("[ponto 7] claim só depois das validações puras", () => {
    it("payload inválido nunca cria chave survival:idempotencia, nunca chama DEL, nunca cria pedido", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      const clientRequestId = "payload-invalido-sem-claim-1";
      const res = await POST(postReq({ ...basePayload, clientRequestId, bairro: "" }));
      expect(res.status).toBe(400);
      expect(store.has(chaveClaim(clientRequestId))).toBe(false);
      expect(store.has(chaveResultado(clientRequestId))).toBe(false);
      expect(redisMock.del).not.toHaveBeenCalled();
      expect(store.get("pedidos")).toBeUndefined();
    });
  });

  describe("[6ª revisão — ponto 3] reconciliação de persistência ambígua (redis.set('pedidos') lança não comprova ausência)", () => {
    it("redis.set('pedidos') aplica a escrita mas LANÇA (timeout na resposta): reconciliação encontra o pedido, responde sucesso, nunca duplica em retry", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      const clientRequestId = "reconciliacao-set-aplicou-mas-lancou-001";

      let jaFalhouPedidos = false;
      redisMock.set.mockImplementation(async (key: string, value: unknown, opts?: { nx?: boolean }) => {
        if (key === "pedidos" && !jaFalhouPedidos && Array.isArray(value)) {
          jaFalhouPedidos = true;
          await defaultSetImpl(key, value, opts); // a escrita É aplicada de verdade...
          throw new Error("timeout simulado — Redis aplicou, mas a resposta HTTP falhou"); // ...mas o cliente Redis lança
        }
        return defaultSetImpl(key, value, opts);
      });

      const res = await POST(postReq({ ...basePayload, clientRequestId }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect((store.get("pedidos") as unknown[]).length).toBe(1);

      redisMock.set.mockImplementation(defaultSetImpl);
      const retry = await POST(postReq({ ...basePayload, clientRequestId }));
      expect(retry.status).toBe(200);
      const retryBody = await retry.json();
      expect(retryBody.pedidoId).toBe(body.pedidoId);
      expect((store.get("pedidos") as unknown[]).length).toBe(1); // nunca duplica
    });

    it("leitura de reconciliação (após redis.set('pedidos') lançar) TAMBÉM falha: nunca compensa às cegas, devolve 503 unresolved, claim mantido", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      const clientRequestId = "reconciliacao-leitura-incerta-001";

      let jaFalhouSet = false;
      redisMock.set.mockImplementation(async (key: string, value: unknown, opts?: { nx?: boolean }) => {
        if (key === "pedidos" && Array.isArray(value)) {
          jaFalhouSet = true;
          throw new Error("falha simulada ao persistir pedido");
        }
        return defaultSetImpl(key, value, opts);
      });
      // Só falha a leitura de "pedidos" DEPOIS que o SET de persistência já
      // lançou — a busca por hash (FASE 2, antes da persistência) precisa
      // continuar funcionando normalmente para o teste isolar exatamente a
      // reconciliação pós-falha de SET.
      redisMock.get.mockImplementation(async (key: string) => {
        if (key === "pedidos" && jaFalhouSet) throw new Error("falha simulada na leitura de reconciliação");
        return defaultGetImpl(key);
      });

      const res = await POST(postReq({ ...basePayload, clientRequestId }));
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.unresolved).toBe(true);

      // O claim NUNCA é liberado quando a reconciliação está incerta — só
      // restauramos os mocks para inspecionar o estado, sem simular um
      // retry (que exigiria uma leitura de "pedidos" funcional).
      redisMock.get.mockImplementation(defaultGetImpl);
      expect(store.has(chaveClaim(clientRequestId))).toBe(true);
    });

    // [7ª revisão de segurança, ponto 3] `pedido.id === pedidoId` sozinho não
    // basta para reconciliar: um pedido de OUTRA tentativa (hash/fingerprint
    // diferentes) pode ter, por colisão de pedidoId (derivado de Date.now()),
    // o mesmo id. A reconciliação nunca pode devolver numero/statusToken/pix
    // desse outro pedido como se fossem da tentativa atual.
    it("dois pedidos com o MESMO pedidoId mas identidades DIFERENTES: reconciliação nunca vaza dados do pedido alheio, devolve 503", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");

      const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(1732000000123);
      try {
        // Pedido A: criado normalmente com clientRequestId A, ocupando o
        // pedidoId "1732000000123".
        const clientRequestIdA = "colisao-pedidoid-identidade-A";
        const resA = await POST(postReq({ ...basePayload, clientRequestId: clientRequestIdA }));
        expect(resA.status).toBe(200);
        const bodyA = await resA.json();
        expect(bodyA.pedidoId).toBe("1732000000123");
        expect(bodyA.numero).toBeDefined();

        // Tentativa B: MESMO Date.now() (mesmo pedidoId candidato), CLIENT
        // REQUEST ID DIFERENTE — a persistência de "pedidos" lança (resposta
        // perdida do ponto de vista do cliente), forçando a reconciliação a
        // olhar para o pedido já existente com o MESMO id (o da tentativa A).
        const clientRequestIdB = "colisao-pedidoid-identidade-B";
        let jaFalhouSet = false;
        redisMock.set.mockImplementation(async (key: string, value: unknown, opts?: { nx?: boolean }) => {
          if (key === "pedidos" && !jaFalhouSet && Array.isArray(value) && (value as unknown[]).length === 2) {
            jaFalhouSet = true;
            throw new Error("falha simulada ao persistir pedido (tentativa B)");
          }
          return defaultSetImpl(key, value, opts);
        });

        const resB = await POST(postReq({ ...basePayload, clientRequestId: clientRequestIdB }));
        // Identidade (hash/fingerprint) diverge do pedido encontrado com o
        // mesmo id — NUNCA reconstrói sucesso com os dados do pedido A, NUNCA
        // duplica: trata como inconsistência recuperável (503).
        expect(resB.status).toBe(503);
        const bodyB = await resB.json();
        expect(bodyB.ok).toBe(false);
        expect(bodyB.unresolved).toBe(true);
        // Nenhum campo da resposta reaproveita numero/pedidoId/pix do pedido A.
        expect(bodyB.numero).toBeUndefined();
        expect(bodyB.pedidoId).toBeUndefined();

        // O pedido de A continua intacto — reconciliação nunca o sobrescreve
        // nem o remove por causa da tentativa B.
        const pedidos = store.get("pedidos") as Array<{ id: string; survivalClientRequestIdHash?: string }>;
        expect(pedidos).toHaveLength(1);
        expect(pedidos[0].id).toBe("1732000000123");
      } finally {
        dateNowSpy.mockRestore();
      }
    });
  });

  describe("[7ª revisão de segurança, ponto 2] token do WhatsApp não pode bloquear a recuperação de idempotência", () => {
    const WHATSAPP_TOKEN = "a".repeat(32);
    const chaveToken = `cardapio:token:${WHATSAPP_TOKEN}`;

    function payloadSemTelefone(clientRequestId: string) {
      return { ...basePayload, telefone: "", whatsappToken: WHATSAPP_TOKEN, clientRequestId };
    }

    it("pedido criado com whatsappToken (sem telefone manual); token expira antes do retry: retry com o MESMO clientRequestId devolve o MESMO pedido, nunca 400/500", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      const clientRequestId = "whatsapp-token-expira-antes-do-retry-001";
      store.set(chaveToken, { phone: "11988887777", createdAt: Date.now() });

      const res = await POST(postReq(payloadSemTelefone(clientRequestId)));
      expect(res.status).toBe(200);
      const body = await res.json();

      // Token "expira" (removido do Redis) ANTES do retry — simula TTL
      // vencido entre a criação e a nova tentativa.
      store.delete(chaveToken);

      const retry = await POST(postReq(payloadSemTelefone(clientRequestId)));
      expect(retry.status).toBe(200);
      const retryBody = await retry.json();
      expect(retryBody.pedidoId).toBe(body.pedidoId);
      expect((store.get("pedidos") as unknown[]).length).toBe(1); // nunca duplica
    });

    it("Redis falha ao validar o token do WhatsApp, mas um :result válido já existe: recupera o pedido SEM consultar o token de novo", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      const clientRequestId = "whatsapp-token-redis-falha-result-existe-001";
      store.set(chaveToken, { phone: "11988887777", createdAt: Date.now() });

      const res = await POST(postReq(payloadSemTelefone(clientRequestId)));
      expect(res.status).toBe(200);
      const body = await res.json();

      // O :result durável continua existindo (não removido) — só o Redis
      // falha especificamente ao ler a chave do TOKEN, nunca ao ler :result.
      redisMock.get.mockImplementation(async (key: string) => {
        if (key === chaveToken) throw new Error("falha simulada ao validar token do WhatsApp");
        return defaultGetImpl(key);
      });

      const retry = await POST(postReq(payloadSemTelefone(clientRequestId)));
      redisMock.get.mockImplementation(defaultGetImpl);

      expect(retry.status).toBe(200);
      const retryBody = await retry.json();
      expect(retryBody.pedidoId).toBe(body.pedidoId);
    });

    it("criação genuinamente NOVA (sem :result/hash/attempt prévios) com token inválido e sem telefone digitado continua bloqueada (400)", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      const clientRequestId = "whatsapp-token-invalido-criacao-nova-001";
      // Nunca configurado no store — token inválido/inexistente.
      const res = await POST(postReq(payloadSemTelefone(clientRequestId)));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/telefone/i);
      expect((store.get("pedidos") as unknown[] | undefined) ?? []).toHaveLength(0);
    });

    it("Redis falha ao validar o token para uma criação genuinamente NOVA: erro recuperável (503), nunca 400/500", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      const clientRequestId = "whatsapp-token-redis-falha-criacao-nova-001";
      redisMock.get.mockImplementation(async (key: string) => {
        if (key === chaveToken) throw new Error("falha simulada ao validar token do WhatsApp");
        return defaultGetImpl(key);
      });

      const res = await POST(postReq(payloadSemTelefone(clientRequestId)));
      redisMock.get.mockImplementation(defaultGetImpl);

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.unresolved).toBe(true);
    });
  });

  describe("[4ª revisão — ponto 3] identidade estável (attempt) ANTES da cobrança Pix — nunca uma segunda cobrança real", () => {
    it("cobrança Pix criada + persistência de 'pedidos' falha: retry com o MESMO clientRequestId reutiliza o MESMO pedidoId/txid/idempotencyKey — nunca uma segunda cobrança", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      vi.stubEnv("PIX_PROVIDER", "mercadopago");
      const clientRequestId = "attempt-pix-persistencia-falha-001";

      // A cobrança Pix é criada normalmente, mas a persistência de "pedidos"
      // falha logo em seguida (resposta perdida do ponto de vista do
      // cliente) — simula exatamente a janela em que, sem identidade
      // estável, um retry geraria um pedidoId/txid novos e arriscaria uma
      // segunda cobrança real no Mercado Pago.
      redisMock.set.mockImplementationOnce(defaultSetImpl); // attempt (SET NX) — sucesso normal
      let falhouPersistencia = false;
      redisMock.set.mockImplementation(async (key: string, value: unknown, opts?: { nx?: boolean }) => {
        if (key === "pedidos" && !falhouPersistencia) {
          falhouPersistencia = true;
          throw new Error("Redis indisponível (simulado) — persistência perdida após criar a cobrança Pix");
        }
        return defaultSetImpl(key, value, opts);
      });

      const r1 = await POST(postReq({ ...basePayload, clientRequestId }));
      expect(r1.status).toBe(500);
      expect(criarCobrancaPixMercadoPagoMock).toHaveBeenCalledTimes(1);
      const primeiroTxid = (criarCobrancaPixMercadoPagoMock.mock.calls[0][0] as { txid: string }).txid;
      expect(store.get("pedidos")).toBeUndefined();

      redisMock.set.mockImplementation(defaultSetImpl); // restaura para o retry

      const retry = await POST(postReq({ ...basePayload, clientRequestId }));
      expect(retry.status).toBe(200);
      expect(criarCobrancaPixMercadoPagoMock).toHaveBeenCalledTimes(2);
      const segundoTxid = (criarCobrancaPixMercadoPagoMock.mock.calls[1][0] as { txid: string }).txid;

      // Mesma identidade estável (attempt) reaproveitada — mesmo txid, logo
      // mesma X-Idempotency-Key do Mercado Pago (derivada do txid), então o
      // provider trata como a MESMA tentativa, nunca uma segunda cobrança.
      expect(segundoTxid).toBe(primeiroTxid);
      expect((store.get("pedidos") as unknown[]).length).toBe(1);
      const pedidoFinal = (store.get("pedidos") as Array<Record<string, unknown>>)[0];
      expect(pedidoFinal.id).toBe(segundoTxid.replace(/^chefebot_/, ""));
    });
  });

  describe("[7ª revisão de segurança, ponto 1] consulta antecipada (somente leitura) do :attempt na FASE 2", () => {
    it("attempt corrompido (formato inválido) é consultado na FASE 2 e retorna 503 unresolved, nunca cria um pedido", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      const clientRequestId = "attempt-corrompido-fase2-001";

      let falhouPersistencia = false;
      redisMock.set.mockImplementation(async (key: string, value: unknown, opts?: { nx?: boolean }) => {
        if (key === "pedidos" && !falhouPersistencia && Array.isArray(value)) {
          falhouPersistencia = true;
          throw new Error("Redis indisponível (simulado) — persistência perdida após criar o attempt");
        }
        return defaultSetImpl(key, value, opts);
      });

      const r1 = await POST(postReq({ ...basePayload, clientRequestId }));
      expect(r1.status).toBe(500);
      expect(store.get("pedidos")).toBeUndefined();
      redisMock.set.mockImplementation(defaultSetImpl);

      // Corrompe o attempt gravado pela tentativa 1 — formato inválido
      // (faltam campos obrigatórios do snapshot financeiro).
      const chaveAttempt = `survival:idempotencia:pedido:${clientRequestId}:attempt`;
      store.set(chaveAttempt, { state: "in_progress", pedidoId: "123" });

      const retry = await POST(postReq({ ...basePayload, clientRequestId }));
      expect(retry.status).toBe(503);
      const body = await retry.json();
      expect(body.ok).toBe(false);
      expect(body.unresolved).toBe(true);
      expect((store.get("pedidos") as unknown[] | undefined) ?? []).toHaveLength(0);
    });
  });

  describe("[6ª revisão — ponto 4] snapshot financeiro estável no attempt — preço nunca muda silenciosamente entre tentativas", () => {
    it("taxa de entrega do bairro muda entre a criação e o retry: retry reutiliza o TOTAL original do attempt, nunca recalcula com a taxa nova", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      const clientRequestId = "attempt-pricing-taxa-muda-001";

      let falhouPersistencia = false;
      redisMock.set.mockImplementation(async (key: string, value: unknown, opts?: { nx?: boolean }) => {
        if (key === "pedidos" && !falhouPersistencia && Array.isArray(value)) {
          falhouPersistencia = true;
          throw new Error("Redis indisponível (simulado) — persistência perdida");
        }
        return defaultSetImpl(key, value, opts);
      });

      const r1 = await POST(postReq({ ...basePayload, clientRequestId }));
      expect(r1.status).toBe(500);
      expect(store.get("pedidos")).toBeUndefined();

      redisMock.set.mockImplementation(defaultSetImpl);
      // A taxa do bairro "Centro" muda de 3 para 999 ANTES do retry —
      // simula uma atualização de cardápio/taxa entre tentativas.
      store.set("cardapio", { neighborhoods: [{ name: "Centro", fee: 999 }] });

      const retry = await POST(postReq({ ...basePayload, clientRequestId }));
      expect(retry.status).toBe(200);
      const body = await retry.json();
      // 33 = total original (2x Refrigerante 2L a R$15 + taxa R$3) — NUNCA
      // 2x15+999, mesmo com a taxa tendo mudado de verdade no "cardápio".
      expect(body.total).toBe(33);
      const pedidoFinal = (store.get("pedidos") as Array<Record<string, unknown>>)[0];
      expect(pedidoFinal.total).toBe(33);
      expect(pedidoFinal.taxaEntrega).toBe(3);
    });
  });

  describe("[4ª revisão — ponto 4] :result stale vs. leitura incerta", () => {
    it(":result existe, mas o pedido correspondente comprovadamente NÃO existe (stale): invalida o :result com segurança e permite um retry legítimo", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      const clientRequestId = "result-stale-pedido-ausente-001";

      await POST(postReq({ ...basePayload, clientRequestId }));
      expect((store.get("pedidos") as unknown[]).length).toBe(1);
      expect(store.has(chaveResultado(clientRequestId))).toBe(true);

      // Simula o pedido tendo sido removido por qualquer via (nunca deveria
      // acontecer fora de um rollback, mas o :result não pode confiar
      // cegamente que o pedido referenciado ainda existe) — leitura de
      // "pedidos" continua funcionando normalmente, só que vazia.
      store.set("pedidos", []);

      const retry = await POST(postReq({ ...basePayload, clientRequestId }));
      expect(retry.status).toBe(200);
      const body = await retry.json();
      expect(body.ok).toBe(true);
      // O :result stale foi invalidado e um pedido NOVO e legítimo foi criado
      // (nunca ficou preso a um resultado apontando para o vazio).
      expect((store.get("pedidos") as unknown[]).length).toBe(1);
    });

    it("falha ao LER 'pedidos' ao reconstruir a partir de :result continua sendo 503 — nunca interpretada como pedido ausente (nunca invalida o :result às cegas)", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      const clientRequestId = "leitura-incerta-nao-e-ausencia-001";

      await POST(postReq({ ...basePayload, clientRequestId }));
      const resultadoOriginal = store.get(chaveResultado(clientRequestId));

      // Revisão de segurança, 6ª rodada, ponto 1: a reconstrução a partir de
      // :result (buscarPedidoPersistidoPorId) roda na FASE 2, ANTES de
      // qualquer leitura de "pedidos" da FASE 3 — é a PRIMEIRA leitura de
      // "pedidos" do retry (a requisição acerta o fast path e nunca chega à
      // FASE 3).
      redisMock.get.mockImplementation(async (key: string) => {
        if (key === "pedidos") throw new Error("Redis indisponível (simulado) — leitura incerta, não ausência");
        return defaultGetImpl(key);
      });

      const retry = await POST(postReq({ ...basePayload, clientRequestId }));
      expect(retry.status).toBe(503);
      const body = await retry.json();
      expect(body.unresolved).toBe(true);
      // Leitura incerta NUNCA invalida o :result (diferente do caso "stale"
      // comprovado) — continua exatamente como estava.
      expect(store.get(chaveResultado(clientRequestId))).toEqual(resultadoOriginal);
    });

    // [4ª revisão — ponto 3] Com o "attempt" de identidade estável, o MESMO
    // clientRequestId + MESMO fingerprint SEMPRE reutiliza o MESMO pedidoId
    // (e portanto o mesmo txid/X-Idempotency-Key do Mercado Pago) — inclusive
    // depois de um :result stale ser invalidado. Isto é intencional e
    // desejado: é exatamente o que impede uma SEGUNDA cobrança Pix real numa
    // tentativa anterior que já tinha gerado a cobrança mas nunca persistiu.
    // statusToken (não derivado de pedidoId, só usado para o link público de
    // acompanhamento) É reemitido — o pedido em si é uma entrada nova na
    // lista "pedidos" (apagada no teste para simular ausência comprovada).
    it("depois de invalidar um :result stale, o retry com o MESMO clientRequestId reutiliza o MESMO pedidoId/txid (nunca gera uma segunda cobrança Pix)", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      vi.stubEnv("PIX_PROVIDER", "mercadopago");
      const clientRequestId = "result-stale-reutiliza-identidade-001";

      const r1 = await POST(postReq({ ...basePayload, clientRequestId }));
      const body1 = await r1.json();
      expect(criarCobrancaPixMercadoPagoMock).toHaveBeenCalledTimes(1);
      const primeiroTxid = (criarCobrancaPixMercadoPagoMock.mock.calls[0][0] as { txid: string }).txid;

      // Simula o pedido comprovadamente ausente (rollback/perda) — :result
      // fica stale.
      store.set("pedidos", []);

      const r2 = await POST(postReq({ ...basePayload, clientRequestId }));
      const body2 = await r2.json();

      expect(body2.pedidoId).toBe(body1.pedidoId);
      expect(criarCobrancaPixMercadoPagoMock).toHaveBeenCalledTimes(2);
      const segundoTxid = (criarCobrancaPixMercadoPagoMock.mock.calls[1][0] as { txid: string }).txid;
      expect(segundoTxid).toBe(primeiroTxid);
      expect((store.get("pedidos") as unknown[]).length).toBe(1);
    });

    it("clientRequestIds DIFERENTES (tentativas distintas de propósito) sempre geram pedidoId/txid distintos — o compartilhamento de identidade é só intra-tentativa", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      const r1 = await POST(postReq({ ...basePayload, clientRequestId: "tentativa-distinta-a-0000001" }));
      const r2 = await POST(postReq({ ...basePayload, clientRequestId: "tentativa-distinta-b-0000002" }));
      const body1 = await r1.json();
      const body2 = await r2.json();
      expect(body2.pedidoId).not.toBe(body1.pedidoId);
      expect((store.get("pedidos") as unknown[]).length).toBe(2);
    });

    it("erro no script de invalidação atômica (EVAL falha): nunca prossegue às cegas, devolve 503, nunca cria pedido", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      const clientRequestId = "invalidacao-eval-falha-001";

      await POST(postReq({ ...basePayload, clientRequestId }));
      store.set("pedidos", []); // torna o :result stale

      redisMock.eval.mockImplementationOnce(async () => {
        throw new Error("Redis indisponível (simulado) — EVAL de invalidação");
      });

      const retry = await POST(postReq({ ...basePayload, clientRequestId }));
      expect(retry.status).toBe(503);
      const body = await retry.json();
      expect(body.unresolved).toBe(true);
      expect((store.get("pedidos") as unknown[]).length).toBe(0);
    });

    it("'substituido_por_outro' (execução concorrente já gravou um :result novo bem no meio da invalidação): reinicia a consulta e reconstrói o resultado NOVO, nunca apaga nem ignora", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      const clientRequestId = "invalidacao-substituido-por-outro-001";

      const r1 = await POST(postReq({ ...basePayload, clientRequestId }));
      const body1 = await r1.json();

      const chaveResultado = `survival:idempotencia:pedido:${clientRequestId}:result`;
      const chaveToken = `survival:idempotencia:pedido:${clientRequestId}:result:token`;
      const registroOriginal = store.get(chaveResultado) as { requestFingerprint: string };

      store.set("pedidos", []); // pedido da 1ª tentativa removido — :result atual fica stale

      const chamadaOriginalEval = redisMock.eval.getMockImplementation()!;
      redisMock.eval.mockImplementationOnce(async (script: string, keys: string[], args: string[]) => {
        // Simula uma execução CONCORRENTE gravando um :result NOVO (para um
        // pedido2 já existente) bem no meio da nossa tentativa de invalidar
        // o antigo — troca o registro principal E a chave-token ANTES do
        // compare-and-delete atômico rodar (com o token ANTIGO ainda em
        // ARGV). Real Redis garantiria essa mesma janela de corrida.
        store.set("pedidos", [{ id: "pedido-concorrente-2", numero: 999, statusToken: "tok-concorrente", total: 10, itens: [] }]);
        store.set(chaveResultado, {
          state: "completed",
          requestFingerprint: registroOriginal.requestFingerprint,
          pedidoId: "pedido-concorrente-2",
          numero: 999,
          statusToken: "tok-concorrente",
          createdAt: Date.now(),
          resultToken: "token-de-outra-execucao-concorrente",
        });
        store.set(chaveToken, "token-de-outra-execucao-concorrente");
        return chamadaOriginalEval(script, keys, args);
      });

      const retry = await POST(postReq({ ...basePayload, clientRequestId }));
      expect(retry.status).toBe(200);
      const body2 = await retry.json();
      // Reconstrói a partir do resultado NOVO (da execução concorrente
      // simulada) — nunca apaga esse resultado nem cria um terceiro pedido.
      expect(body2.pedidoId).toBe("pedido-concorrente-2");
      expect(body2.pedidoId).not.toBe(body1.pedidoId);
      expect((store.get("pedidos") as unknown[]).length).toBe(1);
    });
  });

  it("com a flag ligada, clientRequestId ausente segue criando pedido normalmente (sem cache)", async () => {
    vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
    const r1 = await POST(postReq(basePayload));
    const r2 = await POST(postReq(basePayload));
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect((store.get("pedidos") as unknown[]).length).toBe(2);
  });

  it("clientRequestId em formato inválido (< 16 chars ou com PII/símbolos) é ignorado, nunca quebra o pedido", async () => {
    vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
    const res = await POST(postReq({ ...basePayload, clientRequestId: "id com espaço e PII (99) 99999-9999" }));
    expect(res.status).toBe(200);
    expect((store.get("pedidos") as unknown[]).length).toBe(1);
  });

  describe("[4ª revisão — ponto 5] ativação segura do enforcement de clientRequestId", () => {
    it("enforcement DESLIGADO (padrão): clientRequestId presente porém inválido continua apenas ignorado (200), mesmo com o núcleo ligado", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      // SURVIVAL_CLIENT_REQUEST_ID_ENFORCEMENT_ENABLED deliberadamente
      // ausente — deve se comportar como o teste acima.
      const res = await POST(postReq({ ...basePayload, clientRequestId: "curto" }));
      expect(res.status).toBe(200);
      expect((store.get("pedidos") as unknown[]).length).toBe(1);
    });

    it("enforcement LIGADO: clientRequestId presente porém inválido é rejeitado com 400, nunca cria o pedido", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      vi.stubEnv("SURVIVAL_CLIENT_REQUEST_ID_ENFORCEMENT_ENABLED", "true");
      const res = await POST(postReq({ ...basePayload, clientRequestId: "curto" }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(store.get("pedidos")).toBeUndefined();
    });

    it("enforcement LIGADO: clientRequestId AUSENTE nunca é rejeitado (compatibilidade com clientes antigos) — pedido criado normalmente sem idempotência", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      vi.stubEnv("SURVIVAL_CLIENT_REQUEST_ID_ENFORCEMENT_ENABLED", "true");
      const res = await POST(postReq(basePayload));
      expect(res.status).toBe(200);
      expect((store.get("pedidos") as unknown[]).length).toBe(1);
    });

    it("enforcement LIGADO: clientRequestId válido continua funcionando normalmente (idempotência intacta)", async () => {
      vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
      vi.stubEnv("SURVIVAL_CLIENT_REQUEST_ID_ENFORCEMENT_ENABLED", "true");
      const clientRequestId = "enforcement-ligado-id-valido-001";
      const r1 = await POST(postReq({ ...basePayload, clientRequestId }));
      const r2 = await POST(postReq({ ...basePayload, clientRequestId }));
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      const body1 = await r1.json();
      const body2 = await r2.json();
      expect(body2.pedidoId).toBe(body1.pedidoId);
      expect((store.get("pedidos") as unknown[]).length).toBe(1);
    });
  });

  it("clientRequestIds diferentes nunca colidem entre si (namespace isolado por chave)", async () => {
    vi.stubEnv("SURVIVAL_MODE_ENABLED", "true");
    const r1 = await POST(postReq({ ...basePayload, clientRequestId: "tentativa-um-123456789" }));
    const r2 = await POST(postReq({ ...basePayload, clientRequestId: "tentativa-dois-4567890" }));
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const body1 = await r1.json();
    const body2 = await r2.json();
    expect(body1.pedidoId).not.toBe(body2.pedidoId);
    expect((store.get("pedidos") as unknown[]).length).toBe(2);
  });
});
