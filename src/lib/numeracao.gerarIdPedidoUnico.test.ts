import { vi, describe, test, expect, beforeEach } from "vitest";

const redisStore = new Map<string, unknown>();
let falharProximosSets = 0;

vi.mock("./redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => (redisStore.has(key) ? redisStore.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean }) => {
      if (falharProximosSets > 0) {
        falharProximosSets -= 1;
        throw new Error("Redis indisponível (simulado)");
      }
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

import { gerarIdPedidoUnico, IdPedidoIndisponivelError } from "./numeracao";

beforeEach(() => {
  redisStore.clear();
  falharProximosSets = 0;
});

describe("gerarIdPedidoUnico", () => {
  test("no caso comum (sem colisão), devolve exatamente Date.now().toString()", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_123);
    const id = await gerarIdPedidoUnico();
    expect(id).toBe("1700000000123");
    vi.restoreAllMocks();
  });

  test("sob colisão no mesmo milissegundo (sequencial), devolve ids diferentes e puramente numéricos", async () => {
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

  // BLOQUEIO 3 da revisão externa: prova real de concorrência via Promise.all
  // (não chamadas sequenciais com await) — o mock de Redis usado aqui
  // reproduz a semântica atômica real do SET NX (checa-e-grava de forma
  // síncrona dentro do corpo da função mockada, sem nenhum await antes da
  // gravação — a mesma garantia que o SET NX real do Redis oferece por ser
  // executado de forma serializada no servidor).
  test("20 chamadas GENUINAMENTE concorrentes (Promise.all) no mesmo milissegundo: todos os ids são únicos", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_002_000);
    const ids = await Promise.all(Array.from({ length: 20 }, () => gerarIdPedidoUnico()));
    vi.restoreAllMocks();

    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
    for (const id of ids) expect(/^\d+$/.test(id)).toBe(true);
  });

  test("40 chamadas concorrentes (Promise.all) no mesmo milissegundo: todos os ids são únicos, nenhuma esgota as tentativas", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_002_500);
    const resultados = await Promise.allSettled(Array.from({ length: 40 }, () => gerarIdPedidoUnico()));
    vi.restoreAllMocks();

    const sucesso = resultados.filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled");
    expect(sucesso).toHaveLength(40);
    const ids = sucesso.map((r) => r.value);
    expect(new Set(ids).size).toBe(40);
  });

  test("chamadas concorrentes em milissegundos DIFERENTES nunca competem entre si", async () => {
    const spy = vi.spyOn(Date, "now");
    let tick = 1_700_000_003_000;
    spy.mockImplementation(() => tick++);
    const ids = await Promise.all(Array.from({ length: 15 }, () => gerarIdPedidoUnico()));
    vi.restoreAllMocks();

    expect(new Set(ids).size).toBe(15);
  });

  // BLOQUEIO 2 da revisão externa: a função nunca pode devolver um id não
  // reivindicado. Redis indisponível (SET NX lança) e esgotamento de
  // tentativas (colisão em todos os candidatos) viram erro explícito —
  // nunca um id "torcendo para não colidir".
  test("Redis indisponível (SET NX lança): nunca devolve um id, lança IdPedidoIndisponivelError", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_004_000);
    falharProximosSets = 1;
    await expect(gerarIdPedidoUnico()).rejects.toThrow(IdPedidoIndisponivelError);
    vi.restoreAllMocks();
  });

  test("todas as tentativas de desempate colidem: nunca devolve um id não reivindicado, lança IdPedidoIndisponivelError", async () => {
    const FIXO = 1_700_000_005_000;
    vi.spyOn(Date, "now").mockReturnValue(FIXO);
    // Pré-reivindica TODOS os candidatos que a função tentaria (tentativa 0..49).
    redisStore.set(`pedido_id_claim:${FIXO}`, 1);
    for (let t = 1; t < 50; t++) redisStore.set(`pedido_id_claim:${FIXO}${t}`, 1);

    await expect(gerarIdPedidoUnico()).rejects.toThrow(IdPedidoIndisponivelError);
    vi.restoreAllMocks();

    // Nenhuma chave nova foi criada além das já pré-reivindicadas — confirma
    // que a função não "inventou" um id fora do esquema de candidatos.
    const chavesClaim = [...redisStore.keys()].filter((k) => String(k).startsWith("pedido_id_claim:"));
    expect(chavesClaim).toHaveLength(50);
  });
});
