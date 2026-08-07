import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    // Compare-and-delete atômico do lock GLOBAL de "pedidos" (ver
    // src/lib/pedidosConcorrencia.ts) — 1 chave + 1 arg (o token).
    eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
      const [chave] = keys;
      const [tokenEsperado] = args;
      if (store.get(chave) === tokenEsperado) {
        store.delete(chave);
        return 1;
      }
      return 0;
    }),
  };
  return { store, redisMock };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));

// Adaptador MP: detecção/extração/mapeamento ficam reais (importActual); só a
// validação de assinatura (crypto) e a busca do pagamento (rede) são
// controladas aqui, para testar a orquestração da rota sem HMAC/fetch reais.
const { assinaturaMock, buscarPagamentoMock } = vi.hoisted(() => ({
  assinaturaMock: vi.fn(),
  buscarPagamentoMock: vi.fn(),
}));

vi.mock("@/lib/mercadoPagoWebhook", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mercadoPagoWebhook")>("@/lib/mercadoPagoWebhook");
  return {
    ...actual,
    validarAssinaturaMercadoPago: (...args: unknown[]) => assinaturaMock(...args),
    buscarPagamentoMercadoPago: (...args: unknown[]) => buscarPagamentoMock(...args),
  };
});

import { POST } from "./route";

function postReq(body: unknown, headers: Record<string, string> = {}) {
  return {
    json: async () => body,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
  } as never;
}

async function json(res: Response) {
  return res.json() as Promise<Record<string, unknown>>;
}

// `redis.set` agora também é chamado para adquirir o lock GLOBAL de
// "pedidos" (SET NX na chave "pedidos:mutex:global", ver
// src/lib/pedidosConcorrencia.ts) mesmo quando a rota decide NÃO persistir
// nenhuma mutação — por isso as asserções de "nada foi escrito" checam
// especificamente a chave "pedidos", nunca `redisMock.set` como um todo.
function pedidosFoiEscrito(): boolean {
  return redisMock.set.mock.calls.some(([key]) => key === "pedidos");
}

