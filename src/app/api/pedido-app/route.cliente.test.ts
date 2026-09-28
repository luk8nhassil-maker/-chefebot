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

vi.mock("@/lib/numeracao", () => ({
  proximoNumeroPedido: vi.fn(async () => 42),
  gerarIdPedidoUnico: vi.fn(async () => Date.now().toString()),
}));

const { registrarEventoServidorComportamentoMock } = vi.hoisted(() => ({
  registrarEventoServidorComportamentoMock: vi.fn(async () => true),
}));

vi.mock("@/lib/behaviorAnalytics", () => ({
  registrarEventoServidorComportamento: registrarEventoServidorComportamentoMock,
}));

vi.mock("@/lib/clienteAuth", () => ({
  CLIENTE_COOKIE: "cliente-token",
  verificarTokenCliente: vi.fn(async (token: string) => {
    if (token === "token-cliente-logado") return { clienteId: "cli_logado", telefone: "11900000001" };
    return null;
  }),
}));

vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));

import { POST } from "./route";

beforeEach(() => {
  redisStore.clear();
  vi.mocked(fetch).mockClear();
  registrarEventoServidorComportamentoMock.mockClear();
});

const itemPizza = { kind: "pizza" as const, name: "Pizza G", detail: "Calabresa", price: 50, qty: 2 };

function pedidoRequest(opts: { clienteToken?: string; itens?: unknown[]; cliente?: string; nome?: string; apelido?: string; behaviorSessionId?: string } = {}) {
  const body = {
    cliente: opts.cliente ?? "Fulano de Tal",
    ...(opts.nome !== undefined ? { nome: opts.nome } : {}),
    ...(opts.apelido !== undefined ? { apelido: opts.apelido } : {}),
    telefone: "86999998888",
    itens: opts.itens ?? [itemPizza],
    tipoEntrega: "retirada",
    pagamento: "Dinheiro",
    troco: "Sem troco",
    ...(opts.behaviorSessionId ? { behaviorSessionId: opts.behaviorSessionId } : {}),
  };
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.clienteToken) headers.cookie = `cliente-token=${opts.clienteToken}`;
  return new NextRequest("http://localhost/api/pedido-app", { method: "POST", headers, body: JSON.stringify(body) });
}

describe("POST /api/pedido-app — vinculo opcional com area do cliente", () => {
  test("cliente NAO logado consegue criar pedido normalmente (sem cliente-token) — pedido publico continua funcionando", async () => {
    const res = await POST(pedidoRequest());
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);

    const pedidosSalvos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidosSalvos).toHaveLength(1);
    expect(pedidosSalvos[0].clienteId).toBeUndefined();
  });

  test("apelido sozinho identifica o pedido sem ser salvo como nome", async () => {
    const res = await POST(pedidoRequest({ cliente: "Binho", apelido: "Binho" }));
    expect(res.status).toBe(200);

    const pedidosSalvos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidosSalvos[0].cliente).toBe("Binho");
    expect(pedidosSalvos[0].apelidoCliente).toBe("Binho");
    expect(pedidosSalvos[0].nomeCliente).toBeUndefined();
  });

  test("cliente logado tem o pedido vinculado ao clienteId e a contagem de pizzas", async () => {
    const res = await POST(pedidoRequest({ clienteToken: "token-cliente-logado" }));
    expect(res.status).toBe(200);

    const pedidosSalvos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidosSalvos[0].clienteId).toBe("cli_logado");
    expect(pedidosSalvos[0].pizzasCount).toBe(2);
  });

  test("cookie de cliente invalido/expirado nao impede o pedido de ser salvo (fallback anonimo)", async () => {
    const res = await POST(pedidoRequest({ clienteToken: "token-adulterado-ou-expirado" }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);

    const pedidosSalvos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidosSalvos[0].clienteId).toBeUndefined();
  });

  test("pedido criado vincula a sessao comportamental ao fato oficial sem afetar o pedido", async () => {
    const sessionId = "22222222-2222-4222-8222-222222222222";
    const res = await POST(pedidoRequest({
      clienteToken: "token-cliente-logado",
      behaviorSessionId: sessionId,
    }));

    expect(res.status).toBe(200);
    expect(registrarEventoServidorComportamentoMock).toHaveBeenCalledWith(expect.objectContaining({
      // A identidade canônica da fidelidade/analytics vem do telefone do
      // próprio pedido, não do cookie. Mantém a mesma autoridade já usada
      // pelo crédito de Estrelas e evita duas identidades para uma compra.
      clienteId: "cli_86999998888",
      sessionId,
      type: "order_created",
      context: expect.objectContaining({
        source: "checkout",
        target: "checkout",
        deliveryType: "retirada",
        paymentFamily: "dinheiro",
      }),
    }));
  });

  test("bebida nao entra na contagem de pizzas para fidelidade", async () => {
    const res = await POST(pedidoRequest({
      clienteToken: "token-cliente-logado",
      itens: [itemPizza, { kind: "simple", name: "Refrigerante 2L", price: 15, qty: 1 }],
    }));
    expect(res.status).toBe(200);
    const pedidosSalvos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidosSalvos[0].pizzasCount).toBe(2);
  });
});
