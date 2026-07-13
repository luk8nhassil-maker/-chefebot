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

// A rota chama só `creditarFidelidadeEfetiva` (Nível 6.6.1) — a decisão de
// qual modelo credita (antigo vs. pontos) foi centralizada em
// src/lib/fidelidade.ts e é testada separadamente em
// src/lib/fidelidade.creditoEfetivo.test.ts contra Redis real, não aqui.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura precisa aceitar args variádicos para bater com creditarFidelidadeEfetiva
const creditarFidelidadeEfetivaMock = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("@/lib/fidelidade", () => ({
  creditarFidelidadeEfetiva: (...args: unknown[]) => creditarFidelidadeEfetivaMock(...args),
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
  creditarFidelidadeEfetivaMock.mockClear();
  creditarFidelidadeEfetivaMock.mockResolvedValue(undefined);
});

describe("PATCH /api/orders — credito de fidelidade ao finalizar pedido (Nível 6.6.1: modelo único por chamada)", () => {
  test("status 'entregue' aciona creditarFidelidadeEfetiva com todos os campos dos dois modelos", async () => {
    seedPedido({ taxaEntrega: 5 });
    const res = await PATCH(patchRequest({ id: "ped_1", status: "entregue" }));
    expect(res.status).toBe(200);
    expect(creditarFidelidadeEfetivaMock).toHaveBeenCalledTimes(1);
    expect(creditarFidelidadeEfetivaMock).toHaveBeenCalledWith({
      id: "ped_1",
      status: "entregue",
      telefone: "86999998888",
      clienteId: "cli_abc",
      total: 50,
      taxaEntrega: 5,
      pizzasCount: 2,
    });
  });

  test("status intermediario (em_preparo) NAO aciona nenhum credito", async () => {
    seedPedido({ status: "novo" });
    const res = await PATCH(patchRequest({ id: "ped_1", status: "em_preparo", silent: true }));
    expect(res.status).toBe(200);
    expect(creditarFidelidadeEfetivaMock).not.toHaveBeenCalled();
  });

  test("falha no credito de fidelidade NAO impede o pedido de ser salvo/respondido", async () => {
    seedPedido();
    creditarFidelidadeEfetivaMock.mockRejectedValueOnce(new Error("falha redis fidelidade"));

    const res = await PATCH(patchRequest({ id: "ped_1", status: "entregue" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe("entregue");
    const pedidosSalvos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidosSalvos[0].status).toBe("entregue");
  });

  test("pedido anonimo (sem clienteId/pizzasCount) tambem finaliza normalmente — validacao e responsabilidade do helper", async () => {
    seedPedido({ clienteId: undefined, pizzasCount: undefined });
    const res = await PATCH(patchRequest({ id: "ped_1", status: "entregue" }));
    expect(res.status).toBe(200);
    expect(creditarFidelidadeEfetivaMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ped_1", clienteId: undefined, pizzasCount: 0 })
    );
  });

  test("status intermediario (saiu_entrega) tambem nao credita nada", async () => {
    seedPedido();
    const res = await PATCH(patchRequest({ id: "ped_1", status: "saiu_entrega", silent: true }));
    expect(res.status).toBe(200);
    expect(creditarFidelidadeEfetivaMock).not.toHaveBeenCalled();
  });

  test("pedido sem telefone valido (string vazia) ainda assim aciona a chamada — a validacao e responsabilidade do helper", async () => {
    seedPedido({ telefone: "" });
    const res = await PATCH(patchRequest({ id: "ped_1", status: "entregue" }));
    expect(res.status).toBe(200);
    expect(creditarFidelidadeEfetivaMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ped_1", status: "entregue", telefone: "" })
    );
  });
});
