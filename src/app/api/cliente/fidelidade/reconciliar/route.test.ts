import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const redisStore = new Map<string, unknown>();
const clienteSessao = vi.hoisted(() => ({
  clienteId: "cli_99974000691",
  telefone: "99974000691",
  nome: "Cliente 0691",
  createdAt: "2026-07-13T10:00:00.000Z",
  updatedAt: "2026-07-13T10:00:00.000Z",
  lastLoginAt: "2026-07-13T10:00:00.000Z",
  pontosAtivos: true,
  pontosAtivadoEm: "2026-07-13T11:00:00.000Z",
}));

function defaultGetImpl(key: string) {
  return Promise.resolve(redisStore.has(key) ? redisStore.get(key) : null);
}

function defaultSetImpl(key: string, value: unknown, opts?: { nx?: boolean }) {
  if (opts?.nx && redisStore.has(key)) return Promise.resolve(null);
  redisStore.set(key, value);
  return Promise.resolve("OK");
}

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

vi.mock("@/lib/clienteAuth", () => ({
  resolverSessaoCliente: vi.fn(async () => ({
    cliente: clienteSessao,
    deveRenovar: false,
  })),
  definirCookieSessaoCliente: vi.fn(),
}));

import { POST } from "./route";
import {
  avaliarCreditoPontosPedido,
  derivarClienteIdPorTelefone,
  obterExtratoPontos,
  obterSaldoPontos,
  type ConfigFidelidadePontos,
  type EstadoPontosCliente,
  type PedidoParaCreditoPontos,
} from "@/lib/fidelidade";

const pedido14Real: PedidoParaCreditoPontos = {
  id: "1783976400000",
  numero: 14,
  origem: "site",
  clienteId: "cli_99974000691",
  telefone: "86999999999",
  criadoEm: "2026-07-13T12:00:00.000Z",
  status: "novo",
  pixConfirmado: false,
  pix: { provider: "mercadopago", status: "approved" },
  total: 50,
  taxaEntrega: 5,
};

const configAtiva: ConfigFidelidadePontos = {
  ativo: true,
  metaPontos: 60,
  descricaoRecompensa: "1 Pizza Familia",
};

function request() {
  return new NextRequest("http://localhost/api/cliente/fidelidade/reconciliar", { method: "POST" });
}

beforeEach(() => {
  redisStore.clear();
  redisStore.set("config:fidelidade:pontos", configAtiva);
  redisStore.set("cliente:99974000691", clienteSessao);
  redisStore.set("cliente:86999999999", {
    ...clienteSessao,
    clienteId: "cli_86999999999",
    telefone: "86999999999",
    nome: "Contato 9999",
  });
});

describe("POST /api/cliente/fidelidade/reconciliar", () => {
  test("fixture real do pedido #14 retorna ELEGIVEL", () => {
    const estadoVazio: EstadoPontosCliente = { extrato: [], recompensas: [], reservas: [] };
    const avaliacao = avaliarCreditoPontosPedido(pedido14Real, clienteSessao, configAtiva, estadoVazio, {
      proprietarioClienteId: derivarClienteIdPorTelefone(clienteSessao.telefone),
      origemProprietario: "sessao",
    });

    expect(avaliacao.motivo).toBe("ELEGIVEL");
    expect(avaliacao.gates.compraConfirmada).toBe(true);
    expect(avaliacao.origemConfirmacao).toBe("pix_automatico");
    expect(avaliacao.pontosCalculados).toBe(45);
  });

  test("reconcilia pedido real #14 para a conta autenticada e nao credita o contato", async () => {
    redisStore.set("pedidos", [pedido14Real]);

    const res = await POST(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, verificados: 1, creditados: 1, saldoPontos: 45 });
    expect(body.detalhes[0]).toMatchObject({
      pedidoId: pedido14Real.id,
      numero: 14,
      motivo: "ELEGIVEL",
      movimentoGravado: true,
      eventoId: `confirmado:${pedido14Real.id}`,
      pontosCalculados: 45,
    });

    const clienteIdSessao = derivarClienteIdPorTelefone("99974000691")!;
    const clienteIdContato = derivarClienteIdPorTelefone("86999999999")!;
    const extratoSessao = await obterExtratoPontos(clienteIdSessao);
    const extratoContato = await obterExtratoPontos(clienteIdContato);
    const pedidos = redisStore.get("pedidos") as PedidoParaCreditoPontos[];

    expect(extratoSessao).toHaveLength(1);
    expect(extratoSessao[0]).toMatchObject({
      clienteId: clienteIdSessao,
      pedidoId: pedido14Real.id,
      tipo: "confirmado",
      eventoId: `confirmado:${pedido14Real.id}`,
      pontos: 45,
      valorElegivel: 45,
    });
    expect(extratoContato).toHaveLength(0);
    expect(pedidos[0].confirmacaoCompra).toMatchObject({ origem: "pix_automatico" });
  });

  test("repetir reconciliacao dez vezes nao duplica", async () => {
    redisStore.set("pedidos", [pedido14Real]);

    for (let i = 0; i < 10; i++) {
      await POST(request());
    }

    const clienteIdSessao = derivarClienteIdPorTelefone("99974000691")!;
    const extratoSessao = await obterExtratoPontos(clienteIdSessao);
    expect(extratoSessao.filter((m) => m.eventoId === `confirmado:${pedido14Real.id}`)).toHaveLength(1);
    expect((await obterSaldoPontos(clienteIdSessao)).disponivel).toBe(45);
  });

  test("pix manual e reconciliacao concorrentes nao duplicam", async () => {
    redisStore.set("pedidos", [pedido14Real]);

    const { confirmarCompraECreditarPontos } = await import("@/lib/fidelidade");
    await Promise.all([
      confirmarCompraECreditarPontos(pedido14Real.id, "pix_manual", { clienteSessao }),
      POST(request()),
    ]);

    const clienteIdSessao = derivarClienteIdPorTelefone("99974000691")!;
    const extratoSessao = await obterExtratoPontos(clienteIdSessao);
    expect(extratoSessao.filter((m) => m.tipo === "confirmado")).toHaveLength(1);
  });

  test("pedido anterior a ativacao e cancelado nao creditam", async () => {
    redisStore.set("pedidos", [
      { ...pedido14Real, id: "1783970000000", criadoEm: "2026-07-13T10:30:00.000Z" },
      { ...pedido14Real, id: "1783976400001", status: "cancelado" },
    ]);

    const res = await POST(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.creditados).toBe(0);
    expect(body.detalhes.map((d: { motivo: string }) => d.motivo).sort()).toEqual(
      ["PEDIDO_ANTERIOR_ATIVACAO"].sort()
    );
    expect(await obterExtratoPontos(derivarClienteIdPorTelefone("99974000691")!)).toHaveLength(0);
  });

  test("pedido anonimo usa fallback por telefone", async () => {
    const anonimo = {
      ...pedido14Real,
      id: "1783976400002",
      clienteId: undefined,
      telefone: "86999999999",
    };
    redisStore.set("pedidos", [anonimo]);

    const { confirmarCompraECreditarPontos } = await import("@/lib/fidelidade");
    const resultado = await confirmarCompraECreditarPontos(anonimo.id, "pix_automatico");

    expect(resultado.origemProprietario).toBe("telefone");
    expect(resultado.movimento?.clienteId).toBe(derivarClienteIdPorTelefone("86999999999"));
  });
});