const pedidoPix = {
  id: "pedido-1",
  total: 50,
  pagamento: "Pix",
  pix: { txid: "tx-1", valorEsperado: 50, status: "pendente" },
};

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/pix/webhook", () => {
  it("flag desligada retorna wouldConfirm true, mas nao altera Redis", async () => {
    store.set("pedidos", [pedidoPix]);

    const res = await POST(postReq({ txid: "tx-1", valor: 50, status: "pago", providerPaymentId: "prov-1" }));
    const body = await json(res);

    expect(body).toMatchObject({
      ok: true,
      passive: true,
      wouldConfirm: true,
      pedidoId: "pedido-1",
      txid: "tx-1",
      valorEsperado: 50,
      valorRecebido: 50,
      providerPaymentId: "prov-1",
    });
    expect(pedidosFoiEscrito()).toBe(false);
  });

  it("flag ligada + segredo correto confirma Pix e salva metadados", async () => {
    vi.stubEnv("PIX_WEBHOOK_AUTO_CONFIRM", "true");
    vi.stubEnv("PIX_WEBHOOK_SECRET", "secret-ok");
    store.set("pedidos", [pedidoPix]);

    const res = await POST(postReq(
      { txid: "tx-1", valor: 50, status: "confirmed", providerPaymentId: "prov-1" },
      { "x-pix-webhook-secret": "secret-ok" }
    ));
    const body = await json(res);
    const pedidos = store.get("pedidos") as any[];

    expect(body).toMatchObject({ passive: false, wouldConfirm: true, confirmed: true, pedidoId: "pedido-1" });
    expect(pedidos[0].pixConfirmado).toBe(true);
    expect(pedidos[0].status).toBeUndefined();
    expect(pedidos[0].pix).toMatchObject({
      txid: "tx-1",
      valorEsperado: 50,
      status: "confirmado",
      confirmadoPor: "webhook",
      providerPaymentId: "prov-1",
    });
    expect(typeof pedidos[0].pix.confirmadoEm).toBe("string");
    // 1 SET NX para adquirir o lock GLOBAL de "pedidos" + 1 gravação do
    // pedido + 2 chamadas best-effort do Sentinela Pix (encerrarSentinela
    // grava o estado; incrementarContadorPix grava o contador
    // sentinela_encerrado_webhook) — nenhuma delas afeta a confirmação em
    // si, que já está persistida antes dessas chamadas.
    expect(redisMock.set).toHaveBeenCalledTimes(4);
  });

  it("segredo ausente ou incorreto nao confirma", async () => {
    vi.stubEnv("PIX_WEBHOOK_AUTO_CONFIRM", "true");
    vi.stubEnv("PIX_WEBHOOK_SECRET", "secret-ok");
    store.set("pedidos", [pedidoPix]);

    const semSegredo = await json(await POST(postReq({ txid: "tx-1", valor: 50, status: "pago" })));
    const segredoErrado = await json(await POST(postReq(
      { txid: "tx-1", valor: 50, status: "pago" },
      { "x-pix-webhook-secret": "errado" }
    )));

    expect(semSegredo).toMatchObject({ wouldConfirm: false, reason: "segredo_invalido" });
    expect(segredoErrado).toMatchObject({ wouldConfirm: false, reason: "segredo_invalido" });
    expect(pedidosFoiEscrito()).toBe(false);
  });

  it("sem PIX_WEBHOOK_SECRET configurado nao confirma", async () => {
    vi.stubEnv("PIX_WEBHOOK_AUTO_CONFIRM", "true");
    store.set("pedidos", [pedidoPix]);

    const body = await json(await POST(postReq(
      { txid: "tx-1", valor: 50, status: "pago" },
      { "x-pix-webhook-secret": "qualquer" }
    )));

    expect(body).toMatchObject({ wouldConfirm: false, reason: "segredo_invalido" });
    expect(pedidosFoiEscrito()).toBe(false);
  });

  it("valor divergente nao confirma", async () => {
    vi.stubEnv("PIX_WEBHOOK_AUTO_CONFIRM", "true");
    vi.stubEnv("PIX_WEBHOOK_SECRET", "secret-ok");
    store.set("pedidos", [pedidoPix]);

    const body = await json(await POST(postReq(
      { txid: "tx-1", valor: 49.99, status: "pago" },
      { "x-pix-webhook-secret": "secret-ok" }
    )));

    expect(body).toMatchObject({ wouldConfirm: false, reason: "valor_divergente" });
    expect(pedidosFoiEscrito()).toBe(false);
  });

  it("status pendente nao confirma", async () => {
    vi.stubEnv("PIX_WEBHOOK_AUTO_CONFIRM", "true");
    vi.stubEnv("PIX_WEBHOOK_SECRET", "secret-ok");
    store.set("pedidos", [pedidoPix]);

    const body = await json(await POST(postReq(
      { txid: "tx-1", valor: 50, status: "pendente" },
      { "x-pix-webhook-secret": "secret-ok" }
    )));

    expect(body).toMatchObject({ wouldConfirm: false, reason: "status_nao_pago" });
    expect(pedidosFoiEscrito()).toBe(false);
  });

  it("txid inexistente nao confirma", async () => {
    vi.stubEnv("PIX_WEBHOOK_AUTO_CONFIRM", "true");
    vi.stubEnv("PIX_WEBHOOK_SECRET", "secret-ok");
    store.set("pedidos", [pedidoPix]);

    const body = await json(await POST(postReq(
      { txid: "tx-nao-existe", valor: 50, status: "pago" },
      { "x-pix-webhook-secret": "secret-ok" }
    )));

    expect(body).toMatchObject({ wouldConfirm: false, reason: "pedido_nao_encontrado" });
    expect(pedidosFoiEscrito()).toBe(false);
  });

  it("pedido ja confirmado retorna resposta idempotente sem gravar de novo", async () => {
    vi.stubEnv("PIX_WEBHOOK_AUTO_CONFIRM", "true");
    vi.stubEnv("PIX_WEBHOOK_SECRET", "secret-ok");
    store.set("pedidos", [
      { ...pedidoPix, pixConfirmado: true, pix: { ...pedidoPix.pix, status: "confirmado" } },
    ]);

    const body = await json(await POST(postReq(
      { txid: "tx-1", valor: 50, status: "pago", providerPaymentId: "prov-duplicado" },
      { "x-pix-webhook-secret": "secret-ok" }
    )));

    expect(body).toMatchObject({
      passive: false,
      wouldConfirm: false,
      confirmed: true,
      idempotent: true,
      reason: "pix_ja_confirmado",
      pedidoId: "pedido-1",
      txid: "tx-1",
    });
    expect(pedidosFoiEscrito()).toBe(false);
  });

  it("Pix hibrido confirma usando somente pix.valorEsperado, nao o total do pedido", async () => {
    vi.stubEnv("PIX_WEBHOOK_AUTO_CONFIRM", "true");
    vi.stubEnv("PIX_WEBHOOK_SECRET", "secret-ok");
    store.set("pedidos", [
      {
        id: "pedido-1",
        total: 50,
        status: "novo",
        pagamento: "Pix (R$ 30,00) + Dinheiro (R$ 20,00)",
        pix: { txid: "tx-hibrido", valorEsperado: 30, status: "pendente" },
      },
    ]);

    const body = await json(await POST(postReq(
      { txid: "tx-hibrido", valor: 30, status: "liquidado" },
      { "x-pix-webhook-secret": "secret-ok" }
    )));
    const pedidos = store.get("pedidos") as any[];

    expect(body).toMatchObject({
      wouldConfirm: true,
      confirmed: true,
      pedidoId: "pedido-1",
      valorEsperado: 30,
      valorRecebido: 30,
    });
    expect(pedidos[0].total).toBe(50);
    expect(pedidos[0].status).toBe("novo");
    expect(pedidos[0].pixConfirmado).toBe(true);
    expect(pedidos[0].pix.status).toBe("confirmado");
  });
});

