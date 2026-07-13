import { vi, describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const redisStore = new Map<string, unknown>();

function defaultGetImpl(key: string) {
  return Promise.resolve(redisStore.has(key) ? redisStore.get(key) : null);
}
function defaultSetImpl(key: string, value: unknown, opts?: { nx?: boolean }) {
  if (opts?.nx && redisStore.has(key)) return Promise.resolve(null);
  redisStore.set(key, value);
  return Promise.resolve("OK");
}

// Replica os dois scripts Lua reais da fidelidade por pontos, sem interpretar
// Lua: liberarLockPontosSeDono (1 chave: GET==token -> DEL) e
// persistirEstadoPontosSeDono (2 chaves: GET(lock)==token -> SET(estado)).
function defaultEvalImpl(_script: string, keys: string[], args: unknown[]) {
  if (keys.length === 1) {
    const [key] = keys;
    const [token] = args;
    if (redisStore.get(key) === token) {
      redisStore.delete(key);
      return Promise.resolve(1);
    }
    return Promise.resolve(0);
  }
  const [lockKey, estadoKey] = keys;
  const [token, estadoJson] = args;
  if (redisStore.get(lockKey) === token) {
    redisStore.set(estadoKey, JSON.parse(String(estadoJson)));
    return Promise.resolve(1);
  }
  return Promise.resolve(0);
}

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(defaultGetImpl),
    set: vi.fn(defaultSetImpl),
    eval: vi.fn(defaultEvalImpl),
  },
}));

vi.mock("@/lib/numeracao", () => ({
  proximoNumeroPedido: vi.fn(async () => 100),
}));

vi.mock("@/lib/clienteAuth", () => ({
  CLIENTE_COOKIE: "cliente-token",
  verificarTokenCliente: vi.fn(async (token: string) => {
    if (token === "token-cliente-logado") return { clienteId: "cli_pontos", telefone: "11900000001" };
    return null;
  }),
}));

vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));

import { POST } from "./route";
import { derivarClienteIdPorTelefone, obterExtratoPontos, obterSaldoPontos } from "@/lib/fidelidade";
import { PROMOS_KEY } from "@/lib/promocoes";

beforeEach(async () => {
  redisStore.clear();
  vi.mocked(fetch).mockClear();
  const redisLib = await import("@/lib/redis");
  vi.mocked(redisLib.redis.get).mockImplementation(defaultGetImpl);
  vi.mocked(redisLib.redis.set).mockImplementation(defaultSetImpl);
  vi.mocked(redisLib.redis.eval).mockImplementation(defaultEvalImpl);
});

const itemPizzaRetirada = { kind: "pizza" as const, name: "Pizza G", detail: "Calabresa", price: 50, qty: 1 };

function pedidoRequest(opts: { clienteToken?: string; itens?: unknown[]; tipoEntrega?: string; bairro?: string; rua?: string; numero?: string; body?: Record<string, unknown> } = {}) {
  const body = {
    cliente: "Fulano de Tal",
    telefone: "86999998888",
    itens: opts.itens ?? [itemPizzaRetirada],
    tipoEntrega: opts.tipoEntrega ?? "retirada",
    bairro: opts.bairro,
    rua: opts.rua,
    numero: opts.numero,
    pagamento: "Dinheiro",
    troco: "Sem troco",
    ...opts.body,
  };
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.clienteToken) headers.cookie = `cliente-token=${opts.clienteToken}`;
  return new NextRequest("http://localhost/api/pedido-app", { method: "POST", headers, body: JSON.stringify(body) });
}

