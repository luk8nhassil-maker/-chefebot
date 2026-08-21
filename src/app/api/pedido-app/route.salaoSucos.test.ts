import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, defaultSetImpl, defaultGetImpl, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
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
    eval: vi.fn(async () => 1),
  };
  return { store, defaultSetImpl, defaultGetImpl, redisMock };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));
vi.mock("@/lib/mercadoPagoPix", () => ({ criarCobrancaPixMercadoPago: vi.fn() }));

import { POST } from "./route";
import { SALAO_COOKIE, criarTokenSalao } from "@/lib/salaoAuth";

function postReq(body: unknown, salaoToken?: string) {
  return {
    json: async () => body,
    cookies: {
      get: (n: string) => (salaoToken && n === SALAO_COOKIE ? { value: salaoToken } : undefined),
    },
  } as never;
}

function itemJarraMaracuja(sizeId: string, milk?: "com" | "sem") {
  return {
    kind: "simple",
    name: "Nome adulterado",
    detail: "Preço adulterado",
    price: 0.01,
    qty: 1,
    simpleSelection: {
      productId: "salao-suco-maracuja",
      sizeId,
      ...(milk ? { milk } : {}),
    },
  };
}

const base = {
  cliente: "Mesa 7",
  tipoEntrega: "dine_in" as const,
  pagamento: "Dinheiro",
  troco: "Sem troco",
};

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  redisMock.set.mockImplementation(defaultSetImpl);
  redisMock.get.mockImplementation(defaultGetImpl);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
});

describe("POST /api/pedido-app — Sucos do Salão", () => {
  it("Jarra P de Maracujá com leite recalcula R$22 e grava a escolha", async () => {
    const token = await criarTokenSalao();
    const res = await POST(postReq({
      ...base,
      itens: [itemJarraMaracuja("salao-suco-maracuja-copo", "com")],
    }, token));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.total).toBe(22);

    const pedidos = (store.get("pedidos") ?? []) as Array<{ total: number; itensDetalhados: Array<{ name: string; detail?: string; price: number }> }>;
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].itensDetalhados[0]).toMatchObject({
      name: "Maracujá",
      detail: "Jarra P - Pequena · com leite",
      price: 22,
    });
  });

  it("Jarra G de Maracujá sem leite mantém o preço oficial de R$40", async () => {
    const token = await criarTokenSalao();
    const res = await POST(postReq({
      ...base,
      itens: [itemJarraMaracuja("salao-suco-maracuja-jarra", "sem")],
    }, token));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.total).toBe(40);

    const pedidos = (store.get("pedidos") ?? []) as Array<{ itensDetalhados: Array<{ detail?: string; price: number }> }>;
    expect(pedidos[0].itensDetalhados[0]).toMatchObject({ detail: "Jarra G - Grande · sem leite", price: 40 });
  });

  it("Copo continua usando o produto oficial existente: Acerola sem leite = R$7", async () => {
    const token = await criarTokenSalao();
    const res = await POST(postReq({
      ...base,
      itens: [{
        kind: "simple",
        name: "forjado",
        price: 99,
        qty: 1,
        simpleSelection: { productId: "suco-acerola", milk: "sem" },
      }],
    }, token));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.total).toBe(7);
  });

  it("comanda antiga de Jarra sem milk continua aceitando o preço-base", async () => {
    const token = await criarTokenSalao();
    const res = await POST(postReq({
      ...base,
      itens: [itemJarraMaracuja("salao-suco-maracuja-copo")],
    }, token));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.total).toBe(20);
  });

  it("produto de Jarra continua rejeitado no fluxo público mesmo com leite", async () => {
    const res = await POST(postReq({
      ...base,
      telefone: "85999999999",
      tipoEntrega: "retirada",
      itens: [itemJarraMaracuja("salao-suco-maracuja-copo", "com")],
    }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.ok).toBe(false);
    expect(store.get("pedidos")).toBeUndefined();
  });
});
