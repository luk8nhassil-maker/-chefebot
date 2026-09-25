import { beforeEach, describe, expect, test, vi } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return "OK";
    }),
  };
  return { store, redisMock };
});

vi.mock("./redis", () => ({ redis: redisMock }));

import {
  eventoRankingRetencaoValido,
  registrarEventoRankingRetencao,
  sanitizarDetalheEventoRankingRetencao,
  TIPOS_EVENTO_RANKING_RETENCAO,
} from "./rankingRetencaoTelemetria";

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("eventoRankingRetencaoValido", () => {
  test("aceita só a allowlist fixa", () => {
    expect(eventoRankingRetencaoValido("ranking_aberto")).toBe(true);
    expect(eventoRankingRetencaoValido("evento_inventado")).toBe(false);
    expect(eventoRankingRetencaoValido(123)).toBe(false);
  });
});

describe("sanitizarDetalheEventoRankingRetencao", () => {
  test("descarta campos fora da allowlist (nunca PII)", () => {
    expect(
      sanitizarDetalheEventoRankingRetencao({
        posicaoFaixa: "top3",
        casas: 2,
        clienteId: "cli_123",
        telefone: "11999999999",
      }),
    ).toEqual({ posicaoFaixa: "top3", casas: 2 });
  });

  test("rejeita faixa desconhecida", () => {
    expect(sanitizarDetalheEventoRankingRetencao({ posicaoFaixa: "top999" })).toEqual({});
  });

  test("casas é clampado e arredondado", () => {
    expect(sanitizarDetalheEventoRankingRetencao({ casas: -5 })).toEqual({ casas: 0 });
    expect(sanitizarDetalheEventoRankingRetencao({ casas: 10.6 })).toEqual({ casas: 11 });
    expect(sanitizarDetalheEventoRankingRetencao({ casas: 99999 })).toEqual({ casas: 999 });
  });

  test("entrada não-objeto retorna vazio", () => {
    expect(sanitizarDetalheEventoRankingRetencao(null)).toEqual({});
    expect(sanitizarDetalheEventoRankingRetencao("string")).toEqual({});
  });
});

describe("registrarEventoRankingRetencao", () => {
  test("grava evento sanitizado na lista do tenant", async () => {
    await registrarEventoRankingRetencao("default", "ranking_aberto");
    const eventos = store.get("ranking:retencao:eventos:default") as Array<{ tipo: string }>;
    expect(eventos).toHaveLength(1);
    expect(eventos[0].tipo).toBe("ranking_aberto");
  });

  test("nunca persiste campos fora da allowlist de detalhe", async () => {
    await registrarEventoRankingRetencao("default", "entrou_top3", {
      posicaoFaixa: "top3",
      clienteId: "cli_123", // simula payload malicioso vindo do cliente
    });
    const eventos = store.get("ranking:retencao:eventos:default") as Array<Record<string, unknown>>;
    expect(eventos[0]).not.toHaveProperty("clienteId");
    expect(JSON.stringify(eventos)).not.toContain("cli_123");
  });

  test("tipo inválido é ignorado silenciosamente (nunca lança)", async () => {
    // @ts-expect-error — testando o guard em runtime
    await expect(registrarEventoRankingRetencao("default", "evento_invalido")).resolves.toBeUndefined();
    expect(store.has("ranking:retencao:eventos:default")).toBe(false);
  });

  test("falha do Redis nunca propaga (best-effort)", async () => {
    redisMock.get.mockRejectedValueOnce(new Error("timeout"));
    await expect(registrarEventoRankingRetencao("default", "ranking_aberto")).resolves.toBeUndefined();
  });

  test("lista é capada e nunca cresce sem limite", async () => {
    store.set("ranking:retencao:eventos:default", Array.from({ length: 5000 }, () => ({ tipo: "ranking_aberto", criadoEm: "x" })));
    await registrarEventoRankingRetencao("default", "ranking_retorno");
    const eventos = store.get("ranking:retencao:eventos:default") as unknown[];
    expect(eventos.length).toBe(5000);
  });

  test("todos os tipos declarados na allowlist são aceitos", async () => {
    for (const tipo of TIPOS_EVENTO_RANKING_RETENCAO) {
      await expect(registrarEventoRankingRetencao("default", tipo)).resolves.toBeUndefined();
    }
  });
});