describe("POST /api/pix/webhook — adaptador Mercado Pago", () => {
  const mpBody = { type: "payment", data: { id: "MP-9001" } };
  const mpHeaders = { "x-signature": "ts=1,v1=abc", "x-request-id": "req-1" };

  function pagamento(overrides: Record<string, unknown> = {}) {
    return { id: "MP-9001", status: "approved", transactionAmount: 50, externalReference: "tx-1", ...overrides };
  }

  it("payload MP type=payment é detectado; passivo (flag off) não grava nada", async () => {
    store.set("pedidos", [pedidoPix]);
    assinaturaMock.mockReturnValue(true);

    const res = await POST(postReq(mpBody, mpHeaders));
    const body = await json(res);

    expect(body).toMatchObject({ ok: true, passive: true, provider: "mercadopago", assinaturaValida: true });
    expect(buscarPagamentoMock).not.toHaveBeenCalled(); // passivo nunca chama a API do MP
    expect(pedidosFoiEscrito()).toBe(false);
  });

  it("type diferente de payment é tratado pelo caminho genérico, não pelo MP", async () => {
    store.set("pedidos", [pedidoPix]);

    // Sem flag: caminho genérico passivo. Payload não-MP não deve reportar provider mercadopago.
    const res = await POST(postReq({ type: "merchant_order", data: { id: "X" } }));
    const body = await json(res);

    expect(body.provider).toBeUndefined();
    expect(body).toMatchObject({ ok: true, passive: true });
    expect(buscarPagamentoMock).not.toHaveBeenCalled();
    expect(pedidosFoiEscrito()).toBe(false);
  });

  it("ativo + assinatura válida + pagamento aprovado confirma e grava (external_reference casa com pix.txid)", async () => {
    vi.stubEnv("PIX_WEBHOOK_AUTO_CONFIRM", "true");
    store.set("pedidos", [pedidoPix]);
    assinaturaMock.mockReturnValue(true);
    buscarPagamentoMock.mockResolvedValue(pagamento());

    const res = await POST(postReq(mpBody, mpHeaders));
    const body = await json(res);
    const pedidos = store.get("pedidos") as any[];

    expect(body).toMatchObject({ passive: false, wouldConfirm: true, confirmed: true, pedidoId: "pedido-1", txid: "tx-1" });
    expect(pedidos[0].pixConfirmado).toBe(true);
    expect(pedidos[0].pix).toMatchObject({ status: "confirmado", confirmadoPor: "webhook", providerPaymentId: "MP-9001" });
    // 1 SET NX do lock GLOBAL + 1 gravação do pedido + 2 chamadas
    // best-effort do Sentinela Pix (ver comentário equivalente acima).
    expect(redisMock.set).toHaveBeenCalledTimes(4);
  });

  it("ativo + assinatura inválida/ausente retorna 401 e não grava (nem busca o pagamento)", async () => {
    vi.stubEnv("PIX_WEBHOOK_AUTO_CONFIRM", "true");
    store.set("pedidos", [pedidoPix]);
    assinaturaMock.mockReturnValue(false);

    const res = await POST(postReq(mpBody, {}));
    const body = await json(res);

    expect(res.status).toBe(401);
    expect(body).toMatchObject({ passive: false, provider: "mercadopago", wouldConfirm: false, reason: "assinatura_invalida" });
    expect(buscarPagamentoMock).not.toHaveBeenCalled();
    expect(pedidosFoiEscrito()).toBe(false);
  });

  it("ativo + assinatura válida + pagamento pendente não confirma", async () => {
    vi.stubEnv("PIX_WEBHOOK_AUTO_CONFIRM", "true");
    store.set("pedidos", [pedidoPix]);
    assinaturaMock.mockReturnValue(true);
    buscarPagamentoMock.mockResolvedValue(pagamento({ status: "pending" }));

    const body = await json(await POST(postReq(mpBody, mpHeaders)));

    expect(body).toMatchObject({ wouldConfirm: false, reason: "status_nao_pago" });
    expect(pedidosFoiEscrito()).toBe(false);
  });

  it("ativo + assinatura válida + valor divergente não confirma", async () => {
    vi.stubEnv("PIX_WEBHOOK_AUTO_CONFIRM", "true");
    store.set("pedidos", [pedidoPix]);
    assinaturaMock.mockReturnValue(true);
    buscarPagamentoMock.mockResolvedValue(pagamento({ transactionAmount: 49.99 }));

    const body = await json(await POST(postReq(mpBody, mpHeaders)));

    expect(body).toMatchObject({ wouldConfirm: false, reason: "valor_divergente" });
    expect(pedidosFoiEscrito()).toBe(false);
  });

  it("ativo + pagamento indisponível na API do MP não confirma", async () => {
    vi.stubEnv("PIX_WEBHOOK_AUTO_CONFIRM", "true");
    store.set("pedidos", [pedidoPix]);
    assinaturaMock.mockReturnValue(true);
    buscarPagamentoMock.mockResolvedValue(null);

    const body = await json(await POST(postReq(mpBody, mpHeaders)));

    expect(body).toMatchObject({ passive: false, provider: "mercadopago", wouldConfirm: false, reason: "pagamento_indisponivel" });
    expect(pedidosFoiEscrito()).toBe(false);
  });

  it("idempotência: segunda notificação MP de pedido já confirmado não reconfirma", async () => {
    vi.stubEnv("PIX_WEBHOOK_AUTO_CONFIRM", "true");
    store.set("pedidos", [
      { ...pedidoPix, pixConfirmado: true, pix: { ...pedidoPix.pix, status: "confirmado" } },
    ]);
    assinaturaMock.mockReturnValue(true);
    buscarPagamentoMock.mockResolvedValue(pagamento({ id: "MP-duplicado" }));

    const body = await json(await POST(postReq(mpBody, mpHeaders)));

    expect(body).toMatchObject({ confirmed: true, idempotent: true, reason: "pix_ja_confirmado", pedidoId: "pedido-1" });
    expect(pedidosFoiEscrito()).toBe(false);
  });

  // Edição de pedido (ver AGENTS.md): quando o cliente troca de Pix para
  // outro valor/forma de pagamento, a edição gera uma cobrança NOVA
  // (providerPaymentId diferente) mas o txid interno continua o mesmo
  // (chefebot_<pedidoId>). Sem esta proteção, o pagamento de uma cobrança já
  // substituída poderia confirmar incorretamente a revisão nova do pedido.
  it("cobrança antiga (providerPaymentId diferente da cobrança ativa) NUNCA confirma a revisão nova do pedido", async () => {
    vi.stubEnv("PIX_WEBHOOK_AUTO_CONFIRM", "true");
    store.set("pedidos", [
      { ...pedidoPix, pix: { ...pedidoPix.pix, providerPaymentId: "MP-NOVO-9999" } },
    ]);
    assinaturaMock.mockReturnValue(true);
    // O pagamento que chega agora é da cobrança ANTIGA (MP-9001), já substituída.
    buscarPagamentoMock.mockResolvedValue(pagamento({ id: "MP-9001" }));

    const res = await POST(postReq(mpBody, mpHeaders));
    const body = await json(res);

    expect(body).toMatchObject({ wouldConfirm: false, reason: "cobranca_substituida", pedidoId: "pedido-1" });
    expect(pedidosFoiEscrito()).toBe(false);
    const pedidos = store.get("pedidos") as any[];
    expect(pedidos[0].pixConfirmado).toBeFalsy();
  });

  it("cobrança ativa (mesmo providerPaymentId) confirma normalmente", async () => {
    vi.stubEnv("PIX_WEBHOOK_AUTO_CONFIRM", "true");
    store.set("pedidos", [
      { ...pedidoPix, pix: { ...pedidoPix.pix, providerPaymentId: "MP-9001" } },
    ]);
    assinaturaMock.mockReturnValue(true);
    buscarPagamentoMock.mockResolvedValue(pagamento({ id: "MP-9001" }));

    const body = await json(await POST(postReq(mpBody, mpHeaders)));

    expect(body).toMatchObject({ confirmed: true, wouldConfirm: true });
    const pedidos = store.get("pedidos") as any[];
    expect(pedidos[0].pixConfirmado).toBe(true);
  });
});
