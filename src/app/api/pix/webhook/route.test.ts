import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async () => "OK"),
  };
  return { store, redisMock };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));

import { POST } from "./route";

function postReq(body: unknown) {
  return {
    json: async () => body,
  } as never;
}

async function json(res: Response) {
  return res.json() as Promise<Record<string, unknown>>;
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("POST /api/pix/webhook", () => {
  it("txid valido + valor correto + status pago retorna wouldConfirm true sem gravar", async () => {
    store.set("pedidos", [
      { id: "pedido-1", total: 50, pix: { txid: "tx-1", valorEsperado: 50, status: "pendente" } },
    ]);

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

  it("txid inexistente retorna wouldConfirm false", async () => {
    store.set("pedidos", [
      { id: "pedido-1", total: 50, pix: { txid: "tx-1", valorEsperado: 50, status: "pendente" } },
    ]);

    const res = await POST(postReq({ txid: "tx-nao-existe", valor: 50, status: "pago" }));
    const body = await json(res);

    expect(body).toMatchObject({ wouldConfirm: false, reason: "pedido_nao_encontrado" });
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it("valor menor retorna wouldConfirm false", async () => {
    store.set("pedidos", [
      { id: "pedido-1", total: 50, pix: { txid: "tx-1", valorEsperado: 50, status: "pendente" } },
    ]);

    const res = await POST(postReq({ txid: "tx-1", valor: 49.99, status: "pago" }));
    const body = await json(res);

    expect(body).toMatchObject({ wouldConfirm: false, reason: "valor_divergente", valorEsperado: 50, valorRecebido: 49.99 });
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it("status pendente retorna wouldConfirm false", async () => {
    store.set("pedidos", [
      { id: "pedido-1", total: 50, pix: { txid: "tx-1", valorEsperado: 50, status: "pendente" } },
    ]);

    const res = await POST(postReq({ txid: "tx-1", valor: 50, status: "pendente" }));
    const body = await json(res);

    expect(body).toMatchObject({ wouldConfirm: false, reason: "status_nao_pago" });
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it("pedido sem pix retorna wouldConfirm false", async () => {
    store.set("pedidos", [
      { id: "pedido-1", total: 50, pagamento: "Pix" },
    ]);

    const res = await POST(postReq({ txid: "tx-1", valor: 50, status: "pago" }));
    const body = await json(res);

    expect(body).toMatchObject({ wouldConfirm: false });
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it("Pix hibrido usa pix.valorEsperado, nao o total do pedido", async () => {
    store.set("pedidos", [
      {
        id: "pedido-1",
        total: 50,
        pagamento: "Pix (R$ 30,00) + Dinheiro (R$ 20,00)",
        pix: { txid: "tx-hibrido", valorEsperado: 30, status: "pendente" },
      },
    ]);

    const res = await POST(postReq({ txid: "tx-hibrido", valor: 30, status: "liquidado" }));
    const body = await json(res);

    expect(body).toMatchObject({
      wouldConfirm: true,
      pedidoId: "pedido-1",
      valorEsperado: 30,
      valorRecebido: 30,
    });
    expect(redisMock.set).not.toHaveBeenCalled();
  });
});
