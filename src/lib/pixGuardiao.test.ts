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
    // Dois scripts do lock global de pedidosStore.ts: compare-and-delete (1
    // key, libera o lock) e a escrita cercada de "pedidos" via
    // escreverPedidosCercado (2 keys: lock + "pedidos").
    eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
      if (keys.length >= 2) {
        const [lockKey, pedidosKey] = keys;
        const [token, jsonValor] = args;
        if (store.get(lockKey) !== token) return 0;
        store.set(pedidosKey, JSON.parse(jsonValor));
        return 1;
      }
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

const { buscarPagamentoMock } = vi.hoisted(() => ({ buscarPagamentoMock: vi.fn() }));
vi.mock("./mercadoPagoWebhook", async () => {
  const actual = await vi.importActual<typeof import("./mercadoPagoWebhook")>("./mercadoPagoWebhook");
  return { ...actual, buscarPagamentoMercadoPagoDetalhado: (...args: unknown[]) => buscarPagamentoMock(...args) };
});

vi.mock("./whatsappMensagem", () => ({ enviarTextoWhatsApp: vi.fn(async () => ({ ok: true })) }));

import { avaliarSaudePix, executarGuardiaoPix } from "./pixGuardiao";

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
      criadoEm: new Date(Date.now() - 5 * 60_000).toISOString(),
    },
    ...overrides,
  };
}

