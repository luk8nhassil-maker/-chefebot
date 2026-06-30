import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/lib/redis", () => ({ redis: redisMock }));

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
    expect(redisMock.set).not.toHaveBeenCalled();
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
    expect(redisMock.set).toHaveBeenCalledTimes(1);
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
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it("sem PIX_WEBHOOK_SECRET configurado nao confirma", async () => {
    vi.stubEnv("PIX_WEBHOOK_AUTO_CONFIRM", "true");
    store.set("pedidos", [pedidoPix]);

    const body = await json(await POST(postReq(
      { txid: "tx-1", valor: 50, status: "pago" },
      { "x-pix-webhook-secret": "qualquer" }
    )));

    expect(body).toMatchObject({ wouldConfirm: false, reason: "segredo_invalido" });
    expect(redisMock.set).not.toHaveBeenCalled();
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
    expect(redisMock.set).not.toHaveBeenCalled();
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
    expect(redisMock.set).not.toHaveBeenCalled();
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
    expect(redisMock.set).not.toHaveBeenCalled();
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
    expect(redisMock.set).not.toHaveBeenCalled();
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
