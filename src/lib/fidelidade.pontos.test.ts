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
  calcularMetaPontos,
  calcularPontosPorValor,
  calcularPontosElegiveisPedido,
  calcularSaldoDoExtrato,
  obterConfigFidelidadePontos,
  salvarConfigFidelidadePontos,
  obterExtratoPontos,
  obterSaldoPontos,
  registrarMovimentoPontosIdempotente,
  obterSaldoAntigoPizzas,
  CONFIG_FIDELIDADE_PONTOS_PADRAO,
  type MovimentoPontos,
} from "./fidelidade";

// Modelo antigo (pizzas), importado ao lado do novo para provar que a adição
// do modelo por pontos não alterou o comportamento existente.
import { contarPizzas, creditarFidelidadePedido, obterProgressoFidelidade, salvarConfigFidelidade } from "./fidelidade";

beforeEach(() => {
  store.clear();
});

describe("calcularPontosPorValor — regra R$1 = 1 ponto", () => {
  test("arredonda sempre para baixo (nunca credita centavo fracionado)", () => {
    expect(calcularPontosPorValor(42.9)).toBe(42);
    expect(calcularPontosPorValor(1.99)).toBe(1);
    expect(calcularPontosPorValor(100)).toBe(100);
  });

  test("valor zero ou negativo nunca gera pontos", () => {
    expect(calcularPontosPorValor(0)).toBe(0);
    expect(calcularPontosPorValor(-10)).toBe(0);
  });

  test("valor não finito (NaN/undefined) nunca gera pontos", () => {
    expect(calcularPontosPorValor(NaN)).toBe(0);
    expect(calcularPontosPorValor(undefined as unknown as number)).toBe(0);
  });
});

describe("calcularPontosElegiveisPedido — taxa de entrega nunca gera pontos", () => {
  test("desconta a taxa de entrega do valor elegível", () => {
    expect(calcularPontosElegiveisPedido({ total: 50, taxaEntrega: 5 })).toBe(45);
  });

  test("sem taxa de entrega, todo o total é elegível", () => {
    expect(calcularPontosElegiveisPedido({ total: 42.9 })).toBe(42);
  });

  test("taxa maior ou igual ao total nunca gera pontos negativos", () => {
    expect(calcularPontosElegiveisPedido({ total: 10, taxaEntrega: 15 })).toBe(0);
  });
});

describe("calcularMetaPontos — meta equivalente a N Pizzas Família", () => {
  test("meta = valor de referência × quantidade (ex.: R$60 × 12 = 720)", () => {
    expect(calcularMetaPontos({ valorPizzaFamiliaReferencia: 60, metaPizzasFamilia: 12 })).toBe(720);
  });

  test("configuração inválida (valor ou quantidade <= 0) retorna meta 0", () => {
    expect(calcularMetaPontos({ valorPizzaFamiliaReferencia: 0, metaPizzasFamilia: 12 })).toBe(0);
    expect(calcularMetaPontos({ valorPizzaFamiliaReferencia: 60, metaPizzasFamilia: 0 })).toBe(0);
  });
});

describe("calcularSaldoDoExtrato — distinção previsto/confirmado/cancelado/resgatado", () => {
  function mov(tipo: MovimentoPontos["tipo"], pontos: number): MovimentoPontos {
    return { movimentoId: "m", clienteId: "cli_x", tipo, pontos, motivo: "teste", createdAt: new Date().toISOString() };
  }

  test("previsto e cancelado nunca afetam o saldo", () => {
    expect(calcularSaldoDoExtrato([mov("previsto", 90), mov("cancelado", 90)])).toBe(0);
  });

  test("confirmado soma ao saldo", () => {
    expect(calcularSaldoDoExtrato([mov("confirmado", 45), mov("confirmado", 30)])).toBe(75);
  });

  test("resgatado subtrai, preservando saldo residual (não zera o resto)", () => {
    const extrato = [mov("confirmado", 720), mov("resgatado", 500)];
    expect(calcularSaldoDoExtrato(extrato)).toBe(220);
  });

  test("ajuste soma o valor informado, inclusive negativo", () => {
    expect(calcularSaldoDoExtrato([mov("confirmado", 100), mov("ajuste", -20)])).toBe(80);
  });

  test("array vazio ou inválido retorna 0", () => {
    expect(calcularSaldoDoExtrato([])).toBe(0);
    expect(calcularSaldoDoExtrato(undefined as unknown as MovimentoPontos[])).toBe(0);
  });
});

describe("config de fidelidade por pontos", () => {
  test("retorna o padrão quando nada foi salvo ainda", async () => {
    expect(await obterConfigFidelidadePontos()).toEqual(CONFIG_FIDELIDADE_PONTOS_PADRAO);
  });

  test("salva e lê de volta a configuração", async () => {
    await salvarConfigFidelidadePontos({
      ativo: true,
      valorPizzaFamiliaReferencia: 65,
      metaPizzasFamilia: 12,
      descricaoRecompensa: "1 Pizza Família",
    });
    const config = await obterConfigFidelidadePontos();
    expect(config.ativo).toBe(true);
    expect(config.valorPizzaFamiliaReferencia).toBe(65);
  });
});

