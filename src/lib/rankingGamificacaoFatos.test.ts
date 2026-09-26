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
    incr: vi.fn(async (key: string) => {
      const atual = Number(store.get(key)) || 0;
      const novo = atual + 1;
      store.set(key, novo);
      return novo;
    }),
    expire: vi.fn(async () => 1),
    mget: vi.fn(async (...keys: string[]) => keys.map((k) => store.get(k) ?? null)),
  };
  return { store, redisMock };
});

vi.mock("./redis", () => ({ redis: redisMock }));

import {
  fatoRankingGamificacaoValido,
  marcarLiderancaEVerificarSeJaFoiLider,
  obterContadoresFatosRankingGamificacao,
  registrarFatoRankingGamificacao,
  TIPOS_FATO_RANKING_GAMIFICACAO,
} from "./rankingGamificacaoFatos";

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("fatoRankingGamificacaoValido", () => {
  test("aceita só a allowlist fixa", () => {
    expect(fatoRankingGamificacaoValido("subiu_posicao")).toBe(true);
    expect(fatoRankingGamificacaoValido("fato_inventado")).toBe(false);
  });
});

describe("registrarFatoRankingGamificacao", () => {
  test("primeira ocorrência grava o fato e incrementa o contador", async () => {
    const registrou = await registrarFatoRankingGamificacao("subiu_posicao", "cli_a:temp_1:2026-09-25");
    expect(registrou).toBe(true);
    const contadores = await obterContadoresFatosRankingGamificacao();
    expect(contadores.subiu_posicao).toBe(1);
  });

  test("idempotente: o mesmo eventoId nunca conta duas vezes (correção do #445 — nunca GET-array-append-SET)", async () => {
    await registrarFatoRankingGamificacao("subiu_posicao", "cli_a:temp_1:2026-09-25");
    const segunda = await registrarFatoRankingGamificacao("subiu_posicao", "cli_a:temp_1:2026-09-25");
    expect(segunda).toBe(false);
    const contadores = await obterContadoresFatosRankingGamificacao();
    expect(contadores.subiu_posicao).toBe(1);
  });

  test("eventoIds diferentes contam separadamente", async () => {
    await registrarFatoRankingGamificacao("entrou_top10", "cli_a:temp_1:2026-09-25");
    await registrarFatoRankingGamificacao("entrou_top10", "cli_b:temp_1:2026-09-25");
    const contadores = await obterContadoresFatosRankingGamificacao();
    expect(contadores.entrou_top10).toBe(2);
  });

  test("tipo fora da allowlist nunca é gravado", async () => {
    // @ts-expect-error — testando o guard em runtime
    const registrou = await registrarFatoRankingGamificacao("evento_invalido", "x");
    expect(registrou).toBe(false);
    expect(store.size).toBe(0);
  });

  test("eventoId vazio nunca é gravado", async () => {
    expect(await registrarFatoRankingGamificacao("subiu_posicao", "")).toBe(false);
  });

  test("falha do Redis nunca propaga (best-effort)", async () => {
    redisMock.set.mockRejectedValueOnce(new Error("timeout"));
    await expect(registrarFatoRankingGamificacao("subiu_posicao", "x")).resolves.toBe(false);
  });

  test("todos os tipos declarados são aceitos e contam de forma independente", async () => {
    for (const tipo of TIPOS_FATO_RANKING_GAMIFICACAO) {
      await registrarFatoRankingGamificacao(tipo, `evento:${tipo}`);
    }
    const contadores = await obterContadoresFatosRankingGamificacao();
    for (const tipo of TIPOS_FATO_RANKING_GAMIFICACAO) {
      expect(contadores[tipo]).toBe(1);
    }
  });
});

describe("marcarLiderancaEVerificarSeJaFoiLider", () => {
  test("primeira vez retorna false (nunca tinha sido líder)", async () => {
    const jaEraLider = await marcarLiderancaEVerificarSeJaFoiLider("default", "temp_1", "cli_a");
    expect(jaEraLider).toBe(false);
  });

  test("segunda chamada (já marcado) retorna true — recuperou a liderança", async () => {
    await marcarLiderancaEVerificarSeJaFoiLider("default", "temp_1", "cli_a");
    const jaEraLider = await marcarLiderancaEVerificarSeJaFoiLider("default", "temp_1", "cli_a");
    expect(jaEraLider).toBe(true);
  });

  test("clientes diferentes não compartilham a marca", async () => {
    await marcarLiderancaEVerificarSeJaFoiLider("default", "temp_1", "cli_a");
    const jaEraLiderB = await marcarLiderancaEVerificarSeJaFoiLider("default", "temp_1", "cli_b");
    expect(jaEraLiderB).toBe(false);
  });

  test("temporadas diferentes não compartilham a marca", async () => {
    await marcarLiderancaEVerificarSeJaFoiLider("default", "temp_1", "cli_a");
    const jaEraLiderNovaTemporada = await marcarLiderancaEVerificarSeJaFoiLider("default", "temp_2", "cli_a");
    expect(jaEraLiderNovaTemporada).toBe(false);
  });

  test("falha do Redis nunca propaga — assume 'primeira vez' com segurança", async () => {
    redisMock.set.mockRejectedValueOnce(new Error("timeout"));
    await expect(marcarLiderancaEVerificarSeJaFoiLider("default", "temp_1", "cli_a")).resolves.toBe(false);
  });
});
