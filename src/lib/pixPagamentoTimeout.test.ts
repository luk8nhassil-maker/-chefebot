import { beforeEach, describe, expect, test, vi } from "vitest";
import { PIX_PAGAMENTO_AVISO_PENDENTE_MS, PIX_PAGAMENTO_CANCELAMENTO_MS } from "./pixAutoCheckConfig";

type PedidoTeste = {
  id: string;
  numero?: number;
  cliente: string;
  telefone: string;
  total: number;
  taxaEntrega?: number;
  status: string;
  pixConfirmado: boolean;
  pix: {
    provider: string;
    providerPaymentId?: string;
    status?: string;
    criadoEm: string;
  };
  resgateId?: string;
};

const mocks = vi.hoisted(() => ({
  pedidos: [] as PedidoTeste[],
  store: new Map<string, unknown>(),
  consultaProvider: vi.fn(),
  cancelaProvider: vi.fn(),
  reconciliar: vi.fn(),
  enviarWhatsApp: vi.fn(),
  encerrar: vi.fn(),
  registrarPontos: vi.fn(),
  reverterResgate: vi.fn(),
  reverterJornada: vi.fn(),
  liberarRecompensa: vi.fn(),
}));

vi.mock("./redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => key === "pedidos" ? structuredClone(mocks.pedidos) : (mocks.store.get(key) ?? null)),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean }) => {
      if (opts?.nx && mocks.store.has(key)) return null;
      mocks.store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => mocks.store.delete(key) ? 1 : 0),
  },
}));

vi.mock("./pedidosConcorrencia", () => ({
  mutarPedidos: vi.fn(async (fn: (pedidos: PedidoTeste[]) => Promise<unknown> | unknown) => {
    const resultado = await fn(structuredClone(mocks.pedidos)) as {
      persistir: boolean;
      pedidos?: PedidoTeste[];
      resultado: unknown;
    };
    if (resultado.persistir && resultado.pedidos) mocks.pedidos = resultado.pedidos;
    return resultado.resultado;
  }),
}));
vi.mock("./mercadoPagoCancelamento", () => ({
  consultarEstadoPagamentoMercadoPago: mocks.consultaProvider,
  cancelarPagamentoMercadoPagoPendente: mocks.cancelaProvider,
}));
vi.mock("./mercadoPagoReconciliacao", () => ({ reconciliarPixMercadoPago: mocks.reconciliar }));
vi.mock("./whatsappMensagem", () => ({ enviarTextoWhatsApp: mocks.enviarWhatsApp }));
vi.mock("./pixSentinela", () => ({ encerrarSentinela: mocks.encerrar }));
vi.mock("./fidelidade", () => ({
  calcularPontosElegiveisPedido: vi.fn(() => 5),
  construirEventoIdPontos: vi.fn((id: string, tipo: string) => `${id}:${tipo}`),
  derivarClienteIdPorTelefone: vi.fn(() => "cli_teste"),
  registrarMovimentoPontosIdempotente: mocks.registrarPontos,
  reverterResgateConfirmado: mocks.reverterResgate,
}));
vi.mock("./jornadaChef", () => ({
  reverterConclusaoPedidoJornada: mocks.reverterJornada,
  liberarRecompensaDePedidoCancelado: mocks.liberarRecompensa,
}));

import { processarPoliticaTimeoutPagamentoPix } from "./pixPagamentoTimeout";

const baseAgora = Date.parse("2026-08-10T22:00:00.000Z");

