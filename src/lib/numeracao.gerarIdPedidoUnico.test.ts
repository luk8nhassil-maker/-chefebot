import { vi, describe, test, expect, beforeEach } from "vitest";

const redisStore = new Map<string, unknown>();

vi.mock("./redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => (redisStore.has(key) ? redisStore.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean }) => {
      if (opts?.nx && redisStore.has(key)) return null;
      redisStore.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => (redisStore.delete(key) ? 1 : 0)),
    incr: vi.fn(async (key: string) => {
      const atual = (redisStore.get(key) as number | undefined) ?? 0;
      const novo = atual + 1;
      redisStore.set(key, novo);
      return novo;
    }),
    expire: vi.fn(async () => 1),
  },
}));

import { gerarIdPedidoUnico } from "./numeracao";

beforeEach(() => {
  redisStore.clear();
});

describe("gerarIdPedidoUnico", () => {
  test("no caso comum (sem colisão), devolve exatamente Date.now().toString()", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_123);
    const id = await gerarIdPedidoUnico();
    expect(id).toBe("1700000000123");
    vi.restoreAllMocks();
  });

  test("sob colisão no mesmo milissegundo, devolve ids diferentes e puramente numéricos", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_999);
    const idA = await gerarIdPedidoUnico();
    const idB = await gerarIdPedidoUnico();
    const idC = await gerarIdPedidoUnico();
    vi.restoreAllMocks();

    expect(new Set([idA, idB, idC]).size).toBe(3);
    for (const id of [idA, idB, idC]) expect(/^\d+$/.test(id)).toBe(true);
    expect(idA).toBe("1700000000999");
  });

  test("chamadas em milissegundos diferentes nunca precisam desempatar", async () => {
    const spy = vi.spyOn(Date, "now");
    spy.mockReturnValue(1_700_000_001_000);
    const idA = await gerarIdPedidoUnico();
    spy.mockReturnValue(1_700_000_001_001);
    const idB = await gerarIdPedidoUnico();
    vi.restoreAllMocks();

    expect(idA).toBe("1700000001000");
    expect(idB).toBe("1700000001001");
  });
});
