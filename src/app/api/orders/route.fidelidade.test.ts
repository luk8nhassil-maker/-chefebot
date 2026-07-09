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
vi.mock("@/lib/fidelidade", () => ({
  creditarFidelidadePedido: (...args: unknown[]) => creditarFidelidadePedidoMock(...args),
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
