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
    del: vi.fn((key: string) => { redisStore.delete(key); return Promise.resolve(1); }),
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
import { derivarClienteIdPorTelefone, obterExtratoPontos, obterSaldoPontos, obterReservasResgatePontos, obterRecompensasPontos } from "@/lib/fidelidade";

const TELEFONE = "86999998888";

function estadoKey(clienteId: string) {
  return `fidelidade:pontos:estado:${clienteId}`;
}

function seedPedidoComResgate(overrides: Record<string, unknown> = {}) {
  const pedido = {
    id: "ped_resgate_1",
    cliente: "Fulano",
    telefone: TELEFONE,
    itens: ["1x Pizza G Calabresa"],
    total: 0,
    taxaEntrega: 0,
    status: "entregue",
    horario: "12:00",
    endereco: "Rua X, 10",
    resgateId: "rsg_seed_1",
    descontoFidelidade: 50,
    ...overrides,
  };
  redisStore.set("pedidos", [pedido]);
  return pedido;
}

function seedEstadoComResgateConfirmado(clienteId: string) {
  redisStore.set(estadoKey(clienteId), {
    extrato: [
      {
        movimentoId: "pt_seed_confirmado",
        clienteId,
        pedidoId: "pedido_original",
        tipo: "confirmado",
        pontos: 60,
        saldoApos: 60,
        motivo: "seed",
        createdAt: new Date().toISOString(),
      },
      {
        movimentoId: "pt_seed_resgatado",
        clienteId,
        pedidoId: "ped_resgate_1",
        tipo: "resgatado",
        pontos: 60,
        saldoApos: 0,
        motivo: "seed resgate",
        createdAt: new Date().toISOString(),
        eventoId: "resgatado:ped_resgate_1:rsg_seed_1",
      },
    ],
    recompensas: [
      {
        recompensaId: "rcp_seed_1",
        clienteId,
        pedidoId: "pedido_original",
        pontosNaDesbloqueio: 60,
        metaNaDesbloqueio: 60,
        status: "resgatada",
        notificacaoStatus: "pendente",
        createdAt: new Date().toISOString(),
      },
    ],
    reservas: [
      {
        resgateId: "rsg_seed_1",
        clienteId,
        recompensaId: "rcp_seed_1",
        pontosReservados: 60,
        valorDescontoMaximo: 60,
        status: "confirmado",
        createdAt: new Date().toISOString(),
        expiraEm: new Date(Date.now() + 15 * 60_000).toISOString(),
        pedidoId: "ped_resgate_1",
      },
    ],
  });
}

function patchRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/orders", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", cookie: "auth-token=token-admin" },
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

