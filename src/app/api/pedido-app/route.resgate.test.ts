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
function defaultEvalImpl(_script: string, keys: string[], args: string[]) {
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
    redisStore.set(estadoKey, JSON.parse(estadoJson));
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
  verificarTokenCliente: vi.fn(async () => null),
}));

vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));

import { POST } from "./route";
import {
  derivarClienteIdPorTelefone,
  obterExtratoPontos,
  obterSaldoPontos,
  obterRecompensasPontos,
  obterReservasResgatePontos,
  reservarResgatePontos,
} from "@/lib/fidelidade";

const TELEFONE = "86999998888";
const CONFIG_KEY = "config:fidelidade:pontos";

function estadoKey(clienteId: string) {
  return `fidelidade:pontos:estado:${clienteId}`;
}

async function prepararRecompensaDisponivel() {
  const clienteId = derivarClienteIdPorTelefone(TELEFONE)!;
  redisStore.set(CONFIG_KEY, {
    ativo: true,
    metaPontos: 60,
    valorPizzaFamiliaReferencia: 60,
    metaPizzasFamilia: 1,
    descricaoRecompensa: "1 Pizza Família",
  });
  redisStore.set(estadoKey(clienteId), {
    extrato: [
      {
        movimentoId: "pt_seed",
        clienteId,
        pedidoId: "pedido_seed",
        tipo: "confirmado",
        pontos: 60,
        saldoApos: 60,
        motivo: "seed",
        createdAt: new Date().toISOString(),
      },
    ],
    recompensas: [
      {
        recompensaId: "rcp_1",
        clienteId,
        pedidoId: "pedido_seed",
        pontosNaDesbloqueio: 60,
        metaNaDesbloqueio: 60,
        status: "disponivel",
        notificacaoStatus: "pendente",
        createdAt: new Date().toISOString(),
      },
    ],
    reservas: [],
  });

  const reserva = await reservarResgatePontos(clienteId, "rcp_1");
  return { clienteId, reserva };
}

const itemPizza = { kind: "pizza" as const, name: "Pizza G", detail: "Calabresa", price: 50, qty: 1 };

function pedidoRequest(opts: { resgateId?: string; itens?: unknown[] } = {}) {
  const body = {
    cliente: "Fulano de Tal",
    telefone: TELEFONE,
    itens: opts.itens ?? [itemPizza],
    tipoEntrega: "retirada",
    pagamento: "Dinheiro",
    troco: "Sem troco",
    ...(opts.resgateId ? { resgateId: opts.resgateId } : {}),
  };
  return new NextRequest("http://localhost/api/pedido-app", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  redisStore.clear();
  vi.mocked(fetch).mockClear();
  const redisLib = await import("@/lib/redis");
  vi.mocked(redisLib.redis.get).mockImplementation(defaultGetImpl);
  vi.mocked(redisLib.redis.set).mockImplementation(defaultSetImpl);
  vi.mocked(redisLib.redis.eval).mockImplementation(defaultEvalImpl);
});

