import { beforeEach, describe, expect, test, vi } from "vitest";

const { store, redisMock, obterConfigGamificacaoMock, creditarBonusMock, estornarBonusMock, registrarFatoMock, sincronizarScoreMock, obterMovimentosBonusMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => {
      const bruto = store.get(key) ?? null;
      if (typeof bruto === "string") {
        try {
          return JSON.parse(bruto);
        } catch {
          return bruto;
        }
      }
      return bruto;
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
    eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
      if (keys.length >= 2 && args.length >= 2) {
        if (store.get(keys[0]) !== args[0]) return 0;
        store.set(keys[1], args[1]);
        for (let i = 2; i < keys.length && i < args.length; i++) {
          store.set(keys[i], i === 2 ? JSON.parse(args[i]) : args[i]);
        }
        return 1;
      }
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
    obterMovimentosBonusMock: vi.fn(async () => [] as { eventoId: string; pontos?: number }[]),
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

  test("retry do mesmo pedido preserva o bônus e o evento planejados quando a configuração muda", async () => {
    obterConfigGamificacaoMock
      .mockResolvedValueOnce({ missaoIndicacaoAtiva: true, missaoIndicacaoBonus: 40 })
      .mockResolvedValueOnce({ missaoIndicacaoAtiva: true, missaoIndicacaoBonus: 999 });
    creditarBonusMock.mockRejectedValueOnce(new Error("timeout"));

    await expect(concluirMissaoIndicacaoNoPedido({ tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-config", agora: new Date("2026-01-10T00:00:00Z") })).rejects.toThrow("timeout");

    creditarBonusMock.mockResolvedValueOnce("creditado");
    const retry = await concluirMissaoIndicacaoNoPedido({ tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-config", agora: new Date("2026-01-10T00:05:00Z") });

    expect(retry).toEqual({ concluida: true, bonusCreditado: 40 });
    expect(creditarBonusMock).toHaveBeenLastCalledWith(expect.objectContaining({ eventoId: `missaoIndicacao:${TEMP}:${CLI}:pedido-config`, pontos: 40 }));
  });

  test("BLOCKER 7: a migalha existe ANTES do crédito no ledger — crash no próprio crédito ainda deixa rastro para o cancelamento encontrar", async () => {
    obterConfigGamificacaoMock.mockResolvedValue({ missaoIndicacaoAtiva: true, missaoIndicacaoBonus: 40 });
    creditarBonusMock.mockRejectedValueOnce(new Error("ledger indisponível"));

    await expect(concluirMissaoIndicacaoNoPedido({
      tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-crash-antes-bonus", agora: new Date("2026-01-10T00:00:00Z"),
    })).rejects.toThrow("ledger indisponível");

    expect(store.get("ranking:missaoIndicacao:pedido:pedido-crash-antes-bonus")).toEqual({
      tenantId: T, temporadaId: TEMP, clienteId: CLI, bonus: 0, eventoIdBonus: `missaoIndicacao:${TEMP}:${CLI}:pedido-crash-antes-bonus`, bonusPlanejado: 40,
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
    obterMovimentosBonusMock.mockResolvedValue([{ eventoId: `missaoIndicacao:${TEMP}:${CLI}:pedido-orfao-creditado`, pontos: 40 }]);

    const resultado = await concluirMissaoIndicacaoNoPedido({
      tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-B10", agora: new Date("2026-01-10T00:00:00Z"),
    });

    expect(resultado).toEqual({ concluida: false, bonusCreditado: 0 });
    expect(creditarBonusMock).not.toHaveBeenCalled();
    const estadoFinal = await obterEstadoMissaoIndicacao(T, TEMP, CLI);
    expect(estadoFinal).toEqual(expect.objectContaining({ concluida: true, pedidoId: "pedido-orfao-creditado" }));
    expect(sincronizarScoreMock).toHaveBeenCalledWith(T, TEMP, CLI);
    expect(store.get("ranking:missaoIndicacao:pedido:pedido-orfao-creditado")).toEqual(expect.objectContaining({
      eventoIdBonus: `missaoIndicacao:${TEMP}:${CLI}:pedido-orfao-creditado`, bonus: 40,
    }));
  });

  test("BLOCKER: reconciliação de reserva órfã — pedido REAL 'entregue' SEM crédito no ledger (crash ANTES do bônus): credita exatamente o bonusPlanejado da migalha, uma única vez; outro pedido nunca rouba nem dobra", async () => {
    obterConfigGamificacaoMock.mockResolvedValue({ missaoIndicacaoAtiva: true, missaoIndicacaoBonus: 40 });
    // A reservou de verdade e a migalha foi gravada com bonusPlanejado ANTES
    // do ledger — só então o processo "morreu" (o crédito nunca rodou).
    creditarBonusMock.mockRejectedValueOnce(new Error("processo morreu antes do crédito"));
    await expect(concluirMissaoIndicacaoNoPedido({
      tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-orfao-sem-credito", agora: new Date("2026-01-10T00:00:00Z"),
    })).rejects.toThrow("processo morreu antes do crédito");
    expect(store.get("ranking:missaoIndicacao:pedido:pedido-orfao-sem-credito")).toEqual(
      expect.objectContaining({ bonusPlanejado: 40 }),
    );
    creditarBonusMock.mockClear();

    envelhecerProcessando(10);
    definirPedidoReal("pedido-orfao-sem-credito", "entregue");
    obterMovimentosBonusMock.mockResolvedValue([]); // ledger ainda não tem o crédito

    // Mesmo com a config MUDANDO depois (ex.: admin altera o bônus), a
    // reconciliação usa o valor JÁ PLANEJADO na migalha, nunca recalcula.
    obterConfigGamificacaoMock.mockResolvedValue({ missaoIndicacaoAtiva: true, missaoIndicacaoBonus: 999 });
    const resultado = await concluirMissaoIndicacaoNoPedido({
      tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-B12", agora: new Date("2026-01-10T00:10:00Z"),
    });

    // B NUNCA credita nada — a reconciliação só completou o dono original.
    expect(resultado).toEqual({ concluida: false, bonusCreditado: 0 });
    expect(creditarBonusMock).toHaveBeenCalledTimes(1);
    expect(creditarBonusMock).toHaveBeenCalledWith(expect.objectContaining({
      eventoId: `missaoIndicacao:${TEMP}:${CLI}:pedido-orfao-sem-credito`, pontos: 40,
    }));
    const estadoFinal = await obterEstadoMissaoIndicacao(T, TEMP, CLI);
    expect(estadoFinal).toEqual(expect.objectContaining({ concluida: true, pedidoId: "pedido-orfao-sem-credito" }));
    expect(sincronizarScoreMock).toHaveBeenCalledWith(T, TEMP, CLI);
  });

  test("reconciliação usa o eventoId canônico da migalha, mesmo se o formato atual de evento mudar", async () => {
    obterConfigGamificacaoMock.mockResolvedValue({ missaoIndicacaoAtiva: true, missaoIndicacaoBonus: 40 });
    store.set(`ranking:missaoIndicacao:${T}:${TEMP}:${CLI}`, { concluida: false, concluidaEm: null, pedidoId: null, processandoPedidoId: "pedido-evento-legado" });
    envelhecerProcessando(10);
    definirPedidoReal("pedido-evento-legado", "entregue");
    store.set("ranking:missaoIndicacao:pedido:pedido-evento-legado", {
      tenantId: T, temporadaId: TEMP, clienteId: CLI, bonus: 0, bonusPlanejado: 40, eventoIdBonus: "evento-canonico-legado-v1",
    });
    obterMovimentosBonusMock.mockResolvedValue([]);

    await concluirMissaoIndicacaoNoPedido({ tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-novo", agora: new Date("2026-01-10T00:10:00Z") });

    expect(creditarBonusMock).toHaveBeenCalledWith(expect.objectContaining({ eventoId: "evento-canonico-legado-v1", pontos: 40 }));
  });

  test("BLOCKER: reconciliação de reserva órfã — pedido REAL 'entregue' sem crédito no ledger, mas SEM migalha (registro legado): NUNCA inventa o valor, continua retryable", async () => {
    obterConfigGamificacaoMock.mockResolvedValue({ missaoIndicacaoAtiva: true, missaoIndicacaoBonus: 40 });
    store.set(`ranking:missaoIndicacao:${T}:${TEMP}:${CLI}`, { concluida: false, concluidaEm: null, pedidoId: null, processandoPedidoId: "pedido-legado-sem-migalha" });
    envelhecerProcessando(10);
    definirPedidoReal("pedido-legado-sem-migalha", "entregue");
    obterMovimentosBonusMock.mockResolvedValue([]);

    await expect(concluirMissaoIndicacaoNoPedido({
      tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-B13", agora: new Date("2026-01-10T00:00:00Z"),
    })).rejects.toThrow("ranking_missao_indicacao_em_processamento");

    expect(creditarBonusMock).not.toHaveBeenCalled();
    const estadoFinal = await obterEstadoMissaoIndicacao(T, TEMP, CLI);
    expect(estadoFinal).toEqual(expect.objectContaining({ concluida: false, processandoPedidoId: "pedido-legado-sem-migalha" }));
  });

  test("BLOCKER: cancelamento de A DEPOIS da reconciliação (entregue sem crédito) estorna o bônus efetivamente creditado e libera a missão para uma nova indicação", async () => {
    obterConfigGamificacaoMock.mockResolvedValue({ missaoIndicacaoAtiva: true, missaoIndicacaoBonus: 40 });
    creditarBonusMock.mockRejectedValueOnce(new Error("processo morreu antes do crédito"));
    await expect(concluirMissaoIndicacaoNoPedido({
      tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-A14", agora: new Date("2026-01-10T00:00:00Z"),
    })).rejects.toThrow();

    envelhecerProcessando(10);
    definirPedidoReal("pedido-A14", "entregue");
    obterMovimentosBonusMock.mockResolvedValue([]);
    await concluirMissaoIndicacaoNoPedido({
      tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-B14", agora: new Date("2026-01-10T00:10:00Z"),
    });
    expect((await obterEstadoMissaoIndicacao(T, TEMP, CLI)).pedidoId).toBe("pedido-A14");

    await reverterMissaoIndicacaoDoPedido("pedido-A14", "pedido A cancelado após reconciliação");

    expect(estornarBonusMock).toHaveBeenCalledWith(expect.objectContaining({ eventoIdOriginal: `missaoIndicacao:${TEMP}:${CLI}:pedido-A14` }));
    expect((await obterEstadoMissaoIndicacao(T, TEMP, CLI)).concluida).toBe(false);
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

describe("BLOCKER 4 — CAS real: lock expirado NUNCA permite uma escrita obsoleta (missão indicação)", () => {
  // Mesmo princípio adversarial já validado em rankingIndicacaoConversao.ts
  // (BLOCKER 8) e em rankingMissaoSemanalEstado.ts: simula o TTL do lock
  // expirando e OUTRO worker assumindo a MESMA chave exatamente entre a
  // leitura/decisão deste worker e a escrita CAS — nunca simula a decisão em
  // si, só intercepta o efeito colateral do "roubo" do lock.

  test("reserva: lock roubado entre o GET e o SET — nunca reporta concluída sem escrever, e nunca sobrescreve o que o outro worker já gravou", async () => {
    obterConfigGamificacaoMock.mockResolvedValue({ missaoIndicacaoAtiva: true, missaoIndicacaoBonus: 40 });

    const getPadrao = redisMock.get.getMockImplementation()!;
    redisMock.get.mockImplementationOnce(async (...args: Parameters<typeof getPadrao>) => {
      const original = await getPadrao(...args);
      store.set(`ranking:missaoIndicacao:lock:${T}:${TEMP}:${CLI}`, "token-de-outro-worker");
      store.set(`ranking:missaoIndicacao:${T}:${TEMP}:${CLI}`, JSON.stringify({
        concluida: true, concluidaEm: "2026-01-09T00:00:00.000Z", pedidoId: "pedido-outro-worker", processandoPedidoId: null,
      }));
      return original;
    });

    await expect(
      concluirMissaoIndicacaoNoPedido({ tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-A", agora: new Date("2026-01-10T00:00:00Z") }),
    ).rejects.toThrow("ranking_missao_indicacao_lock_perdido_durante_reserva");

    expect(creditarBonusMock).not.toHaveBeenCalled();
    // O estado do "outro worker" continua intacto — o worker atrasado nunca
    // escreveu por cima.
    const estadoFinal = await obterEstadoMissaoIndicacao(T, TEMP, CLI);
    expect(estadoFinal).toEqual(expect.objectContaining({ concluida: true, pedidoId: "pedido-outro-worker" }));
  });

  test("confirmação: lock roubado enquanto o crédito no ledger está em andamento — o crédito já aconteceu (idempotente), mas o estado do outro worker nunca é sobrescrito", async () => {
    obterConfigGamificacaoMock.mockResolvedValue({ missaoIndicacaoAtiva: true, missaoIndicacaoBonus: 40 });

    // O "outro worker" assume o lock e grava sua própria transição legítima
    // exatamente enquanto ESTE worker está esperando o crédito no ledger
    // (TTL do lock expirando durante uma chamada mais lenta que o normal).
    creditarBonusMock.mockImplementationOnce(async () => {
      store.set(`ranking:missaoIndicacao:lock:${T}:${TEMP}:${CLI}`, "token-de-outro-worker");
      store.set(`ranking:missaoIndicacao:${T}:${TEMP}:${CLI}`, JSON.stringify({
        concluida: true, concluidaEm: "2026-01-09T00:00:00.000Z", pedidoId: "pedido-outro-worker", processandoPedidoId: null,
      }));
      return "creditado";
    });

    await expect(
      concluirMissaoIndicacaoNoPedido({ tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-A", agora: new Date("2026-01-10T00:00:00Z") }),
    ).rejects.toThrow("ranking_missao_indicacao_lock_perdido_durante_confirmacao");

    expect(creditarBonusMock).toHaveBeenCalledTimes(1);
    const estadoFinal = await obterEstadoMissaoIndicacao(T, TEMP, CLI);
    expect(estadoFinal).toEqual(expect.objectContaining({ concluida: true, pedidoId: "pedido-outro-worker" }));
  });

  test("lock expira e NENHUM outro worker assume a chave — nunca reporta sucesso sem ter escrito, nunca deixa um estado 'processando' fantasma", async () => {
    obterConfigGamificacaoMock.mockResolvedValue({ missaoIndicacaoAtiva: true, missaoIndicacaoBonus: 40 });

    const getPadrao = redisMock.get.getMockImplementation()!;
    redisMock.get.mockImplementationOnce(async (...args: Parameters<typeof getPadrao>) => {
      const original = await getPadrao(...args);
      // TTL expira e a chave de lock simplesmente desaparece — nenhum outro
      // worker a assume.
      store.delete(`ranking:missaoIndicacao:lock:${T}:${TEMP}:${CLI}`);
      return original;
    });

    await expect(
      concluirMissaoIndicacaoNoPedido({ tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-A", agora: new Date("2026-01-10T00:00:00Z") }),
    ).rejects.toThrow("ranking_missao_indicacao_lock_perdido_durante_reserva");

    expect(creditarBonusMock).not.toHaveBeenCalled();
    const estadoFinal = await obterEstadoMissaoIndicacao(T, TEMP, CLI);
    expect(estadoFinal).toEqual(expect.objectContaining({ concluida: false, processandoPedidoId: null }));
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