function pagamento(overrides: Record<string, unknown> = {}) {
  return { id: "MP-1", status: "approved", transactionAmount: 50, externalReference: "chefebot_ped-1", ...overrides };
}
function ok(overrides: Record<string, unknown> = {}) {
  return { ok: true as const, pagamento: pagamento(overrides) };
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

const estadoBase = {
  ultimaTentativaMs: null as number | null,
  ultimoSucessoMs: null as number | null,
  falhasConsecutivas: 0,
  lockAtivo: false,
  emCooldownRateLimitGlobal: false,
  emCooldownRecuperacaoPropria: false,
  recuperacoesRealizadas: 0,
};

describe("avaliarSaudePix — classificação determinística (sem LLM, sem heurística probabilística)", () => {
  test("pedido cancelado nunca é elegível para recuperação", () => {
    const r = avaliarSaudePix(pedidoMP({ status: "cancelado" }), Date.now(), estadoBase);
    expect(r.saude).toBe("cancelled");
    expect(r.precisaRecuperacao).toBe(false);
  });

  test("pix já confirmado é 'confirmed', nunca reavaliado para recuperação", () => {
    const r = avaliarSaudePix(pedidoMP({ pixConfirmado: true, pix: { ...pedidoMP().pix, status: "confirmado" } }), Date.now(), estadoBase);
    expect(r.saude).toBe("confirmed");
    expect(r.precisaRecuperacao).toBe(false);
  });

  test("Pix manual por chave (provider !== mercadopago) nunca é avaliado como saudável/recuperável pelo Guardião — não deveria nem chegar aqui, mas se chegar não confirma nada", () => {
    // avaliarSaudePix nunca confirma por si mesma, então mesmo um pix manual
    // passado por engano não resulta em nenhuma ação de confirmação — só
    // classificação operacional. A garantia real é feita rio acima, filtrando
    // por selecionarPedidosPixMercadoPagoPendentes antes de chamar isto.
    const manual = pedidoMP({ pix: { provider: "manual", status: "pendente", valorEsperado: 50 } });
    const r = avaliarSaudePix(manual, Date.now(), estadoBase);
    expect(r.saude).not.toBe("confirmed");
  });

  test("dentro da janela esperada, sem falhas: healthy", () => {
    const r = avaliarSaudePix(pedidoMP(), Date.now(), { ...estadoBase, ultimaTentativaMs: Date.now() - 5_000, ultimoSucessoMs: Date.now() - 5_000 });
    expect(r.saude).toBe("healthy");
    expect(r.precisaRecuperacao).toBe(false);
  });

  test("sem nenhuma tentativa registrada além da janela esperada: delayed, precisa recuperação", () => {
    const agora = Date.now();
    const pedido = pedidoMP({ pix: { ...pedidoMP().pix, criadoEm: new Date(agora - 30_000).toISOString() } });
    const r = avaliarSaudePix(pedido, agora, estadoBase);
    expect(r.saude).toBe("delayed");
    expect(r.motivos).toContain("sem_tentativa_na_janela_esperada");
    expect(r.precisaRecuperacao).toBe(true);
  });

  test("última verificação muito antiga (> 2x o intervalo esperado): delayed", () => {
    const agora = Date.now();
    const r = avaliarSaudePix(pedidoMP(), agora, { ...estadoBase, ultimaTentativaMs: agora - 200_000, ultimoSucessoMs: agora - 200_000 });
    expect(r.saude).toBe("delayed");
    expect(r.motivos).toContain("ultima_verificacao_antiga");
  });

  test("lock abandonado expirado: motivo específico quando muito além do TTL do lock (95s+)", () => {
    const agora = Date.now();
    const r = avaliarSaudePix(pedidoMP(), agora, { ...estadoBase, ultimaTentativaMs: agora - 200_000, ultimoSucessoMs: agora - 200_000 });
    expect(r.motivos).toContain("lock_abandonado_expirado");
  });

  test("falhas consecutivas acima do limite: delayed com motivo específico", () => {
    const agora = Date.now();
    const r = avaliarSaudePix(pedidoMP(), agora, { ...estadoBase, ultimaTentativaMs: agora - 5_000, ultimoSucessoMs: null, falhasConsecutivas: 5 });
    expect(r.motivos).toContain("falhas_consecutivas");
    expect(r.precisaRecuperacao).toBe(true);
  });

  test("rate limit global ativo: saude rate_limited, nunca tenta recuperar nesse ciclo", () => {
    const r = avaliarSaudePix(pedidoMP(), Date.now(), { ...estadoBase, emCooldownRateLimitGlobal: true });
    expect(r.saude).toBe("rate_limited");
    expect(r.precisaRecuperacao).toBe(false);
  });

  test("lock do conciliador ativo agora: recovering, Guardião não interfere", () => {
    const r = avaliarSaudePix(pedidoMP(), Date.now(), { ...estadoBase, lockAtivo: true });
    expect(r.saude).toBe("recovering");
    expect(r.precisaRecuperacao).toBe(false);
  });

  test("limite de recuperações atingido: failed, para de tentar (nunca loop infinito)", () => {
    const r = avaliarSaudePix(pedidoMP(), Date.now(), { ...estadoBase, recuperacoesRealizadas: 5 });
    expect(r.saude).toBe("failed");
    expect(r.precisaRecuperacao).toBe(false);
  });

  test("idade acima do teto operacional: expired, nunca mais tenta recuperar", () => {
    const agora = Date.now();
    const pedido = pedidoMP({ pix: { ...pedidoMP().pix, criadoEm: new Date(agora - 60 * 60_000).toISOString() } });
    const r = avaliarSaudePix(pedido, agora, estadoBase);
    expect(r.saude).toBe("expired");
    expect(r.precisaRecuperacao).toBe(false);
  });

  test("paymentId ausente e txid inconsistente: ambíguo, mantém pendente sem tentar recuperar", () => {
    const pedido = pedidoMP({ pix: { ...pedidoMP().pix, providerPaymentId: undefined, txid: "algo-diferente" } });
    const r = avaliarSaudePix(pedido, Date.now(), estadoBase);
    expect(r.ambiguo).toBe(true);
    expect(r.saude).toBe("delayed");
    expect(r.precisaRecuperacao).toBe(false);
    expect(r.motivos).toContain("inconsistencia_pedido_metadata");
  });

  test("paymentId ausente mas txid consistente com o próprio pedido: sinaliza mas não é 'ambiguidade grave', ainda assim não recupera sem paymentId", () => {
    const pedido = pedidoMP({ pix: { ...pedidoMP().pix, providerPaymentId: undefined, txid: "chefebot_ped-1" } });
    const r = avaliarSaudePix(pedido, Date.now(), estadoBase);
    expect(r.precisaRecuperacao).toBe(false);
    expect(r.motivos).toContain("payment_id_ausente_ou_inconsistente");
  });

  test("já em cooldown de recuperação própria: não tenta recuperar de novo neste ciclo", () => {
    const agora = Date.now();
    const r = avaliarSaudePix(pedidoMP(), agora, { ...estadoBase, ultimaTentativaMs: agora - 200_000, ultimoSucessoMs: agora - 200_000, emCooldownRecuperacaoPropria: true });
    expect(r.precisaRecuperacao).toBe(false);
  });
});

describe("executarGuardiaoPix — orquestração (recuperação segura, sem duplicidade)", () => {
  test("sem nenhum Pix Mercado Pago pendente, não faz nada", async () => {
    store.set("pedidos", [{ id: "1", pix: { provider: "manual", status: "pendente" } }]);
    const r = await executarGuardiaoPix();
    expect(r.avaliadas).toBe(0);
    expect(buscarPagamentoMock).not.toHaveBeenCalled();
  });

  test("pagamento saudável (verificado recentemente) não é reencaminhado", async () => {
    const agora = Date.now();
    store.set("pedidos", [pedidoMP()]);
    store.set(`pix:verificacao:ultimaTentativa:ped-1`, String(agora - 5_000));
    store.set(`pix:verificacao:ultimoSucesso:ped-1`, String(agora - 5_000));

    const r = await executarGuardiaoPix();

    expect(r.saude.healthy).toBe(1);
    expect(r.recuperacoesTentadas).toBe(0);
    expect(buscarPagamentoMock).not.toHaveBeenCalled();
  });

  test("pagamento travado (sem tentativa registrada, além da janela) é recolocado na fila via o mecanismo central", async () => {
    const agora = Date.now();
    const pedido = pedidoMP({ pix: { ...pedidoMP().pix, criadoEm: new Date(agora - 40_000).toISOString() } });
    store.set("pedidos", [pedido]);
    buscarPagamentoMock.mockResolvedValue(ok());

    const r = await executarGuardiaoPix();

    expect(r.recuperacoesTentadas).toBe(1);
    expect(r.recuperacoesBemSucedidas).toBe(1);
    expect(buscarPagamentoMock).toHaveBeenCalledTimes(1);
    const pedidos = store.get("pedidos") as Array<{ id: string; pixConfirmado?: boolean; pix?: { status?: string; confirmadoPor?: string } }>;
    expect(pedidos[0].pixConfirmado).toBe(true);
    expect(pedidos[0].pix.confirmadoPor).toBe("conciliador_mercadopago");
  });

  test("recuperação por paymentId funciona (fluxo feliz, reaproveita reconciliarPixMercadoPago)", async () => {
    const agora = Date.now();
    store.set("pedidos", [pedidoMP({ pix: { ...pedidoMP().pix, criadoEm: new Date(agora - 40_000).toISOString(), providerPaymentId: "MP-XYZ" } })]);
    buscarPagamentoMock.mockResolvedValue(ok({ id: "MP-XYZ" }));

    await executarGuardiaoPix();

    expect(buscarPagamentoMock).toHaveBeenCalledWith("MP-XYZ", expect.anything());
  });

  test("ambiguidade (paymentId ausente e txid inconsistente) nunca dispara consulta — mantém pendente", async () => {
    const agora = Date.now();
    const pedido = pedidoMP({
      pix: { ...pedidoMP().pix, criadoEm: new Date(agora - 40_000).toISOString(), providerPaymentId: undefined, txid: "outro-txid" },
    });
    store.set("pedidos", [pedido]);

    const r = await executarGuardiaoPix();

    expect(r.ambiguos).toBe(1);
    expect(r.recuperacoesTentadas).toBe(0);
    expect(buscarPagamentoMock).not.toHaveBeenCalled();
    const pedidos = store.get("pedidos") as Array<{ id: string; pixConfirmado?: boolean; pix?: { status?: string; confirmadoPor?: string } }>;
    expect(pedidos[0].pixConfirmado).toBeUndefined();
  });

  test("limite de recuperações por pagamento impede loop infinito", async () => {
    const agora = Date.now();
    const pedido = pedidoMP({ pix: { ...pedidoMP().pix, criadoEm: new Date(agora - 40_000).toISOString() } });
    store.set("pedidos", [pedido]);
    store.set("pix:guardiao:tentativas:ped-1", "5");
    buscarPagamentoMock.mockResolvedValue(ok({ status: "pending" }));

    const r = await executarGuardiaoPix();

    expect(r.saude.failed).toBe(1);
    expect(r.recuperacoesTentadas).toBe(0);
    expect(buscarPagamentoMock).not.toHaveBeenCalled();
  });

  test("cooldown de recuperação própria evita disparar duas recuperações seguidas para o mesmo pagamento", async () => {
    const agora = Date.now();
    const pedido = pedidoMP({ pix: { ...pedidoMP().pix, criadoEm: new Date(agora - 40_000).toISOString() } });
    store.set("pedidos", [pedido]);
    store.set("pix:guardiao:cooldown:ped-1", "1");

    const r = await executarGuardiaoPix();

    expect(r.recuperacoesTentadas).toBe(0);
    expect(buscarPagamentoMock).not.toHaveBeenCalled();
  });

  test("lock do conciliador ativo: Guardião nunca tenta remover/ignorar o lock, só classifica e espera", async () => {
    store.set("lock:mercadopago:reconciliacao", "outro-dono");
    const agora = Date.now();
    store.set("pedidos", [pedidoMP({ pix: { ...pedidoMP().pix, criadoEm: new Date(agora - 40_000).toISOString() } })]);

    const r = await executarGuardiaoPix();

    expect(r.saude.recovering).toBe(1);
    expect(r.recuperacoesTentadas).toBe(0);
    expect(store.get("lock:mercadopago:reconciliacao")).toBe("outro-dono");
  });

  test("registra tentativa de recuperação (log) sem incluir dados sensíveis", async () => {
    const agora = Date.now();
    store.set("pedidos", [pedidoMP({ pix: { ...pedidoMP().pix, criadoEm: new Date(agora - 40_000).toISOString() } })]);
    buscarPagamentoMock.mockResolvedValue(ok());

    await executarGuardiaoPix();

    const log = store.get("pix:guardiao:log:ped-1") as Array<Record<string, unknown>>;
    expect(log?.length).toBeGreaterThan(0);
    const serializado = JSON.stringify(log);
    expect(serializado).not.toMatch(/access.?token/i);
    expect(serializado).not.toContain("MP-1");
  });

  test("webhook confirma um pedido antes do Guardião consultar: Guardião não sobrescreve nem duplica (idempotência preservada)", async () => {
    const agora = Date.now();
    const pedidoInicial = pedidoMP({ pix: { ...pedidoMP().pix, criadoEm: new Date(agora - 40_000).toISOString() } });
    store.set("pedidos", [pedidoInicial]);

    // Simula o webhook gravando a confirmação DEPOIS que o Guardião já leu
    // "pedidos" mas ANTES da consulta ao Mercado Pago responder — a mesma
    // corrida testada em mercadoPagoReconciliacao.test.ts, aqui disparada
    // pelo caminho do Guardião.
    buscarPagamentoMock.mockImplementation(async () => {
      store.set("pedidos", [
        { ...pedidoInicial, pixConfirmado: true, pix: { ...pedidoInicial.pix, status: "confirmado", confirmadoPor: "webhook", confirmadoEm: new Date().toISOString() } },
      ]);
      return ok();
    });

    await executarGuardiaoPix();

    const pedidos = store.get("pedidos") as Array<{ id: string; pixConfirmado?: boolean; pix?: { status?: string; confirmadoPor?: string } }>;
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].pix.confirmadoPor).toBe("webhook");
  });
});
