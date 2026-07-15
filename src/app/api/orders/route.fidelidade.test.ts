import { vi, describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const redisStore = new Map<string, unknown>();

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => (redisStore.has(key) ? redisStore.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown) => {
      redisStore.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => {
      redisStore.delete(key);
      return 1;
    }),
  },
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    verifyToken: vi.fn(async (token: string) => (token === "token-admin" ? { username: "dev-admin", name: "Admin", role: "admin" } : null)),
  };
});

const creditarFidelidadePedidoMock = vi.fn(async () => undefined);
const creditarPontosPedidoEntregueMock = vi.fn(async () => undefined);
vi.mock("@/lib/fidelidade", () => ({
  creditarFidelidadePedido: (...args: unknown[]) => creditarFidelidadePedidoMock(...args),
  creditarPontosPedidoEntregue: (...args: unknown[]) => creditarPontosPedidoEntregueMock(...args),
}));

vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));

import { PATCH } from "./route";

function seedPedido(overrides: Record<string, unknown> = {}) {
  const pedido = {
    id: "ped_1",
    cliente: "Fulano",
    telefone: "86999998888",
    itens: ["1x Pizza G Calabresa"],
    total: 50,
    status: "saiu_entrega",
    horario: "12:00",
    endereco: "Retirada na loja",
    clienteId: "cli_abc",
    pizzasCount: 2,
    ...overrides,
  };
  redisStore.set("pedidos", [pedido]);
  return pedido;
}

function patchRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/orders", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", cookie: "auth-token=token-admin" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  redisStore.clear();
  creditarFidelidadePedidoMock.mockClear();
  creditarFidelidadePedidoMock.mockResolvedValue(undefined);
  creditarPontosPedidoEntregueMock.mockClear();
  creditarPontosPedidoEntregueMock.mockResolvedValue(undefined);
});

describe("PATCH /api/orders — credito de fidelidade ao finalizar pedido", () => {
  test("status 'entregue' aciona o credito de fidelidade com pedidoId/clienteId/pizzas corretos", async () => {
    seedPedido();
    const res = await PATCH(patchRequest({ id: "ped_1", status: "entregue" }));
    expect(res.status).toBe(200);
    expect(creditarFidelidadePedidoMock).toHaveBeenCalledWith({ pedidoId: "ped_1", clienteId: "cli_abc", pizzas: 2 });
  });

  test("status intermediario (em_preparo) NAO aciona credito de fidelidade", async () => {
    seedPedido({ status: "novo" })
    const res = await PATCH(patchRequest({ id: "ped_1", status: "em_preparo", silent: true }));
    expect(res.status).toBe(200);
    expect(creditarFidelidadePedidoMock).not.toHaveBeenCalled();
    expect(creditarPontosPedidoEntregueMock).not.toHaveBeenCalled();
  });

  test("falha no credito de fidelidade NAO impede o pedido de ser salvo/respondido", async () => {
    seedPedido();
    creditarFidelidadePedidoMock.mockRejectedValueOnce(new Error("falha redis fidelidade"));

    const res = await PATCH(patchRequest({ id: "ped_1", status: "entregue" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe("entregue");
    const pedidosSalvos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidosSalvos[0].status).toBe("entregue");
  });

  test("pedido anonimo (sem clienteId) tambem finaliza normalmente, credito e ignorado dentro do helper", async () => {
    seedPedido({ clienteId: undefined, pizzasCount: undefined });
    const res = await PATCH(patchRequest({ id: "ped_1", status: "entregue" }));
    expect(res.status).toBe(200);
    expect(creditarFidelidadePedidoMock).toHaveBeenCalledWith({ pedidoId: "ped_1", clienteId: undefined, pizzas: 0 });
  });
});

describe("PATCH /api/orders — credito de PONTOS de fidelidade (novo modelo) ao finalizar pedido", () => {
  test("status 'entregue' aciona o credito de pontos com id/telefone/clienteId/total/taxaEntrega corretos", async () => {
    seedPedido({ taxaEntrega: 5 });
    const res = await PATCH(patchRequest({ id: "ped_1", status: "entregue" }));
    expect(res.status).toBe(200);
    expect(creditarPontosPedidoEntregueMock).toHaveBeenCalledWith({
      id: "ped_1",
      status: "entregue",
      telefone: "86999998888",
      clienteId: "cli_abc",
      total: 50,
      taxaEntrega: 5,
    });
  });

  test("status intermediario (saiu_entrega) NAO aciona credito de pontos", async () => {
    seedPedido();
    const res = await PATCH(patchRequest({ id: "ped_1", status: "saiu_entrega", silent: true }));
    expect(res.status).toBe(200);
    expect(creditarPontosPedidoEntregueMock).not.toHaveBeenCalled();
  });

  test("8. falha controlada no credito de PONTOS NAO impede o pedido de ser salvo/respondido", async () => {
    seedPedido();
    creditarPontosPedidoEntregueMock.mockRejectedValueOnce(new Error("falha redis pontos"));

    const res = await PATCH(patchRequest({ id: "ped_1", status: "entregue" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe("entregue");
    const pedidosSalvos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidosSalvos[0].status).toBe("entregue");
    // o credito antigo (pizzas) continua rodando normalmente, independente da falha no de pontos
    expect(creditarFidelidadePedidoMock).toHaveBeenCalled();
  });

  test("pedido sem telefone valido (string vazia) ainda assim aciona a chamada — a validacao e responsabilidade do helper", async () => {
    seedPedido({ telefone: "" });
    const res = await PATCH(patchRequest({ id: "ped_1", status: "entregue" }));
    expect(res.status).toBe(200);
    expect(creditarPontosPedidoEntregueMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ped_1", status: "entregue", telefone: "" })
    );
  });
});
