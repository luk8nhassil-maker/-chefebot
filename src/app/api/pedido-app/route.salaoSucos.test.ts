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

function itemMaracuja(sizeId: string) {
  return {
    kind: "simple",
    name: "Nome adulterado",
    detail: "Preço adulterado",
    price: 0.01,
    qty: 1,
    simpleSelection: { productId: "salao-suco-maracuja", sizeId },
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

describe("POST /api/pedido-app — sucos exclusivos do Salão", () => {
  it("sessão real do Salão aceita Copo e recalcula R$20, ignorando o preço do navegador", async () => {
    const token = await criarTokenSalao();
    const res = await POST(postReq({ ...base, itens: [itemMaracuja("salao-suco-maracuja-copo")] }, token));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.total).toBe(20);

    const pedidos = (store.get("pedidos") ?? []) as Array<{ total: number; itensDetalhados: Array<{ name: string; detail?: string; price: number }> }>;
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].total).toBe(20);
    expect(pedidos[0].itensDetalhados[0]).toMatchObject({ name: "Maracujá", detail: "Tamanho Copo", price: 20 });
  });

  it("sessão real do Salão aceita Jarra pelo preço oficial de R$40", async () => {
    const token = await criarTokenSalao();
    const res = await POST(postReq({ ...base, itens: [itemMaracuja("salao-suco-maracuja-jarra")] }, token));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.total).toBe(40);
  });

  it("o mesmo productId exclusivo é rejeitado no fluxo público, mesmo com telefone e preço forjados", async () => {
    const res = await POST(postReq({
      ...base,
      telefone: "85999999999",
      tipoEntrega: "retirada",
      itens: [itemMaracuja("salao-suco-maracuja-copo")],
    }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.ok).toBe(false);
    expect(store.get("pedidos")).toBeUndefined();
  });
});
