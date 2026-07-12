import { vi, describe, test, expect, beforeEach } from "vitest";

const store = new Map<string, unknown>();

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
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
  calcularDescontoRecompensa,
  criarReservaResgate,
  cancelarReservaResgate,
  aplicarResgateAoPedido,
  restaurarPontosResgate,
  obterResgatePorId,
  obterResgatesCliente,
  obterSaldoPontos,
  registrarMovimentoPontosIdempotente,
  salvarConfigFidelidadePontos,
  type RecompensaPontosConfig,
} from "./fidelidade";

beforeEach(() => {
  store.clear();
});

const configDescontoFixo = {
  ativo: true,
  metaPontos: 720,
  descricaoRecompensa: "R$20 de desconto",
  recompensa: {
    ativa: true,
    custoPontos: 500,
    tipo: "desconto_fixo" as const,
    descricao: "R$20 de desconto",
    valorDescontoCentavos: 2000,
  },
};

const configPizzaGratis = {
  ativo: true,
  metaPontos: 720,
  descricaoRecompensa: "1 Pizza Família grátis",
  recompensa: {
    ativa: true,
    custoPontos: 720,
    tipo: "pizza_gratis" as const,
    descricao: "1 Pizza Família grátis",
  },
};

async function darSaldo(clienteId: string, pontos: number) {
  await registrarMovimentoPontosIdempotente(clienteId, {
    eventoId: `seed:${clienteId}:${pontos}`,
    pedidoId: "ped_seed",
    tipo: "confirmado",
    pontos,
    motivo: "seed de teste",
  });
}

describe("calcularDescontoRecompensa — desconto_fixo", () => {
  const recompensa: RecompensaPontosConfig = { ativa: true, custoPontos: 500, tipo: "desconto_fixo", descricao: "x", valorDescontoCentavos: 2000 };

  test("aplica o valor configurado quando o subtotal comporta", () => {
    const r = calcularDescontoRecompensa({ recompensa, itens: [], subtotalElegivel: 100 });
    expect(r.valorDescontoCentavos).toBe(2000);
  });

  test("limita o desconto ao subtotal elegível (nunca ultrapassa)", () => {
    const r = calcularDescontoRecompensa({ recompensa, itens: [], subtotalElegivel: 10 });
    expect(r.valorDescontoCentavos).toBe(1000);
  });

  test("recompensa mal configurada (sem valorDescontoCentavos) retorna erro", () => {
    const r = calcularDescontoRecompensa({ recompensa: { ...recompensa, valorDescontoCentavos: undefined }, itens: [], subtotalElegivel: 50 });
    expect(r.valorDescontoCentavos).toBe(0);
    expect(r.erro).toBeTruthy();
  });

  test("subtotal zero/negativo nunca gera desconto", () => {
    expect(calcularDescontoRecompensa({ recompensa, itens: [], subtotalElegivel: 0 }).valorDescontoCentavos).toBe(0);
    expect(calcularDescontoRecompensa({ recompensa, itens: [], subtotalElegivel: -5 }).valorDescontoCentavos).toBe(0);
  });
});

