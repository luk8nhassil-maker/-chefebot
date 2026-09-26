import { beforeEach, describe, expect, test, vi } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    // Valores gravados via `eval` (BLOCKER 8, escreverBonusSeDono) ficam
    // como STRING crua no Map — o GET precisa tentar o parse de volta.
    get: vi.fn(async (key: string) => {
      if (!store.has(key)) return null;
      const valor = store.get(key);
      if (typeof valor === "string") {
        try {
          return JSON.parse(valor);
        } catch {
          return valor;
        }
      }
      return valor;
    }),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
    incr: vi.fn(async (key: string) => {
      const atual = Number(store.get(key)) || 0;
      const novo = atual + 1;
      store.set(key, novo);
      return novo;
    }),
    expire: vi.fn(async () => 1),
    mget: vi.fn(async (...keys: string[]) => keys.map((k) => store.get(k) ?? null)),
    // BLOCKER 8: compare-and-set (2 keys, 2 args) — grava keys[1] só se
    // keys[0] (o lock) ainda bater com args[0]; compare-and-delete-lock
    // (1 key, 1 arg) — libera o lock só se o dono ainda bater.
    eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
      if (store.get(keys[0]) !== args[0]) return 0;
      if (keys.length >= 2 && args.length >= 2) {
        store.set(keys[1], args[1]);
        return 1;
      }
      store.delete(keys[0]);
      return 1;
    }),
  };
  return { store, redisMock };
});

vi.mock("./redis", () => ({ redis: redisMock }));

import {
  calcularTotalBonusPorTipo,
  calcularTotalBonusTemporada,
  creditarBonusCompeticao,
  creditarBonusCompeticaoComTeto,
  estornarBonusCompeticao,
  obterBonusCompeticaoDaTemporada,
  obterMovimentosBonusTemporada,
} from "./rankingBonusTemporada";
import { redis } from "./redis";

const getMock = vi.mocked(redis.get);

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

const T = "default";
const TEMP = "temp_1";
const CLI = "cli_a";

describe("creditarBonusCompeticao", () => {
  test("credita e fica disponível no total", async () => {
    const resultado = await creditarBonusCompeticao({
      tenantId: T, temporadaId: TEMP, clienteId: CLI,
      eventoId: "missaoSemanal:pedido_1", tipo: "missao_semanal", pontos: 50, motivo: "2x no pedido",
    });
    expect(resultado).toBe("creditado");
    expect(await obterBonusCompeticaoDaTemporada(T, TEMP, CLI)).toBe(50);
  });

  test("idempotente por eventoId — retry nunca duplica", async () => {
    await creditarBonusCompeticao({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: "e1", tipo: "impulso_podio", pontos: 30, motivo: "x" });
    const segunda = await creditarBonusCompeticao({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: "e1", tipo: "impulso_podio", pontos: 30, motivo: "x" });
    expect(segunda).toBe("ja_creditado");
    expect(await obterBonusCompeticaoDaTemporada(T, TEMP, CLI)).toBe(30);
  });

  test("guarda de reserva é avaliada dentro do lock antes de escrever", async () => {
    const resultado = await creditarBonusCompeticao({
      tenantId: T, temporadaId: TEMP, clienteId: CLI,
      eventoId: "missaoSemanal:cancelado", tipo: "missao_semanal", pontos: 50, motivo: "2x no pedido",
      podeCreditar: async () => false,
    });

    expect(resultado).toBe("invalido");
    expect(await obterBonusCompeticaoDaTemporada(T, TEMP, CLI)).toBe(0);
  });

  test("eventos diferentes somam", async () => {
    await creditarBonusCompeticao({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: "e1", tipo: "missao_semanal", pontos: 20, motivo: "x" });
    await creditarBonusCompeticao({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: "e2", tipo: "missao_indicacao", pontos: 15, motivo: "x" });
    expect(await obterBonusCompeticaoDaTemporada(T, TEMP, CLI)).toBe(35);
  });

  test("nunca credita pontos zero, negativos ou não finitos (fail-closed) — retorna 'invalido', nunca 'ja_creditado'", async () => {
    expect(await creditarBonusCompeticao({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: "e1", tipo: "ajuste", pontos: 0, motivo: "x" })).toBe("invalido");
    expect(await creditarBonusCompeticao({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: "e2", tipo: "ajuste", pontos: -10, motivo: "x" })).toBe("invalido");
    expect(await creditarBonusCompeticao({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: "e3", tipo: "ajuste", pontos: NaN, motivo: "x" })).toBe("invalido");
    expect(store.size).toBe(0);
  });

  test("parâmetros vazios nunca creditam — retorna 'invalido', nunca 'ja_creditado'", async () => {
    expect(await creditarBonusCompeticao({ tenantId: "", temporadaId: TEMP, clienteId: CLI, eventoId: "e1", tipo: "ajuste", pontos: 10, motivo: "x" })).toBe("invalido");
    expect(await creditarBonusCompeticao({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: "", tipo: "ajuste", pontos: 10, motivo: "x" })).toBe("invalido");
  });

  test("'invalido' nunca é confundido com um crédito real: um eventoId usado antes com parâmetros ruins ainda pode ser creditado de verdade depois", async () => {
    const invalido = await creditarBonusCompeticao({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: "e-recuperavel", tipo: "ajuste", pontos: -5, motivo: "x" });
    expect(invalido).toBe("invalido");
    const real = await creditarBonusCompeticao({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: "e-recuperavel", tipo: "ajuste", pontos: 5, motivo: "x" });
    expect(real).toBe("creditado");
    expect(await obterBonusCompeticaoDaTemporada(T, TEMP, CLI)).toBe(5);
  });

  test("todo crédito bem-sucedido registra o fato 'bonus_competicao_aplicado' (Telemetria V2)", async () => {
    await creditarBonusCompeticao({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: "e1", tipo: "carryover", pontos: 100, motivo: "x" });
    expect(store.get("ranking:gamificacao:fato:bonus_competicao_aplicado:e1")).toBeTruthy();
  });

  test("clientes e temporadas diferentes não compartilham saldo", async () => {
    await creditarBonusCompeticao({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: "e1", tipo: "missao_semanal", pontos: 20, motivo: "x" });
    expect(await obterBonusCompeticaoDaTemporada(T, TEMP, "cli_b")).toBe(0);
    expect(await obterBonusCompeticaoDaTemporada(T, "temp_2", CLI)).toBe(0);
  });
});

