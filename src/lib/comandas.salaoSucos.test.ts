import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
    incr: vi.fn(async () => 1),
    expire: vi.fn(async () => 1),
  };
  return { store, redisMock };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));

import { validarItensComanda } from "./comandas";

const PRODUCT_MARACUJA = "salao-suco-maracuja";
const SIZE_COPO = "salao-suco-maracuja-copo";
const SIZE_JARRA = "salao-suco-maracuja-jarra";

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("validarItensComanda — sucos exclusivos do Salão", () => {
  it("Copo de Maracujá ignora preço/name/detail adulterados e recalcula R$20 no servidor", async () => {
    const r = await validarItensComanda([
      {
        kind: "simple",
        name: "Produto forjado",
        detail: "Jarra por um centavo",
        price: 0.01,
        qty: 2,
        simpleSelection: { productId: PRODUCT_MARACUJA, sizeId: SIZE_COPO },
      },
    ]);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.itens[0]).toMatchObject({
      kind: "simple",
      name: "Maracujá",
      detail: "Tamanho Copo",
      price: 20,
      qty: 2,
      simpleSelection: { productId: PRODUCT_MARACUJA, sizeId: SIZE_COPO },
    });
    expect(r.total).toBe(40);
  });

  it("Jarra de Maracujá usa o preço oficial de R$40", async () => {
    const r = await validarItensComanda([
      {
        kind: "simple",
        price: 1,
        qty: 1,
        simpleSelection: { productId: PRODUCT_MARACUJA, sizeId: SIZE_JARRA },
      },
    ]);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.itens[0].detail).toBe("Tamanho Jarra");
    expect(r.itens[0].price).toBe(40);
    expect(r.total).toBe(40);
  });

  it("sizeId inexistente é rejeitado e nunca usa o preço enviado pelo navegador", async () => {
    const r = await validarItensComanda([
      {
        kind: "simple",
        name: "Maracujá",
        price: 0.01,
        qty: 1,
        simpleSelection: { productId: PRODUCT_MARACUJA, sizeId: "salao-suco-maracuja-inexistente" },
      },
    ]);

    expect(r.ok).toBe(false);
  });

  it("produto exclusivo esgotado por ID é rejeitado no Salão", async () => {
    store.set("estoque:itens", {
      [PRODUCT_MARACUJA]: { id: PRODUCT_MARACUJA, esgotado: true },
    });

    const r = await validarItensComanda([
      {
        kind: "simple",
        price: 20,
        qty: 1,
        simpleSelection: { productId: PRODUCT_MARACUJA, sizeId: SIZE_COPO },
      },
    ]);

    expect(r.ok).toBe(false);
  });
});