describe("calcularDescontoRecompensa — pizza_gratis", () => {
  const recompensa: RecompensaPontosConfig = { ativa: true, custoPontos: 720, tipo: "pizza_gratis", descricao: "x" };

  test("identifica a pizza pela estrutura (kind), não por texto", () => {
    const itens = [{ kind: "simple", price: 100, qty: 1 }, { kind: "pizza", price: 50, qty: 1 }];
    const r = calcularDescontoRecompensa({ recompensa, itens, subtotalElegivel: 150 });
    expect(r.valorDescontoCentavos).toBe(5000);
  });

  test("com mais de uma pizza, aplica na de menor valor", () => {
    const itens = [{ kind: "pizza", price: 60, qty: 1 }, { kind: "pizza", price: 40, qty: 1 }];
    const r = calcularDescontoRecompensa({ recompensa, itens, subtotalElegivel: 100 });
    expect(r.valorDescontoCentavos).toBe(4000);
  });

  test("sem pizza no carrinho retorna erro, nunca inventa valor", () => {
    const itens = [{ kind: "simple", price: 30, qty: 1 }];
    const r = calcularDescontoRecompensa({ recompensa, itens, subtotalElegivel: 30 });
    expect(r.valorDescontoCentavos).toBe(0);
    expect(r.erro).toBeTruthy();
  });

  test("respeita valorMaximoCentavos configurado", () => {
    const comTeto: RecompensaPontosConfig = { ...recompensa, valorMaximoCentavos: 3000 };
    const itens = [{ kind: "pizza", price: 55, qty: 1 }];
    const r = calcularDescontoRecompensa({ recompensa: comTeto, itens, subtotalElegivel: 55 });
    expect(r.valorDescontoCentavos).toBe(3000);
  });

  test("nunca ultrapassa o subtotal elegível", () => {
    const itens = [{ kind: "pizza", price: 60, qty: 1 }];
    const r = calcularDescontoRecompensa({ recompensa, itens, subtotalElegivel: 20 });
    expect(r.valorDescontoCentavos).toBe(2000);
  });
});

describe("criarReservaResgate", () => {
  test("cria reserva quando saldo e configuração são válidos", async () => {
    await salvarConfigFidelidadePontos(configDescontoFixo);
    await darSaldo("cli_res_1", 600);
    const r = await criarReservaResgate("cli_res_1");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.resgate.status).toBe("reservado");
      expect(r.resgate.pontosUtilizados).toBe(500);
    }
  });

  test("saldo insuficiente bloqueia a reserva", async () => {
    await salvarConfigFidelidadePontos(configDescontoFixo);
    await darSaldo("cli_res_2", 100);
    const r = await criarReservaResgate("cli_res_2");
    expect(r.ok).toBe(false);
  });

  test("recompensa desativada bloqueia a reserva", async () => {
    await salvarConfigFidelidadePontos({ ...configDescontoFixo, recompensa: { ...configDescontoFixo.recompensa, ativa: false } });
    await darSaldo("cli_res_3", 600);
    const r = await criarReservaResgate("cli_res_3");
    expect(r.ok).toBe(false);
  });

  test("reservas simultâneas (lock) não excedem o saldo — a segunda falha enquanto a primeira está em curso", async () => {
    await salvarConfigFidelidadePontos(configDescontoFixo);
    await darSaldo("cli_res_4", 600);
    const [a, b] = await Promise.all([criarReservaResgate("cli_res_4"), criarReservaResgate("cli_res_4")]);
    const sucessos = [a, b].filter((r) => r.ok);
    expect(sucessos).toHaveLength(1);
  });
});

describe("cancelarReservaResgate", () => {
  test("cancela uma reserva ainda não aplicada", async () => {
    await salvarConfigFidelidadePontos(configDescontoFixo);
    await darSaldo("cli_can_1", 600);
    const criado = await criarReservaResgate("cli_can_1");
    expect(criado.ok).toBe(true);
    if (!criado.ok) return;
    const r = await cancelarReservaResgate("cli_can_1", criado.resgate.resgateId);
    expect(r.ok).toBe(true);
    const resgate = await obterResgatePorId(criado.resgate.resgateId);
    expect(resgate?.status).toBe("cancelado");
  });

  test("resgate de outro cliente não pode ser cancelado", async () => {
    await salvarConfigFidelidadePontos(configDescontoFixo);
    await darSaldo("cli_can_2", 600);
    const criado = await criarReservaResgate("cli_can_2");
    if (!criado.ok) return;
    const r = await cancelarReservaResgate("cli_outro", criado.resgate.resgateId);
    expect(r.ok).toBe(false);
  });

  test("reserva já aplicada não pode ser cancelada manualmente", async () => {
    await salvarConfigFidelidadePontos(configDescontoFixo);
    await darSaldo("cli_can_3", 600);
    const criado = await criarReservaResgate("cli_can_3");
    if (!criado.ok) return;
    await aplicarResgateAoPedido({
      resgateId: criado.resgate.resgateId,
      clienteId: "cli_can_3",
      pedidoId: "ped_1",
      itens: [],
      subtotalElegivel: 100,
    });
    const r = await cancelarReservaResgate("cli_can_3", criado.resgate.resgateId);
    expect(r.ok).toBe(false);
  });
});

