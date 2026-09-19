import { beforeEach, describe, expect, test, vi } from "vitest";

// In-memory sorted set simulation
const { zset, redisMock } = vi.hoisted(() => {
  const zsets = new Map<string, Map<string, number>>();

  function getZ(key: string): Map<string, number> {
    if (!zsets.has(key)) zsets.set(key, new Map());
    return zsets.get(key)!;
  }

  const redisMock = {
    zadd: vi.fn(async (key: string, entry: { score: number; member: string }) => {
      getZ(key).set(entry.member, entry.score);
      return 1;
    }),
    zrange: vi.fn(async (key: string, _start: number, stop: number, opts?: { rev?: boolean }) => {
      const z = getZ(key);
      const entries = Array.from(z.entries()).sort((a, b) => opts?.rev ? b[1] - a[1] : a[1] - b[1]);
      const end = stop < 0 ? entries.length + stop + 1 : stop + 1;
      return entries.slice(0, end).map(([m]) => m);
    }),
    zscore: vi.fn(async (key: string, member: string): Promise<number | null> => {
      return getZ(key).get(member) ?? null;
    }),
    zrevrank: vi.fn(async (key: string, member: string): Promise<number | null> => {
      const z = getZ(key);
      if (!z.has(member)) return null;
      const sorted = Array.from(z.entries()).sort((a, b) => b[1] - a[1]);
      const idx = sorted.findIndex(([m]) => m === member);
      return idx >= 0 ? idx : null;
    }),
    zset: zsets,
  };
  return { zset: zsets, redisMock };
});

vi.mock("./redis", () => ({ redis: redisMock }));

import { atualizarScoreRanking, obterTopRanking, posicaoClienteRanking } from "./rankingClientes";

const TENANT = "default";
const TEMPORADA = "t2026-1";

beforeEach(() => {
  zset.clear();
  vi.clearAllMocks();
});

describe("atualizarScoreRanking", () => {
  test("registra score no sorted set", async () => {
    await atualizarScoreRanking(TENANT, TEMPORADA, "cli_123", 42);
    expect(redisMock.zadd).toHaveBeenCalledWith(
      `ranking:clientes:${TENANT}:${TEMPORADA}`,
      { score: 42, member: "cli_123" }
    );
  });

  test("ignora score negativo (usa 0)", async () => {
    await atualizarScoreRanking(TENANT, TEMPORADA, "cli_123", -5);
    expect(redisMock.zadd).toHaveBeenCalledWith(
      `ranking:clientes:${TENANT}:${TEMPORADA}`,
      { score: 0, member: "cli_123" }
    );
  });

  test("ignora cliente vazio", async () => {
    await atualizarScoreRanking(TENANT, TEMPORADA, "", 10);
    expect(redisMock.zadd).not.toHaveBeenCalled();
  });
});

describe("obterTopRanking", () => {
  test("retorna array vazio quando sem dados", async () => {
    const top = await obterTopRanking(TENANT, TEMPORADA, 5);
    expect(top).toEqual([]);
  });

  test("retorna top N ordenado do maior para o menor", async () => {
    await atualizarScoreRanking(TENANT, TEMPORADA, "cli_a", 30);
    await atualizarScoreRanking(TENANT, TEMPORADA, "cli_b", 50);
    await atualizarScoreRanking(TENANT, TEMPORADA, "cli_c", 20);

    const top = await obterTopRanking(TENANT, TEMPORADA, 3);
    expect(top).toHaveLength(3);
    expect(top[0].clienteId).toBe("cli_b");
    expect(top[0].posicao).toBe(1);
    expect(top[0].score).toBe(50);
    expect(top[1].clienteId).toBe("cli_a");
    expect(top[1].posicao).toBe(2);
    expect(top[2].clienteId).toBe("cli_c");
    expect(top[2].posicao).toBe(3);
  });

  test("limita ao máximo permitido (50)", async () => {
    const top = await obterTopRanking(TENANT, TEMPORADA, 999);
    expect(redisMock.zrange).toHaveBeenCalledWith(
      expect.any(String), 0, 49, { rev: true }
    );
  });

  test("retorna vazio para tenant/temporada sem dados", async () => {
    expect(await obterTopRanking("", TEMPORADA)).toEqual([]);
    expect(await obterTopRanking(TENANT, "")).toEqual([]);
  });
});

describe("posicaoClienteRanking", () => {
  test("retorna null para cliente ausente do ranking", async () => {
    expect(await posicaoClienteRanking(TENANT, TEMPORADA, "cli_z")).toBeNull();
  });

  test("retorna posição e score corretos", async () => {
    await atualizarScoreRanking(TENANT, TEMPORADA, "cli_a", 30);
    await atualizarScoreRanking(TENANT, TEMPORADA, "cli_b", 50);

    const pos = await posicaoClienteRanking(TENANT, TEMPORADA, "cli_a");
    expect(pos).not.toBeNull();
    expect(pos!.posicao).toBe(2);
    expect(pos!.score).toBe(30);

    const pos1 = await posicaoClienteRanking(TENANT, TEMPORADA, "cli_b");
    expect(pos1!.posicao).toBe(1);
  });

  test("retorna null para parâmetros vazios", async () => {
    expect(await posicaoClienteRanking("", TEMPORADA, "cli_a")).toBeNull();
    expect(await posicaoClienteRanking(TENANT, TEMPORADA, "")).toBeNull();
  });
});
