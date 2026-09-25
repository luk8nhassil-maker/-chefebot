import { beforeEach, describe, expect, test, vi } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, number>();
  const redisMock = {
    incr: vi.fn(async (key: string) => {
      const atual = store.get(key) ?? 0;
      const novo = atual + 1;
      store.set(key, novo);
      return novo;
    }),
    expire: vi.fn(async () => 1),
  };
  return { store, redisMock };
});

vi.mock("./redis", () => ({ redis: redisMock }));

import {
  eventoRankingRetencaoValido,
  registrarEventoRankingRetencao,
  TIPOS_EVENTO_RANKING_RETENCAO,
} from "./rankingRetencaoTelemetria";

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("eventoRankingRetencaoValido", () => {
  test("aceita só interações client-side — fatos de negócio não fazem parte desta allowlist", () => {
    expect(eventoRankingRetencaoValido("ranking_aberto")).toBe(true);
    expect(eventoRankingRetencaoValido("cta_subir_clicado")).toBe(true);
    // Correção do #445: estes viraram FATOS server-side (rankingGamificacaoFatos.ts)
    // e nunca mais devem ser aceitos vindos do navegador aqui.
    expect(eventoRankingRetencaoValido("indicacao_convertida")).toBe(false);
    expect(eventoRankingRetencaoValido("subiu_posicao")).toBe(false);
    expect(eventoRankingRetencaoValido("entrou_top10")).toBe(false);
    expect(eventoRankingRetencaoValido("entrou_top3")).toBe(false);
    expect(eventoRankingRetencaoValido("participacao_revogada")).toBe(false);
    expect(eventoRankingRetencaoValido("evento_inventado")).toBe(false);
  });
});

describe("registrarEventoRankingRetencao (contador atômico, correção do #445)", () => {
  test("incrementa um contador por tenant+tipo+dia, nunca uma lista", async () => {
    const dia = new Date("2026-09-25T12:00:00.000Z");
    await registrarEventoRankingRetencao("default", "ranking_aberto", dia);
    expect(redisMock.incr).toHaveBeenCalledWith("ranking:retencao:contador:default:ranking_aberto:2026-09-25");
    expect(store.get("ranking:retencao:contador:default:ranking_aberto:2026-09-25")).toBe(1);
  });

  test("chamadas concorrentes no mesmo dia se acumulam via INCR atômico (nunca GET-array-append-SET)", async () => {
    const dia = new Date("2026-09-25T12:00:00.000Z");
    await Promise.all([
      registrarEventoRankingRetencao("default", "ranking_aberto", dia),
      registrarEventoRankingRetencao("default", "ranking_aberto", dia),
      registrarEventoRankingRetencao("default", "ranking_aberto", dia),
    ]);
    expect(store.get("ranking:retencao:contador:default:ranking_aberto:2026-09-25")).toBe(3);
  });

  test("dias diferentes usam chaves diferentes", async () => {
    await registrarEventoRankingRetencao("default", "ranking_aberto", new Date("2026-09-25T00:00:00.000Z"));
    await registrarEventoRankingRetencao("default", "ranking_aberto", new Date("2026-09-26T00:00:00.000Z"));
    expect(store.get("ranking:retencao:contador:default:ranking_aberto:2026-09-25")).toBe(1);
    expect(store.get("ranking:retencao:contador:default:ranking_aberto:2026-09-26")).toBe(1);
  });

  test("tipo fora da allowlist é ignorado silenciosamente (nunca lança)", async () => {
    // @ts-expect-error — testando o guard em runtime
    await expect(registrarEventoRankingRetencao("default", "evento_invalido")).resolves.toBeUndefined();
    expect(redisMock.incr).not.toHaveBeenCalled();
  });

  test("falha do Redis nunca propaga (best-effort)", async () => {
    redisMock.incr.mockRejectedValueOnce(new Error("timeout"));
    await expect(registrarEventoRankingRetencao("default", "ranking_aberto")).resolves.toBeUndefined();
  });

  test("todos os tipos declarados na allowlist são aceitos", async () => {
    for (const tipo of TIPOS_EVENTO_RANKING_RETENCAO) {
      await expect(registrarEventoRankingRetencao("default", tipo)).resolves.toBeUndefined();
    }
  });
});