describe("POST /api/pedido-app — resgate de pontos no checkout (Etapa 5)", () => {
  test("resgate valido aplica desconto calculado no servidor e confirma a reserva", async () => {
    const { clienteId, reserva } = await prepararRecompensaDisponivel();

    const res = await POST(pedidoRequest({ resgateId: reserva.resgateId }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.total).toBe(0); // subtotal 50 - desconto 50 (capado no subtotal) + taxa 0

    const pedidosSalvos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidosSalvos[0].resgateId).toBe(reserva.resgateId);
    expect(pedidosSalvos[0].descontoFidelidade).toBe(50);

    const reservas = await obterReservasResgatePontos(clienteId);
    const reservaFinal = reservas.find((r) => r.resgateId === reserva.resgateId)!;
    expect(reservaFinal.status).toBe("confirmado");

    const recompensas = await obterRecompensasPontos(clienteId);
    expect(recompensas.find((r) => r.recompensaId === "rcp_1")!.status).toBe("resgatada");

    // pontos "resgatado" debitam a meta inteira reservada, mesmo com desconto capado no subtotal
    const extrato = await obterExtratoPontos(clienteId);
    const movResgate = extrato.find((m) => m.tipo === "resgatado");
    expect(movResgate?.pontos).toBe(60);

    const saldo = await obterSaldoPontos(clienteId);
    expect(saldo.disponivel).toBe(0); // 60 confirmados - 60 resgatados
  });

  test("novos pontos previstos sao calculados sobre o valor JA com desconto (total pago)", async () => {
    const { reserva } = await prepararRecompensaDisponivel();
    const res = await POST(pedidoRequest({ resgateId: reserva.resgateId }));
    expect(res.status).toBe(200);

    // total pago foi 0 (subtotal 50 - desconto 50), entao nenhum ponto previsto novo deve ser gerado
    const clienteId = derivarClienteIdPorTelefone(TELEFONE)!;
    const extrato = await obterExtratoPontos(clienteId);
    const previstoNovoPedido = extrato.find((m) => m.tipo === "previsto");
    expect(previstoNovoPedido).toBeUndefined();
  });

  test("desconto e sempre capado pelo subtotal: pedido menor que o valor-base nunca fica negativo", async () => {
    const { reserva } = await prepararRecompensaDisponivel();
    const res = await POST(
      pedidoRequest({ resgateId: reserva.resgateId, itens: [{ kind: "simple", name: "Agua sem Gas", price: 3, qty: 1 }] })
    );
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.total).toBe(0);

    const pedidosSalvos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidosSalvos[0].descontoFidelidade).toBe(3);
  });

  test("resgateId inexistente e rejeitado com 400 e nao cria o pedido", async () => {
    const res = await POST(pedidoRequest({ resgateId: "rsg_inexistente" }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toMatch(/resgate inv/i);
    expect(redisStore.get("pedidos")).toBeUndefined();
  });

  test("resgateId expirado e rejeitado com 400 e nao cria o pedido", async () => {
    const { reserva } = await prepararRecompensaDisponivel();
    const clienteId = derivarClienteIdPorTelefone(TELEFONE)!;
    const estadoAtual = redisStore.get(estadoKey(clienteId)) as { reservas: Array<Record<string, unknown>> };
    estadoAtual.reservas = estadoAtual.reservas.map((r) =>
      r.resgateId === reserva.resgateId ? { ...r, expiraEm: new Date(Date.now() - 1000).toISOString() } : r
    );
    redisStore.set(estadoKey(clienteId), estadoAtual);

    const res = await POST(pedidoRequest({ resgateId: reserva.resgateId }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toMatch(/expirad/i);
    expect(redisStore.get("pedidos")).toBeUndefined();
  });

  test("resgateId de outro telefone (outro cliente) nunca e aplicado", async () => {
    const { reserva } = await prepararRecompensaDisponivel();

    const body = {
      cliente: "Outra Pessoa",
      telefone: "11911112222", // telefone diferente do dono da reserva
      itens: [itemPizza],
      tipoEntrega: "retirada",
      pagamento: "Dinheiro",
      troco: "Sem troco",
      resgateId: reserva.resgateId,
    };
    const req = new NextRequest("http://localhost/api/pedido-app", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const res = await POST(req);
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toMatch(/resgate inv/i);
  });

  test("reserva ja confirmada (reutilizada) e rejeitada com 400 na segunda tentativa", async () => {
    const { reserva } = await prepararRecompensaDisponivel();

    const primeira = await POST(pedidoRequest({ resgateId: reserva.resgateId }));
    expect(primeira.status).toBe(200);

    const segunda = await POST(pedidoRequest({ resgateId: reserva.resgateId }));
    const data = await segunda.json();
    expect(segunda.status).toBe(400);
    expect(data.error).toMatch(/resgate inv/i);
  });

  test("falha ao confirmar o resgate rejeita a resposta e remove o pedido com desconto", async () => {
    const { reserva } = await prepararRecompensaDisponivel();

    const redisLib = await import("@/lib/redis");
    const originalEval = defaultEvalImpl;
    let jaFalhou = false;
    vi.mocked(redisLib.redis.eval).mockImplementation((script: string, keys: string[], args: string[]) => {
      if (!jaFalhou && keys.length === 2) {
        jaFalhou = true;
        return Promise.reject(new Error("falha simulada ao confirmar resgate"));
      }
      return originalEval(script, keys, args);
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(pedidoRequest({ resgateId: reserva.resgateId }));
    const data = await res.json();
    consoleSpy.mockRestore();

    expect(res.status).toBe(409);
    expect(data.ok).toBe(false);
    const pedidosSalvos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidosSalvos).toHaveLength(0);

    const clienteId = derivarClienteIdPorTelefone(TELEFONE)!;
    const reservas = await obterReservasResgatePontos(clienteId);
    expect(reservas.find((r) => r.resgateId === reserva.resgateId)!.status).toBe("reservado");
  });

  test("pedido sem resgateId continua funcionando normalmente (sem desconto)", async () => {
    const res = await POST(pedidoRequest());
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.total).toBe(50);
    const pedidosSalvos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidosSalvos[0].resgateId).toBeUndefined();
    expect(pedidosSalvos[0].descontoFidelidade).toBeUndefined();
  });
});
