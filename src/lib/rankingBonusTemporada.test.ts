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
  };
  return { store, redisMock };
});

vi.mock("./redis", () => ({ redis: redisMock }));

import {
  calcularTotalBonusPorTipo,
  calcularTotalBonusTemporada,
  creditarBonusCompeticao,
  estornarBonusCompeticao,
  obterBonusCompeticaoDaTemporada,
  obterMovimentosBonusTemporada,
} from "./rankingBonusTemporada";

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

  test("eventos diferentes somam", async () => {
    await creditarBonusCompeticao({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: "e1", tipo: "missao_semanal", pontos: 20, motivo: "x" });
    await creditarBonusCompeticao({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: "e2", tipo: "missao_indicacao", pontos: 15, motivo: "x" });
    expect(await obterBonusCompeticaoDaTemporada(T, TEMP, CLI)).toBe(35);
  });

  test("nunca credita pontos zero, negativos ou não finitos (fail-closed)", async () => {
    expect(await creditarBonusCompeticao({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: "e1", tipo: "ajuste", pontos: 0, motivo: "x" })).toBe("ja_creditado");
    expect(await creditarBonusCompeticao({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: "e2", tipo: "ajuste", pontos: -10, motivo: "x" })).toBe("ja_creditado");
    expect(await creditarBonusCompeticao({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: "e3", tipo: "ajuste", pontos: NaN, motivo: "x" })).toBe("ja_creditado");
    expect(store.size).toBe(0);
  });

  test("parâmetros vazios nunca creditam", async () => {
    expect(await creditarBonusCompeticao({ tenantId: "", temporadaId: TEMP, clienteId: CLI, eventoId: "e1", tipo: "ajuste", pontos: 10, motivo: "x" })).toBe("ja_creditado");
    expect(await creditarBonusCompeticao({ tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: "", tipo: "ajuste", pontos: 10, motivo: "x" })).toBe("ja_creditado");
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
}, 10000);

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
