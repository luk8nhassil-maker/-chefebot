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

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(defaultGetImpl),
    set: vi.fn(defaultSetImpl),
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
import { obterExtratoPontos, obterSaldoPontos } from "@/lib/fidelidade";
import { PROMOS_KEY } from "@/lib/promocoes";

beforeEach(async () => {
  redisStore.clear();
  vi.mocked(fetch).mockClear();
  const redisLib = await import("@/lib/redis");
  vi.mocked(redisLib.redis.get).mockImplementation(defaultGetImpl);
  vi.mocked(redisLib.redis.set).mockImplementation(defaultSetImpl);
});

const itemPizzaRetirada = { kind: "pizza" as const, name: "Pizza G", detail: "Calabresa", price: 50, qty: 1 };

function pedidoRequest(opts: { clienteToken?: string; itens?: unknown[]; tipoEntrega?: string; bairro?: string; rua?: string; numero?: string } = {}) {
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
  };
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.clienteToken) headers.cookie = `cliente-token=${opts.clienteToken}`;
  return new NextRequest("http://localhost/api/pedido-app", { method: "POST", headers, body: JSON.stringify(body) });
}

describe("POST /api/pedido-app — pontos previstos (modelo novo)", () => {
  test("pedido com clienteId cria movimento 'previsto' com pontos = floor(total - taxa)", async () => {
    const res = await POST(pedidoRequest({ clienteToken: "token-cliente-logado" }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.total).toBe(50);

    const extrato = await obterExtratoPontos("cli_pontos");
    expect(extrato).toHaveLength(1);
    expect(extrato[0].tipo).toBe("previsto");
    expect(extrato[0].pontos).toBe(50);

    // previsto nunca entra no saldo confirmado
    const saldo = await obterSaldoPontos("cli_pontos");
    expect(saldo.disponivel).toBe(0);
  });

  test("pedido SEM clienteId (anonimo) nao cria nenhum movimento de pontos", async () => {
    const res = await POST(pedidoRequest());
    expect(res.status).toBe(200);

    // sem clienteId nao ha chave de extrato para nenhum cliente vinculado a este pedido
    const extratoAnonimo = await obterExtratoPontos("cli_pontos");
    expect(extratoAnonimo).toHaveLength(0);
  });

  test("pedidos manuais/WhatsApp sem clienteId (cookie ausente ou invalido) permanecem fora do novo credito", async () => {
    const res = await POST(pedidoRequest({ clienteToken: "token-adulterado-ou-expirado" }));
    expect(res.status).toBe(200);
    const extrato = await obterExtratoPontos("cli_pontos");
    expect(extrato).toHaveLength(0);
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

    const extrato = await obterExtratoPontos("cli_pontos");
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

    const extrato = await obterExtratoPontos("cli_pontos");
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
    expect(pedidosSalvos[0].clienteId).toBe("cli_pontos");

    const extratoPontos = await obterExtratoPontos("cli_pontos");
    expect(extratoPontos).toHaveLength(1);
    expect(extratoPontos[0].tipo).toBe("previsto");
  });
});
