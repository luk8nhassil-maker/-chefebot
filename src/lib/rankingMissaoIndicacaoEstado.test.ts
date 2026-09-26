import { beforeEach, describe, expect, test, vi } from "vitest";

const { store, redisMock, obterConfigGamificacaoMock, creditarBonusMock, estornarBonusMock, registrarFatoMock, sincronizarScoreMock, obterMovimentosBonusMock } = vi.hoisted(() => {
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
    obterMovimentosBonusMock: vi.fn(async () => [] as { eventoId: string }[]),
  };
});

vi.mock("./redis", () => ({ redis: redisMock }));
vi.mock("./rankingGamificacaoConfig", () => ({ obterConfigGamificacao: obterConfigGamificacaoMock }));
vi.mock("./rankingBonusTemporada", () => ({
  creditarBonusCompeticao: creditarBonusMock,
  estornarBonusCompeticao: estornarBonusMock,
  obterMovimentosBonusTemporada: obterMovimentosBonusMock,
}));
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
  obterMovimentosBonusMock.mockResolvedValue([]);
});

// BLOCKER 7 — helpers só para os testes de reconciliação de reserva órfã.
function definirPedidoReal(id: string, status: string) {
  const pedidos = (store.get("pedidos") as { id: string; status: string }[] | undefined) ?? [];
  store.set("pedidos", [...pedidos.filter((p) => p.id !== id), { id, status }]);
}
function envelhecerProcessando(minutosAtras: number) {
  store.set(`ranking:missaoIndicacao:processandoDesdeEm:${T}:${TEMP}:${CLI}`, new Date(Date.now() - minutosAtras * 60 * 1000).toISOString());
}

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

  test("BLOCKER 7: a migalha existe ANTES do crédito no ledger — crash no próprio crédito ainda deixa rastro para o cancelamento encontrar", async () => {
    obterConfigGamificacaoMock.mockResolvedValue({ missaoIndicacaoAtiva: true, missaoIndicacaoBonus: 40 });
    creditarBonusMock.mockRejectedValueOnce(new Error("ledger indisponível"));

    await expect(concluirMissaoIndicacaoNoPedido({
      tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-crash-antes-bonus", agora: new Date("2026-01-10T00:00:00Z"),
    })).rejects.toThrow("ledger indisponível");

    expect(store.get("ranking:missaoIndicacao:pedido:pedido-crash-antes-bonus")).toEqual({
      tenantId: T, temporadaId: TEMP, clienteId: CLI, bonus: 0, eventoIdBonus: `missaoIndicacao:${TEMP}:${CLI}:pedido-crash-antes-bonus`,
    });

    await reverterMissaoIndicacaoDoPedido("pedido-crash-antes-bonus", "cancelado antes do bônus");
    expect((await obterEstadoMissaoIndicacao(T, TEMP, CLI)).concluida).toBe(false);
    expect((await obterEstadoMissaoIndicacao(T, TEMP, CLI)).processandoPedidoId).toBeNull();
  });

  test("BLOCKER 7: outro pedido encontra a reserva 'processando' RECENTE (nunca stale) — nunca abandona silenciosamente, vira retryable", async () => {
    obterConfigGamificacaoMock.mockResolvedValue({ missaoIndicacaoAtiva: true, missaoIndicacaoBonus: 40 });
    store.set(`ranking:missaoIndicacao:${T}:${TEMP}:${CLI}`, { concluida: false, concluidaEm: null, pedidoId: null, processandoPedidoId: "pedido-A9" });
    store.set(`ranking:missaoIndicacao:processandoDesdeEm:${T}:${TEMP}:${CLI}`, new Date().toISOString());

    await expect(concluirMissaoIndicacaoNoPedido({
      tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-B9", agora: new Date("2026-01-10T00:00:01Z"),
    })).rejects.toThrow("ranking_missao_indicacao_em_processamento");

    expect(creditarBonusMock).not.toHaveBeenCalled();
    expect((await obterEstadoMissaoIndicacao(T, TEMP, CLI)).processandoPedidoId).toBe("pedido-A9");
  });

  test("BLOCKER 7: reconciliação de reserva órfã — pedido REAL dono já 'cancelado': libera a reserva e uma nova indicação conclui normalmente", async () => {
    obterConfigGamificacaoMock.mockResolvedValue({ missaoIndicacaoAtiva: true, missaoIndicacaoBonus: 40 });
    store.set(`ranking:missaoIndicacao:${T}:${TEMP}:${CLI}`, { concluida: false, concluidaEm: null, pedidoId: null, processandoPedidoId: "pedido-orfao-cancelado" });
    envelhecerProcessando(10);
    definirPedidoReal("pedido-orfao-cancelado", "cancelado");
    obterMovimentosBonusMock.mockResolvedValue([]);

    const resultado = await concluirMissaoIndicacaoNoPedido({
      tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-novo-legitimo", agora: new Date("2026-01-10T00:00:00Z"),
    });

    expect(resultado).toEqual({ concluida: true, bonusCreditado: 40 });
    expect(estornarBonusMock).toHaveBeenCalledWith(expect.objectContaining({ eventoIdOriginal: `missaoIndicacao:${TEMP}:${CLI}:pedido-orfao-cancelado` }));
    const estadoFinal = await obterEstadoMissaoIndicacao(T, TEMP, CLI);
    expect(estadoFinal).toEqual(expect.objectContaining({ concluida: true, pedidoId: "pedido-novo-legitimo" }));
  });

  test("BLOCKER 7: reconciliação de reserva órfã — crédito REAL já existe no ledger (só faltou confirmar): completa sozinha, outro pedido nunca dobra", async () => {
    obterConfigGamificacaoMock.mockResolvedValue({ missaoIndicacaoAtiva: true, missaoIndicacaoBonus: 40 });
    store.set(`ranking:missaoIndicacao:${T}:${TEMP}:${CLI}`, { concluida: false, concluidaEm: null, pedidoId: null, processandoPedidoId: "pedido-orfao-creditado" });
    envelhecerProcessando(10);
    definirPedidoReal("pedido-orfao-creditado", "entregue");
    obterMovimentosBonusMock.mockResolvedValue([{ eventoId: `missaoIndicacao:${TEMP}:${CLI}:pedido-orfao-creditado` }]);

    const resultado = await concluirMissaoIndicacaoNoPedido({
      tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-B10", agora: new Date("2026-01-10T00:00:00Z"),
    });

    expect(resultado).toEqual({ concluida: false, bonusCreditado: 0 });
    expect(creditarBonusMock).not.toHaveBeenCalled();
    const estadoFinal = await obterEstadoMissaoIndicacao(T, TEMP, CLI);
    expect(estadoFinal).toEqual(expect.objectContaining({ concluida: true, pedidoId: "pedido-orfao-creditado" }));
    expect(sincronizarScoreMock).toHaveBeenCalledWith(T, TEMP, CLI);
  });

  test("BLOCKER 7: reconciliação impossível (pedido órfão não encontrado / status indeterminado) — NUNCA rouba, continua retryable", async () => {
    obterConfigGamificacaoMock.mockResolvedValue({ missaoIndicacaoAtiva: true, missaoIndicacaoBonus: 40 });
    store.set(`ranking:missaoIndicacao:${T}:${TEMP}:${CLI}`, { concluida: false, concluidaEm: null, pedidoId: null, processandoPedidoId: "pedido-fantasma" });
    envelhecerProcessando(10);
    obterMovimentosBonusMock.mockResolvedValue([]);

    await expect(concluirMissaoIndicacaoNoPedido({
      tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-B11", agora: new Date("2026-01-10T00:00:00Z"),
    })).rejects.toThrow("ranking_missao_indicacao_em_processamento");

    const estadoFinal = await obterEstadoMissaoIndicacao(T, TEMP, CLI);
    expect(estadoFinal).toEqual(expect.objectContaining({ concluida: false, processandoPedidoId: "pedido-fantasma" }));
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
