import { beforeEach, describe, expect, test, vi } from "vitest";

const store = new Map<string, unknown>();
vi.mock("./redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return "OK";
    }),
  },
}));

import { sincronizarMovimentoRecente } from "./rankingMovimentoRecenteEstado";

const T = "default";
const TEMP = "temp_1";
const CLI = "cli_a";

beforeEach(() => store.clear());

describe("sincronizarMovimentoRecente", () => {
  test("primeira visita: sem visita anterior, retorna null e grava a marca", async () => {
    const resultado = await sincronizarMovimentoRecente(T, TEMP, CLI, 8);
    expect(resultado).toBeNull();
    expect(store.get(`ranking:movimentoRecente:${T}:${TEMP}:${CLI}`)).toEqual(expect.objectContaining({ posicao: 8 }));
  });

  test("segunda visita: compara contra a marca da visita anterior (nunca 'desde ontem')", async () => {
    await sincronizarMovimentoRecente(T, TEMP, CLI, 8);
    const primeiraMarca = (store.get(`ranking:movimentoRecente:${T}:${TEMP}:${CLI}`) as { em: string }).em;

    const resultado = await sincronizarMovimentoRecente(T, TEMP, CLI, 5);
    expect(resultado).toEqual({ variacao: { direcao: "subiu", casas: 3 }, desde: primeiraMarca });
  });

  test("mesma posição entre visitas: direcao 'manteve'", async () => {
    await sincronizarMovimentoRecente(T, TEMP, CLI, 8);
    const resultado = await sincronizarMovimentoRecente(T, TEMP, CLI, 8);
    expect(resultado?.variacao).toEqual({ direcao: "manteve", casas: 0 });
  });

  test("posição pior (número maior) entre visitas: direcao 'desceu'", async () => {
    await sincronizarMovimentoRecente(T, TEMP, CLI, 3);
    const resultado = await sincronizarMovimentoRecente(T, TEMP, CLI, 7);
    expect(resultado?.variacao).toEqual({ direcao: "desceu", casas: 4 });
  });

  test("clientes/temporadas diferentes não compartilham a marca", async () => {
    await sincronizarMovimentoRecente(T, TEMP, CLI, 8);
    expect(await sincronizarMovimentoRecente(T, TEMP, "cli_b", 5)).toBeNull();
    expect(await sincronizarMovimentoRecente(T, "temp_2", CLI, 5)).toBeNull();
  });

  test("parâmetros inválidos retornam null sem gravar nada", async () => {
    expect(await sincronizarMovimentoRecente("", TEMP, CLI, 8)).toBeNull();
    expect(store.size).toBe(0);
  });
});
