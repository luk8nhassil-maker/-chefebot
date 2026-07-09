import { vi, describe, test, expect, beforeEach } from "vitest";

const store = new Map<string, unknown>();

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
  },
}));

import {
  contarPizzas,
  creditarFidelidadePedido,
  obterProgressoFidelidade,
  salvarConfigFidelidade,
} from "./fidelidade";

beforeEach(() => {
  store.clear();
});

describe("contarPizzas", () => {
  test("conta apenas itens kind=pizza, ignora bebida/suco/lanche", () => {
    const itens = [
      { kind: "pizza", qty: 2 },
      { kind: "simple", qty: 3 },
      { kind: "pizza", qty: 1 },
      { kind: "promo", qty: 5 },
    ];
    expect(contarPizzas(itens)).toBe(3);
  });

  test("array vazio ou invalido retorna 0", () => {
    expect(contarPizzas([])).toBe(0);
    expect(contarPizzas(undefined as unknown as [])).toBe(0);
  });
});

describe("creditarFidelidadePedido", () => {
  test("nao credita quando fidelidade esta desativada", async () => {
    await salvarConfigFidelidade({ ativo: false, pizzasParaPremio: 10, tipoRecompensa: "pizza_gratis", descricaoRecompensa: "Pizza gratis" });
    await creditarFidelidadePedido({ pedidoId: "p1", clienteId: "cli_123", pizzas: 5 });
    const progresso = await obterProgressoFidelidade("cli_123");
    expect(progresso.progresso).toBe(0);
  });

  test("nao credita pedido anonimo (sem clienteId) e nao lanca erro", async () => {
    await salvarConfigFidelidade({ ativo: true, pizzasParaPremio: 10, tipoRecompensa: "pizza_gratis", descricaoRecompensa: "Pizza gratis" });
    await expect(creditarFidelidadePedido({ pedidoId: "anon1", clienteId: undefined, pizzas: 5 })).resolves.toBeUndefined();
  });

  test("acumula progresso e gera recompensa preservando sobra (regra 10, 8+3=1 sobra + 1 recompensa)", async () => {
    await salvarConfigFidelidade({ ativo: true, pizzasParaPremio: 10, tipoRecompensa: "pizza_gratis", descricaoRecompensa: "Pizza gratis" });

    await creditarFidelidadePedido({ pedidoId: "ped1", clienteId: "cli_abc", pizzas: 8 });
    let progresso = await obterProgressoFidelidade("cli_abc");
    expect(progresso.progresso).toBe(8);
    expect(progresso.faltam).toBe(2);
    expect(progresso.recompensasDisponiveis).toHaveLength(0);

    await creditarFidelidadePedido({ pedidoId: "ped2", clienteId: "cli_abc", pizzas: 3 });
    progresso = await obterProgressoFidelidade("cli_abc");
    expect(progresso.progresso).toBe(1);
    expect(progresso.recompensasDisponiveis).toHaveLength(1);
  });

  test("idempotente: creditar o mesmo pedidoId duas vezes nao duplica o progresso", async () => {
    await salvarConfigFidelidade({ ativo: true, pizzasParaPremio: 10, tipoRecompensa: "pizza_gratis", descricaoRecompensa: "Pizza gratis" });

    await creditarFidelidadePedido({ pedidoId: "dup1", clienteId: "cli_999", pizzas: 5 });
    await creditarFidelidadePedido({ pedidoId: "dup1", clienteId: "cli_999", pizzas: 5 });

    const progresso = await obterProgressoFidelidade("cli_999");
    expect(progresso.progresso).toBe(5);
  });
});
