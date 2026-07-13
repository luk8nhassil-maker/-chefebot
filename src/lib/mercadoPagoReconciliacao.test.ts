import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
      if (opts?.nx && store.has(key)) return null;
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
    buscarPagamentoMercadoPagoDetalhado: (...args: unknown[]) => buscarPagamentoMock(...args),
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

// Helper: formato de retorno de buscarPagamentoMercadoPagoDetalhado (usada
// pelo conciliador desde o Nivel 6.5 no lugar da função simples do webhook).
function ok(pagamentoOverrides: Record<string, unknown> = {}) {
  return { ok: true as const, pagamento: pagamento(pagamentoOverrides) };
}
function falha(status: number | null, motivo: string) {
  return { ok: false as const, status, motivo };
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
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
    buscarPagamentoMock.mockResolvedValue(ok());

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
    buscarPagamentoMock.mockResolvedValue(ok({ transactionAmount: 49.99 }));

    const resumo = await reconciliarPixMercadoPago();

    expect(resumo).toMatchObject({ verificados: 1, confirmados: 0, ignorados: 1 });
    expect(resumo.detalhes[0]).toMatchObject({ outcome: "ignorado", motivo: "valor_divergente" });
    const pedidos = store.get("pedidos") as any[];
    expect(pedidos[0].pixConfirmado).toBeUndefined();
  });

  test("external_reference divergente não confirma", async () => {
    store.set("pedidos", [pedidoMP()]);
    buscarPagamentoMock.mockResolvedValue(ok({ externalReference: "chefebot_outro_pedido" }));

    const resumo = await reconciliarPixMercadoPago();

    expect(resumo).toMatchObject({ confirmados: 0, ignorados: 1 });
    expect(resumo.detalhes[0]).toMatchObject({ outcome: "ignorado", motivo: "external_reference_divergente" });
  });

  test("external_reference ausente no pedido ou no pagamento não bloqueia a confirmação", async () => {
    store.set("pedidos", [pedidoMP({ pix: { ...pedidoMP().pix, txid: undefined } })]);
    buscarPagamentoMock.mockResolvedValue(ok());

    const resumo = await reconciliarPixMercadoPago();

    expect(resumo.confirmados).toBe(1);
  });

  test("pending não confirma", async () => {
    store.set("pedidos", [pedidoMP()]);
    buscarPagamentoMock.mockResolvedValue(ok({ status: "pending" }));

    const resumo = await reconciliarPixMercadoPago();

    expect(resumo).toMatchObject({ confirmados: 0, pendentes: 1, ignorados: 0 });
    const pedidos = store.get("pedidos") as any[];
    expect(pedidos[0].pixConfirmado).toBeUndefined();
    expect(pedidos[0].pix.status).toBe("pendente");
  });

  test("in_process também é tratado como pendente, não confirma", async () => {
    store.set("pedidos", [pedidoMP()]);
    buscarPagamentoMock.mockResolvedValue(ok({ status: "in_process" }));

    const resumo = await reconciliarPixMercadoPago();

    expect(resumo.pendentes).toBe(1);
  });

  test("rejected não confirma", async () => {
    store.set("pedidos", [pedidoMP()]);
    buscarPagamentoMock.mockResolvedValue(ok({ status: "rejected" }));

    const resumo = await reconciliarPixMercadoPago();

    expect(resumo).toMatchObject({ confirmados: 0, pendentes: 0, ignorados: 1 });
  });

  test("cancelled e refunded também não confirmam", async () => {
    store.set("pedidos", [pedidoMP({ id: "ped-a" }), pedidoMP({ id: "ped-b" })]);
    buscarPagamentoMock
      .mockResolvedValueOnce(ok({ id: "MP-a", status: "cancelled" }))
      .mockResolvedValueOnce(ok({ id: "MP-b", status: "refunded" }));

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
    // "pedidos" nunca é regravado quando não há mudança (lock/cooldown usam outras chaves).
    expect(redisMock.set).not.toHaveBeenCalledWith("pedidos", expect.anything());
  });

  test("pedido sem providerPaymentId é ignorado — nem entra na verificação", async () => {
    store.set("pedidos", [
      pedidoMP({ id: "ped-sem-payment", pix: { provider: "mercadopago", valorEsperado: 50, status: "pendente" } }),
    ]);

    const resumo = await reconciliarPixMercadoPago();

    expect(resumo.verificados).toBe(0);
    expect(buscarPagamentoMock).not.toHaveBeenCalled();
  });

  test("sem pedidos elegíveis: resumo zerado, nunca chama a API nem grava 'pedidos'", async () => {
    store.set("pedidos", [{ id: "ped-cartao", total: 30, pagamento: "Cartao" }]);

    const resumo = await reconciliarPixMercadoPago();

    expect(resumo).toMatchObject({ verificados: 0, confirmados: 0, pendentes: 0, ignorados: 0, erros: 0, detalhes: [] });
    expect(buscarPagamentoMock).not.toHaveBeenCalled();
    expect(redisMock.set).not.toHaveBeenCalledWith("pedidos", expect.anything());
  });

  test("pagamento indisponível na API do MP conta como erro, não interrompe os demais", async () => {
    store.set("pedidos", [pedidoMP({ id: "ped-a" }), pedidoMP({ id: "ped-b" })]);
    buscarPagamentoMock
      .mockResolvedValueOnce(falha(404, "http_404"))
      .mockResolvedValueOnce(ok({ id: "MP-b" }));

    const resumo = await reconciliarPixMercadoPago();

    expect(resumo).toMatchObject({ verificados: 2, erros: 1, confirmados: 1 });
  });

  test("processa múltiplos pedidos elegíveis independentemente", async () => {
    store.set("pedidos", [
      pedidoMP({ id: "ped-1", pix: { ...pedidoMP().pix, providerPaymentId: "MP-1", txid: "chefebot_ped-1" } }),
      pedidoMP({ id: "ped-2", pix: { ...pedidoMP().pix, providerPaymentId: "MP-2", txid: "chefebot_ped-2" } }),
    ]);
    buscarPagamentoMock
      .mockResolvedValueOnce(ok({ id: "MP-1", externalReference: "chefebot_ped-1" }))
      .mockResolvedValueOnce(ok({ id: "MP-2", externalReference: "chefebot_ped-2", status: "pending" }));

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
    buscarPagamentoMock.mockResolvedValue(ok());

    await reconciliarPixMercadoPago();

    const pedidos = store.get("pedidos") as any[];
    expect(pedidos[0].chavePix).toBe("99984430294");
    expect(pedidos[0].beneficiario).toBe("Geovane Sousa da Silva");
  });

  describe("Nivel 6.5 — robustez para múltiplos Pix pendentes", () => {
    test("muitos Pix pendentes: processa no máximo 20 por rodada", async () => {
      const pedidos = Array.from({ length: 35 }, (_, i) =>
        pedidoMP({
          id: `ped-${i}`,
          pix: { ...pedidoMP().pix, providerPaymentId: `MP-${i}`, txid: `chefebot_ped-${i}` },
        })
      );
      store.set("pedidos", pedidos);
      buscarPagamentoMock.mockImplementation(async () => ok({ status: "pending" }));

      const resumo = await reconciliarPixMercadoPago();

      expect(resumo.verificados).toBe(20);
      expect(resumo.limitados).toBe(15);
      expect(buscarPagamentoMock).toHaveBeenCalledTimes(20);
    });

    test("lock ativo impede segunda execução simultânea", async () => {
      store.set("lock:mercadopago:reconciliacao", "1");
      store.set("pedidos", [pedidoMP()]);

      const resumo = await reconciliarPixMercadoPago();

      expect(resumo).toMatchObject({ locked: true, verificados: 0 });
      expect(buscarPagamentoMock).not.toHaveBeenCalled();
    });

    test("lock não apaga lock de outra execução (nunca chama del/apaga a chave)", async () => {
      store.set("pedidos", [pedidoMP()]);
      buscarPagamentoMock.mockResolvedValue(ok());

      await reconciliarPixMercadoPago();

      // O lock continua no store: a implementação nunca remove manualmente,
      // só expira por TTL (não simulado aqui) — nunca corre risco de apagar
      // o lock de outra execução concorrente.
      expect(store.get("lock:mercadopago:reconciliacao")).toBe("1");
    });

    test("cooldown global de rate limit impede nova chamada ao Mercado Pago", async () => {
      store.set("cooldown:mercadopago:reconciliacao", "1");
      store.set("pedidos", [pedidoMP()]);

      const resumo = await reconciliarPixMercadoPago();

      expect(resumo).toMatchObject({ rateLimited: true, verificados: 0 });
      expect(buscarPagamentoMock).not.toHaveBeenCalled();
      // Nem tenta o lock quando já está em cooldown global.
      expect(store.get("lock:mercadopago:reconciliacao")).toBeUndefined();
    });

    test("timeout não confirma e conta erro", async () => {
      vi.useFakeTimers();
      store.set("pedidos", [pedidoMP()]);
      buscarPagamentoMock.mockImplementation(
        (_paymentId: string, signal?: AbortSignal) =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener("abort", () => {
              reject(Object.assign(new Error("timeout"), { name: "AbortError" }));
            });
          })
      );

      const promise = reconciliarPixMercadoPago();
      await vi.advanceTimersByTimeAsync(5000);
      const resumo = await promise;

      expect(resumo).toMatchObject({ confirmados: 0, erros: 1 });
      expect(resumo.detalhes[0].outcome).toBe("erro");
      const pedidos = store.get("pedidos") as any[];
      expect(pedidos[0].pixConfirmado).toBeUndefined();
    });

    test("429/rate limit não confirma, para o lote e retorna rateLimited=true com cooldown global gravado", async () => {
      store.set("pedidos", [pedidoMP({ id: "ped-a" }), pedidoMP({ id: "ped-b" })]);
      buscarPagamentoMock
        .mockResolvedValueOnce(falha(429, "http_429"))
        .mockResolvedValueOnce(falha(429, "http_429"));

      const resumo = await reconciliarPixMercadoPago();

      expect(resumo.confirmados).toBe(0);
      expect(resumo.rateLimited).toBe(true);
      expect(store.get("cooldown:mercadopago:reconciliacao")).toBe("1");
    });

    test("cooldown por pedido pula pedido consultado recentemente", async () => {
      store.set("cooldown:pix:ped-1", "1");
      store.set("pedidos", [pedidoMP({ id: "ped-1" })]);

      const resumo = await reconciliarPixMercadoPago();

      expect(resumo.verificados).toBe(0);
      expect(buscarPagamentoMock).not.toHaveBeenCalled();
    });

    test("pedido não confirmado recebe cooldown próprio após ser consultado", async () => {
      store.set("pedidos", [pedidoMP()]);
      buscarPagamentoMock.mockResolvedValue(ok({ status: "pending" }));

      await reconciliarPixMercadoPago();

      expect(store.get("cooldown:pix:ped-1")).toBe("1");
    });

    test("pedido confirmado não recebe cooldown próprio (não precisa)", async () => {
      store.set("pedidos", [pedidoMP()]);
      buscarPagamentoMock.mockResolvedValue(ok());

      await reconciliarPixMercadoPago();

      expect(store.get("cooldown:pix:ped-1")).toBeUndefined();
    });
  });
});