describe("aplicarResgateAoPedido", () => {
  test("aplica e recalcula o desconto no servidor, debita pontos uma vez", async () => {
    await salvarConfigFidelidadePontos(configDescontoFixo);
    await darSaldo("cli_apl_1", 600);
    const criado = await criarReservaResgate("cli_apl_1");
    if (!criado.ok) return;

    const r = await aplicarResgateAoPedido({
      resgateId: criado.resgate.resgateId,
      clienteId: "cli_apl_1",
      pedidoId: "ped_apl_1",
      itens: [],
      subtotalElegivel: 100,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valorDescontoCentavos).toBe(2000);

    const saldo = await obterSaldoPontos("cli_apl_1");
    expect(saldo.disponivel).toBe(100); // 600 - 500
  });

  test("resgate de outro cliente nunca é aplicado", async () => {
    await salvarConfigFidelidadePontos(configDescontoFixo);
    await darSaldo("cli_apl_2", 600);
    const criado = await criarReservaResgate("cli_apl_2");
    if (!criado.ok) return;

    const r = await aplicarResgateAoPedido({
      resgateId: criado.resgate.resgateId,
      clienteId: "cli_intruso",
      pedidoId: "ped_x",
      itens: [],
      subtotalElegivel: 100,
    });
    expect(r.ok).toBe(false);
  });

  test("reserva expirada não é aplicada", async () => {
    await salvarConfigFidelidadePontos(configDescontoFixo);
    await darSaldo("cli_apl_3", 600);
    const criado = await criarReservaResgate("cli_apl_3");
    if (!criado.ok) return;
    // força expiração manualmente
    const expirado = { ...criado.resgate, expiraEm: new Date(Date.now() - 1000).toISOString() };
    store.set(`fidelidade:pontos:resgate:${criado.resgate.resgateId}`, expirado);

    const r = await aplicarResgateAoPedido({
      resgateId: criado.resgate.resgateId,
      clienteId: "cli_apl_3",
      pedidoId: "ped_y",
      itens: [],
      subtotalElegivel: 100,
    });
    expect(r.ok).toBe(false);
  });

  test("repetir a aplicação para o MESMO pedido é idempotente, nunca duplica o débito", async () => {
    await salvarConfigFidelidadePontos(configDescontoFixo);
    await darSaldo("cli_apl_4", 600);
    const criado = await criarReservaResgate("cli_apl_4");
    if (!criado.ok) return;

    await aplicarResgateAoPedido({ resgateId: criado.resgate.resgateId, clienteId: "cli_apl_4", pedidoId: "ped_dup", itens: [], subtotalElegivel: 100 });
    const segunda = await aplicarResgateAoPedido({ resgateId: criado.resgate.resgateId, clienteId: "cli_apl_4", pedidoId: "ped_dup", itens: [], subtotalElegivel: 100 });
    expect(segunda.ok).toBe(true);

    const saldo = await obterSaldoPontos("cli_apl_4");
    expect(saldo.disponivel).toBe(100); // não caiu duas vezes
  });

  test("desconto pizza_gratis nunca gera total negativo (limitado ao subtotal)", async () => {
    await salvarConfigFidelidadePontos(configPizzaGratis);
    await darSaldo("cli_apl_5", 800);
    const criado = await criarReservaResgate("cli_apl_5");
    if (!criado.ok) return;

    const r = await aplicarResgateAoPedido({
      resgateId: criado.resgate.resgateId,
      clienteId: "cli_apl_5",
      pedidoId: "ped_pizza",
      itens: [{ kind: "pizza", price: 500, qty: 1 }],
      subtotalElegivel: 40, // menor que o preço "informado" da pizza — cenário defensivo
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valorDescontoCentavos).toBeLessThanOrEqual(4000);
  });
});

describe("restaurarPontosResgate", () => {
  test("restitui os pontos exatamente uma vez quando o pedido é cancelado", async () => {
    await salvarConfigFidelidadePontos(configDescontoFixo);
    await darSaldo("cli_rest_1", 600);
    const criado = await criarReservaResgate("cli_rest_1");
    if (!criado.ok) return;
    await aplicarResgateAoPedido({ resgateId: criado.resgate.resgateId, clienteId: "cli_rest_1", pedidoId: "ped_rest_1", itens: [], subtotalElegivel: 100 });
    expect((await obterSaldoPontos("cli_rest_1")).disponivel).toBe(100);

    await restaurarPontosResgate({ clienteId: "cli_rest_1", resgateId: criado.resgate.resgateId, pedidoId: "ped_rest_1" });
    expect((await obterSaldoPontos("cli_rest_1")).disponivel).toBe(600);

    const resgate = await obterResgatePorId(criado.resgate.resgateId);
    expect(resgate?.status).toBe("estornado");
  });

  test("restituição repetida não duplica (idempotente)", async () => {
    await salvarConfigFidelidadePontos(configDescontoFixo);
    await darSaldo("cli_rest_2", 600);
    const criado = await criarReservaResgate("cli_rest_2");
    if (!criado.ok) return;
    await aplicarResgateAoPedido({ resgateId: criado.resgate.resgateId, clienteId: "cli_rest_2", pedidoId: "ped_rest_2", itens: [], subtotalElegivel: 100 });

    await restaurarPontosResgate({ clienteId: "cli_rest_2", resgateId: criado.resgate.resgateId, pedidoId: "ped_rest_2" });
    await restaurarPontosResgate({ clienteId: "cli_rest_2", resgateId: criado.resgate.resgateId, pedidoId: "ped_rest_2" });

    expect((await obterSaldoPontos("cli_rest_2")).disponivel).toBe(600);
  });

  test("resgate ainda 'reservado' (nunca aplicado) não é restituído", async () => {
    await salvarConfigFidelidadePontos(configDescontoFixo);
    await darSaldo("cli_rest_3", 600);
    const criado = await criarReservaResgate("cli_rest_3");
    if (!criado.ok) return;
    await restaurarPontosResgate({ clienteId: "cli_rest_3", resgateId: criado.resgate.resgateId, pedidoId: "ped_nunca_aplicado" });
    expect((await obterSaldoPontos("cli_rest_3")).disponivel).toBe(600); // nunca tinha sido debitado
    const resgate = await obterResgatePorId(criado.resgate.resgateId);
    expect(resgate?.status).toBe("reservado");
  });
});

describe("obterResgatesCliente", () => {
  test("lista somente os resgates do cliente, mais recente primeiro", async () => {
    await salvarConfigFidelidadePontos(configDescontoFixo);
    await darSaldo("cli_list_1", 2000);
    await darSaldo("cli_list_2", 2000);
    const r1 = await criarReservaResgate("cli_list_1");
    await new Promise((r) => setTimeout(r, 2));
    const r2 = await criarReservaResgate("cli_list_1");
    await criarReservaResgate("cli_list_2");

    const lista = await obterResgatesCliente("cli_list_1");
    expect(lista).toHaveLength(2);
    expect(lista.every((r) => r.clienteId === "cli_list_1")).toBe(true);
    if (r1.ok && r2.ok) {
      expect(lista[0].resgateId).toBe(r2.resgate.resgateId);
    }
  });
});
