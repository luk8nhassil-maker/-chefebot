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

import { obterConfigGamificacao, salvarConfigGamificacao, CONFIG_GAMIFICACAO_PADRAO } from "./rankingGamificacaoConfig";

beforeEach(() => {
  store.clear();
});

describe("obterConfigGamificacao", () => {
  test("sem nada salvo, retorna o padrão fail-closed (tudo desligado)", async () => {
    const config = await obterConfigGamificacao();
    expect(config).toEqual(CONFIG_GAMIFICACAO_PADRAO);
    expect(config.missaoSemanalAtiva).toBe(false);
    expect(config.impulsoPodioAtivo).toBe(false);
    expect(config.carryoverAtivo).toBe(false);
    expect(config.nivelChefAtivo).toBe(false);
  });

  test("faz merge com o padrão — campo novo ausente numa config antiga nunca fica undefined", async () => {
    await salvarConfigGamificacao({
      ...CONFIG_GAMIFICACAO_PADRAO,
      missaoSemanalAtiva: true,
    });
    // Simula uma config salva ANTES de um campo novo existir.
    store.set("config:ranking:gamificacao", { missaoSemanalAtiva: true });
    const config = await obterConfigGamificacao();
    expect(config.missaoSemanalAtiva).toBe(true);
    expect(config.nivelChefLimiares).toEqual([]);
    expect(config.carryoverTabela).toEqual([]);
  });

  test("retorna exatamente o que foi salvo quando completo", async () => {
    const config: typeof CONFIG_GAMIFICACAO_PADRAO = {
      ...CONFIG_GAMIFICACAO_PADRAO,
      missaoSemanalAtiva: true,
      missaoSemanalMultiplicador: 3,
      carryoverAtivo: true,
      carryoverTabela: [{ posicao: 1, bonus: 100 }],
    };
    await salvarConfigGamificacao(config);
    expect(await obterConfigGamificacao()).toEqual(config);
  });
});
