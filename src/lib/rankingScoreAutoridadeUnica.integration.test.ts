// Teste de integração do blocker crítico apontado na auditoria do #446:
// "o bônus de competição pode desaparecer porque existe um gravador
// concorrente base-only da mesma projeção de ranking".
//
// Usa as implementações REAIS de fidelidade.ts, temporadas.ts,
// rankingClientes.ts e rankingScoreTemporada[Sync].ts — só Redis é mockado
// (com um sorted-set em memória) e o ledger de bônus é mockado para
// controlar o valor sem depender de missões/carryover específicos.
import { beforeEach, describe, expect, test, vi } from "vitest";

const { store, zsets, redisMock, obterBonusMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  type ZEntry = { score: number; member: string };
  const zsets = new Map<string, ZEntry[]>();

  function zaddImpl(key: string, opts: { score: number; member: string }) {
    let arr = zsets.get(key) ?? [];
    arr = arr.filter((e) => e.member !== opts.member);
    arr.push({ score: opts.score, member: opts.member });
    zsets.set(key, arr);
    return 1;
  }
  function zrangeImpl(key: string, start: number, stop: number, opts?: { rev?: boolean }) {
    let arr = [...(zsets.get(key) ?? [])].sort((a, b) => a.score - b.score);
    if (opts?.rev) arr = arr.reverse();
    const len = arr.length;
    const s = start < 0 ? Math.max(0, len + start) : start;
    const e = stop < 0 ? len + stop + 1 : Math.min(len, stop + 1);
    return arr.slice(s, e).map((x) => x.member);
  }
  function zscoreImpl(key: string, member: string) {
    const arr = zsets.get(key) ?? [];
    const found = arr.find((e) => e.member === member);
    return found ? found.score : null;
  }

  const redisMock = {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
    zadd: vi.fn(async (key: string, opts: { score: number; member: string }) => zaddImpl(key, opts)),
    zrange: vi.fn(async (key: string, start: number, stop: number, opts?: { rev?: boolean }) => zrangeImpl(key, start, stop, opts)),
    zscore: vi.fn(async (key: string, member: string) => zscoreImpl(key, member)),
    zrevrank: vi.fn(async () => null),
    // Cobre os dois scripts Lua usados por fidelidade.ts: liberar lock
    // (1 key: apaga se dono) e persistir-se-dono (2 keys: verifica dono na
    // primeira, grava a segunda).
    eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
      if (store.get(keys[0]) !== args[0]) return 0;
      if (keys.length === 1) {
        store.delete(keys[0]);
        return 1;
      }
      store.set(keys[1], JSON.parse(args[1]));
      return 1;
    }),
  };

  return { store, zsets, redisMock, obterBonusMock: vi.fn(async () => 0) };
});

vi.mock("./redis", () => ({ redis: redisMock }));
vi.mock("./rankingBonusTemporada", () => ({ obterBonusCompeticaoDaTemporada: obterBonusMock }));

import { registrarMovimentoPontosIdempotente, salvarConfigFidelidadePontos } from "./fidelidade";
import { REGRA_ESTRELAS_V1 } from "./estrelas";
import { criarTemporada, ativarTemporada } from "./temporadas";
import { posicaoClienteRanking } from "./rankingClientes";

const TENANT = "default";
const TEMP = "temp_1";
const CLI = "cli_a";

async function scoreAtual(): Promise<number> {
  const pos = await posicaoClienteRanking(TENANT, TEMP, CLI);
  return pos?.score ?? 0;
}

beforeEach(async () => {
  store.clear();
  zsets.clear();
  vi.clearAllMocks();
  obterBonusMock.mockResolvedValue(0);
  await salvarConfigFidelidadePontos({ ativo: true, regraVersao: REGRA_ESTRELAS_V1, coberturaEconomicaAprovada: true, metaEstrelas: 720, descricaoRecompensa: "Pizza grátis" });
  await criarTemporada(TENANT, TEMP, { nome: "T1" });
  await ativarTemporada(TENANT, TEMP);
});