describe("registrarMovimentoPontosIdempotente — impede crédito/débito duplicado", () => {
  test("registra o movimento na primeira chamada", async () => {
    const registro = await registrarMovimentoPontosIdempotente("cli_abc", {
      pedidoId: "ped_1",
      tipo: "confirmado",
      pontos: 45,
      motivo: "Pedido ped_1 entregue",
    });
    expect(registro).not.toBeNull();
    expect(registro?.pontos).toBe(45);

    const extrato = await obterExtratoPontos("cli_abc");
    expect(extrato).toHaveLength(1);
  });

  test("mesmo pedidoId + tipo duas vezes: segunda chamada é ignorada (idempotência)", async () => {
    await registrarMovimentoPontosIdempotente("cli_abc", { pedidoId: "ped_2", tipo: "confirmado", pontos: 30, motivo: "x" });
    const segunda = await registrarMovimentoPontosIdempotente("cli_abc", { pedidoId: "ped_2", tipo: "confirmado", pontos: 30, motivo: "x" });

    expect(segunda).toBeNull();
    const extrato = await obterExtratoPontos("cli_abc");
    expect(extrato).toHaveLength(1);
  });

  test("mesmo pedidoId com tipos diferentes (previsto depois confirmado) são eventos distintos", async () => {
    await registrarMovimentoPontosIdempotente("cli_xyz", { pedidoId: "ped_3", tipo: "previsto", pontos: 20, motivo: "estimativa" });
    await registrarMovimentoPontosIdempotente("cli_xyz", { pedidoId: "ped_3", tipo: "confirmado", pontos: 20, motivo: "entregue" });

    const extrato = await obterExtratoPontos("cli_xyz");
    expect(extrato).toHaveLength(2);
    expect(extrato.map((m) => m.tipo).sort()).toEqual(["confirmado", "previsto"]);
  });

  test("saldo via obterSaldoPontos reflete só os movimentos confirmados/resgatados", async () => {
    await registrarMovimentoPontosIdempotente("cli_saldo", { pedidoId: "ped_4", tipo: "previsto", pontos: 50, motivo: "estimativa" });
    await registrarMovimentoPontosIdempotente("cli_saldo", { pedidoId: "ped_4", tipo: "confirmado", pontos: 50, motivo: "entregue" });
    await registrarMovimentoPontosIdempotente("cli_saldo", { pedidoId: "ped_5", tipo: "cancelado", pontos: 30, motivo: "pedido cancelado" });

    const saldo = await obterSaldoPontos("cli_saldo");
    expect(saldo.disponivel).toBe(50);
  });
});

describe("compatibilidade com o modelo antigo (pizzas)", () => {
  test("funções antigas continuam funcionando sem alteração de comportamento", async () => {
    expect(contarPizzas([{ kind: "pizza", qty: 2 }, { kind: "simple", qty: 3 }])).toBe(2);

    await salvarConfigFidelidade({ ativo: true, pizzasParaPremio: 10, tipoRecompensa: "pizza_gratis", descricaoRecompensa: "Pizza gratis" });
    await creditarFidelidadePedido({ pedidoId: "ped_legado", clienteId: "cli_legado", pizzas: 4 });

    const progresso = await obterProgressoFidelidade("cli_legado");
    expect(progresso.progresso).toBe(4);
  });

  test("obterSaldoAntigoPizzas lê o mesmo dado que obterProgressoFidelidade, sem converter unidade", async () => {
    await salvarConfigFidelidade({ ativo: true, pizzasParaPremio: 10, tipoRecompensa: "pizza_gratis", descricaoRecompensa: "Pizza gratis" });
    await creditarFidelidadePedido({ pedidoId: "ped_compat", clienteId: "cli_compat", pizzas: 7 });

    const antigo = await obterSaldoAntigoPizzas("cli_compat");
    const progresso = await obterProgressoFidelidade("cli_compat");
    expect(antigo).toBe(progresso.progresso);
    expect(antigo).toBe(7);
  });

  test("dados antigos e novos coexistem em chaves diferentes sem colisão", async () => {
    await salvarConfigFidelidade({ ativo: true, pizzasParaPremio: 10, tipoRecompensa: "pizza_gratis", descricaoRecompensa: "Pizza gratis" });
    await creditarFidelidadePedido({ pedidoId: "ped_a", clienteId: "cli_dual", pizzas: 3 });
    await registrarMovimentoPontosIdempotente("cli_dual", { pedidoId: "ped_b", tipo: "confirmado", pontos: 99, motivo: "teste" });

    const antigo = await obterProgressoFidelidade("cli_dual");
    const novo = await obterSaldoPontos("cli_dual");
    expect(antigo.progresso).toBe(3);
    expect(novo.disponivel).toBe(99);
  });
});
