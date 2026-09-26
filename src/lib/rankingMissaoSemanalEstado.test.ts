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
    creditarBonusMock: vi.fn(async () => "creditado" as "creditado" | "ja_creditado"),
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

import {
  sincronizarMissaoSemanalCliente,
  consumirMissaoSemanalNoPedido,
  reverterMissaoSemanalDoPedido,
  obterEstadoMissaoSemanal,
} from "./rankingMissaoSemanalEstado";

const T = "default";
const TEMP = "temp_1";
const CLI = "cli_a";

const CONFIG_ATIVA = { missaoSemanalAtiva: true, missaoSemanalMultiplicador: 2, missaoSemanalCooldownDias: 7 };
const CONFIG_INATIVA = { missaoSemanalAtiva: false, missaoSemanalMultiplicador: 2, missaoSemanalCooldownDias: 7 };

function desbloqueada(overrides: Partial<{ ultimoPedidoElegivelEm: string | null }> = {}) {
  store.set(`ranking:missaoSemanal:${T}:${TEMP}:${CLI}`, {
    estado: { status: "desbloqueada", desbloqueadaEm: "2026-01-05T00:00:00.000Z", consumidaEm: null, consumidaPedidoId: null, processandoPedidoId: null },
    ultimoPedidoElegivelEm: overrides.ultimoPedidoElegivelEm ?? "2026-01-01T00:00:00.000Z",
  });
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  creditarBonusMock.mockResolvedValue("creditado");
  estornarBonusMock.mockResolvedValue("estornado");
  registrarFatoMock.mockResolvedValue(true);
  sincronizarScoreMock.mockResolvedValue(undefined);
  obterMovimentosBonusMock.mockResolvedValue([]);
});

// BLOCKER 5/6 — helpers só para os testes de reconciliação de reserva órfã:
// gravam o pedido REAL na chave "pedidos" e envelhecem `processandoDesdeEm`
// de um registro existente, simulando um processo que morreu de verdade há
// mais tempo que o limiar técnico.
function definirPedidoReal(id: string, status: string) {
  const pedidos = (store.get("pedidos") as { id: string; status: string }[] | undefined) ?? [];
  store.set("pedidos", [...pedidos.filter((p) => p.id !== id), { id, status }]);
}
function envelhecerProcessando(minutosAtras: number) {
  const chave = `ranking:missaoSemanal:${T}:${TEMP}:${CLI}`;
  const atual = store.get(chave) as { estado: unknown; ultimoPedidoElegivelEm: string | null; processandoDesdeEm?: string | null };
  store.set(chave, { ...atual, processandoDesdeEm: new Date(Date.now() - minutosAtras * 60 * 1000).toISOString() });
}