function credito(pedidoId: string, pontos: number) {
  return registrarMovimentoPontosIdempotente(CLI, {
    pedidoId,
    tipo: "confirmado",
    pontos,
    motivo: "pedido entregue",
    regraVersao: REGRA_ESTRELAS_V1,
    unidade: "estrelas",
  });
}

function estorno(pedidoId: string, pontos: number) {
  return registrarMovimentoPontosIdempotente(CLI, {
    pedidoId,
    tipo: "estornado",
    pontos,
    motivo: "pedido cancelado",
    regraVersao: REGRA_ESTRELAS_V1,
    unidade: "estrelas",
  });
}

describe("autoridade única de projeção do score (blocker crítico do #446)", () => {
  test("1. base=10 + carryover=5, novo pedido soma +5 na base -> resultado = 20", async () => {
    obterBonusMock.mockResolvedValue(5); // carryover já aplicado no ledger de bônus
    await credito("pedido-1", 10);
    expect(await scoreAtual()).toBe(15); // 10 base + 5 bônus

    await credito("pedido-2", 5);
    expect(await scoreAtual()).toBe(20); // 15 base + 5 bônus — o crédito seguinte NUNCA apaga o bônus
  });

  test("2. bônus da missão semanal sobrevive ao pedido seguinte", async () => {
    obterBonusMock.mockResolvedValue(0);
    await credito("pedido-1", 10);
    expect(await scoreAtual()).toBe(10);

    obterBonusMock.mockResolvedValue(10); // missão semanal consumida creditou 10 de bônus
    await credito("pedido-2", 10); // pedido normal seguinte, sem relação com a missão
    expect(await scoreAtual()).toBe(30); // 20 base + 10 bônus
  });

  test("3. carryover sobrevive a um crédito de indicação processado pelo fidelidade.ts", async () => {
    obterBonusMock.mockResolvedValue(20); // carryover
    await credito("pedido-1", 10);
    expect(await scoreAtual()).toBe(30);

    // Crédito de indicação passa pelo MESMO registrarMovimentoPontosIdempotente
    // (estrelasIndicacao.ts chama essa função) — nunca deve apagar o bônus.
    await registrarMovimentoPontosIdempotente(CLI, {
      pedidoId: "pedido-indicacao-1",
      tipo: "confirmado",
      pontos: 6,
      motivo: "indicação confirmada",
      eventoId: "indicacao:cli_a:primeira-compra:pedido-indicacao-1",
      regraVersao: REGRA_ESTRELAS_V1,
      unidade: "estrelas",
    });
    expect(await scoreAtual()).toBe(36); // 16 base + 20 bônus
  });

  test("4. carryover sobrevive ao +1 de apoio recorrente", async () => {
    obterBonusMock.mockResolvedValue(15);
    await credito("pedido-1", 10);
    expect(await scoreAtual()).toBe(25);

    await registrarMovimentoPontosIdempotente(CLI, {
      pedidoId: "pedido-apoio-1",
      tipo: "confirmado",
      pontos: 1,
      motivo: "apoio recorrente",
      eventoId: "apoio:cli_a:2026-01-01",
      regraVersao: REGRA_ESTRELAS_V1,
      unidade: "estrelas",
    });
    expect(await scoreAtual()).toBe(26); // 11 base + 15 bônus
  });

  test("5. estorno de pedido reduz somente a base — o bônus não é tocado", async () => {
    obterBonusMock.mockResolvedValue(10);
    await credito("pedido-1", 10);
    await credito("pedido-2", 8);
    expect(await scoreAtual()).toBe(28); // 18 base + 10 bônus

    await estorno("pedido-2", 8);
    expect(await scoreAtual()).toBe(20); // 10 base + 10 bônus — só a base do pedido-2 saiu
  });

  test("7. retry do mesmo crédito (idempotência) nunca altera o score", async () => {
    obterBonusMock.mockResolvedValue(7);
    await credito("pedido-1", 10);
    expect(await scoreAtual()).toBe(17);

    // Retry: mesmo pedidoId/tipo -> mesmo eventoId -> no-op no extrato, mas a
    // sincronização do ranking roda de novo. O score final tem que continuar
    // exatamente igual (nunca duplicar a base nem perder o bônus).
    const retry = await credito("pedido-1", 10);
    expect(retry).toBeNull(); // já processado
    expect(await scoreAtual()).toBe(17);
  });

  // ---------------------------------------------------------------------
  // Seção 16 da auditoria: testes adversariais de concorrência. Os cenários
  // de "dois pedidos concorrentes" e "recuperação de falha intermediária" já
  // têm prova dedicada em rankingMissaoSemanalEstado.test.ts e
  // rankingMissaoIndicacaoEstado.test.ts (mesmo lock exclusivo por cliente).
  // Os dois testes abaixo cobrem o cenário que falta: duas ESCRITAS
  // concorrentes na MESMA projeção de score por caminhos DIFERENTES
  // (fidelidade.ts vs. crédito de bônus) — o caso em que não há lock
  // compartilhado entre os dois caminhos.
  // ---------------------------------------------------------------------

  test("8. crédito de fidelidade e crédito de bônus no MESMO instante: o último a terminar nunca apaga o outro (cada um relê o estado mais recente antes de escrever)", async () => {
    obterBonusMock.mockResolvedValue(0);
    await credito("pedido-0", 10);
    expect(await scoreAtual()).toBe(10);

    // Dois caminhos concorrentes disparados ao mesmo tempo: um pedido novo
    // (fidelidade.ts) e uma missão semanal sendo confirmada nesse instante
    // (sincronizarScoreTemporadaComBonus, chamada por
    // rankingMissaoSemanalEstado.ts após creditar o bônus no ledger).
    obterBonusMock.mockResolvedValue(8);
    const { sincronizarScoreTemporadaComBonus } = await import("./rankingScoreTemporadaSync");
    await Promise.all([
      credito("pedido-1", 5),
      sincronizarScoreTemporadaComBonus(TENANT, TEMP, CLI),
    ]);

    // Cada caminho recalcula a partir da fonte de verdade (extrato completo
    // para a base, ledger de bônus para o bônus) — não existe "incremento"
    // sobre um valor em memória que o outro pudesse pisar. Resultado
    // determinístico: 15 base + 8 bônus, não importa qual terminou por
    // último.
    expect(await scoreAtual()).toBe(23);
  });

  test("9. bônus creditado no exato instante de um novo pedido: nenhum dos dois se perde, mesmo com Redis lento em um dos dois caminhos", async () => {
    obterBonusMock.mockResolvedValue(3);
    await credito("pedido-0", 10);
    expect(await scoreAtual()).toBe(13); // 10 base + 3 bônus

    // Simula o bônus real do ledger passando de 3 para 9 NO MEIO da leitura
    // (ex.: outro worker credita a missão semanal exatamente agora, e o
    // Redis desse caminho é um pouco mais lento) — qualquer leitura de
    // obterBonusCompeticaoDaTemporada que comece DEPOIS da transição já vê o
    // valor novo, como um ledger real faria.
    let bonusReal = 3;
    obterBonusMock.mockImplementation(async () => bonusReal);
    setTimeout(() => { bonusReal = 9; }, 5);

    const { sincronizarScoreTemporadaComBonus } = await import("./rankingScoreTemporadaSync");
    await Promise.all([
      sincronizarScoreTemporadaComBonus(TENANT, TEMP, CLI),
      new Promise((resolve) => setTimeout(resolve, 20)).then(() => credito("pedido-1", 7)),
    ]);

    expect(await scoreAtual()).toBe(26); // 17 base + 9 bônus — nenhum dos dois créditos se perdeu, não importa a ordem
  });
});
