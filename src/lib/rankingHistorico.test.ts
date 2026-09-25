import { beforeEach, describe, expect, test, vi } from "vitest";

const { store, zsets, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const zsets = new Map<string, Map<string, number>>();
  function getZ(key: string): Map<string, number> {
    if (!zsets.has(key)) zsets.set(key, new Map());
    return zsets.get(key)!;
  }
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    zadd: vi.fn(async (key: string, entry: { score: number; member: string }) => {
      getZ(key).set(entry.member, entry.score);
      return 1;
    }),
    zrange: vi.fn(async (key: string, _start: number, stop: number, opts?: { rev?: boolean }) => {
      const z = getZ(key);
      const entries = Array.from(z.entries()).sort((a, b) => (opts?.rev ? b[1] - a[1] : a[1] - b[1]));
      const end = stop < 0 ? entries.length + stop + 1 : stop + 1;
      return entries.slice(0, end).map(([m]) => m);
    }),
  };
  return { store, zsets, redisMock };
});

vi.mock("./redis", () => ({ redis: redisMock }));

import {
  calcularVariacaoPosicao,
  dataReferenciaUtc,
  garantirSnapshotDiario,
  obterPosicaoAnterior,
} from "./rankingHistorico";

const TENANT = "default";
const TEMPORADA = "t2026-1";

beforeEach(() => {
  store.clear();
  zsets.clear();
  vi.clearAllMocks();
});

describe("garantirSnapshotDiario", () => {
  test("grava o snapshot na primeira chamada do dia", async () => {
    const hoje = new Date("2026-09-25T12:00:00.000Z");
    await garantirSnapshotDiario(TENANT, TEMPORADA, { cli_a: { geral: 1, participantes: 1 } }, hoje);
    expect(store.get(`ranking:snapshot:${TENANT}:${TEMPORADA}:2026-09-25`)).toEqual({
      cli_a: { geral: 1, participantes: 1 },
    });
  });

  test("nunca sobrescreve o snapshot do mesmo dia (idempotente/imutável)", async () => {
    const hoje = new Date("2026-09-25T08:00:00.000Z");
    await garantirSnapshotDiario(TENANT, TEMPORADA, { cli_a: { geral: 5, participantes: null } }, hoje);
    const maisTarde = new Date("2026-09-25T20:00:00.000Z");
    await garantirSnapshotDiario(TENANT, TEMPORADA, { cli_a: { geral: 1, participantes: 1 } }, maisTarde);
    // Continua o valor da primeira gravação do dia, não o da segunda tentativa.
    expect(store.get(`ranking:snapshot:${TENANT}:${TEMPORADA}:2026-09-25`)).toEqual({
      cli_a: { geral: 5, participantes: null },
    });
  });

  test("ignora chamadas sem tenant/temporada ou sem posições", async () => {
    await garantirSnapshotDiario("", TEMPORADA, { cli_a: { geral: 1, participantes: 1 } });
    await garantirSnapshotDiario(TENANT, "", { cli_a: { geral: 1, participantes: 1 } });
    await garantirSnapshotDiario(TENANT, TEMPORADA, {});
    expect(redisMock.set).not.toHaveBeenCalled();
  });
});

describe("obterPosicaoAnterior", () => {
  test("retorna null quando não existe nenhum snapshot anterior — nunca inventa", async () => {
    const resultado = await obterPosicaoAnterior(TENANT, TEMPORADA, "cli_a", new Date("2026-09-25T12:00:00.000Z"));
    expect(resultado).toBeNull();
  });

  test("ignora o snapshot de hoje e usa o mais recente anterior", async () => {
    await garantirSnapshotDiario(TENANT, TEMPORADA, { cli_a: { geral: 10, participantes: 5 } }, new Date("2026-09-23T12:00:00.000Z"));
    await garantirSnapshotDiario(TENANT, TEMPORADA, { cli_a: { geral: 7, participantes: 3 } }, new Date("2026-09-24T12:00:00.000Z"));
    await garantirSnapshotDiario(TENANT, TEMPORADA, { cli_a: { geral: 2, participantes: 1 } }, new Date("2026-09-25T09:00:00.000Z"));

    const resultado = await obterPosicaoAnterior(TENANT, TEMPORADA, "cli_a", new Date("2026-09-25T18:00:00.000Z"));
    // Não pega o snapshot de hoje (2026-09-25), e sim o de ontem (24).
    expect(resultado).toEqual({ geral: 7, participantes: 3 });
  });

  test("retorna null para cliente ausente do snapshot anterior", async () => {
    await garantirSnapshotDiario(TENANT, TEMPORADA, { cli_a: { geral: 1, participantes: 1 } }, new Date("2026-09-24T12:00:00.000Z"));
    const resultado = await obterPosicaoAnterior(TENANT, TEMPORADA, "cli_desconhecido", new Date("2026-09-25T12:00:00.000Z"));
    expect(resultado).toBeNull();
  });

  test("retorna null para parâmetros vazios", async () => {
    expect(await obterPosicaoAnterior("", TEMPORADA, "cli_a")).toBeNull();
    expect(await obterPosicaoAnterior(TENANT, "", "cli_a")).toBeNull();
    expect(await obterPosicaoAnterior(TENANT, TEMPORADA, "")).toBeNull();
  });
});

describe("calcularVariacaoPosicao", () => {
  test("null quando não há posição anterior — nunca infere 'manteve'", () => {
    expect(calcularVariacaoPosicao(null, 5)).toBeNull();
    expect(calcularVariacaoPosicao(undefined, 5)).toBeNull();
  });

  test("subiu quando a posição atual é numericamente menor (melhor)", () => {
    expect(calcularVariacaoPosicao(10, 4)).toEqual({ direcao: "subiu", casas: 6 });
  });

  test("desceu quando a posição atual é numericamente maior (pior)", () => {
    expect(calcularVariacaoPosicao(3, 8)).toEqual({ direcao: "desceu", casas: 5 });
  });

  test("manteve quando a posição não mudou", () => {
    expect(calcularVariacaoPosicao(5, 5)).toEqual({ direcao: "manteve", casas: 0 });
  });
});

describe("dataReferenciaUtc", () => {
  test("formata em UTC, independente do fuso local", () => {
    expect(dataReferenciaUtc(new Date("2026-01-05T23:59:59.000Z"))).toBe("2026-01-05");
  });
});
