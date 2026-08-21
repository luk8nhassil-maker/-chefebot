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
const SIZE_JARRA_P = "salao-suco-maracuja-copo";
const SIZE_JARRA_G = "salao-suco-maracuja-jarra";

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("validarItensComanda — Sucos do Salão", () => {
  it("Jarra P de Maracujá ignora preço adulterado e recalcula R$20", async () => {
    const r = await validarItensComanda([
      {
        kind: "simple",
        name: "Produto forjado",
        detail: "qualquer coisa",
        price: 0.01,
        qty: 2,
        simpleSelection: { productId: PRODUCT_MARACUJA, sizeId: SIZE_JARRA_P },
      },
    ]);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.itens[0]).toMatchObject({
      kind: "simple",
      name: "Maracujá",
      detail: "Jarra P - Pequena",
      price: 20,
      qty: 2,
      simpleSelection: { productId: PRODUCT_MARACUJA, sizeId: SIZE_JARRA_P },
    });
    expect(r.total).toBe(40);
  });

  it("Jarra G de Maracujá usa R$40 e descrição correta", async () => {
    const r = await validarItensComanda([
      {
        kind: "simple",
        price: 1,
        qty: 1,
        simpleSelection: { productId: PRODUCT_MARACUJA, sizeId: SIZE_JARRA_G },
      },
    ]);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.itens[0].detail).toBe("Jarra G - Grande");
    expect(r.itens[0].price).toBe(40);
    expect(r.total).toBe(40);
  });

  it("Copo oficial continua intacto: Acerola sem leite = R$7", async () => {
    const r = await validarItensComanda([
      {
        kind: "simple",
        price: 99,
        qty: 1,
        simpleSelection: { productId: "suco-acerola", milk: "sem" },
      },
    ]);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.itens[0]).toMatchObject({ name: "Acerola", detail: "sem leite", price: 7 });
    expect(r.total).toBe(7);
  });

  it("sizeId inexistente é rejeitado", async () => {
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

  it("produto de Jarra esgotado por ID é rejeitado", async () => {
    store.set("estoque:itens", {
      [PRODUCT_MARACUJA]: { id: PRODUCT_MARACUJA, esgotado: true },
    });

    const r = await validarItensComanda([
      {
        kind: "simple",
        price: 20,
        qty: 1,
        simpleSelection: { productId: PRODUCT_MARACUJA, sizeId: SIZE_JARRA_P },
      },
    ]);

    expect(r.ok).toBe(false);
  });
});