describe("sincronizarMissaoSemanalCliente", () => {
  test("fail-closed: sem missaoSemanalAtiva, nunca desbloqueia nem escreve no Redis", async () => {
    obterConfigGamificacaoMock.mockResolvedValue(CONFIG_INATIVA);
    const estado = await sincronizarMissaoSemanalCliente({
      tenantId: T, temporadaId: TEMP, clienteId: CLI, participaCampanha: true, posicaoAtual: 8, agora: new Date(),
    });
    expect(estado.status).toBe("inativa");
    expect(store.size).toBe(0);
  });

  test("desbloqueia e registra o fato quando fora do pódio e cooldown vencido", async () => {
    obterConfigGamificacaoMock.mockResolvedValue(CONFIG_ATIVA);
    store.set(`ranking:missaoSemanal:${T}:${TEMP}:${CLI}`, {
      estado: { status: "inativa", desbloqueadaEm: null, consumidaEm: null, consumidaPedidoId: null, processandoPedidoId: null },
      ultimoPedidoElegivelEm: new Date("2026-01-01T00:00:00Z").toISOString(),
    });
    const agora = new Date("2026-01-10T00:00:00Z");
    const estado = await sincronizarMissaoSemanalCliente({
      tenantId: T, temporadaId: TEMP, clienteId: CLI, participaCampanha: true, posicaoAtual: 8, agora,
    });
    expect(estado.status).toBe("desbloqueada");
    expect(registrarFatoMock).toHaveBeenCalledWith("missao_semanal_desbloqueada", expect.stringContaining(`${CLI}:${TEMP}:`));
  });

  test("BACKDATING: primeira avaliação de um cliente antigo usa a data real do último pedido confirmado", async () => {
    obterConfigGamificacaoMock.mockResolvedValue(CONFIG_ATIVA);
    // Nunca teve ultimoPedidoElegivelEm registrado (cliente existia antes da feature).
    const agora = new Date("2026-01-10T00:00:00Z");
    const estado = await sincronizarMissaoSemanalCliente({
      tenantId: T, temporadaId: TEMP, clienteId: CLI, participaCampanha: true, posicaoAtual: 8, agora,
      ultimoPedidoConfirmadoConhecido: "2026-01-01T00:00:00.000Z", // pedido real, 9 dias atrás
    });
    expect(estado.status).toBe("desbloqueada");
    const registro = store.get(`ranking:missaoSemanal:${T}:${TEMP}:${CLI}`) as { ultimoPedidoElegivelEm: string };
    expect(registro.ultimoPedidoElegivelEm).toBe("2026-01-01T00:00:00.000Z");
  });

  test("BACKDATING: nunca sobrescreve um ultimoPedidoElegivelEm já registrado", async () => {
    obterConfigGamificacaoMock.mockResolvedValue(CONFIG_ATIVA);
    store.set(`ranking:missaoSemanal:${T}:${TEMP}:${CLI}`, {
      estado: { status: "inativa", desbloqueadaEm: null, consumidaEm: null, consumidaPedidoId: null, processandoPedidoId: null },
      ultimoPedidoElegivelEm: "2026-01-08T00:00:00.000Z", // já registrado por um pedido real recente
    });
    await sincronizarMissaoSemanalCliente({
      tenantId: T, temporadaId: TEMP, clienteId: CLI, participaCampanha: true, posicaoAtual: 8, agora: new Date("2026-01-10T00:00:00Z"),
      ultimoPedidoConfirmadoConhecido: "2020-01-01T00:00:00.000Z", // valor antigo do extrato — não deve substituir o já registrado
    });
    const registro = store.get(`ranking:missaoSemanal:${T}:${TEMP}:${CLI}`) as { ultimoPedidoElegivelEm: string };
    expect(registro.ultimoPedidoElegivelEm).toBe("2026-01-08T00:00:00.000Z");
  });

  test("BACKDATING: sem nenhum pedido real conhecido, continua sem desbloquear (nunca inventa data)", async () => {
    obterConfigGamificacaoMock.mockResolvedValue(CONFIG_ATIVA);
    const estado = await sincronizarMissaoSemanalCliente({
      tenantId: T, temporadaId: TEMP, clienteId: CLI, participaCampanha: true, posicaoAtual: 8, agora: new Date(),
      ultimoPedidoConfirmadoConhecido: null,
    });
    expect(estado.status).toBe("inativa");
  });

  test("estado sem mudança não regrava nem dispara fato de novo", async () => {
    obterConfigGamificacaoMock.mockResolvedValue(CONFIG_ATIVA);
    const agora = new Date("2026-01-10T00:00:00Z");
    await sincronizarMissaoSemanalCliente({ tenantId: T, temporadaId: TEMP, clienteId: CLI, participaCampanha: true, posicaoAtual: 1, agora });
    registrarFatoMock.mockClear();
    redisMock.set.mockClear();
    await sincronizarMissaoSemanalCliente({ tenantId: T, temporadaId: TEMP, clienteId: CLI, participaCampanha: true, posicaoAtual: 1, agora });
    expect(registrarFatoMock).not.toHaveBeenCalled();
  });
});

