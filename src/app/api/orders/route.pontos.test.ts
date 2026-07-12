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
    eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
      const [key] = keys;
      const [token] = args;
      if (redisStore.get(key) === token) {
        redisStore.delete(key);
        return 1;
      }
      return 0;
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

vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));

import { PATCH } from "./route";
import { derivarClienteIdPorTelefone, obterExtratoPontos, obterSaldoPontos, salvarConfigFidelidadePontos } from "@/lib/fidelidade";

function seedPedido(overrides: Record<string, unknown> = {}) {
  const pedido = {
    id: "ped_pt_1",
    cliente: "Fulano",
    telefone: "86999998888",
    itens: ["1x Pizza G Calabresa"],
    total: 50,
    taxaEntrega: 5,
    status: "saiu_entrega",
    horario: "12:00",
    endereco: "Rua X, 10",
    clienteId: "cli_pontos_api",
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

beforeEach(async () => {
  redisStore.clear();
  vi.mocked(fetch).mockClear();
  const redisLib = await import("@/lib/redis");
  vi.mocked(redisLib.redis.get).mockImplementation(defaultGetImpl);
  vi.mocked(redisLib.redis.set).mockImplementation(defaultSetImpl);
  vi.mocked(redisLib.redis.eval).mockImplementation(async (_script: string, keys: string[], args: string[]) => {
    const [key] = keys;
    const [token] = args;
    if (redisStore.get(key) === token) {
      redisStore.delete(key);
      return 1;
    }
    return 0;
  });
  await salvarConfigFidelidadePontos({ ativo: true, metaPontos: 720, descricaoRecompensa: "1 Pizza Familia" });
});

describe("PATCH /api/orders — pontos confirmados na entrega (modelo novo)", () => {
  test("status 'entregue' registra movimento 'confirmado' com pontos = floor(total - taxa)", async () => {
    seedPedido();
    const res = await PATCH(patchRequest({ id: "ped_pt_1", status: "entregue" }));
    expect(res.status).toBe(200);

    const extrato = await obterExtratoPontos(derivarClienteIdPorTelefone("86999998888")!);
    expect(extrato).toHaveLength(1);
    expect(extrato[0].tipo).toBe("confirmado");
    expect(extrato[0].pontos).toBe(45); // 50 - 5

    const saldo = await obterSaldoPontos(derivarClienteIdPorTelefone("86999998888")!);
    expect(saldo.disponivel).toBe(45);
  });

  test("repetir o status 'entregue' para o mesmo pedido nao duplica os pontos confirmados", async () => {
    seedPedido();
    await PATCH(patchRequest({ id: "ped_pt_1", status: "entregue" }));
    await PATCH(patchRequest({ id: "ped_pt_1", status: "entregue" }));

    const extrato = await obterExtratoPontos(derivarClienteIdPorTelefone("86999998888")!);
    expect(extrato).toHaveLength(1);
    const saldo = await obterSaldoPontos(derivarClienteIdPorTelefone("86999998888")!);
    expect(saldo.disponivel).toBe(45);
  });

  test("pedido WhatsApp sem clienteId gera movimento confirmado pelo telefone canonico", async () => {
    seedPedido({ clienteId: undefined });
    const res = await PATCH(patchRequest({ id: "ped_pt_1", status: "entregue" }));
    expect(res.status).toBe(200);

    const extrato = await obterExtratoPontos(derivarClienteIdPorTelefone("86999998888")!);
    expect(extrato).toHaveLength(1);
    expect(extrato[0].tipo).toBe("confirmado");
    expect(extrato[0].pontos).toBe(45);
  });

  test("entrega silenciosa pelo painel tambem registra pontos sem enviar mensagem", async () => {
    seedPedido();
    const res = await PATCH(patchRequest({ id: "ped_pt_1", status: "entregue", silent: true }));
    expect(res.status).toBe(200);

    const extrato = await obterExtratoPontos(derivarClienteIdPorTelefone("86999998888")!);
    expect(extrato).toHaveLength(1);
    expect(extrato[0].tipo).toBe("confirmado");
    expect(fetch).not.toHaveBeenCalled();
  });

  test("falha ao registrar pontos confirmados (Redis fora do ar) nao impede a resposta nem a mudanca de status do pedido", async () => {
    seedPedido();
    const setMock = vi.mocked((await import("@/lib/redis")).redis.set);
    setMock.mockImplementation(async (key: string, value: unknown, opts?: { nx?: boolean }) => {
      if (typeof key === "string" && key.startsWith("fidelidade:pontos:")) {
        throw new Error("falha redis fidelidade pontos");
      }
      if (opts?.nx && redisStore.has(key)) return null;
      redisStore.set(key, value);
      return "OK";
    });

    const res = await PATCH(patchRequest({ id: "ped_pt_1", status: "entregue" }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.status).toBe("entregue");
    const pedidosSalvos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    expect(pedidosSalvos[0].status).toBe("entregue");
  });
});

describe("PATCH /api/orders — cancelamento antes da entrega (modelo novo)", () => {
  test("cancelar pedido que nunca chegou a 'entregue' registra 'cancelado' e NAO altera o saldo confirmado", async () => {
    seedPedido({ status: "novo" });
    const res = await PATCH(patchRequest({ id: "ped_pt_1", status: "cancelado" }));
    expect(res.status).toBe(200);

    const extrato = await obterExtratoPontos(derivarClienteIdPorTelefone("86999998888")!);
    expect(extrato).toHaveLength(1);
    expect(extrato[0].tipo).toBe("cancelado");
    expect(extrato[0].pontos).toBe(45);

    const saldo = await obterSaldoPontos(derivarClienteIdPorTelefone("86999998888")!);
    expect(saldo.disponivel).toBe(0);
  });

  test("pedido sem clienteId cancelado antes da entrega registra cancelado pelo telefone canonico", async () => {
    seedPedido({ status: "novo", clienteId: undefined });
    const res = await PATCH(patchRequest({ id: "ped_pt_1", status: "cancelado" }));
    expect(res.status).toBe(200);
    const extrato = await obterExtratoPontos(derivarClienteIdPorTelefone("86999998888")!);
    expect(extrato).toHaveLength(1);
    expect(extrato[0].tipo).toBe("cancelado");
  });
});

describe("PATCH /api/orders — estorno de pontos apos entrega corrigida para cancelado (modelo novo)", () => {
  test("pedido ja entregue (com 'confirmado' no extrato) corrigido para cancelado gera 'estornado' e zera o saldo", async () => {
    seedPedido();
    await PATCH(patchRequest({ id: "ped_pt_1", status: "entregue" }));
    expect((await obterSaldoPontos(derivarClienteIdPorTelefone("86999998888")!)).disponivel).toBe(45);

    const res = await PATCH(patchRequest({ id: "ped_pt_1", status: "cancelado" }));
    expect(res.status).toBe(200);

    const extrato = await obterExtratoPontos(derivarClienteIdPorTelefone("86999998888")!);
    expect(extrato).toHaveLength(2);
    expect(extrato.map(m => m.tipo)).toEqual(["confirmado", "estornado"]);
    // o movimento "confirmado" original nunca e apagado/reescrito
    expect(extrato[0].pontos).toBe(45);

    const saldo = await obterSaldoPontos(derivarClienteIdPorTelefone("86999998888")!);
    expect(saldo.disponivel).toBe(0);
  });

  test("estorno repetido (cancelar duas vezes apos entregue) nao duplica o debito", async () => {
    seedPedido();
    await PATCH(patchRequest({ id: "ped_pt_1", status: "entregue" }));
    await PATCH(patchRequest({ id: "ped_pt_1", status: "cancelado" }));
    await PATCH(patchRequest({ id: "ped_pt_1", status: "cancelado" }));

    const extrato = await obterExtratoPontos(derivarClienteIdPorTelefone("86999998888")!);
    expect(extrato).toHaveLength(2);
    expect((await obterSaldoPontos(derivarClienteIdPorTelefone("86999998888")!)).disponivel).toBe(0);
  });

  test("nao ocorre estorno sem confirmacao anterior no extrato canonico", async () => {
    // pedido entregue sem telefone valido -> nenhum 'confirmado' e registrado
    seedPedido({ clienteId: undefined, telefone: "" });
    await PATCH(patchRequest({ id: "ped_pt_1", status: "entregue" }));

    // simula correcao/edicao que adiciona um telefone valido ao pedido depois,
    // mas sem confirmado original naquele extrato canonico.
    const pedidos = redisStore.get("pedidos") as Array<Record<string, unknown>>;
    pedidos[0] = { ...pedidos[0], telefone: "86999997777", clienteId: "cli_86999997777" };
    redisStore.set("pedidos", pedidos);

    await PATCH(patchRequest({ id: "ped_pt_1", status: "cancelado" }));

    const extrato = await obterExtratoPontos(derivarClienteIdPorTelefone("86999997777")!);
    // nao deve haver "estornado" pois nao existia "confirmado" correspondente
    expect(extrato.some(m => m.tipo === "estornado")).toBe(false);
  });

  test("falha ao registrar estorno nao impede a resposta do PATCH", async () => {
    seedPedido();
    await PATCH(patchRequest({ id: "ped_pt_1", status: "entregue" }));

    const redisLib = await import("@/lib/redis");
    const getMock = vi.mocked(redisLib.redis.get);
    getMock.mockImplementation(async (key: string) => {
      if (typeof key === "string" && key.startsWith("fidelidade:pontos:extrato:")) {
        throw new Error("falha redis ao ler extrato para estornar");
      }
      return redisStore.has(key) ? redisStore.get(key) : null;
    });

    const res = await PATCH(patchRequest({ id: "ped_pt_1", status: "cancelado" }));
    expect(res.status).toBe(200);
  });
});
