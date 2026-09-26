import { beforeEach, describe, expect, test, vi } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
    eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
      if (store.get(keys[0]) !== args[0]) return 0;
      store.delete(keys[0]);
      return 1;
    }),
  };
  return { store, redisMock };
});

vi.mock("./redis", () => ({ redis: redisMock }));

import { comBloqueioGamificacao } from "./rankingGamificacaoLock";

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("comBloqueioGamificacao", () => {
  test("executa a função sob lock e libera ao final", async () => {
    const resultado = await comBloqueioGamificacao("chave-1", async () => 42);
    expect(resultado).toBe(42);
    expect(store.has("chave-1")).toBe(false);
  });

  test("serializa duas chamadas concorrentes na mesma chave", async () => {
    const ordem: string[] = [];
    let liberar!: () => void;
    const bloqueio = new Promise<void>((resolve) => { liberar = resolve; });

    const primeira = comBloqueioGamificacao("chave-1", async () => {
      ordem.push("primeira-entrou");
      await bloqueio;
      ordem.push("primeira-saiu");
    });
    await new Promise((r) => setTimeout(r, 10));

    const segunda = comBloqueioGamificacao("chave-1", async () => {
      ordem.push("segunda-entrou");
    });

    liberar();
    await Promise.all([primeira, segunda]);

    expect(ordem).toEqual(["primeira-entrou", "primeira-saiu", "segunda-entrou"]);
  });

  test("libera mesmo quando a função lança", async () => {
    await expect(comBloqueioGamificacao("chave-1", async () => { throw new Error("falhou"); })).rejects.toThrow("falhou");
    expect(store.has("chave-1")).toBe(false);
  });

  test("chaves diferentes nunca se bloqueiam", async () => {
    const ordem: string[] = [];
    let liberar!: () => void;
    const bloqueio = new Promise<void>((resolve) => { liberar = resolve; });
    const p1 = comBloqueioGamificacao("chave-A", async () => { ordem.push("A-entrou"); await bloqueio; ordem.push("A-saiu"); });
    await new Promise((r) => setTimeout(r, 10));
    const p2 = comBloqueioGamificacao("chave-B", async () => { ordem.push("B-entrou"); });
    await p2;
    liberar();
    await p1;
    expect(ordem).toEqual(["A-entrou", "B-entrou", "A-saiu"]);
  });
});