function pedido(idadeMs: number, overrides: Partial<PedidoTeste> = {}): PedidoTeste {
  return {
    id: "p1",
    numero: 10,
    cliente: "João Teste",
    telefone: "86999998888",
    total: 50,
    taxaEntrega: 5,
    status: "novo",
    pixConfirmado: false,
    pix: {
      provider: "mercadopago",
      providerPaymentId: "mp123",
      status: "pendente",
      criadoEm: new Date(baseAgora - idadeMs).toISOString(),
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.store.clear();
  mocks.pedidos = [pedido(0)];
  mocks.consultaProvider.mockResolvedValue({ estado: "pendente", status: "pending" });
  mocks.cancelaProvider.mockResolvedValue({ estado: "cancelado", status: "cancelled" });
  mocks.reconciliar.mockResolvedValue({
    verificados: 1,
    confirmados: 1,
    pendentes: 0,
    ignorados: 0,
    erros: 0,
    detalhes: [{ pedidoId: "p1", outcome: "confirmado" }],
  });
  mocks.enviarWhatsApp.mockResolvedValue({ ok: true, latenciaMs: 10, tentativas: 1 });
  mocks.registrarPontos.mockResolvedValue(undefined);
  mocks.reverterResgate.mockResolvedValue(undefined);
  mocks.reverterJornada.mockResolvedValue(undefined);
  mocks.liberarRecompensa.mockResolvedValue(undefined);
  mocks.encerrar.mockResolvedValue(undefined);
});

describe("política Pix 6/13 minutos", () => {
  test("antes de 6 minutos não avisa nem cancela", async () => {
    mocks.pedidos = [pedido(PIX_PAGAMENTO_AVISO_PENDENTE_MS - 1)];

    const r = await processarPoliticaTimeoutPagamentoPix({ pedidoId: "p1", agora: baseAgora });

    expect(r.motivo).toBe("antes_do_aviso");
    expect(mocks.enviarWhatsApp).not.toHaveBeenCalled();
    expect(mocks.cancelaProvider).not.toHaveBeenCalled();
  });

  test("aos 6 minutos, se o provider ainda está pending, envia um único aviso", async () => {
    mocks.pedidos = [pedido(PIX_PAGAMENTO_AVISO_PENDENTE_MS)];

    const r1 = await processarPoliticaTimeoutPagamentoPix({ pedidoId: "p1", agora: baseAgora });
    const r2 = await processarPoliticaTimeoutPagamentoPix({ pedidoId: "p1", agora: baseAgora + 1_000 });

    expect(r1.avisoEnviado).toBe(true);
    expect(r2.motivo).toBe("aviso_ja_processado");
    expect(mocks.enviarWhatsApp).toHaveBeenCalledTimes(1);
    expect(mocks.enviarWhatsApp.mock.calls[0][1]).toContain("prazo total é de 13 minutos");
  });

  test("aos 6 minutos não manda aviso de pendência se o Mercado Pago já mostra approved", async () => {
    mocks.pedidos = [pedido(PIX_PAGAMENTO_AVISO_PENDENTE_MS)];
    mocks.consultaProvider.mockResolvedValue({ estado: "pago", status: "approved" });

    const r = await processarPoliticaTimeoutPagamentoPix({ pedidoId: "p1", agora: baseAgora });

    expect(r.encerrado).toBe(true);
    expect(mocks.enviarWhatsApp).not.toHaveBeenCalled();
    expect(mocks.reconciliar).toHaveBeenCalledWith({ apenasPedidoIds: ["p1"] });
  });

  test("aos 13 minutos cancela primeiro a cobrança e só depois o pedido local", async () => {
    mocks.pedidos = [pedido(PIX_PAGAMENTO_CANCELAMENTO_MS, { resgateId: "res1" })];

    const r = await processarPoliticaTimeoutPagamentoPix({ pedidoId: "p1", agora: baseAgora });

    expect(r.cancelado).toBe(true);
    expect(mocks.cancelaProvider).toHaveBeenCalledWith("mp123");
    expect(mocks.pedidos[0].status).toBe("cancelado");
    expect(mocks.enviarWhatsApp.mock.calls[0][1]).toContain("pagamento Pix não foi confirmado dentro do prazo de 13 minutos");
    expect(mocks.registrarPontos).toHaveBeenCalledTimes(1);
    expect(mocks.reverterResgate).toHaveBeenCalledTimes(1);
    expect(mocks.reverterJornada).toHaveBeenCalledTimes(1);
    expect(mocks.liberarRecompensa).toHaveBeenCalledTimes(1);
    expect(mocks.encerrar).toHaveBeenCalledWith("p1", "cancelado");
  });

  test("se o provider diz que ficou pago no limite, nunca cancela o pedido", async () => {
    mocks.pedidos = [pedido(PIX_PAGAMENTO_CANCELAMENTO_MS)];
    mocks.cancelaProvider.mockResolvedValue({ estado: "pago", status: "approved" });

    const r = await processarPoliticaTimeoutPagamentoPix({ pedidoId: "p1", agora: baseAgora });

    expect(r.encerrado).toBe(true);
    expect(mocks.pedidos[0].status).toBe("novo");
    expect(mocks.reconciliar).toHaveBeenCalled();
  });

  test("falha ou ambiguidade no Mercado Pago não cancela às cegas e agenda retry", async () => {
    mocks.pedidos = [pedido(PIX_PAGAMENTO_CANCELAMENTO_MS)];
    mocks.cancelaProvider.mockResolvedValue({ estado: "inconclusivo", motivo: "timeout" });

    const r = await processarPoliticaTimeoutPagamentoPix({ pedidoId: "p1", agora: baseAgora });

    expect(r.encerrado).toBe(false);
    expect(r.proximoDelayMs).toBe(15_000);
    expect(mocks.pedidos[0].status).toBe("novo");
    expect(mocks.enviarWhatsApp).not.toHaveBeenCalled();
  });

  test("Pix manual e pedido já em preparo ficam fora do cancelamento automático", async () => {
    mocks.pedidos = [pedido(PIX_PAGAMENTO_CANCELAMENTO_MS, {
      pix: {
        provider: "manual",
        criadoEm: new Date(baseAgora - PIX_PAGAMENTO_CANCELAMENTO_MS).toISOString(),
      },
    })];
    const manual = await processarPoliticaTimeoutPagamentoPix({ pedidoId: "p1", agora: baseAgora });
    expect(manual.motivo).toBe("pedido_nao_elegivel");

    mocks.pedidos = [pedido(PIX_PAGAMENTO_CANCELAMENTO_MS, { status: "em_preparo" })];
    const preparo = await processarPoliticaTimeoutPagamentoPix({ pedidoId: "p1", agora: baseAgora });
    expect(preparo.motivo).toBe("pedido_nao_elegivel");
    expect(mocks.cancelaProvider).not.toHaveBeenCalled();
  });
});
