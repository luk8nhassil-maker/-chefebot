import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => { store.set(key, value); return "OK"; }),
    incr: vi.fn(async (key: string) => { const next = Number(store.get(key) || 0) + 1; store.set(key, next); return next; }),
    expire: vi.fn(async () => 1),
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
