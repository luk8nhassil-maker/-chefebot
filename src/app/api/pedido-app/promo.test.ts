import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    incr: vi.fn(async (key: string) => { const next = Number(store.get(key) || 0) + 1; store.set(key, next); return next; }),
    expire: vi.fn(async () => 1),
    del: vi.fn(async (key: string) => {
      const existia = store.has(key);
      store.delete(key);
      return existia ? 1 : 0;
    }),
    // Dispatch por keys.length/args.length — mesmo padrão usado em
    // route.test.ts (GRAVAR_RESULTADO_E_TOKEN_SCRIPT / INVALIDAR_RESULTADO_SE_TOKEN_SCRIPT).
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
  return { store, redisMock };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));
vi.mock("@/lib/mercadoPagoPix", () => ({ criarCobrancaPixMercadoPago: vi.fn() }));

import { POST } from "./route";
import { PROMOS_KEY } from "@/lib/promocoes";

function postReq(body: unknown) {
  return { json: async () => body } as never;
}

const promo = {
  id: "promo_teste_1",
  active: true,
  featured: true,
  badge: "PROMO DE HOJE",
  title: "Pizza G + Guaraná 1L grátis",
  description: "Combo",
  buttonText: "Pedir",
  type: "combo_fixed_price",
  mainItems: [{ productId: "pizza:G", productName: "Pizza G", category: "pizza", quantity: 1, customerMustChooseFlavor: true }],
  freeItems: [{ productId: "bebida:Guarana 1L", productName: "Guarana 1L", category: "bebida", quantity: 1, priceImpact: 0 }],
  promotionalPrice: 49.9,
  includedText: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const itemPromo = {
  kind: "promo",
  promoId: "promo_teste_1",
  name: "Promoção: Pizza G + Guaraná 1L grátis",
  detail: "Sabor: Calabresa · Inclui: Guarana 1L grátis · Preço promocional: R$ 49,90",
  price: 49.9,
  qty: 1,
};

const basePedido = {
  cliente: "Teste Promo",
  telefone: "(11) 98765-4321",
  tipoEntrega: "retirada" as const,
  pagamento: "Cartao",
  itens: [itemPromo],
};

beforeEach(() => {
  store.clear();
  store.set(PROMOS_KEY, [promo]);
});

describe("pedido com item promocional", () => {
  it("aceita promoção ativa e usa o preço do servidor (total bate)", async () => {
    const res = await POST(postReq(basePedido));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.total).toBe(49.9);
  });

  it("pedido salvo contém a descrição clara da promoção e do brinde", async () => {
    await POST(postReq(basePedido));
    const pedidos = store.get("pedidos") as Array<{ itens: string[] }>;
    const linha = pedidos[0].itens.join(" | ");
    expect(linha).toContain("Promoção: Pizza G + Guaraná 1L grátis");
    expect(linha).toContain("Sabor: Calabresa");
    expect(linha).toContain("Inclui: Guarana 1L grátis");
    expect(linha).toContain("Preço promocional");
  });

  it("ignora preço adulterado pelo cliente e cobra o preço configurado", async () => {
    const res = await POST(postReq({ ...basePedido, itens: [{ ...itemPromo, price: 0.01 }] }));
    const data = await res.json();
    expect(data.total).toBe(49.9);
  });

  it("rejeita promoção inexistente ou inativa", async () => {
    store.set(PROMOS_KEY, [{ ...promo, active: false }]);
    const res = await POST(postReq(basePedido));
    expect(res.status).toBe(400);

    store.set(PROMOS_KEY, []);
    const res2 = await POST(postReq(basePedido));
    expect(res2.status).toBe(400);
  });

  it("rejeita quantidade acima do limite por pedido", async () => {
    store.set(PROMOS_KEY, [{ ...promo, maxUsesPerOrder: 1 }]);
    const res = await POST(postReq({ ...basePedido, itens: [{ ...itemPromo, qty: 2 }] }));
    expect(res.status).toBe(400);
  });

  it("rejeita promoção com brinde esgotado", async () => {
    store.set("esgotados", ["Guarana 1L"]);
    const res = await POST(postReq(basePedido));
    expect(res.status).toBe(400);
  });

  it("rejeita sabor escolhido esgotado", async () => {
    store.set("esgotados", ["Calabresa"]);
    const res = await POST(postReq(basePedido));
    expect(res.status).toBe(400);
  });

  it("fluxo normal sem promoção continua funcionando", async () => {
    const res = await POST(postReq({ ...basePedido, itens: [{ kind: "simple", name: "Refrigerante 2L", detail: "", price: 15, qty: 1 }] }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.total).toBe(15);
  });
});

// [6ª revisão de segurança, ponto 1] Antes desta correção, a rota validava a
// promoção (ativa/dentro da janela/produto esgotado) ANTES de consultar
// :result/pedido-por-hash. Se o pedido já tivesse sido criado com sucesso
// mas a resposta original se perdesse (timeout), e a promoção expirasse ou
// o brinde ficasse esgotado ANTES do retry, a rota rejeitaria o retry
// legítimo com 400 em vez de devolver o pedido já criado. Agora a
// recuperação de idempotência roda antes: o retry encontra o pedido pelo
// hash e devolve o MESMO pedido, nunca reavaliando a promoção contra o
// estado atual (possivelmente já mudado).
describe("[6ª revisão] recuperação de idempotência roda antes da validação (mutável) da promoção", () => {
  it("promoção expira/fica inativa entre a criação e o retry: retry com o MESMO clientRequestId devolve o MESMO pedido, nunca 400", async () => {
    process.env.SURVIVAL_MODE_ENABLED = "true";
    try {
      const clientRequestId = "retry-apos-promo-expirar-0000001";
      const r1 = await POST(postReq({ ...basePedido, clientRequestId }));
      expect(r1.status).toBe(200);
      const body1 = await r1.json();

      // A promoção deixa de existir/fica inativa ANTES do retry.
      store.set(PROMOS_KEY, [{ ...promo, active: false }]);

      // Simula resposta perdida: :result/:claim desaparecem, só o pedido
      // real (com o hash) resta.
      const chaveResultado = `survival:idempotencia:pedido:${clientRequestId}:result`;
      const chaveClaim = `survival:idempotencia:pedido:${clientRequestId}:claim`;
      store.delete(chaveResultado);
      store.delete(chaveClaim);

      const retry = await POST(postReq({ ...basePedido, clientRequestId }));
      expect(retry.status).toBe(200);
      const body2 = await retry.json();
      expect(body2.pedidoId).toBe(body1.pedidoId);
      expect((store.get("pedidos") as unknown[]).length).toBe(1); // nunca duplica
    } finally {
      delete process.env.SURVIVAL_MODE_ENABLED;
    }
  });

  it("brinde da promoção fica esgotado entre a criação e o retry: retry com o MESMO clientRequestId devolve o MESMO pedido, nunca 400", async () => {
    process.env.SURVIVAL_MODE_ENABLED = "true";
    try {
      const clientRequestId = "retry-apos-brinde-esgotar-0000001";
      const r1 = await POST(postReq({ ...basePedido, clientRequestId }));
      expect(r1.status).toBe(200);
      const body1 = await r1.json();

      // O brinde fica esgotado ANTES do retry.
      store.set("esgotados", ["Guarana 1L"]);

      const chaveResultado = `survival:idempotencia:pedido:${clientRequestId}:result`;
      const chaveClaim = `survival:idempotencia:pedido:${clientRequestId}:claim`;
      store.delete(chaveResultado);
      store.delete(chaveClaim);

      const retry = await POST(postReq({ ...basePedido, clientRequestId }));
      expect(retry.status).toBe(200);
      const body2 = await retry.json();
      expect(body2.pedidoId).toBe(body1.pedidoId);
      expect((store.get("pedidos") as unknown[]).length).toBe(1);
    } finally {
      delete process.env.SURVIVAL_MODE_ENABLED;
    }
  });
});
