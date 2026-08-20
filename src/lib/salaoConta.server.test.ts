import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
      const [key] = keys;
      const [token] = args;
      if (store.get(key) === token) {
        store.delete(key);
        return 1;
      }
      return 0;
    }),
  };
  return { store, redisMock };
});

vi.mock("./redis", () => ({ redis: redisMock }));
vi.mock("./comandas", () => ({
  buscarComanda: vi.fn(async () => null),
  comRodadasNormalizadas: vi.fn((value: unknown) => value),
  fecharComanda: vi.fn(async () => "nao_encontrada"),
  listarComandas: vi.fn(async () => []),
}));
vi.mock("./menu.server", () => ({ getMENUDinamico: vi.fn(async () => ({ payments: [] })) }));
vi.mock("./pedidosConcorrencia", () => ({ mutarPedidos: vi.fn() }));

import { executarMutacaoComContaAbertaSalao } from "./salaoConta.server";

const ESTADO_KEY = "salao:conta:v1:comanda-1";
const LOCK_KEY = "salao:conta:lock:v1:comanda-1";

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  delete process.env.VERCEL_ENV;
});

describe("Salão — serialização da conta", () => {
  it("executa a mutação quando a conta segue aberta e libera somente o próprio lock", async () => {
    store.set(ESTADO_KEY, {
      comandaId: "comanda-1",
      status: "aberta",
      atualizadoEm: "2026-08-19T20:00:00.000Z",
    });
    const fn = vi.fn(async () => "gravado");

    const resultado = await executarMutacaoComContaAbertaSalao("comanda-1", fn);

    expect(resultado).toEqual({ ok: true, valor: "gravado" });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(redisMock.set).toHaveBeenCalledWith(LOCK_KEY, expect.any(String), { nx: true, ex: 20 });
    expect(redisMock.eval).toHaveBeenCalledTimes(1);
    expect(store.has(LOCK_KEY)).toBe(false);
  });

  it("não executa a mutação se a conta já foi solicitada", async () => {
    store.set(ESTADO_KEY, {
      comandaId: "comanda-1",
      status: "conta_solicitada",
      atualizadoEm: "2026-08-19T20:00:00.000Z",
    });
    const fn = vi.fn(async () => "não deve gravar");

    const resultado = await executarMutacaoComContaAbertaSalao("comanda-1", fn);

    expect(resultado).toMatchObject({ ok: false, status: 409 });
    expect(fn).not.toHaveBeenCalled();
    expect(store.has(LOCK_KEY)).toBe(false);
  });

  it("recusa segunda mutação concorrente enquanto a primeira possui o lock", async () => {
    store.set(ESTADO_KEY, {
      comandaId: "comanda-1",
      status: "aberta",
      atualizadoEm: "2026-08-19T20:00:00.000Z",
    });

    let liberar!: () => void;
    const espera = new Promise<void>((resolve) => { liberar = resolve; });
    const primeira = executarMutacaoComContaAbertaSalao("comanda-1", async () => {
      await espera;
      return "primeira";
    });

    await vi.waitFor(() => expect(store.has(LOCK_KEY)).toBe(true));
    const segunda = await executarMutacaoComContaAbertaSalao("comanda-1", async () => "segunda");
    expect(segunda).toMatchObject({ ok: false, status: 409 });

    liberar();
    await expect(primeira).resolves.toEqual({ ok: true, valor: "primeira" });
    expect(store.has(LOCK_KEY)).toBe(false);
  });

  it("compare-and-delete não remove lock que já pertence a outro token", async () => {
    store.set(ESTADO_KEY, {
      comandaId: "comanda-1",
      status: "aberta",
      atualizadoEm: "2026-08-19T20:00:00.000Z",
    });

    const resultado = await executarMutacaoComContaAbertaSalao("comanda-1", async () => {
      store.set(LOCK_KEY, "novo-dono");
      return "ok";
    });

    expect(resultado).toEqual({ ok: true, valor: "ok" });
    expect(store.get(LOCK_KEY)).toBe("novo-dono");
  });
});