describe("PATCH /api/orders — reversao de resgate de pontos ao cancelar (Etapa 5)", () => {
  test("cancelar um pedido entregue que usou resgate devolve os pontos e reabre a recompensa", async () => {
    const clienteId = derivarClienteIdPorTelefone(TELEFONE)!;
    seedPedidoComResgate();
    seedEstadoComResgateConfirmado(clienteId);

    const res = await PATCH(patchRequest({ id: "ped_resgate_1", status: "cancelado" }));
    expect(res.status).toBe(200);

    const reservas = await obterReservasResgatePontos(clienteId);
    expect(reservas.find((r) => r.resgateId === "rsg_seed_1")!.status).toBe("cancelado");

    const recompensas = await obterRecompensasPontos(clienteId);
    expect(recompensas.find((r) => r.recompensaId === "rcp_seed_1")!.status).toBe("disponivel");

    const extrato = await obterExtratoPontos(clienteId);
    const ajuste = extrato.find((m) => m.eventoId === "reversao-resgate:rsg_seed_1");
    expect(ajuste).toBeDefined();
    expect(ajuste!.tipo).toBe("ajuste");
    expect(ajuste!.pontos).toBe(60);

    const saldo = await obterSaldoPontos(clienteId);
    expect(saldo.disponivel).toBe(60); // 60 confirmado - 60 resgatado + 60 estornado do resgate
  });

  test("cancelar o mesmo pedido duas vezes nunca devolve os pontos duas vezes (idempotente)", async () => {
    const clienteId = derivarClienteIdPorTelefone(TELEFONE)!;
    seedPedidoComResgate();
    seedEstadoComResgateConfirmado(clienteId);

    await PATCH(patchRequest({ id: "ped_resgate_1", status: "cancelado" }));

    // segunda tentativa: pedido ja esta cancelado, o guard `statusAnterior !== 'cancelado'`
    // no route.ts ja bloqueia reprocessamento, mas simulamos reenviando o PATCH mesmo assim.
    const res2 = await PATCH(patchRequest({ id: "ped_resgate_1", status: "cancelado" }));
    expect(res2.status).toBe(200);

    const extrato = await obterExtratoPontos(clienteId);
    const ajustes = extrato.filter((m) => m.eventoId === "reversao-resgate:rsg_seed_1");
    expect(ajustes).toHaveLength(1);

    const saldo = await obterSaldoPontos(clienteId);
    expect(saldo.disponivel).toBe(60);
  });

  test("cancelar um pedido sem resgateId nao chama a reversao nem mexe em reservas", async () => {
    const clienteId = derivarClienteIdPorTelefone(TELEFONE)!;
    seedPedidoComResgate({ id: "ped_sem_resgate", resgateId: undefined, descontoFidelidade: undefined, total: 50 });
    seedEstadoComResgateConfirmado(clienteId);

    const res = await PATCH(patchRequest({ id: "ped_sem_resgate", status: "cancelado" }));
    expect(res.status).toBe(200);

    const reservas = await obterReservasResgatePontos(clienteId);
    expect(reservas.find((r) => r.resgateId === "rsg_seed_1")!.status).toBe("confirmado"); // inalterado
  });

  test("falha na reversao do resgate (ignorada) nunca impede o cancelamento do pedido", async () => {
    const clienteId = derivarClienteIdPorTelefone(TELEFONE)!;
    seedPedidoComResgate();
    seedEstadoComResgateConfirmado(clienteId);

    const redisLib = await import("@/lib/redis");
    const originalEval = defaultEvalImpl;
    let jaFalhou = false;
    vi.mocked(redisLib.redis.eval).mockImplementation((script: string, keys: string[], args: string[]) => {
      // keys[1] !== "pedidos": a escrita cercada de "pedidos"
      // (escreverPedidosCercado, pedidosStore.ts) tem a MESMA forma (2 keys,
      // 2 args) do estado de pontos — sem este guard, intercepta a própria
      // mutação de status do pedido em vez da reversão do resgate.
      if (!jaFalhou && keys.length === 2 && keys[1] !== "pedidos") {
        jaFalhou = true;
        return Promise.reject(new Error("falha simulada ao reverter resgate"));
      }
      return originalEval(script, keys, args);
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await PATCH(patchRequest({ id: "ped_resgate_1", status: "cancelado" }));
    consoleSpy.mockRestore();

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("cancelado");
  });

  test("reprocessar pedido ja cancelado tenta reverter resgate pendente", async () => {
    const clienteId = derivarClienteIdPorTelefone(TELEFONE)!;
    seedPedidoComResgate({ status: "cancelado" });
    seedEstadoComResgateConfirmado(clienteId);

    const res = await PATCH(patchRequest({ id: "ped_resgate_1", status: "cancelado" }));
    expect(res.status).toBe(200);

    const reservas = await obterReservasResgatePontos(clienteId);
    expect(reservas.find((r) => r.resgateId === "rsg_seed_1")!.status).toBe("cancelado");

    const recompensas = await obterRecompensasPontos(clienteId);
    expect(recompensas.find((r) => r.recompensaId === "rcp_seed_1")!.status).toBe("disponivel");
  });
});
