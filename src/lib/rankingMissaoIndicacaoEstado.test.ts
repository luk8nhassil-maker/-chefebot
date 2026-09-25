import { beforeEach, describe, expect, test, vi } from "vitest";

const { store, redisMock, obterConfigGamificacaoMock, creditarBonusMock, registrarFatoMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return "OK";
    }),
  };
  return {
    store,
    redisMock,
    obterConfigGamificacaoMock: vi.fn(),
    creditarBonusMock: vi.fn(async () => "creditado" as const),
    registrarFatoMock: vi.fn(async () => true),
  };
});

vi.mock("./redis", () => ({ redis: redisMock }));
vi.mock("./rankingGamificacaoConfig", () => ({ obterConfigGamificacao: obterConfigGamificacaoMock }));
vi.mock("./rankingBonusTemporada", () => ({ creditarBonusCompeticao: creditarBonusMock }));
vi.mock("./rankingGamificacaoFatos", () => ({ registrarFatoRankingGamificacao: registrarFatoMock }));
vi.mock("./rankingScoreTemporadaSync", () => ({ sincronizarScoreTemporadaComBonus: vi.fn(async () => undefined) }));

import { concluirMissaoIndicacaoNoPedido, obterEstadoMissaoIndicacao } from "./rankingMissaoIndicacaoEstado";

const T = "default";
const TEMP = "temp_1";
const CLI = "cli_indicador";

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  creditarBonusMock.mockResolvedValue("creditado");
  registrarFatoMock.mockResolvedValue(true);
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
      tenantId: T, temporadaId: TEMP, clienteId: CLI, eventoId: `missaoIndicacao:${TEMP}:${CLI}`, tipo: "missao_indicacao", pontos: 40,
    }));
    expect(registrarFatoMock).toHaveBeenCalledWith("missao_indicacao_concluida", `${CLI}:${TEMP}`);
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
});