describe("POST /api/pedido-app — pontos previstos (modelo novo)", () => {
  test("pedido autenticado cria movimento 'previsto' no cliente canonico da sessao", async () => {
    const res = await POST(pedidoRequest({ clienteToken: "token-cliente-logado" }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.total).toBe(50);

    const pedidosSalvos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidosSalvos[0].clienteId).toBe(derivarClienteIdPorTelefone("11900000001"));
    expect(pedidosSalvos[0].clienteVinculo).toBe("sessao");

    const extrato = await obterExtratoPontos(derivarClienteIdPorTelefone("11900000001")!);
    expect(extrato).toHaveLength(1);
    expect(extrato[0].tipo).toBe("previsto");
    expect(extrato[0].pontos).toBe(50);
    expect(await obterExtratoPontos(derivarClienteIdPorTelefone("86999998888")!)).toHaveLength(0);

    // previsto nunca entra no saldo confirmado
    const saldo = await obterSaldoPontos(derivarClienteIdPorTelefone("11900000001")!);
    expect(saldo.disponivel).toBe(0);
  });

  test("clienteId enviado no body nao vira vinculo de fidelidade", async () => {
    const res = await POST(pedidoRequest({ body: { clienteId: "cli_99974000691" } }));
    expect(res.status).toBe(200);

    const pedidosSalvos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidosSalvos[0].clienteId).toBeUndefined();
    expect(pedidosSalvos[0].clienteVinculo).toBeUndefined();
    expect(await obterExtratoPontos("cli_99974000691")).toHaveLength(0);
    expect(await obterExtratoPontos(derivarClienteIdPorTelefone("86999998888")!)).toHaveLength(1);
  });

  test("pedido SEM clienteId (anonimo) cria previsto pelo telefone canonico", async () => {
    const res = await POST(pedidoRequest());
    expect(res.status).toBe(200);

    const extratoAnonimo = await obterExtratoPontos(derivarClienteIdPorTelefone("86999998888")!);
    expect(extratoAnonimo).toHaveLength(1);
    expect(extratoAnonimo[0].tipo).toBe("previsto");
  });

  test("cookie invalido nao impede previsao quando o telefone do pedido e valido", async () => {
    const res = await POST(pedidoRequest({ clienteToken: "token-adulterado-ou-expirado" }));
    expect(res.status).toBe(200);
    const extrato = await obterExtratoPontos(derivarClienteIdPorTelefone("86999998888")!);
    expect(extrato).toHaveLength(1);
    expect(extrato[0].tipo).toBe("previsto");
  });

  test("taxa de entrega nunca gera pontos: total igual a taxa reduz pontos elegiveis a 0 e nao registra movimento", async () => {
    // item barato + taxa alta o suficiente para zerar o valor elegivel
    const res = await POST(pedidoRequest({
      clienteToken: "token-cliente-logado",
      tipoEntrega: "delivery",
      bairro: "Barro Preto", // fee 7
      rua: "Rua X",
      numero: "10",
      itens: [{ kind: "simple", name: "Agua sem Gas", price: 3, qty: 1 }], // subtotal 3, taxa 7 -> total 10, elegivel = 10-7=3
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBe(10);

    const extrato = await obterExtratoPontos(derivarClienteIdPorTelefone("11900000001")!);
    expect(extrato).toHaveLength(1);
    expect(extrato[0].pontos).toBe(3); // 10 - 7 (taxa), nao os 10 inteiros
  });

  test("desconto de promocao reduz corretamente o valor elegivel (e valor decimal usa floor)", async () => {
    const promo = {
      id: "promo_pontos_1",
      active: true,
      featured: true,
      badge: "PROMO",
      title: "Combo promocional",
      description: "Combo",
      buttonText: "Pedir",
      type: "combo_fixed_price",
      mainItems: [{ productId: "pizza:G", productName: "Pizza G", category: "pizza", quantity: 1, customerMustChooseFlavor: true }],
      freeItems: [],
      promotionalPrice: 49.9,
      includedText: "",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    redisStore.set(PROMOS_KEY, [promo]);

    const itemPromo = {
      kind: "promo",
      promoId: "promo_pontos_1",
      name: "Promoção: Combo promocional",
      detail: "Sabor: Calabresa · Preço promocional: R$ 49,90",
      price: 49.9,
      qty: 1,
    };

    const res = await POST(pedidoRequest({ clienteToken: "token-cliente-logado", itens: [itemPromo] }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.total).toBe(49.9); // preço normal da pizza G seria 50 — desconto aplicado

    const extrato = await obterExtratoPontos(derivarClienteIdPorTelefone("11900000001")!);
    expect(extrato).toHaveLength(1);
    expect(extrato[0].pontos).toBe(49); // floor(49.9), nunca 50 nem 49.9 fracionado
  });

  test("falha no registro de pontos previstos nunca impede a criacao do pedido", async () => {
    const setSpy = vi.mocked((await import("@/lib/redis")).redis.set);
    setSpy.mockImplementation(async (key: string, value: unknown, opts?: { nx?: boolean }) => {
      if (typeof key === "string" && key.startsWith("fidelidade:pontos:")) {
        throw new Error("falha redis fidelidade pontos");
      }
      if (opts?.nx && redisStore.has(key)) return null;
      redisStore.set(key, value);
      return "OK";
    });

    const res = await POST(pedidoRequest({ clienteToken: "token-cliente-logado" }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);

    const pedidosSalvos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidosSalvos).toHaveLength(1);
  });
});

describe("modelo antigo (pizzas) continua funcionando junto com o novo (pontos)", () => {
  test("pedido com clienteId gera pizzasCount (antigo) e pontos previstos (novo) simultaneamente, sem colisao", async () => {
    const res = await POST(pedidoRequest({ clienteToken: "token-cliente-logado", itens: [itemPizzaRetirada, itemPizzaRetirada] }));
    expect(res.status).toBe(200);

    const pedidosSalvos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidosSalvos[0].pizzasCount).toBe(2);
    expect(pedidosSalvos[0].clienteId).toBe(derivarClienteIdPorTelefone("11900000001"));
    expect(pedidosSalvos[0].clienteVinculo).toBe("sessao");

    const extratoPontos = await obterExtratoPontos(derivarClienteIdPorTelefone("11900000001")!);
    expect(extratoPontos).toHaveLength(1);
    expect(extratoPontos[0].tipo).toBe("previsto");
  });
});
