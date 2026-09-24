import { beforeEach, describe, expect, test, vi } from "vitest";

const { store, zsets, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const zsets = new Map<string, Map<string, number>>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
      const [dedupKey, ledgerKey, startKey] = keys;
      const [scoreRaw, member] = args;
      if (store.has(dedupKey)) return 0;

      store.set(dedupKey, "1");
      const zset = zsets.get(ledgerKey) ?? new Map<string, number>();
      zset.set(member, Number(scoreRaw));
      zsets.set(ledgerKey, zset);
      if (!store.has(startKey)) store.set(startKey, scoreRaw);
      return 1;
    }),
    zrange: vi.fn(async (key: string, min: number, max: number) => {
      const zset = zsets.get(key) ?? new Map<string, number>();
      return [...zset.entries()]
        .filter(([, score]) => score >= Number(min) && score <= Number(max))
        .sort((a, b) => a[1] - b[1])
        .map(([member]) => member);
    }),
  };
  return { store, zsets, redisMock };
});

vi.mock("./redis", () => ({ redis: redisMock }));

import {
  coberturaHistoricoContatos,
  customerKeyPesquisaDoTelefone,
  listarContatosPesquisa,
  obterInicioLedgerContatosPesquisa,
  registrarContatoPesquisa,
  registrarContatoPesquisaBestEffort,
} from "./pesquisaPreferenciaContatosRedis";

const DIA = 24 * 60 * 60 * 1000;
const AGORA = Date.UTC(2026, 8, 24, 12, 0, 0);
const PHONE = "5586999990001";

beforeEach(() => {
  store.clear();
  zsets.clear();
  vi.clearAllMocks();
  process.env.AUTH_SECRET = "segredo-estavel-de-teste";
  delete process.env.PESQUISA_PSEUDONYM_SECRET;
});

describe("customerKeyPesquisaDoTelefone", () => {
  test("gera pseudônimo estável sem embutir telefone", () => {
    const a = customerKeyPesquisaDoTelefone("(86) 99999-0001");
    const b = customerKeyPesquisaDoTelefone("5586999990001");

    expect(a).not.toBeNull();
    expect(a).not.toContain("86999990001");
    expect(a).not.toContain("5586999990001");
    expect(a).toBe(b);
    expect(customerKeyPesquisaDoTelefone("(86) 99999-0001")).toBe(a);
  });

  test("falha fechada sem segredo ou telefone válido", () => {
    delete process.env.AUTH_SECRET;
    expect(customerKeyPesquisaDoTelefone(PHONE)).toBeNull();

    process.env.AUTH_SECRET = "segredo";
    expect(customerKeyPesquisaDoTelefone("123")).toBeNull();
  });
});

describe("ledger de contatos", () => {
  test("registra exposição sem PII e deduplica por exposureId", async () => {
    const registro = {
      exposureId: "avaliacao-pos-entrega:pedido-123",
      questionId: "legacy-avaliacao-pos-entrega-v1",
      momentId: null,
      sentAtMs: AGORA,
      origem: "avaliacao_pos_entrega_legada" as const,
    };

    expect(
      await registrarContatoPesquisa({ telefone: PHONE, registro })
    ).toBe("registrado");
    expect(
      await registrarContatoPesquisa({ telefone: PHONE, registro })
    ).toBe("duplicado");

    expect(redisMock.eval).toHaveBeenCalledTimes(2);
    const primeira = redisMock.eval.mock.calls[0];
    const keys = primeira[1] as string[];
    const args = primeira[2] as string[];

    expect(keys.join(" ")).not.toContain(PHONE);
    expect(args.join(" ")).not.toContain(PHONE);
    expect(args[1]).toContain("legacy-avaliacao-pos-entrega-v1");
  });

  test("lista apenas contatos dos últimos 90 dias para o mesmo pseudônimo", async () => {
    await registrarContatoPesquisa({
      telefone: PHONE,
      registro: {
        exposureId: "e1",
        questionId: "legacy-avaliacao-pos-entrega-v1",
        momentId: null,
        sentAtMs: AGORA - 10 * DIA,
        origem: "avaliacao_pos_entrega_legada",
      },
    });
    await registrarContatoPesquisa({
      telefone: PHONE,
      registro: {
        exposureId: "e2",
        questionId: "research-m2-main",
        momentId: "M2",
        sentAtMs: AGORA - 2 * DIA,
        origem: "motor_preferencia",
      },
    });

    const contatos = await listarContatosPesquisa({ telefone: PHONE, agoraMs: AGORA });

    expect(contatos).toEqual([
      {
        momentId: null,
        questionId: "legacy-avaliacao-pos-entrega-v1",
        sentAtMs: AGORA - 10 * DIA,
      },
      {
        momentId: "M2",
        questionId: "research-m2-main",
        sentAtMs: AGORA - 2 * DIA,
      },
    ]);
  });

  test("registra início do ledger no primeiro contato e calcula cobertura conservadora", async () => {
    await registrarContatoPesquisa({
      telefone: PHONE,
      registro: {
        exposureId: "e1",
        questionId: "legacy-avaliacao-pos-entrega-v1",
        momentId: null,
        sentAtMs: AGORA,
        origem: "avaliacao_pos_entrega_legada",
      },
    });

    expect(await obterInicioLedgerContatosPesquisa()).toBe(AGORA);
    expect(
      coberturaHistoricoContatos({
        inicioLedgerMs: AGORA,
        agoraMs: AGORA + 13 * DIA,
      })
    ).toEqual({
      inicioLedgerIso: new Date(AGORA).toISOString(),
      cooldown14DiasCompleto: false,
      orcamento90DiasCompleto: false,
    });
    expect(
      coberturaHistoricoContatos({
        inicioLedgerMs: AGORA,
        agoraMs: AGORA + 90 * DIA,
      })
    ).toEqual({
      inicioLedgerIso: new Date(AGORA).toISOString(),
      cooldown14DiasCompleto: true,
      orcamento90DiasCompleto: true,
    });
  });

  test("best-effort nunca propaga falha operacional", async () => {
    redisMock.eval.mockRejectedValueOnce(new Error("redis indisponível"));
    await expect(
      registrarContatoPesquisaBestEffort({
        telefone: PHONE,
        registro: {
          exposureId: "e1",
          questionId: "legacy-avaliacao-pos-entrega-v1",
          momentId: null,
          sentAtMs: AGORA,
          origem: "avaliacao_pos_entrega_legada",
        },
      })
    ).resolves.toBeUndefined();
  });
});