describe("consumirMissaoSemanalNoPedido", () => {
  test("sem missão desbloqueada, apenas atualiza último pedido elegível (não credita nada)", async () => {
    obterConfigGamificacaoMock.mockResolvedValue(CONFIG_ATIVA);
    const resultado = await consumirMissaoSemanalNoPedido({
      tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-1", estrelasBaseDoPedido: 50, agora: new Date("2026-01-10T00:00:00Z"),
    });
    expect(resultado).toEqual({ consumida: false, bonusCreditado: 0 });
    expect(creditarBonusMock).not.toHaveBeenCalled();
    const registro = store.get(`ranking:missaoSemanal:${T}:${TEMP}:${CLI}`) as { ultimoPedidoElegivelEm: string };
    expect(registro.ultimoPedidoElegivelEm).toBe("2026-01-10T00:00:00.000Z");
  });

  test("com missão desbloqueada, consome e credita 2x no ledger de bônus", async () => {
    obterConfigGamificacaoMock.mockResolvedValue(CONFIG_ATIVA);
    desbloqueada();
    const resultado = await consumirMissaoSemanalNoPedido({
      tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-1", estrelasBaseDoPedido: 50, agora: new Date("2026-01-10T00:00:00Z"),
    });
    expect(resultado).toEqual({ consumida: true, bonusCreditado: 50 });
    expect(creditarBonusMock).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: "missaoSemanal:pedido-1", tipo: "missao_semanal", pontos: 50,
    }));
    expect(registrarFatoMock).toHaveBeenCalledWith("missao_semanal_consumida", `${CLI}:${TEMP}:pedido-1`);
    expect(sincronizarScoreMock).toHaveBeenCalledWith(T, TEMP, CLI);
    expect((await obterEstadoMissaoSemanal(T, TEMP, CLI)).status).toBe("consumida");
  });

  test("fail-closed: config desativada nunca consome nem credita", async () => {
    obterConfigGamificacaoMock.mockResolvedValue(CONFIG_INATIVA);
    desbloqueada({ ultimoPedidoElegivelEm: null });
    const resultado = await consumirMissaoSemanalNoPedido({
      tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-1", estrelasBaseDoPedido: 50, agora: new Date(),
    });
    expect(resultado).toEqual({ consumida: false, bonusCreditado: 0 });
    expect(creditarBonusMock).not.toHaveBeenCalled();
  });

  test("idempotente: consumo já concluído (retry do efeito) nunca credita de novo", async () => {
    obterConfigGamificacaoMock.mockResolvedValue(CONFIG_ATIVA);
    store.set(`ranking:missaoSemanal:${T}:${TEMP}:${CLI}`, {
      estado: { status: "consumida", desbloqueadaEm: "2026-01-05T00:00:00.000Z", consumidaEm: "2026-01-10T00:00:00.000Z", consumidaPedidoId: "pedido-1", processandoPedidoId: null },
      ultimoPedidoElegivelEm: "2026-01-10T00:00:00.000Z",
    });
    const resultado = await consumirMissaoSemanalNoPedido({
      tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-1", estrelasBaseDoPedido: 50, agora: new Date("2026-01-10T00:00:00Z"),
    });
    expect(resultado).toEqual({ consumida: false, bonusCreditado: 0 });
    expect(creditarBonusMock).not.toHaveBeenCalled();
  });

  test("BLOCKER: dois pedidos concorrentes nunca consomem a mesma missão (só um recebe o bônus)", async () => {
    obterConfigGamificacaoMock.mockResolvedValue(CONFIG_ATIVA);
    desbloqueada();

    const [r1, r2] = await Promise.all([
      consumirMissaoSemanalNoPedido({ tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-A", estrelasBaseDoPedido: 50, agora: new Date("2026-01-10T00:00:00Z") }),
      consumirMissaoSemanalNoPedido({ tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-B", estrelasBaseDoPedido: 30, agora: new Date("2026-01-10T00:00:00Z") }),
    ]);

    const consumidos = [r1, r2].filter((r) => r.consumida);
    expect(consumidos).toHaveLength(1);
    expect(creditarBonusMock).toHaveBeenCalledTimes(1);
    const estadoFinal = await obterEstadoMissaoSemanal(T, TEMP, CLI);
    expect(estadoFinal.status).toBe("consumida");
  }, 10000);

  test("RECUPERAÇÃO DE FALHA: crédito falha após reservar — retry do MESMO pedido conclui sem duplicar", async () => {
    obterConfigGamificacaoMock.mockResolvedValue(CONFIG_ATIVA);
    desbloqueada();
    creditarBonusMock.mockRejectedValueOnce(new Error("timeout no ledger"));

    await expect(consumirMissaoSemanalNoPedido({
      tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-1", estrelasBaseDoPedido: 50, agora: new Date("2026-01-10T00:00:00Z"),
    })).rejects.toThrow("timeout no ledger");

    // Estado ficou "processando" (reserva feita, bônus ainda não confirmado) — nunca "consumida" sem o bônus garantido.
    expect((await obterEstadoMissaoSemanal(T, TEMP, CLI)).status).toBe("processando");

    creditarBonusMock.mockResolvedValueOnce("creditado");
    const retry = await consumirMissaoSemanalNoPedido({
      tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-1", estrelasBaseDoPedido: 50, agora: new Date("2026-01-10T00:05:00Z"),
    });
    expect(retry).toEqual({ consumida: true, bonusCreditado: 50 });
    expect(creditarBonusMock).toHaveBeenCalledTimes(2);
    expect((await obterEstadoMissaoSemanal(T, TEMP, CLI)).status).toBe("consumida");
  });

  test("RECUPERAÇÃO DE FALHA: crédito já tinha sido garantido antes da falha — retry nunca duplica o bônus", async () => {
    obterConfigGamificacaoMock.mockResolvedValue(CONFIG_ATIVA);
    desbloqueada();
    // Simula: o crédito no ledger teve sucesso, mas o processo caiu ANTES de
    // confirmar a missão (nunca chegou a "consumida"). Um retry chama o
    // ledger de novo, que responde "ja_creditado" (idempotente) — a missão
    // só precisa ser confirmada, nunca creditada duas vezes.
    creditarBonusMock.mockResolvedValueOnce("ja_creditado");
    const resultado = await consumirMissaoSemanalNoPedido({
      tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-1", estrelasBaseDoPedido: 50, agora: new Date("2026-01-10T00:00:00Z"),
    });
    expect(resultado).toEqual({ consumida: true, bonusCreditado: 50 });
    expect((await obterEstadoMissaoSemanal(T, TEMP, CLI)).status).toBe("consumida");
    // Correção de blocker: "ja_creditado" precisa repetir breadcrumb/fato/
    // sincronização de score da mesma forma que "creditado" — cada uma
    // dessas operações já é idempotente por si (SET simples, SET NX por
    // eventoId, recomputo total), então repeti-las num retry é sempre
    // seguro e necessário (sem isso, um crash bem no meio deixava a missão
    // "consumida" sem nunca ter breadcrumb para o cancelamento encontrar).
    expect(registrarFatoMock).toHaveBeenCalledWith("missao_semanal_consumida", "cli_a:temp_1:pedido-1");
    expect(sincronizarScoreMock).toHaveBeenCalledWith(T, TEMP, CLI);
    // A prova real: a migalha existe de verdade no Redis (não só "teria
    // sido escrita na primeira vez") — o cancelamento consegue encontrá-la.
    expect(store.get(`ranking:missaoSemanal:pedido:pedido-1`)).toEqual({ tenantId: T, temporadaId: TEMP, clienteId: CLI, bonus: 50 });

    await reverterMissaoSemanalDoPedido("pedido-1", "pedido cancelado após o retry");
    expect(estornarBonusMock).toHaveBeenCalledWith(expect.objectContaining({ eventoIdOriginal: "missaoSemanal:pedido-1" }));
    expect((await obterEstadoMissaoSemanal(T, TEMP, CLI)).status).toBe("desbloqueada");
  });

  test("BLOCKER 6: a migalha existe ANTES do crédito no ledger — crash no próprio crédito ainda deixa rastro para o cancelamento encontrar", async () => {
    obterConfigGamificacaoMock.mockResolvedValue(CONFIG_ATIVA);
    desbloqueada();
    creditarBonusMock.mockRejectedValueOnce(new Error("ledger indisponível"));

    await expect(consumirMissaoSemanalNoPedido({
      tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-crash-antes-bonus", estrelasBaseDoPedido: 50, agora: new Date("2026-01-10T00:00:00Z"),
    })).rejects.toThrow("ledger indisponível");

    // A migalha já existe mesmo sem NENHUM crédito real ter acontecido —
    // antes desta correção, ela só era gravada DEPOIS do crédito.
    expect(store.get("ranking:missaoSemanal:pedido:pedido-crash-antes-bonus")).toEqual({ tenantId: T, temporadaId: TEMP, clienteId: CLI, bonus: 0 });

    // Um cancelamento chega antes de qualquer retry: encontra a migalha,
    // libera a reserva (nada a estornar de verdade) e nunca fica preso.
    await reverterMissaoSemanalDoPedido("pedido-crash-antes-bonus", "pedido cancelado antes do bônus");
    expect((await obterEstadoMissaoSemanal(T, TEMP, CLI)).status).toBe("desbloqueada");
  });

  test("BLOCKER 6: outro pedido encontra a reserva 'processando' RECENTE (nunca stale) — nunca abandona silenciosamente, vira retryable", async () => {
    obterConfigGamificacaoMock.mockResolvedValue(CONFIG_ATIVA);
    desbloqueada();
    // Estado já em "processando" para pedido-A9, reservado AGORA (sem
    // envelhecer) — simula B chegando bem depois de A ter reservado, mas
    // ainda dentro da janela normal de um crédito real em andamento.
    store.set(`ranking:missaoSemanal:${T}:${TEMP}:${CLI}`, {
      estado: { status: "processando", desbloqueadaEm: "2026-01-05T00:00:00.000Z", consumidaEm: null, consumidaPedidoId: null, processandoPedidoId: "pedido-A9" },
      ultimoPedidoElegivelEm: "2026-01-01T00:00:00.000Z",
      processandoDesdeEm: new Date().toISOString(),
    });

    // pedido-B chega logo em seguida — a reserva de A é recentíssima, nunca
    // candidata a órfã. Nunca credita, nunca é tratado como "nada a fazer".
    await expect(consumirMissaoSemanalNoPedido({
      tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-B9", estrelasBaseDoPedido: 30, agora: new Date("2026-01-10T00:00:01Z"),
    })).rejects.toThrow("ranking_missao_semanal_em_processamento");

    expect(creditarBonusMock).not.toHaveBeenCalled();
    expect((await obterEstadoMissaoSemanal(T, TEMP, CLI)).processandoPedidoId).toBe("pedido-A9");
  });

  test("BLOCKER 6: reconciliação de reserva órfã — pedido REAL dono já 'cancelado': libera a reserva e uma nova compra converte normalmente", async () => {
    obterConfigGamificacaoMock.mockResolvedValue(CONFIG_ATIVA);
    desbloqueada();
    store.set(`ranking:missaoSemanal:${T}:${TEMP}:${CLI}`, {
      estado: { status: "processando", desbloqueadaEm: "2026-01-05T00:00:00.000Z", consumidaEm: null, consumidaPedidoId: null, processandoPedidoId: "pedido-orfao-cancelado" },
      ultimoPedidoElegivelEm: "2026-01-01T00:00:00.000Z",
    });
    envelhecerProcessando(10);
    definirPedidoReal("pedido-orfao-cancelado", "cancelado");
    obterMovimentosBonusMock.mockResolvedValue([]); // nada foi creditado de fato

    const resultado = await consumirMissaoSemanalNoPedido({
      tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-novo-legitimo", estrelasBaseDoPedido: 40, agora: new Date("2026-01-10T00:00:00Z"),
    });

    expect(resultado).toEqual({ consumida: true, bonusCreditado: 40 });
    expect(estornarBonusMock).toHaveBeenCalledWith(expect.objectContaining({ eventoIdOriginal: "missaoSemanal:pedido-orfao-cancelado" }));
    const estadoFinal = await obterEstadoMissaoSemanal(T, TEMP, CLI);
    expect(estadoFinal).toEqual(expect.objectContaining({ status: "consumida", consumidaPedidoId: "pedido-novo-legitimo" }));
  });

  test("BLOCKER 6: reconciliação de reserva órfã — crédito REAL já existe no ledger (só faltou confirmar): completa sozinha, outro pedido nunca dobra", async () => {
    obterConfigGamificacaoMock.mockResolvedValue(CONFIG_ATIVA);
    desbloqueada();
    store.set(`ranking:missaoSemanal:${T}:${TEMP}:${CLI}`, {
      estado: { status: "processando", desbloqueadaEm: "2026-01-05T00:00:00.000Z", consumidaEm: null, consumidaPedidoId: null, processandoPedidoId: "pedido-orfao-creditado" },
      ultimoPedidoElegivelEm: "2026-01-01T00:00:00.000Z",
    });
    envelhecerProcessando(10);
    definirPedidoReal("pedido-orfao-creditado", "entregue");
    // O ledger PROVA que o crédito real já aconteceu para este pedido.
    obterMovimentosBonusMock.mockResolvedValue([{ eventoId: "missaoSemanal:pedido-orfao-creditado" }]);

    const resultado = await consumirMissaoSemanalNoPedido({
      tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-B10", estrelasBaseDoPedido: 30, agora: new Date("2026-01-10T00:00:00Z"),
    });

    // pedido-B10 NUNCA credita nada — a reconciliação só completou o dono original.
    expect(resultado).toEqual({ consumida: false, bonusCreditado: 0 });
    expect(creditarBonusMock).not.toHaveBeenCalled();
    const estadoFinal = await obterEstadoMissaoSemanal(T, TEMP, CLI);
    expect(estadoFinal).toEqual(expect.objectContaining({ status: "consumida", consumidaPedidoId: "pedido-orfao-creditado" }));
    expect(sincronizarScoreMock).toHaveBeenCalledWith(T, TEMP, CLI);
  });

  test("BLOCKER 6: reconciliação impossível (pedido órfão não encontrado / status indeterminado) — NUNCA rouba, continua retryable", async () => {
    obterConfigGamificacaoMock.mockResolvedValue(CONFIG_ATIVA);
    desbloqueada();
    store.set(`ranking:missaoSemanal:${T}:${TEMP}:${CLI}`, {
      estado: { status: "processando", desbloqueadaEm: "2026-01-05T00:00:00.000Z", consumidaEm: null, consumidaPedidoId: null, processandoPedidoId: "pedido-fantasma" },
      ultimoPedidoElegivelEm: "2026-01-01T00:00:00.000Z",
    });
    envelhecerProcessando(10);
    // Nenhum definirPedidoReal() chamado — "pedidos" não tem esse id.
    obterMovimentosBonusMock.mockResolvedValue([]);

    await expect(consumirMissaoSemanalNoPedido({
      tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-B11", estrelasBaseDoPedido: 30, agora: new Date("2026-01-10T00:00:00Z"),
    })).rejects.toThrow("ranking_missao_semanal_em_processamento");

    // A reserva "fantasma" continua exatamente como estava — nunca roubada.
    const estadoFinal = await obterEstadoMissaoSemanal(T, TEMP, CLI);
    expect(estadoFinal).toEqual(expect.objectContaining({ status: "processando", processandoPedidoId: "pedido-fantasma" }));
  });
});

describe("reverterMissaoSemanalDoPedido", () => {
  test("reverte o consumo e estorna o bônus quando o pedido exato é cancelado", async () => {
    obterConfigGamificacaoMock.mockResolvedValue(CONFIG_ATIVA);
    desbloqueada();
    await consumirMissaoSemanalNoPedido({
      tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-1", estrelasBaseDoPedido: 50, agora: new Date("2026-01-10T00:00:00Z"),
    });

    await reverterMissaoSemanalDoPedido("pedido-1", "Pedido pedido-1 cancelado");

    expect(estornarBonusMock).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoIdOriginal: "missaoSemanal:pedido-1",
    }));
    expect(sincronizarScoreMock).toHaveBeenCalledWith(T, TEMP, CLI);
    expect(await obterEstadoMissaoSemanal(T, TEMP, CLI)).toEqual({
      status: "desbloqueada", desbloqueadaEm: "2026-01-05T00:00:00.000Z", consumidaEm: null, consumidaPedidoId: null, processandoPedidoId: null,
    });
  });

  test("pedido sem migalha (nunca consumiu nada) é no-op — nunca estorna à toa", async () => {
    await reverterMissaoSemanalDoPedido("pedido-nunca-consumiu", "x");
    expect(estornarBonusMock).not.toHaveBeenCalled();
  });

  test("idempotente: reverter duas vezes o mesmo pedido é seguro", async () => {
    obterConfigGamificacaoMock.mockResolvedValue(CONFIG_ATIVA);
    desbloqueada();
    await consumirMissaoSemanalNoPedido({
      tenantId: T, temporadaId: TEMP, clienteId: CLI, pedidoId: "pedido-1", estrelasBaseDoPedido: 50, agora: new Date("2026-01-10T00:00:00Z"),
    });
    await reverterMissaoSemanalDoPedido("pedido-1", "x");
    await expect(reverterMissaoSemanalDoPedido("pedido-1", "x")).resolves.toBeUndefined();
  });
});
