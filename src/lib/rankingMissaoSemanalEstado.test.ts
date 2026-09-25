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
    creditarBonusMock: vi.fn(async () => "creditado" as "creditado" | "ja_creditado"),
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
});

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
    // "ja_creditado" nunca gera um NOVO registro de fato/breadcrumb — só a primeira vez ("creditado") faz isso.
    expect(registrarFatoMock).not.toHaveBeenCalled();
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
