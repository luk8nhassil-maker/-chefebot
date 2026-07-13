import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return "OK";
    }),
  };
  return { store, redisMock };
});

vi.mock("./redis", () => ({ redis: redisMock }));

const { buscarPagamentoMock } = vi.hoisted(() => ({
  buscarPagamentoMock: vi.fn(),
}));

vi.mock("./mercadoPagoWebhook", async () => {
  const actual = await vi.importActual<typeof import("./mercadoPagoWebhook")>("./mercadoPagoWebhook");
  return {
    ...actual,
    buscarPagamentoMercadoPago: (...args: unknown[]) => buscarPagamentoMock(...args),
  };
});

import {
  elegivelParaReconciliacao,
  selecionarPedidosPixMercadoPagoPendentes,
  reconciliarPixMercadoPago,
} from "./mercadoPagoReconciliacao";

function pedidoMP(overrides: Record<string, unknown> = {}) {
  return {
    id: "ped-1",
    total: 50,
    status: "novo",
    pix: {
      provider: "mercadopago",
      providerPaymentId: "MP-1",
      txid: "chefebot_ped-1",
      valorEsperado: 50,
      status: "pendente",
    },
    ...overrides,
  };
}

function pagamento(overrides: Record<string, unknown> = {}) {
  return {
    id: "MP-1",
    status: "approved",
    transactionAmount: 50,
    externalReference: "chefebot_ped-1",
    ...overrides,
  };
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("elegivelParaReconciliacao / selecionarPedidosPixMercadoPagoPendentes", () => {
  test("elegível: provider mercadopago, providerPaymentId presente, não confirmado", () => {
    expect(elegivelParaReconciliacao(pedidoMP())).toBe(true);
  });

  test("não elegível: sem providerPaymentId", () => {
    const p = pedidoMP({ pix: { provider: "mercadopago", valorEsperado: 50, status: "pendente" } });
    expect(elegivelParaReconciliacao(p)).toBe(false);
  });

  test("não elegível: provider manual (fallback)", () => {
    const p = pedidoMP({ pix: { valorEsperado: 50, status: "pendente" } });
    expect(elegivelParaReconciliacao(p)).toBe(false);
  });

  test("não elegível: pix.status já confirmado", () => {
    const p = pedidoMP({ pix: { ...pedidoMP().pix, status: "confirmado" } });
    expect(elegivelParaReconciliacao(p)).toBe(false);
  });

  test("não elegível: pixConfirmado true", () => {
    const p = pedidoMP({ pixConfirmado: true });
    expect(elegivelParaReconciliacao(p)).toBe(false);
  });

  test("seleciona só os elegíveis de uma lista mista", () => {
    const pedidos = [
      pedidoMP({ id: "a" }),
      pedidoMP({ id: "b", pixConfirmado: true }),
      pedidoMP({ id: "c", pix: undefined }),
    ];
    const selecionados = selecionarPedidosPixMercadoPagoPendentes(pedidos);
    expect(selecionados.map((p) => p.id)).toEqual(["a"]);
  });
});

describe("reconciliarPixMercadoPago", () => {
  test("pedido approved confirma: grava pixConfirmado, pix.status, confirmadoPor e confirmadoEm", async () => {
    store.set("pedidos", [pedidoMP()]);
    buscarPagamentoMock.mockResolvedValue(pagamento());

    const resumo = await reconciliarPixMercadoPago();

    expect(resumo).toMatchObject({ verificados: 1, confirmados: 1, pendentes: 0, ignorados: 0, erros: 0 });
    const pedidos = store.get("pedidos") as any[];
    expect(pedidos[0].pixConfirmado).toBe(true);
    expect(pedidos[0].pix).toMatchObject({
      status: "confirmado",
      confirmadoPor: "conciliador_mercadopago",
      providerPaymentId: "MP-1",
    });
    expect(typeof pedidos[0].pix.confirmadoEm).toBe("string");
  });

  test("valor divergente não confirma", async () => {
    store.set("pedidos", [pedidoMP()]);
    buscarPagamentoMock.mockResolvedValue(pagamento({ transactionAmount: 49.99 }));

    const resumo = await reconciliarPixMercadoPago();

    expect(resumo).toMatchObject({ verificados: 1, confirmados: 0, ignorados: 1 });
    expect(resumo.detalhes[0]).toMatchObject({ outcome: "ignorado", motivo: "valor_divergente" });
    const pedidos = store.get("pedidos") as any[];
    expect(pedidos[0].pixConfirmado).toBeUndefined();
  });

  test("external_reference divergente não confirma", async () => {
    store.set("pedidos", [pedidoMP()]);
    buscarPagamentoMock.mockResolvedValue(pagamento({ externalReference: "chefebot_outro_pedido" }));

    const resumo = await reconciliarPixMercadoPago();

    expect(resumo).toMatchObject({ confirmados: 0, ignorados: 1 });
    expect(resumo.detalhes[0]).toMatchObject({ outcome: "ignorado", motivo: "external_reference_divergente" });
  });

  test("external_reference ausente no pedido ou no pagamento não bloqueia a confirmação", async () => {
    store.set("pedidos", [pedidoMP({ pix: { ...pedidoMP().pix, txid: undefined } })]);
    buscarPagamentoMock.mockResolvedValue(pagamento());

    const resumo = await reconciliarPixMercadoPago();

    expect(resumo.confirmados).toBe(1);
  });

  test("pending não confirma", async () => {
    store.set("pedidos", [pedidoMP()]);
    buscarPagamentoMock.mockResolvedValue(pagamento({ status: "pending" }));

    const resumo = await reconciliarPixMercadoPago();

    expect(resumo).toMatchObject({ confirmados: 0, pendentes: 1, ignorados: 0 });
    const pedidos = store.get("pedidos") as any[];
    expect(pedidos[0].pixConfirmado).toBeUndefined();
    expect(pedidos[0].pix.status).toBe("pendente");
  });

  test("in_process também é tratado como pendente, não confirma", async () => {
    store.set("pedidos", [pedidoMP()]);
    buscarPagamentoMock.mockResolvedValue(pagamento({ status: "in_process" }));

    const resumo = await reconciliarPixMercadoPago();

    expect(resumo.pendentes).toBe(1);
  });

  test("rejected não confirma", async () => {
    store.set("pedidos", [pedidoMP()]);
    buscarPagamentoMock.mockResolvedValue(pagamento({ status: "rejected" }));

    const resumo = await reconciliarPixMercadoPago();

    expect(resumo).toMatchObject({ confirmados: 0, pendentes: 0, ignorados: 1 });
  });

  test("cancelled e refunded também não confirmam", async () => {
    store.set("pedidos", [pedidoMP({ id: "ped-a" }), pedidoMP({ id: "ped-b" })]);
    buscarPagamentoMock
      .mockResolvedValueOnce(pagamento({ id: "MP-a", status: "cancelled" }))
      .mockResolvedValueOnce(pagamento({ id: "MP-b", status: "refunded" }));

    const resumo = await reconciliarPixMercadoPago();

    expect(resumo.confirmados).toBe(0);
    expect(resumo.ignorados).toBe(2);
  });

  test("pedido já confirmado (pix.status=confirmado) é ignorado — nem entra na verificação", async () => {
    store.set("pedidos", [
      pedidoMP({ id: "ped-confirmado", pixConfirmado: true, pix: { ...pedidoMP().pix, status: "confirmado" } }),
    ]);

    const resumo = await reconciliarPixMercadoPago();

    expect(resumo.verificados).toBe(0);
    expect(buscarPagamentoMock).not.toHaveBeenCalled();
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  test("pedido sem providerPaymentId é ignorado — nem entra na verificação", async () => {
    store.set("pedidos", [
      pedidoMP({ id: "ped-sem-payment", pix: { provider: "mercadopago", valorEsperado: 50, status: "pendente" } }),
    ]);

    const resumo = await reconciliarPixMercadoPago();

    expect(resumo.verificados).toBe(0);
    expect(buscarPagamentoMock).not.toHaveBeenCalled();
  });

  test("sem pedidos elegíveis: resumo zerado, nunca chama a API nem grava", async () => {
    store.set("pedidos", [{ id: "ped-cartao", total: 30, pagamento: "Cartao" }]);

    const resumo = await reconciliarPixMercadoPago();

    expect(resumo).toEqual({ verificados: 0, confirmados: 0, pendentes: 0, ignorados: 0, erros: 0, detalhes: [] });
    expect(buscarPagamentoMock).not.toHaveBeenCalled();
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  test("pagamento indisponível na API do MP conta como erro, não interrompe os demais", async () => {
    store.set("pedidos", [pedidoMP({ id: "ped-a" }), pedidoMP({ id: "ped-b" })]);
    buscarPagamentoMock.mockResolvedValueOnce(null).mockResolvedValueOnce(pagamento({ id: "MP-b" }));

    const resumo = await reconciliarPixMercadoPago();

    expect(resumo).toMatchObject({ verificados: 2, erros: 1, confirmados: 1 });
  });

  test("processa múltiplos pedidos elegíveis independentemente", async () => {
    store.set("pedidos", [
      pedidoMP({ id: "ped-1", pix: { ...pedidoMP().pix, providerPaymentId: "MP-1", txid: "chefebot_ped-1" } }),
      pedidoMP({ id: "ped-2", pix: { ...pedidoMP().pix, providerPaymentId: "MP-2", txid: "chefebot_ped-2" } }),
    ]);
    buscarPagamentoMock
      .mockResolvedValueOnce(pagamento({ id: "MP-1", externalReference: "chefebot_ped-1" }))
      .mockResolvedValueOnce(pagamento({ id: "MP-2", externalReference: "chefebot_ped-2", status: "pending" }));

    const resumo = await reconciliarPixMercadoPago();

    expect(resumo).toMatchObject({ verificados: 2, confirmados: 1, pendentes: 1 });
    const pedidos = store.get("pedidos") as any[];
    expect(pedidos.find((p) => p.id === "ped-1").pixConfirmado).toBe(true);
    expect(pedidos.find((p) => p.id === "ped-2").pixConfirmado).toBeUndefined();
  });

  test("Pix copia e cola / fallback manual não são tocados (nenhum campo chavePix/beneficiario é alterado)", async () => {
    const pedidoComFallback = pedidoMP({
      chavePix: "99984430294",
      beneficiario: "Geovane Sousa da Silva",
    });
    store.set("pedidos", [pedidoComFallback]);
    buscarPagamentoMock.mockResolvedValue(pagamento());

    await reconciliarPixMercadoPago();

    const pedidos = store.get("pedidos") as any[];
    expect(pedidos[0].chavePix).toBe("99984430294");
    expect(pedidos[0].beneficiario).toBe("Geovane Sousa da Silva");
  });
});