describe("estornarBonusCompeticao", () => {
  test("estorna um crédito existente e o saldo volta a 0", async () => {
    await creditarBonusCompeticao({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: "e1", tipo: "missao_semanal", pontos: 50, motivo: "x" });
    const resultado = await estornarBonusCompeticao({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoIdOriginal: "e1", motivo: "pedido cancelado" });
    expect(resultado).toBe("estornado");
    expect(await obterBonusCompeticaoDaTemporada(T, TEMP, CLI)).toBe(0);
  });

  test("idempotente — um segundo estorno do mesmo evento é no-op", async () => {
    await creditarBonusCompeticao({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: "e1", tipo: "missao_semanal", pontos: 50, motivo: "x" });
    await estornarBonusCompeticao({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoIdOriginal: "e1", motivo: "x" });
    const segunda = await estornarBonusCompeticao({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoIdOriginal: "e1", motivo: "x" });
    expect(segunda).toBe("ja_estornado");
    expect(await obterBonusCompeticaoDaTemporada(T, TEMP, CLI)).toBe(0);
  });

  test("nunca estorna um crédito que não existe (protege contra estorno fantasma)", async () => {
    const resultado = await estornarBonusCompeticao({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoIdOriginal: "nunca-existiu", motivo: "x" });
    expect(resultado).toBe("credito_nao_encontrado");
  });

  test("estorno não apaga o crédito original — auditável (soma líquida, nunca reescreve)", async () => {
    await creditarBonusCompeticao({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: "e1", tipo: "missao_semanal", pontos: 50, motivo: "x" });
    await estornarBonusCompeticao({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoIdOriginal: "e1", motivo: "x" });
    const movimentos = await obterMovimentosBonusTemporada(T, TEMP, CLI);
    expect(movimentos).toHaveLength(2);
    expect(movimentos[0].eventoId).toBe("e1");
    expect(movimentos[0].pontos).toBe(50);
    expect(movimentos[1].eventoId).toBe("estorno:e1");
    expect(movimentos[1].estornadoDeEventoId).toBe("e1");
    expect(movimentos[1].pontos).toBe(-50);
  });

  test("outros créditos da mesma temporada continuam de pé após um estorno pontual", async () => {
    await creditarBonusCompeticao({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: "e1", tipo: "missao_semanal", pontos: 50, motivo: "x" });
    await creditarBonusCompeticao({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: "e2", tipo: "carryover", pontos: 100, motivo: "x" });
    await estornarBonusCompeticao({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoIdOriginal: "e1", motivo: "x" });
    expect(await obterBonusCompeticaoDaTemporada(T, TEMP, CLI)).toBe(100);
  });
});

