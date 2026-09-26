import { beforeEach, describe, expect, test, vi } from "vitest";

const { store, redisMock, obterConfigGamificacaoMock, creditarBonusMock, estornarBonusMock, registrarFatoMock, sincronizarScoreMock } = vi.hoisted(() => {
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
    eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
      if (store.get(keys[0]) !== args[0]) return 0;
      store.delete(keys[0]);
      return 1;
    }),
  };
  return {
    store,
    redisMock,
    obterConfigGamificacaoMock: vi.fn(),
    creditarBonusMock: vi.fn(async () => "creditado" as const),
    estornarBonusMock: vi.fn(async () => "estornado" as const),
    registrarFatoMock: vi.fn(async () => true),
    sincronizarScoreMock: vi.fn(async () => undefined),
  };
});

vi.mock("./redis", () => ({ redis: redisMock }));
vi.mock("./rankingGamificacaoConfig", () => ({ obterConfigGamificacao: obterConfigGamificacaoMock }));
vi.mock("./rankingBonusTemporada", () => ({ creditarBonusCompeticao: creditarBonusMock, estornarBonusCompeticao: estornarBonusMock }));
vi.mock("./rankingGamificacaoFatos", () => ({ registrarFatoRankingGamificacao: registrarFatoMock }));
vi.mock("./rankingScoreTemporadaSync", () => ({ sincronizarScoreTemporadaComBonus: sincronizarScoreMock }));

import { concluirMissaoIndicacaoNoPedido, reverterMissaoIndicacaoDoPedido, obterEstadoMissaoIndicacao } from "./rankingMissaoIndicacaoEstado";

const T = "default";
const TEMP = "temp_1";
const CLI = "cli_indicador";

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  creditarBonusMock.mockResolvedValue("creditado");
  estornarBonusMock.mockResolvedValue("estornado");
  registrarFatoMock.mockResolvedValue(true);
  sincronizarScoreMock.mockResolvedValue(undefined);
});

