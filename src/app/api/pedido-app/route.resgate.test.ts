import { vi, describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const redisStore = new Map<string, unknown>();

function defaultGetImpl(key: string) {
  return Promise.resolve(redisStore.has(key) ? redisStore.get(key) : null);
}
function defaultSetImpl(key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) {
  if (opts?.nx && redisStore.has(key)) return Promise.resolve(null);
  redisStore.set(key, value);
  return Promise.resolve("OK");
}
function defaultDelImpl(key: string) {
  redisStore.delete(key);
  return Promise.resolve(1);
}

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(defaultGetImpl),
    set: vi.fn(defaultSetImpl),
    del: vi.fn(defaultDelImpl),
  },
}));

vi.mock("@/lib/numeracao", () => ({
  proximoNumeroPedido: vi.fn(async () => 100),
}));

vi.mock("@/lib/clienteAuth", () => ({
  CLIENTE_COOKIE: "cliente-token",
  verificarTokenCliente: vi.fn(async (token: string) => {
    if (token === "token-cliente-a") return { clienteId: "cli_a", telefone: "11900000001" };
    if (token === "token-cliente-b") return { clienteId: "cli_b", telefone: "11900000002" };
    return null;
  }),
}));

vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));

import { POST } from "./route";
import {
  obterExtratoPontos,
  obterSaldoPontos,
  registrarMovimentoPontosIdempotente,
  salvarConfigFidelidadePontos,
  criarReservaResgate,
  obterResgatePorId,
  type ConfigFidelidadePontos,
} from "@/lib/fidelidade";

const configDescontoFixo: ConfigFidelidadePontos = {
  ativo: true,
  metaPontos: 720,
  descricaoRecompensa: "Pizza gratis",
  recompensa: {
    ativa: true,
    custoPontos: 500,
    tipo: "desconto_fixo",
    descricao: "R$20 de desconto",
    valorDescontoCentavos: 2000,
  },
};

beforeEach(async () => {
  redisStore.clear();
  vi.mocked(fetch).mockClear();
  const redisLib = await import("@/lib/redis");
  vi.mocked(redisLib.redis.get).mockImplementation(defaultGetImpl);
  vi.mocked(redisLib.redis.set).mockImplementation(defaultSetImpl);
  vi.mocked(redisLib.redis.del).mockImplementation(defaultDelImpl);
});

async function darSaldo(clienteId: string, pontos: number) {
  await registrarMovimentoPontosIdempotente(clienteId, {
    eventoId: `seed:${clienteId}:${pontos}:${Math.random()}`,
    pedidoId: `ped_seed_${Math.random()}`,
    tipo: "confirmado",
    pontos,
    motivo: "seed teste",
  });
}

// Precos SEMPRE recalculados pelo servidor a partir do menu oficial — o
// campo `price` enviado no item e ignorado (mesma regra do resto da rota).
// "Refrigerante 2L" = 15, "Agua sem Gas" = 3, "Pizza G / Calabresa" = 50.
const itemSimples = { kind: "simple" as const, name: "Refrigerante 2L", price: 999, qty: 1 };
const itemAgua = { kind: "simple" as const, name: "Agua sem Gas", price: 999, qty: 1 };
const itemPizzaG = { kind: "pizza" as const, name: "Pizza G", detail: "Calabresa", price: 999, qty: 1 };

function pedidoRequest(opts: { clienteToken?: string; resgateId?: string; itens?: unknown[]; tipoEntrega?: string; bairro?: string; rua?: string; numero?: string; troco?: string } = {}) {
  const body = {
    cliente: "Fulano de Tal",
    telefone: "86999998888",
    itens: opts.itens ?? [itemSimples],
    tipoEntrega: opts.tipoEntrega ?? "retirada",
    bairro: opts.bairro,
    rua: opts.rua,
    numero: opts.numero,
    pagamento: "Dinheiro",
    troco: opts.troco ?? "Sem troco",
    resgateId: opts.resgateId,
  };
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.clienteToken) headers.cookie = `cliente-token=${opts.clienteToken}`;
  return new NextRequest("http://localhost/api/pedido-app", { method: "POST", headers, body: JSON.stringify(body) });
}