describe("concorrência", () => {
  test("dois créditos concorrentes (eventoIds diferentes) nunca se perdem — o lock serializa o get-then-set", async () => {
    const [r1, r2] = await Promise.all([
      creditarBonusCompeticao({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: "concorrente-1", tipo: "missao_semanal", pontos: 30, motivo: "x" }),
      creditarBonusCompeticao({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: "concorrente-2", tipo: "impulso_podio", pontos: 20, motivo: "x" }),
    ]);
    expect(r1).toBe("creditado");
    expect(r2).toBe("creditado");
    // Sem o lock, um "GET extrato → append → SET extrato" concorrente
    // perderia um dos dois créditos (o segundo SET sobrescreveria o
    // primeiro). Com o lock, a soma final tem que refletir os dois.
    expect(await obterBonusCompeticaoDaTemporada(T, TEMP, CLI)).toBe(50);
    const movimentos = await obterMovimentosBonusTemporada(T, TEMP, CLI);
    expect(movimentos).toHaveLength(2);
  });

  test("crédito e estorno concorrentes de eventos diferentes nunca se pisam", async () => {
    await creditarBonusCompeticao({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: "base", tipo: "carryover", pontos: 100, motivo: "x" });
    const [credito, estorno] = await Promise.all([
      creditarBonusCompeticao({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: "novo", tipo: "missao_semanal", pontos: 40, motivo: "x" }),
      estornarBonusCompeticao({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoIdOriginal: "base", motivo: "x" }),
    ]);
    expect(credito).toBe("creditado");
    expect(estorno).toBe("estornado");
    expect(await obterBonusCompeticaoDaTemporada(T, TEMP, CLI)).toBe(40);
  });

  test("AUDITORIA — Impulso do Pódio: N eventos concorrentes (eventoIds DIFERENTES) do mesmo cliente/temporada NUNCA ultrapassam o teto configurado", async () => {
    // Simula 5 fatos "entrou_top3" quase simultâneos (o cliente entra/sai do
    // Top 3 várias vezes rapidamente) — cada um com seu próprio eventoId,
    // cada um tentando creditar até 30 pontos, com um teto de 50 na
    // temporada. Sem a atomicidade de creditarBonusCompeticaoComTeto, cada
    // chamada podia ler "0 já aplicado" antes de qualquer uma escrever e
    // todas creditariam 30 (total 150, muito acima do teto).
    const CAP = 50;
    const BONUS_POR_EVENTO = 30;
    const calcularPontosDisponiveis = (jaAplicado: number) => Math.max(0, Math.min(BONUS_POR_EVENTO, CAP - jaAplicado));

    const resultados = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        creditarBonusCompeticaoComTeto({
          tenantId: T,
          temporadaId: TEMP,
          clienteId: CLI,
          eventoId: `top3-${i}`,
          tipo: "impulso_podio",
          calcularPontosDisponiveis,
          motivo: "Impulso do Pódio — chegou ao Top 3",
        }),
      ),
    );

    // Todas as 5 chamadas OU creditaram algo (respeitando o espaço restante,
    // possivelmente 0 pontos → "invalido") OU nunca lançaram sem sentido.
    expect(resultados.every((r) => r === "creditado" || r === "invalido")).toBe(true);

    // A prova real: a SOMA total de impulso_podio creditado nunca ultrapassa
    // o teto, não importa quantos eventos concorrentes tentaram.
    const totalCreditado = calcularTotalBonusPorTipo(await obterMovimentosBonusTemporada(T, TEMP, CLI), "impulso_podio");
    expect(totalCreditado).toBeLessThanOrEqual(CAP);
    expect(totalCreditado).toBe(CAP); // o espaço todo foi consumido, mas nunca ultrapassado
  }, 10000);
}, 10000);