describe("concluirMissaoIndicacaoNoPedido", () => {
  test("fail-closed: sem missaoIndicacaoAtiva, nunca conclui nem credita", async () => {
    obterConfigGamificacaoMock.mockResolvedValue({ missaoIndicacaoAtiva: false, missaoIndicacaoBonus: 50 });
    const resultado = await concluirMissaoIndicacaoNoPedido({ tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-1", agora: new Date() });
    expect(resultado).toEqual({ concluida: false, bonusCreditado: 0 });
    expect(creditarBonusMock).not.toHaveBeenCalled();
  });

  test("conclui e credita o bônus configurado", async () => {
    obterConfigGamificacaoMock.mockResolvedValue({ missaoIndicacaoAtiva: true, missaoIndicacaoBonus: 40 });
    const resultado = await concluirMissaoIndicacaoNoPedido({ tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-1", agora: new Date("2026-01-10T00:00:00Z") });
    expect(resultado).toEqual({ concluida: true, bonusCreditado: 40 });
    expect(creditarBonusMock).toHaveBeenCalledWith(expect.objectContaining({
      // eventoId inclui o pedidoId (correção de blocker — ver rankingMissaoIndicacaoEstado.ts).
      tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: `missaoIndicacao:${TEMP}:${CLI}:pedido-1`, tipo: "missao_indicacao", pontos: 40,
    }));
    expect(registrarFatoMock).toHaveBeenCalledWith("missao_indicacao_concluida", `${CLI}:${TEMP}:pedido-1`);
    expect((await obterEstadoMissaoIndicacao(T, TEMP, CLI)).concluida).toBe(true);
  });

  test("nunca duplica — segunda indicação na mesma temporada não conclui de novo", async () => {
    obterConfigGamificacaoMock.mockResolvedValue({ missaoIndicacaoAtiva: true, missaoIndicacaoBonus: 40 });
    await concluirMissaoIndicacaoNoPedido({ tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-1", agora: new Date() });
    creditarBonusMock.mockClear();
    registrarFatoMock.mockClear();
    const resultado = await concluirMissaoIndicacaoNoPedido({ tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-2", agora: new Date() });
    expect(resultado).toEqual({ concluida: false, bonusCreditado: 0 });
    expect(creditarBonusMock).not.toHaveBeenCalled();
  });

  test("sem bônus configurado (0), conclui a missão mas não credita nada", async () => {
    obterConfigGamificacaoMock.mockResolvedValue({ missaoIndicacaoAtiva: true, missaoIndicacaoBonus: 0 });
    const resultado = await concluirMissaoIndicacaoNoPedido({ tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-1", agora: new Date() });
    expect(resultado).toEqual({ concluida: true, bonusCreditado: 0 });
    expect(creditarBonusMock).not.toHaveBeenCalled();
  });

  test("BLOCKER: duas indicações quase simultâneas do mesmo indicador nunca concluem/creditam duas vezes", async () => {
    obterConfigGamificacaoMock.mockResolvedValue({ missaoIndicacaoAtiva: true, missaoIndicacaoBonus: 40 });
    const [r1, r2] = await Promise.all([
      concluirMissaoIndicacaoNoPedido({ tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-A", agora: new Date() }),
      concluirMissaoIndicacaoNoPedido({ tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-B", agora: new Date() }),
    ]);
    const concluidos = [r1, r2].filter((r) => r.concluida);
    expect(concluidos).toHaveLength(1);
    expect(creditarBonusMock).toHaveBeenCalledTimes(1);
  }, 10000);

  test("RECUPERAÇÃO DE FALHA: crédito falha após reservar — retry do mesmo pedido conclui sem duplicar", async () => {
    obterConfigGamificacaoMock.mockResolvedValue({ missaoIndicacaoAtiva: true, missaoIndicacaoBonus: 40 });
    creditarBonusMock.mockRejectedValueOnce(new Error("timeout"));

    await expect(concluirMissaoIndicacaoNoPedido({ tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-1", agora: new Date() })).rejects.toThrow("timeout");
    expect((await obterEstadoMissaoIndicacao(T, TEMP, CLI)).concluida).toBe(false);

    creditarBonusMock.mockResolvedValueOnce("creditado");
    const retry = await concluirMissaoIndicacaoNoPedido({ tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-1", agora: new Date() });
    expect(retry).toEqual({ concluida: true, bonusCreditado: 40 });
    expect(creditarBonusMock).toHaveBeenCalledTimes(2);
  });
});

describe("reverterMissaoIndicacaoDoPedido (cancelamento tardio)", () => {
  test("reverte a missão e estorna o bônus quando o pedido exato é cancelado depois", async () => {
    obterConfigGamificacaoMock.mockResolvedValue({ missaoIndicacaoAtiva: true, missaoIndicacaoBonus: 40 });
    await concluirMissaoIndicacaoNoPedido({ tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-1", agora: new Date() });

    await reverterMissaoIndicacaoDoPedido("pedido-1", "Pedido pedido-1 cancelado");

    expect(estornarBonusMock).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoIdOriginal: `missaoIndicacao:${TEMP}:${CLI}:pedido-1`,
    }));
    expect((await obterEstadoMissaoIndicacao(T, TEMP, CLI)).concluida).toBe(false);
  });

  test("pedido sem migalha é no-op — nunca estorna à toa", async () => {
    await reverterMissaoIndicacaoDoPedido("pedido-nunca-concluiu", "x");
    expect(estornarBonusMock).not.toHaveBeenCalled();
  });

  test("depois de revertida, uma NOVA indicação real pode concluir a missão de novo", async () => {
    obterConfigGamificacaoMock.mockResolvedValue({ missaoIndicacaoAtiva: true, missaoIndicacaoBonus: 40 });
    await concluirMissaoIndicacaoNoPedido({ tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-1", agora: new Date() });
    await reverterMissaoIndicacaoDoPedido("pedido-1", "cancelado");

    const resultado = await concluirMissaoIndicacaoNoPedido({ tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-2", agora: new Date() });
    expect(resultado.concluida).toBe(true);
  });
});
