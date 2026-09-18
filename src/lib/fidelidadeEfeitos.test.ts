import { beforeEach, describe, expect, test, vi } from "vitest";

const { store, legadoMock, pontosMock, jornadaMock, estornoMock, resgateMock, reversaoJornadaMock, liberarRecompensaMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  return {
    store,
    legadoMock: vi.fn(async () => undefined),
    pontosMock: vi.fn(async () => undefined),
    jornadaMock: vi.fn(async () => null),
    estornoMock: vi.fn(async () => undefined),
    resgateMock: vi.fn(async () => undefined),
    reversaoJornadaMock: vi.fn(async () => ({ ok: true, pendenciaAberta: false })),
    liberarRecompensaMock: vi.fn(async () => undefined),
  };
});

vi.mock("./redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown, options?: { nx?: boolean }) => {
      if (options?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
      if (keys.length !== 1) return 0;
      if (store.get(keys[0]) !== args[0]) return 0;
      store.delete(keys[0]);
      return 1;
    }),
  },
}));

vi.mock("./fidelidade", () => ({
  creditarFidelidadePedido: legadoMock,
  creditarPontosPedidoEntregue: pontosMock,
  calcularPontosElegiveisPedido: vi.fn(() => 40),
  construirEventoIdPontos: vi.fn((pedidoId: string, tipo: string) => `${tipo}:${pedidoId}`),
  derivarClienteIdPorTelefone: vi.fn(() => "cli_canonico"),
  obterExtratoPontos: vi.fn(async () => [{ pedidoId: "ped_cancelado", tipo: "confirmado" }]),
  registrarMovimentoPontosIdempotente: estornoMock,
  reverterResgateConfirmado: resgateMock,
}));

vi.mock("./jornadaChef", () => ({
  processarConclusaoPedidoJornada: jornadaMock,
  reverterConclusaoPedidoJornada: reversaoJornadaMock,
  liberarRecompensaDePedidoCancelado: liberarRecompensaMock,
}));

import { processarEfeitosPedidoCancelado, processarEfeitosPedidoEntregue } from "./fidelidadeEfeitos";

const pedidoEntregue = {
  id: "ped_entregue",
  status: "entregue",
  telefone: "telefone-mascarado-teste",
  clienteId: "cli_canonico",
  total: 40,
  pizzasCount: 2,
};

beforeEach(() => {
  store.clear();
  legadoMock.mockReset().mockResolvedValue(undefined);
  pontosMock.mockReset().mockResolvedValue(undefined);
  jornadaMock.mockReset().mockResolvedValue(null);
  estornoMock.mockReset().mockResolvedValue(undefined);
  resgateMock.mockReset().mockResolvedValue(undefined);
  reversaoJornadaMock.mockReset().mockResolvedValue({ ok: true, pendenciaAberta: false });
  liberarRecompensaMock.mockReset().mockResolvedValue(undefined);
});

describe("processarEfeitosPedidoEntregue", () => {
  test("mesmo pedido repetido não duplica nenhum consumidor", async () => {
    await processarEfeitosPedidoEntregue(pedidoEntregue);
    await processarEfeitosPedidoEntregue(pedidoEntregue);

    expect(legadoMock).toHaveBeenCalledTimes(1);
    expect(pontosMock).toHaveBeenCalledTimes(1);
    expect(jornadaMock).toHaveBeenCalledTimes(1);
    expect((store.get("fidelidade:efeitos:pedido:ped_entregue:entregue") as { status: string }).status).toBe("concluido");
  });

  test("falha após o primeiro consumidor permite retry sem repetir o primeiro", async () => {
    pontosMock.mockRejectedValueOnce(new Error("falha pontos"));

    await expect(processarEfeitosPedidoEntregue(pedidoEntregue)).rejects.toThrow("falha pontos");
    expect(legadoMock).toHaveBeenCalledTimes(1);
    expect(jornadaMock).not.toHaveBeenCalled();

    await processarEfeitosPedidoEntregue(pedidoEntregue);
    expect(legadoMock).toHaveBeenCalledTimes(1);
    expect(pontosMock).toHaveBeenCalledTimes(2);
    expect(jornadaMock).toHaveBeenCalledTimes(1);
  });

  test("dois workers concorrentes não executam os efeitos em duplicidade", async () => {
    let liberarPrimeiro!: () => void;
    const bloqueio = new Promise<void>((resolve) => { liberarPrimeiro = resolve; });
    legadoMock.mockImplementationOnce(async () => { await bloqueio; });

    const primeiro = processarEfeitosPedidoEntregue(pedidoEntregue);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const segundo = processarEfeitosPedidoEntregue(pedidoEntregue);
    await expect(segundo).rejects.toThrow("fidelidade_efeitos_pedido_em_processamento");
    liberarPrimeiro();
    await primeiro;

    expect(legadoMock).toHaveBeenCalledTimes(1);
    expect(pontosMock).toHaveBeenCalledTimes(1);
    expect(jornadaMock).toHaveBeenCalledTimes(1);
  });
});

describe("processarEfeitosPedidoCancelado", () => {
  test("cancelamento repetido mantém uma única reversão por consumidor", async () => {
    const pedido = {
      ...pedidoEntregue,
      id: "ped_cancelado",
      status: "cancelado",
      statusAnterior: "entregue",
      resgateId: "resgate-1",
      recompensaJornadaId: "recompensa-1",
    };

    await processarEfeitosPedidoCancelado(pedido);
    await processarEfeitosPedidoCancelado(pedido);

    expect(estornoMock).toHaveBeenCalledTimes(1);
    expect(resgateMock).toHaveBeenCalledTimes(1);
    expect(reversaoJornadaMock).toHaveBeenCalledTimes(1);
    expect(liberarRecompensaMock).toHaveBeenCalledTimes(1);
  });
});