describe("BLOCKER 8 — atomicidade real: um lock expirado NUNCA permite uma escrita obsoleta no ledger", () => {
  test("crédito: lock roubado entre o GET e o SET — nunca reporta 'creditado' sem ter escrito, e nunca apaga o que o outro worker já gravou", async () => {
    const getPadrao = getMock.getMockImplementation()!;
    getMock.mockImplementationOnce(async (...args: Parameters<typeof getPadrao>) => {
      // O código de negócio lê o ledger ORIGINAL (vazio) — só DEPOIS de ler
      // é que o "outro worker" rouba o lock e já grava o SEU PRÓPRIO
      // movimento (ex.: uma reconciliação concorrente legítima).
      const original = await getPadrao(...args);
      store.set(`ranking:bonus:temporada:lock:${T}:${TEMP}:${CLI}`, "token-de-outro-worker");
      store.set(`ranking:bonus:temporada:${T}:${TEMP}:${CLI}`, JSON.stringify({
        movimentos: [{ movimentoId: "outro", eventoId: "evento-outro-worker", tipo: "carryover", pontos: 100, motivo: "x", createdAt: new Date().toISOString() }],
      }));
      return original;
    });

    await expect(
      creditarBonusCompeticao({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: "evento-A", tipo: "missao_semanal", pontos: 40, motivo: "x" }),
    ).rejects.toThrow("ranking_bonus_temporada_lock_perdido_durante_credito:evento-A");

    // O movimento do outro worker continua intacto — a escrita atrasada
    // nunca sobrescreveu por cima.
    const movimentos = await obterMovimentosBonusTemporada(T, TEMP, CLI);
    expect(movimentos).toEqual([expect.objectContaining({ eventoId: "evento-outro-worker" })]);
  });

  test("estorno: lock roubado entre o GET e o SET — nunca reporta 'estornado' sem ter escrito, e nunca apaga o que o outro worker já gravou", async () => {
    await creditarBonusCompeticao({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: "evento-A", tipo: "missao_semanal", pontos: 40, motivo: "x" });

    const getPadrao = getMock.getMockImplementation()!;
    getMock.mockImplementationOnce(async (...args: Parameters<typeof getPadrao>) => {
      const original = await getPadrao(...args);
      store.set(`ranking:bonus:temporada:lock:${T}:${TEMP}:${CLI}`, "token-de-outro-worker");
      store.set(`ranking:bonus:temporada:${T}:${TEMP}:${CLI}`, JSON.stringify({
        movimentos: [
          { movimentoId: "1", eventoId: "evento-A", tipo: "missao_semanal", pontos: 40, motivo: "x", createdAt: new Date().toISOString() },
          { movimentoId: "outro", eventoId: "evento-outro-worker", tipo: "carryover", pontos: 100, motivo: "x", createdAt: new Date().toISOString() },
        ],
      }));
      return original;
    });

    await expect(
      estornarBonusCompeticao({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoIdOriginal: "evento-A", motivo: "cancelado" }),
    ).rejects.toThrow("ranking_bonus_temporada_lock_perdido_durante_estorno:evento-A");

    // O movimento do outro worker continua intacto — o estorno atrasado
    // nunca apagou/sobrescreveu por cima.
    const movimentos = await obterMovimentosBonusTemporada(T, TEMP, CLI);
    expect(movimentos.some((m) => m.eventoId === "evento-outro-worker")).toBe(true);
    expect(movimentos.some((m) => m.eventoId === "estorno:evento-A")).toBe(false);
  });
});

describe("calcularTotalBonusTemporada / calcularTotalBonusPorTipo", () => {
  test("soma líquida nunca fica negativa mesmo com estornos que superam créditos residuais de outro tipo", () => {
    const movimentos = [
      { movimentoId: "1", eventoId: "e1", tipo: "missao_semanal" as const, pontos: 10, motivo: "x", createdAt: "" },
      { movimentoId: "2", eventoId: "estorno:e1", tipo: "missao_semanal" as const, pontos: -10, motivo: "x", createdAt: "", estornadoDeEventoId: "e1" },
    ];
    expect(calcularTotalBonusTemporada(movimentos)).toBe(0);
  });

  test("total por tipo isola cada categoria", () => {
    const movimentos = [
      { movimentoId: "1", eventoId: "e1", tipo: "impulso_podio" as const, pontos: 30, motivo: "x", createdAt: "" },
      { movimentoId: "2", eventoId: "e2", tipo: "carryover" as const, pontos: 100, motivo: "x", createdAt: "" },
    ];
    expect(calcularTotalBonusPorTipo(movimentos, "impulso_podio")).toBe(30);
    expect(calcularTotalBonusPorTipo(movimentos, "carryover")).toBe(100);
    expect(calcularTotalBonusPorTipo(movimentos, "missao_indicacao")).toBe(0);
  });
});