describe("POST /api/pedido-app — resgate de pontos aplicado ao pedido", () => {
  test("desconto recalculado no servidor e aplicado ao total; saldo residual correto", async () => {
    await salvarConfigFidelidadePontos(configDescontoFixo);
    await darSaldo("cli_a", 500);
    const reserva = await criarReservaResgate("cli_a");
    if (!reserva.ok) throw new Error("reserva deveria ter sido criada");

    const res = await POST(pedidoRequest({
      clienteToken: "token-cliente-a",
      resgateId: reserva.resgate.resgateId,
      itens: [itemPizzaG], // subtotal 50, desconto 20 -> total 30
    }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.total).toBe(30);
    expect(data.descontoResgateCentavos).toBe(2000);

    const saldo = await obterSaldoPontos("cli_a");
    expect(saldo.disponivel).toBe(0); // 500 - 500 usados no resgate
  });

  test("total nunca fica negativo mesmo quando desconto excede o subtotal", async () => {
    await salvarConfigFidelidadePontos(configDescontoFixo); // desconto R$20, subtotal do pedido = R$3
    await darSaldo("cli_a", 500);
    const reserva = await criarReservaResgate("cli_a");
    if (!reserva.ok) throw new Error("reserva deveria ter sido criada");

    const res = await POST(pedidoRequest({ clienteToken: "token-cliente-a", resgateId: reserva.resgate.resgateId, itens: [itemAgua] }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.total).toBeGreaterThanOrEqual(0);
    expect(data.total).toBe(0);
  });

  test("taxa de entrega nunca recebe desconto", async () => {
    await salvarConfigFidelidadePontos(configDescontoFixo); // desconto R$20
    await darSaldo("cli_a", 500);
    const reserva = await criarReservaResgate("cli_a");
    if (!reserva.ok) throw new Error("reserva deveria ter sido criada");

    const res = await POST(pedidoRequest({
      clienteToken: "token-cliente-a",
      resgateId: reserva.resgate.resgateId,
      tipoEntrega: "delivery",
      bairro: "Barro Preto", // taxa 7
      rua: "Rua X",
      numero: "10",
      itens: [itemPizzaG], // subtotal 50
    }));
    const data = await res.json();
    expect(res.status).toBe(200);
    // subtotal 50 - desconto 20 = 30, + taxa 7 = 37 (taxa nunca descontada)
    expect(data.total).toBe(37);
  });

  test("movimento 'resgatado' ocorre uma unica vez e fica registrado no extrato", async () => {
    await salvarConfigFidelidadePontos(configDescontoFixo);
    await darSaldo("cli_a", 500);
    const reserva = await criarReservaResgate("cli_a");
    if (!reserva.ok) throw new Error("reserva deveria ter sido criada");

    const res = await POST(pedidoRequest({ clienteToken: "token-cliente-a", resgateId: reserva.resgate.resgateId, itens: [itemPizzaG] }));
    expect(res.status).toBe(200);

    const extrato = await obterExtratoPontos("cli_a");
    const resgatados = extrato.filter((m) => m.tipo === "resgatado");
    expect(resgatados).toHaveLength(1);
    expect(resgatados[0].pontos).toBe(500);
  });

  test("resgate de outro cliente nao pode ser aplicado — pedido nao e criado", async () => {
    await salvarConfigFidelidadePontos(configDescontoFixo);
    await darSaldo("cli_a", 500);
    const reserva = await criarReservaResgate("cli_a");
    if (!reserva.ok) throw new Error("reserva deveria ter sido criada");

    const res = await POST(pedidoRequest({ clienteToken: "token-cliente-b", resgateId: reserva.resgate.resgateId }));
    expect(res.status).toBe(400);

    const pedidosSalvos = (redisStore.get("pedidos") as unknown[] | undefined) ?? [];
    expect(pedidosSalvos).toHaveLength(0);
  });

  test("reserva expirada nao e aplicada — pedido nao e criado", async () => {
    await salvarConfigFidelidadePontos(configDescontoFixo);
    await darSaldo("cli_a", 500);
    const reserva = await criarReservaResgate("cli_a");
    if (!reserva.ok) throw new Error("reserva deveria ter sido criada");

    // Forca expiracao manualmente (mesma chave usada pela lib).
    const chave = `fidelidade:pontos:resgate:${reserva.resgate.resgateId}`;
    redisStore.set(chave, { ...reserva.resgate, expiraEm: new Date(Date.now() - 1000).toISOString() });

    const res = await POST(pedidoRequest({ clienteToken: "token-cliente-a", resgateId: reserva.resgate.resgateId }));
    expect(res.status).toBe(400);

    const pedidosSalvos = (redisStore.get("pedidos") as unknown[] | undefined) ?? [];
    expect(pedidosSalvos).toHaveLength(0);

    const resgateAtualizado = await obterResgatePorId(reserva.resgate.resgateId);
    expect(resgateAtualizado?.status).toBe("expirado");
  });

  test("resgateId sem sessao de cliente e rejeitado (nunca aceita clienteId do body)", async () => {
    await salvarConfigFidelidadePontos(configDescontoFixo);
    const res = await POST(pedidoRequest({ resgateId: "res_inexistente" }));
    expect(res.status).toBe(400);
    const pedidosSalvos = (redisStore.get("pedidos") as unknown[] | undefined) ?? [];
    expect(pedidosSalvos).toHaveLength(0);
  });

  test("pedido sem resgate continua igual (sem regressao)", async () => {
    const res = await POST(pedidoRequest({ clienteToken: "token-cliente-a" }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.total).toBe(15);
    expect(data.descontoResgateCentavos).toBeUndefined();
  });

  test("pedido anonimo (sem login) continua funcionando normalmente", async () => {
    const res = await POST(pedidoRequest());
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.total).toBe(15);
  });

  test("novos pontos previstos sao calculados sobre o valor ja com desconto (nunca sobre a parte paga com pontos)", async () => {
    await salvarConfigFidelidadePontos(configDescontoFixo); // desconto R$20
    await darSaldo("cli_a", 500);
    const reserva = await criarReservaResgate("cli_a");
    if (!reserva.ok) throw new Error("reserva deveria ter sido criada");

    const res = await POST(pedidoRequest({
      clienteToken: "token-cliente-a",
      resgateId: reserva.resgate.resgateId,
      itens: [itemPizzaG], // subtotal 50 - 20 = 30
    }));
    expect(res.status).toBe(200);

    const extrato = await obterExtratoPontos("cli_a");
    const previsto = extrato.find((m) => m.tipo === "previsto");
    expect(previsto?.pontos).toBe(30); // nao 50 (nao conta o valor pago com pontos)
  });

  test("troco continua validado, e contra o total ja com desconto do resgate", async () => {
    await salvarConfigFidelidadePontos(configDescontoFixo); // desconto R$20
    await darSaldo("cli_a", 500);
    const reserva = await criarReservaResgate("cli_a");
    if (!reserva.ok) throw new Error("reserva deveria ter sido criada");

    // subtotal 50 - desconto 20 = total 30. Troco para 25 é insuficiente
    // (menor que os R$30 a pagar em dinheiro).
    const resInsuficiente = await POST(pedidoRequest({
      clienteToken: "token-cliente-a",
      resgateId: reserva.resgate.resgateId,
      itens: [itemPizzaG],
      troco: "25",
    }));
    expect(resInsuficiente.status).toBe(400);

    const reserva2 = await criarReservaResgate("cli_a");
    if (!reserva2.ok) throw new Error("segunda reserva deveria ter sido criada");
    const resSuficiente = await POST(pedidoRequest({
      clienteToken: "token-cliente-a",
      resgateId: reserva2.resgate.resgateId,
      itens: [itemPizzaG],
      troco: "40",
    }));
    expect(resSuficiente.status).toBe(200);
  });

  test("falha inesperada ao validar o resgate nao corrompe o pedido: nenhum pedido e salvo e a requisicao retorna erro", async () => {
    await salvarConfigFidelidadePontos(configDescontoFixo);
    await darSaldo("cli_a", 500);
    const reserva = await criarReservaResgate("cli_a");
    if (!reserva.ok) throw new Error("reserva deveria ter sido criada");

    const redisLib = await import("@/lib/redis");
    const getMock = vi.mocked(redisLib.redis.get);
    getMock.mockImplementation(async (key: string) => {
      if (typeof key === "string" && key.startsWith("fidelidade:pontos:resgate:")) {
        throw new Error("falha redis inesperada ao ler o resgate");
      }
      return redisStore.has(key) ? redisStore.get(key) : null;
    });

    const res = await POST(pedidoRequest({ clienteToken: "token-cliente-a", resgateId: reserva.resgate.resgateId, itens: [itemPizzaG] }));
    expect(res.status).toBe(500);

    const pedidosSalvos = (redisStore.get("pedidos") as unknown[] | undefined) ?? [];
    expect(pedidosSalvos).toHaveLength(0);
  });
});
