import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

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

vi.mock("@/lib/redis", () => ({ redis: redisMock }));

const { verifyMock, receiverCtorMock } = vi.hoisted(() => ({
  verifyMock: vi.fn(async () => true),
  receiverCtorMock: vi.fn(),
}));

vi.mock("@upstash/qstash", () => ({
  Receiver: class {
    constructor(config: unknown) {
      receiverCtorMock(config);
    }
    verify = verifyMock;
  },
}));

const { reconciliarMock } = vi.hoisted(() => ({
  reconciliarMock: vi.fn(async () => ({ verificados: 1, confirmados: 0, pendentes: 1, ignorados: 0, erros: 0, detalhes: [] })),
}));

vi.mock("@/lib/mercadoPagoReconciliacao", () => ({
  reconciliarPixMercadoPago: reconciliarMock,
}));

const { agendarMock } = vi.hoisted(() => ({
  agendarMock: vi.fn(async () => true),
}));

vi.mock("@/lib/pixGuardiaoScheduler", () => ({
  agendarProximaVerificacaoPixGuardiao: agendarMock,
}));

function req(body: unknown, headers: Record<string, string> = { "upstash-signature": "sig-valida" }) {
  return new NextRequest("https://chefebot-pjif.vercel.app/api/interno/pix-guardiao/verificar", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("/api/interno/pix-guardiao/verificar", () => {
  beforeEach(() => {
    store.clear();
    verifyMock.mockClear().mockResolvedValue(true);
    reconciliarMock.mockClear();
    agendarMock.mockClear().mockResolvedValue(true);
    receiverCtorMock.mockClear();
    process.env.QSTASH_CURRENT_SIGNING_KEY = "current-key";
    process.env.QSTASH_NEXT_SIGNING_KEY = "next-key";
  });

  afterEach(() => {
    delete process.env.QSTASH_CURRENT_SIGNING_KEY;
    delete process.env.QSTASH_NEXT_SIGNING_KEY;
  });

  test("sem chaves de assinatura configuradas retorna 503 e nao processa", async () => {
    delete process.env.QSTASH_CURRENT_SIGNING_KEY;
    delete process.env.QSTASH_NEXT_SIGNING_KEY;
    const { POST } = await import("./route");
    const res = await POST(req({ pedidoId: "p1", tentativa: 1 }));
    expect(res.status).toBe(503);
    expect(reconciliarMock).not.toHaveBeenCalled();
  });

  test("sem header de assinatura retorna 401", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ pedidoId: "p1", tentativa: 1 }, {}));
    expect(res.status).toBe(401);
    expect(reconciliarMock).not.toHaveBeenCalled();
  });

  test("assinatura invalida retorna 401 e nao reconcilia", async () => {
    verifyMock.mockResolvedValueOnce(false);
    const { POST } = await import("./route");
    const res = await POST(req({ pedidoId: "p1", tentativa: 1 }));
    expect(res.status).toBe(401);
    expect(reconciliarMock).not.toHaveBeenCalled();
  });

  test("payload invalido retorna 400", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ tentativa: 1 }));
    expect(res.status).toBe(400);
  });

  test("pedido ja confirmado encerra a cadeia sem reconciliar nem reagendar", async () => {
    store.set("pedidos", [{ id: "p1", pixConfirmado: true, pix: { provider: "mercadopago", status: "confirmado", criadoEm: new Date().toISOString() } }]);
    const { POST } = await import("./route");
    const res = await POST(req({ pedidoId: "p1", tentativa: 2 }));
    const json = await res.json();
    expect(json.encerrado).toBe(true);
    expect(reconciliarMock).not.toHaveBeenCalled();
    expect(agendarMock).not.toHaveBeenCalled();
  });

  test("pedido dentro da idade maxima e ainda pendente: reconcilia e reagenda proximo tick", async () => {
    store.set("pedidos", [{ id: "p1", pix: { provider: "mercadopago", status: "pendente", criadoEm: new Date().toISOString() } }]);
    const { POST } = await import("./route");
    const res = await POST(req({ pedidoId: "p1", tentativa: 1 }));
    const json = await res.json();
    expect(reconciliarMock).toHaveBeenCalledWith({ apenasPedidoIds: ["p1"] });
    expect(agendarMock).toHaveBeenCalledWith({ pedidoId: "p1", tentativa: 2, delayMs: expect.any(Number) });
    expect(json.encerrado).toBe(false);
  });

  test("idade acima do teto maximo encerra sem reconciliar", async () => {
    const criadoEm = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 60min > 45min maximo
    store.set("pedidos", [{ id: "p1", pix: { provider: "mercadopago", status: "pendente", criadoEm } }]);
    const { POST } = await import("./route");
    const res = await POST(req({ pedidoId: "p1", tentativa: 5 }));
    const json = await res.json();
    expect(json.encerrado).toBe(true);
    expect(reconciliarMock).not.toHaveBeenCalled();
  });

  test("pedido cancelado encerra sem reconciliar", async () => {
    store.set("pedidos", [{ id: "p1", status: "cancelado", pix: { provider: "mercadopago", status: "pendente", criadoEm: new Date().toISOString() } }]);
    const { POST } = await import("./route");
    const res = await POST(req({ pedidoId: "p1", tentativa: 1 }));
    const json = await res.json();
    expect(json.encerrado).toBe(true);
    expect(reconciliarMock).not.toHaveBeenCalled();
  });

  test("reconciliacao confirma o pagamento nesta rodada: encerra sem reagendar", async () => {
    store.set("pedidos", [{ id: "p1", pix: { provider: "mercadopago", status: "pendente", criadoEm: new Date().toISOString() } }]);
    reconciliarMock.mockImplementationOnce(async () => {
      store.set("pedidos", [{ id: "p1", pixConfirmado: true, pix: { provider: "mercadopago", status: "confirmado", criadoEm: new Date().toISOString() } }]);
      return { verificados: 1, confirmados: 1, pendentes: 0, ignorados: 0, erros: 0, detalhes: [] };
    });
    const { POST } = await import("./route");
    const res = await POST(req({ pedidoId: "p1", tentativa: 1 }));
    const json = await res.json();
    expect(json.encerrado).toBe(true);
    expect(agendarMock).not.toHaveBeenCalled();
  });

  test("mesmo tick (pedidoId+tentativa) entregue duas vezes so reconcilia uma vez", async () => {
    store.set("pedidos", [{ id: "p1", pix: { provider: "mercadopago", status: "pendente", criadoEm: new Date().toISOString() } }]);
    const { POST } = await import("./route");
    await POST(req({ pedidoId: "p1", tentativa: 1 }));
    const res2 = await POST(req({ pedidoId: "p1", tentativa: 1 }));
    const json2 = await res2.json();
    expect(json2.duplicado).toBe(true);
    expect(reconciliarMock).toHaveBeenCalledTimes(1);
  });
});
