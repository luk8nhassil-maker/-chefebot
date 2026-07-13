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
    del: vi.fn(async (key: string) => {
      const existia = store.delete(key);
      return existia ? 1 : 0;
    }),
    // Simula EVAL o suficiente para o compare-and-delete do lock: só o
    // script usado por liberarLockSeDono (get==arg -> del) é suportado.
    eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
      const [key] = keys;
      const [esperado] = args;
      if (store.get(key) === esperado) {
        store.delete(key);
        return 1;
      }
      return 0;
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

const { enviarTextoMock } = vi.hoisted(() => ({
  enviarTextoMock: vi.fn(),
}));

vi.mock("./whatsappMensagem", () => ({
  enviarTextoWhatsApp: (...args: unknown[]) => enviarTextoMock(...args),
}));

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
  // Default seguro: qualquer teste que não mockar explicitamente o envio
  // continua funcionando como "sucesso" — só é chamado quando o pedido é
  // elegível para notificação (origem whatsapp + telefone + confirmado pelo
  // conciliador), o que a fixture pedidoMP() padrão nunca satisfaz sozinha.
  enviarTextoMock.mockResolvedValue({ ok: true });
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

    test("libera o lock ao final quando a execução ainda é dona (lockId bate)", async () => {
      store.set("pedidos", [pedidoMP()]);
      buscarPagamentoMock.mockResolvedValue(ok());

      await reconciliarPixMercadoPago();

      expect(store.get("lock:mercadopago:reconciliacao")).toBeUndefined();
    });

    test("não remove lock quando o valor atual não é mais o lockId desta execução", async () => {
      store.set("pedidos", [pedidoMP()]);
      // Simula outra execução assumindo o lock (ex.: TTL expirou e outro
      // processo já gravou seu próprio lockId) enquanto esta ainda está em
      // andamento — o compare-and-delete no finally não pode apagar isso.
      buscarPagamentoMock.mockImplementation(async () => {
        store.set("lock:mercadopago:reconciliacao", "lock-de-outra-execucao");
        return ok();
      });

      await reconciliarPixMercadoPago();

      expect(store.get("lock:mercadopago:reconciliacao")).toBe("lock-de-outra-execucao");
    });

    test("segunda execução após a primeira finalizar consegue rodar sem esperar 90s (não fica locked)", async () => {
      store.set("pedidos", [pedidoMP({ id: "ped-1" })]);
      buscarPagamentoMock.mockResolvedValue(ok());
      const primeira = await reconciliarPixMercadoPago();
      expect(primeira.locked).toBeUndefined();

      store.set("pedidos", [pedidoMP({ id: "ped-2", pix: { ...pedidoMP().pix, providerPaymentId: "MP-2", txid: "chefebot_ped-2" } })]);
      buscarPagamentoMock.mockResolvedValue(ok({ id: "MP-2", externalReference: "chefebot_ped-2" }));
      const segunda = await reconciliarPixMercadoPago();

      expect(segunda.locked).toBeUndefined();
      expect(segunda.confirmados).toBe(1);
    });

    test("execução concorrente enquanto a primeira ainda não terminou retorna locked:true", async () => {
      store.set("pedidos", [pedidoMP()]);
      let liberarPrimeira: (() => void) | undefined;
      buscarPagamentoMock.mockImplementation(
        () => new Promise((resolve) => { liberarPrimeira = () => resolve(ok()); })
      );

      const primeira = reconciliarPixMercadoPago();
      await vi.waitFor(() => {
        if (!store.has("lock:mercadopago:reconciliacao")) throw new Error("lock ainda não adquirido");
      });

      const segunda = await reconciliarPixMercadoPago();
      expect(segunda).toMatchObject({ locked: true });

      liberarPrimeira?.();
      await primeira;
    });

    test("em timeout, o lock também é liberado com segurança quando ainda é dono", async () => {
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
      await promise;

      expect(store.get("lock:mercadopago:reconciliacao")).toBeUndefined();
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

  describe("Nível 6.6A — notificação WhatsApp pós-conciliação", () => {
    function pedidoWhatsApp(overrides: Record<string, unknown> = {}) {
      return pedidoMP({ origem: "whatsapp", telefone: "5511999998888", ...overrides });
    }

    test("pedido WhatsApp confirmado pelo conciliador envia uma mensagem", async () => {
      store.set("pedidos", [pedidoWhatsApp()]);
      buscarPagamentoMock.mockResolvedValue(ok());

      const resumo = await reconciliarPixMercadoPago();

      expect(resumo.confirmados).toBe(1);
      expect(enviarTextoMock).toHaveBeenCalledTimes(1);
      expect(enviarTextoMock).toHaveBeenCalledWith(
        "5511999998888",
        "Pagamento confirmado ✅ Recebemos seu Pix e seu pedido foi confirmado."
      );
      expect(store.get("pix:notificado:ped-1")).toBe("1");
    });

    test("segunda execução não envia novamente", async () => {
      store.set("pedidos", [pedidoWhatsApp()]);
      buscarPagamentoMock.mockResolvedValue(ok());
      await reconciliarPixMercadoPago();
      expect(enviarTextoMock).toHaveBeenCalledTimes(1);

      // Nada mais pendente para reconciliar — segunda rodada só teria o
      // pedido já confirmado (ainda assim passa pelo caminho de retry).
      const segundo = await reconciliarPixMercadoPago();

      expect(segundo.verificados).toBe(0);
      expect(enviarTextoMock).toHaveBeenCalledTimes(1);
    });

    test("falha da Evolution não marca como notificado e permite retry", async () => {
      store.set("pedidos", [pedidoWhatsApp()]);
      buscarPagamentoMock.mockResolvedValue(ok());
      enviarTextoMock.mockResolvedValueOnce({ ok: false, motivo: "http_500" });

      await reconciliarPixMercadoPago();

      expect(enviarTextoMock).toHaveBeenCalledTimes(1);
      expect(store.get("pix:notificado:ped-1")).toBeUndefined();

      // Rodada seguinte: nada novo para reconciliar, mas o retry de
      // notificação deve tentar de novo porque não há marcador permanente.
      enviarTextoMock.mockResolvedValueOnce({ ok: true });
      await reconciliarPixMercadoPago();

      expect(enviarTextoMock).toHaveBeenCalledTimes(2);
      expect(store.get("pix:notificado:ped-1")).toBe("1");
    });

    test("exceção no envio (ex.: erro de rede) também não marca como notificado", async () => {
      store.set("pedidos", [pedidoWhatsApp()]);
      buscarPagamentoMock.mockResolvedValue(ok());
      enviarTextoMock.mockRejectedValueOnce(new Error("network down"));

      const resumo = await reconciliarPixMercadoPago();

      expect(resumo.confirmados).toBe(1);
      expect(store.get("pix:notificado:ped-1")).toBeUndefined();
    });

    test("pedido de app/site com telefone não recebe mensagem (sem origem whatsapp)", async () => {
      store.set("pedidos", [pedidoMP({ telefone: "5511999998888" })]);
      buscarPagamentoMock.mockResolvedValue(ok());

      const resumo = await reconciliarPixMercadoPago();

      expect(resumo.confirmados).toBe(1);
      expect(enviarTextoMock).not.toHaveBeenCalled();
    });

    test("pagamento ainda pendente não envia mensagem", async () => {
      store.set("pedidos", [pedidoWhatsApp()]);
      buscarPagamentoMock.mockResolvedValue(ok({ status: "pending" }));

      const resumo = await reconciliarPixMercadoPago();

      expect(resumo.pendentes).toBe(1);
      expect(enviarTextoMock).not.toHaveBeenCalled();
    });

    test("Pix manual (confirmado por comprovante) não envia mensagem via conciliador", async () => {
      store.set("pedidos", [
        pedidoWhatsApp({
          pix: { provider: "manual", status: "confirmado", confirmadoPor: "comprovante", valorEsperado: 50 },
        }),
      ]);

      const resumo = await reconciliarPixMercadoPago();

      expect(resumo.verificados).toBe(0);
      expect(enviarTextoMock).not.toHaveBeenCalled();
    });

    test("confirmação do Pix continua salva mesmo se a notificação falhar", async () => {
      store.set("pedidos", [pedidoWhatsApp()]);
      buscarPagamentoMock.mockResolvedValue(ok());
      enviarTextoMock.mockRejectedValueOnce(new Error("network down"));

      const resumo = await reconciliarPixMercadoPago();

      expect(resumo.confirmados).toBe(1);
      const pedidos = store.get("pedidos") as ReturnType<typeof pedidoWhatsApp>[];
      expect(pedidos[0].pixConfirmado).toBe(true);
      expect(pedidos[0].pix.status).toBe("confirmado");
      expect(pedidos[0].pix.confirmadoPor).toBe("conciliador_mercadopago");
    });

    test("lock curto de notificação evita reenvio dentro da mesma rodada mesmo sem marcador permanente ainda", async () => {
      // Simula concorrência: o lock de notificação já foi adquirido por outra
      // chamada, então esta rodada não deve tentar enviar de novo.
      store.set("pedidos", [pedidoWhatsApp()]);
      store.set("lock:pix:notificacao:ped-1", "1");
      buscarPagamentoMock.mockResolvedValue(ok());

      await reconciliarPixMercadoPago();

      expect(enviarTextoMock).not.toHaveBeenCalled();
      expect(store.get("pix:notificado:ped-1")).toBeUndefined();
    });
  });
});
