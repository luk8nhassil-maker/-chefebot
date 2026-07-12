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

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    verifyToken: vi.fn(async (token: string) => (token === "token-admin" ? { username: "dev-admin", name: "Admin", role: "admin" } : null)),
  };
});

vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));

import { PATCH } from "./route";
import {
  obterExtratoPontos,
  obterSaldoPontos,
  registrarMovimentoPontosIdempotente,
  salvarConfigFidelidadePontos,
  criarReservaResgate,
  aplicarResgateAoPedido,
  obterResgatePorId,
  type ConfigFidelidadePontos,
} from "@/lib/fidelidade";

const configDescontoFixo: ConfigFidelidadePontos = {
  ativo: true,
  metaPontos: 720,
  descricaoRecompensa: "Desconto",
  recompensa: {
    ativa: true,
    custoPontos: 500,
    tipo: "desconto_fixo",
    descricao: "R$20 de desconto",
    valorDescontoCentavos: 2000,
  },
};

function seedPedido(overrides: Record<string, unknown> = {}) {
  const pedido = {
    id: "ped_resgate_1",
    cliente: "Fulano",
    telefone: "86999998888",
    itens: ["1x Pizza G Calabresa"],
    total: 30,
    taxaEntrega: 0,
    status: "saiu_entrega",
    horario: "12:00",
    endereco: "Retirada na loja",
    clienteId: "cli_resgate",
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

async function darSaldo(clienteId: string, pontos: number) {
  await registrarMovimentoPontosIdempotente(clienteId, {
    eventoId: `seed:${clienteId}:${pontos}:${Math.random()}`,
    pedidoId: `ped_seed_${Math.random()}`,
    tipo: "confirmado",
    pontos,
    motivo: "seed teste",
  });
}

beforeEach(async () => {
  redisStore.clear();
  vi.mocked(fetch).mockClear();
  const redisLib = await import("@/lib/redis");
  vi.mocked(redisLib.redis.get).mockImplementation(defaultGetImpl);
  vi.mocked(redisLib.redis.set).mockImplementation(defaultSetImpl);
  vi.mocked(redisLib.redis.del).mockImplementation(defaultDelImpl);
});

async function prepararResgateAplicado() {
  await salvarConfigFidelidadePontos(configDescontoFixo);
  await darSaldo("cli_resgate", 500);
  const reserva = await criarReservaResgate("cli_resgate");
  if (!reserva.ok) throw new Error("reserva deveria ter sido criada");
  const aplicado = await aplicarResgateAoPedido({
    resgateId: reserva.resgate.resgateId,
    clienteId: "cli_resgate",
    pedidoId: "ped_resgate_1",
    itens: [{ kind: "pizza", price: 50, qty: 1 }],
    subtotalElegivel: 50,
  });
  if (!aplicado.ok) throw new Error("resgate deveria ter sido aplicado");
  return reserva.resgate.resgateId;
}

describe("PATCH /api/orders — restauracao de pontos ao cancelar pedido com resgate", () => {
  test("pedido cancelado com resgate aplicado restaura os pontos exatamente uma vez e marca o resgate como estornado", async () => {
    const resgateId = await prepararResgateAplicado();
    expect((await obterSaldoPontos("cli_resgate")).disponivel).toBe(0); // 500 - 500 usados no resgate

    seedPedido({ resgateId, total: 30, taxaEntrega: 0, status: "novo" });
    const res = await PATCH(patchRequest({ id: "ped_resgate_1", status: "cancelado" }));
    expect(res.status).toBe(200);

    const extrato = await obterExtratoPontos("cli_resgate");
    const restituicoes = extrato.filter((m) => m.tipo === "resgate_estornado");
    expect(restituicoes).toHaveLength(1);
    expect(restituicoes[0].pontos).toBe(500);

    const saldo = await obterSaldoPontos("cli_resgate");
    expect(saldo.disponivel).toBe(500); // pontos restaurados

    const resgate = await obterResgatePorId(resgateId);
    expect(resgate?.status).toBe("estornado");

    // o movimento "resgatado" original nunca e apagado
    expect(extrato.some((m) => m.tipo === "resgatado")).toBe(true);
  });

  test("cancelamento repetido do mesmo pedido nao duplica a restituicao", async () => {
    const resgateId = await prepararResgateAplicado();
    seedPedido({ resgateId, total: 30, taxaEntrega: 0, status: "novo" });

    await PATCH(patchRequest({ id: "ped_resgate_1", status: "cancelado" }));
    await PATCH(patchRequest({ id: "ped_resgate_1", status: "cancelado" }));

    const extrato = await obterExtratoPontos("cli_resgate");
    const restituicoes = extrato.filter((m) => m.tipo === "resgate_estornado");
    expect(restituicoes).toHaveLength(1);

    const saldo = await obterSaldoPontos("cli_resgate");
    expect(saldo.disponivel).toBe(500);
  });

  test("pedido cancelado sem resgateId nao tenta restaurar nada (sem regressao)", async () => {
    seedPedido({ status: "novo", resgateId: undefined });
    const res = await PATCH(patchRequest({ id: "ped_resgate_1", status: "cancelado" }));
    expect(res.status).toBe(200);
    const extrato = await obterExtratoPontos("cli_resgate");
    expect(extrato.some((m) => m.tipo === "resgate_estornado")).toBe(false);
  });

  test("falha ao restaurar pontos de resgate nao impede a resposta do PATCH", async () => {
    const resgateId = await prepararResgateAplicado();
    seedPedido({ resgateId, total: 30, taxaEntrega: 0, status: "novo" });

    const redisLib = await import("@/lib/redis");
    const getMock = vi.mocked(redisLib.redis.get);
    getMock.mockImplementation(async (key: string) => {
      if (typeof key === "string" && key.startsWith("fidelidade:pontos:resgate:")) {
        throw new Error("falha redis ao ler resgate para restaurar");
      }
      return redisStore.has(key) ? redisStore.get(key) : null;
    });

    const res = await PATCH(patchRequest({ id: "ped_resgate_1", status: "cancelado" }));
    expect(res.status).toBe(200);
  });
});
