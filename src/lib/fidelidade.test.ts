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
  obterConfigFidelidadePontosEfetiva,
  salvarConfigFidelidadePontos,
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

// Ponte de compatibilidade (Nivel 5.9): enquanto config:fidelidade:pontos
// nunca foi salva, obterConfigFidelidadePontosEfetiva() herda so o `ativo` do
// modelo legado (config:fidelidade) — nunca grava no Redis durante a leitura,
// e a config nova, uma vez salva, passa a ser totalmente autoritativa.
describe("obterConfigFidelidadePontosEfetiva — ponte com o modelo legado", () => {
  test("chave nova ausente + legado ativo: programa efetivo fica ativo, com os padroes do modelo por pontos", async () => {
    await salvarConfigFidelidade({ ativo: true, pizzasParaPremio: 10, tipoRecompensa: "pizza_gratis", descricaoRecompensa: "Pizza gratis" });

    const efetiva = await obterConfigFidelidadePontosEfetiva();

    expect(efetiva.ativo).toBe(true);
    expect(efetiva.metaPontos).toBe(720);
    expect(efetiva.descricaoRecompensa).toBe("1 Pizza Família");
  });

  test("chave nova ausente + legado inativo: programa efetivo fica inativo", async () => {
    await salvarConfigFidelidade({ ativo: false, pizzasParaPremio: 10, tipoRecompensa: "pizza_gratis", descricaoRecompensa: "Pizza gratis" });

    const efetiva = await obterConfigFidelidadePontosEfetiva();

    expect(efetiva.ativo).toBe(false);
  });

  test("chave nova ausente + legado nunca configurado: cai no padrao (inativo)", async () => {
    const efetiva = await obterConfigFidelidadePontosEfetiva();
    expect(efetiva.ativo).toBe(false);
  });

  test("chave nova presente e ativa: usa integralmente a config nova, sem olhar o legado", async () => {
    await salvarConfigFidelidade({ ativo: false, pizzasParaPremio: 10, tipoRecompensa: "pizza_gratis", descricaoRecompensa: "Pizza gratis" });
    await salvarConfigFidelidadePontos({ ativo: true, metaPontos: 500, descricaoRecompensa: "Desconto especial" });

    const efetiva = await obterConfigFidelidadePontosEfetiva();

    expect(efetiva).toEqual({ ativo: true, metaPontos: 500, descricaoRecompensa: "Desconto especial" });
  });

  test("chave nova presente e inativa: nao herda o legado ativo", async () => {
    await salvarConfigFidelidade({ ativo: true, pizzasParaPremio: 10, tipoRecompensa: "pizza_gratis", descricaoRecompensa: "Pizza gratis" });
    await salvarConfigFidelidadePontos({ ativo: false, metaPontos: 500, descricaoRecompensa: "Desconto especial" });

    const efetiva = await obterConfigFidelidadePontosEfetiva();

    expect(efetiva.ativo).toBe(false);
  });

  test("leitura nunca grava no Redis (efetiva calculada na hora, nao persiste a heranca)", async () => {
    await salvarConfigFidelidade({ ativo: true, pizzasParaPremio: 10, tipoRecompensa: "pizza_gratis", descricaoRecompensa: "Pizza gratis" });

    await obterConfigFidelidadePontosEfetiva();
    await obterConfigFidelidadePontosEfetiva();

    // A chave nova continua ausente: uma leitura nao "materializa" a heranca.
    const { redis } = await import("@/lib/redis");
    const salvaDireto = await redis.get("config:fidelidade:pontos");
    expect(salvaDireto).toBeNull();
  });
});
