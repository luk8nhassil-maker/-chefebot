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
    eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
      const [key] = keys;
      const [token] = args;
      if (store.get(key) === token) {
        store.delete(key);
        return 1;
      }
      return 0;
    }),
  },
}));

vi.mock("@/lib/whatsappMensagem", () => ({
  enviarTextoWhatsApp: vi.fn(async () => ({ ok: true, latenciaMs: 1, tentativas: 1 })),
}));

import {
  contarPizzasElegiveisPedido,
  itensJornadaDoPedidoApp,
  itensJornadaDoCarrinhoWhatsApp,
  processarConclusaoPedidoJornada,
  obterEstadoJornada,
  obterEventosFase,
  salvarConfigJornadaChef,
  derivarFaseAtual,
  calcularMensagemProgresso,
  TENANT_PADRAO,
} from "./jornadaChef";

beforeEach(() => {
  store.clear();
});

async function ativarJornada(overrides: Record<string, unknown> = {}) {
  return salvarConfigJornadaChef({ ativo: true, ...overrides });
}

describe("contarPizzasElegiveisPedido", () => {
  test("pizza normal paga conta como 1", () => {
    const total = contarPizzasElegiveisPedido({
      id: "p1",
      status: "entregue",
      itensDetalhados: [{ kind: "pizza", name: "Pizza G", detail: "Calabresa", price: 50, qty: 1 }],
    });
    expect(total).toBe(1);
  });

  test("pizza meio a meio conta como 1 (um unico item, dois sabores no detail)", () => {
    const total = contarPizzasElegiveisPedido({
      id: "p2",
      status: "entregue",
      itensDetalhados: [{ kind: "pizza", name: "Pizza G", detail: "Calabresa / Baiana", price: 50, qty: 1 }],
    });
    expect(total).toBe(1);
  });

  test("pizza com tres sabores conta como 1", () => {
    const total = contarPizzasElegiveisPedido({
      id: "p3",
      status: "entregue",
      itensDetalhados: [{ kind: "pizza", name: "Pizza G", detail: "Calabresa / Baiana / Mussarela", price: 50, qty: 1 }],
    });
    expect(total).toBe(1);
  });

  test("quantidade 3 do mesmo item conta como 3", () => {
    const total = contarPizzasElegiveisPedido({
      id: "p4",
      status: "entregue",
      itensDetalhados: [{ kind: "pizza", name: "Pizza G", detail: "Calabresa", price: 50, qty: 3 }],
    });
    expect(total).toBe(3);
  });

  test("mini-pizza (kind simple) nao conta", () => {
    const total = contarPizzasElegiveisPedido({
      id: "p5",
      status: "entregue",
      itensDetalhados: [{ kind: "simple", name: "Mini-Pizza", detail: "Calabresa", price: 17, qty: 2 }],
    });
    expect(total).toBe(0);
  });

  test("bebida nao conta", () => {
    const total = contarPizzasElegiveisPedido({
      id: "p6",
      status: "entregue",
      itensDetalhados: [{ kind: "simple", name: "Guarana 2L", price: 12, qty: 1 }],
    });
    expect(total).toBe(0);
  });

  test("item recebido como recompensa (gratuito) nao conta", () => {
    const itens = itensJornadaDoPedidoApp([
      { kind: "pizza", name: "Pizza G", detail: "Calabresa", price: 0, qty: 1, recompensaJornadaId: "rec_1" } as never,
    ]);
    expect(itens[0].gratuito).toBe(true);
    const total = contarPizzasElegiveisPedido({ id: "p7", status: "entregue", itensDetalhados: undefined, itensJornada: itens });
    expect(total).toBe(0);
  });

  test("pedido com 14 pizzas: contarPizzasElegiveisPedido retorna 14 (o teto de 4 e aplicado no processamento, nao na contagem)", () => {
    const total = contarPizzasElegiveisPedido({
      id: "p8",
      status: "entregue",
      itensDetalhados: [{ kind: "pizza", name: "Pizza G", detail: "Calabresa", price: 50, qty: 14 }],
    });
    expect(total).toBe(14);
  });

  test("pedido cancelado conta 0", () => {
    const total = contarPizzasElegiveisPedido({
      id: "p9",
      status: "cancelado",
      itensDetalhados: [{ kind: "pizza", name: "Pizza G", detail: "Calabresa", price: 50, qty: 5 }],
    });
    expect(total).toBe(0);
  });

  test("pedido antigo sem itensDetalhados nem itensJornada usa fallback conservador (0), nunca quebra", () => {
    const total = contarPizzasElegiveisPedido({ id: "p10", status: "entregue" });
    expect(total).toBe(0);
  });

  test("carrinho de WhatsApp: category pizza conta, mini-pizza (category lanche) nao conta", () => {
    const itens = itensJornadaDoCarrinhoWhatsApp([
      { category: "pizza", name: "Pizza" },
      { category: "pizza", name: "Pizza" },
      { category: "lanche", name: "Mini-Pizza" },
      { category: "bebida", name: "Guarana" },
    ]);
    const total = contarPizzasElegiveisPedido({ id: "p11", status: "entregue", itensJornada: itens });
    expect(total).toBe(2);
  });
});

describe("canais: entrega, retirada, consumo local — todos creditam por status 'entregue'", () => {
  test.each(["delivery", "retirada", "dine_in"])("tipoEntrega=%s credita normalmente", async (tipoEntrega) => {
    await ativarJornada();
    const resultado = await processarConclusaoPedidoJornada({
      id: `pedido_${tipoEntrega}`,
      telefone: "86999990000",
      status: "entregue",
      tipoEntrega,
      itensDetalhados: [{ kind: "pizza", name: "Pizza G", detail: "Calabresa", price: 50, qty: 2 }],
    });
    expect(resultado?.pizzasNaTrilha).toBe(2);
  });
});

describe("processarConclusaoPedidoJornada — progresso e teto economico", () => {
  test("0 + 4 = 4 (dentro do ciclo, sem caixa)", async () => {
    await ativarJornada();
    const resultado = await processarConclusaoPedidoJornada({
      id: "ped_a",
      telefone: "86988880001",
      status: "entregue",
      itensDetalhados: [{ kind: "pizza", name: "Pizza G", detail: "Calabresa", price: 50, qty: 4 }],
    });
    expect(resultado?.pizzasNaTrilha).toBe(4);
    expect(resultado?.progressoDepois).toEqual({ ciclo: 1, pizzasNoCiclo: 4 });
    expect(resultado?.recompensasDesbloqueadas).toHaveLength(0);
  });

  test("pedido com 14 pizzas: so 4 avancam na trilha (teto por pedido)", async () => {
    await ativarJornada();
    const resultado = await processarConclusaoPedidoJornada({
      id: "ped_teto",
      telefone: "86988880002",
      status: "entregue",
      itensDetalhados: [{ kind: "pizza", name: "Pizza G", detail: "Calabresa", price: 50, qty: 14 }],
    });
    expect(resultado?.pizzasElegiveisTotal).toBe(14);
    expect(resultado?.pizzasNaTrilha).toBe(4);
  });

  test("10/12 + 4 = caixa desbloqueada + novo ciclo comeca em 2/12 (excedente preservado)", async () => {
    await ativarJornada();
    const telefone = "86988880003";
    // Teto de 4 por pedido: chega a 10/12 via 3 pedidos (4 + 4 + 2), nunca um so pedido de 10.
    for (const qty of [4, 4, 2]) {
      await processarConclusaoPedidoJornada({
        id: `ped_b1_${qty}_${Math.random()}`,
        telefone,
        status: "entregue",
        itensDetalhados: [{ kind: "pizza", name: "Pizza G", detail: "Calabresa", price: 50, qty }],
      });
    }
    expect((await obterEstadoJornada("cli_86988880003")).pizzasNoCiclo).toBe(10);
    const resultado = await processarConclusaoPedidoJornada({
      id: "ped_b2",
      telefone,
      status: "entregue",
      itensDetalhados: [{ kind: "pizza", name: "Pizza G", detail: "Calabresa", price: 50, qty: 4 }],
    });
    expect(resultado?.progressoAntes).toEqual({ ciclo: 1, pizzasNoCiclo: 10 });
    expect(resultado?.progressoDepois).toEqual({ ciclo: 2, pizzasNoCiclo: 2 });
    expect(resultado?.recompensasDesbloqueadas).toHaveLength(1);
  });

  test("11/12 + 4 = caixa desbloqueada + novo ciclo comeca em 3/12", async () => {
    await ativarJornada();
    const telefone = "86988880004";
    // Teto de 4 por pedido: chega a 11/12 via 3 pedidos (4 + 4 + 3).
    for (const qty of [4, 4, 3]) {
      await processarConclusaoPedidoJornada({
        id: `ped_c1_${qty}_${Math.random()}`,
        telefone,
        status: "entregue",
        itensDetalhados: [{ kind: "pizza", name: "Pizza G", detail: "Calabresa", price: 50, qty }],
      });
    }
    expect((await obterEstadoJornada("cli_86988880004")).pizzasNoCiclo).toBe(11);
    const resultado = await processarConclusaoPedidoJornada({
      id: "ped_c2",
      telefone,
      status: "entregue",
      itensDetalhados: [{ kind: "pizza", name: "Pizza G", detail: "Calabresa", price: 50, qty: 4 }],
    });
    expect(resultado?.progressoDepois).toEqual({ ciclo: 2, pizzasNoCiclo: 3 });
    expect(resultado?.recompensasDesbloqueadas).toHaveLength(1);
  });

  test("todas as fases cruzadas em um unico pedido sao registradas (2/12 + 4 = 6/12: cruza fase 1 e fase 2)", async () => {
    await ativarJornada();
    const telefone = "86988880005";
    await processarConclusaoPedidoJornada({
      id: "ped_d1",
      telefone,
      status: "entregue",
      itensDetalhados: [{ kind: "pizza", name: "Pizza G", detail: "Calabresa", price: 50, qty: 2 }],
    });
    const resultado = await processarConclusaoPedidoJornada({
      id: "ped_d2",
      telefone,
      status: "entregue",
      itensDetalhados: [{ kind: "pizza", name: "Pizza G", detail: "Calabresa", price: 50, qty: 4 }],
    });
    expect(resultado?.fasesCruzadas.sort()).toEqual([3, 6]);
    const clienteId = "cli_86988880005";
    const eventos = await obterEventosFase(clienteId);
    expect(eventos.map((e) => e.marco).sort()).toEqual([3, 6]);
  });

  test("progresso nao expira: cliente inativo por 'muito tempo' mantem o mesmo estado ate o proximo pedido", async () => {
    await ativarJornada();
    const telefone = "86988880006";
    await processarConclusaoPedidoJornada({
      id: "ped_e1",
      telefone,
      status: "entregue",
      itensDetalhados: [{ kind: "pizza", name: "Pizza G", detail: "Calabresa", price: 50, qty: 3 }],
    });
    const clienteId = "cli_86988880006";
    const estado = await obterEstadoJornada(clienteId);
    expect(estado.pizzasNoCiclo).toBe(3); // sem TTL — nunca some sozinho
  });

  test("feature flag desativada: nao processa (retorna null), pedido/pontos normais continuam intactos", async () => {
    await salvarConfigJornadaChef({ ativo: false });
    const resultado = await processarConclusaoPedidoJornada({
      id: "ped_flag_off",
      telefone: "86988880007",
      status: "entregue",
      itensDetalhados: [{ kind: "pizza", name: "Pizza G", detail: "Calabresa", price: 50, qty: 2 }],
    });
    expect(resultado).toBeNull();
  });

  test("pedido sem telefone/clienteId (anonimo) nao processa e nao lanca erro", async () => {
    await ativarJornada();
    const resultado = await processarConclusaoPedidoJornada({
      id: "ped_anon",
      status: "entregue",
      itensDetalhados: [{ kind: "pizza", name: "Pizza G", detail: "Calabresa", price: 50, qty: 2 }],
    });
    expect(resultado).toBeNull();
  });
});

describe("idempotencia", () => {
  test("o mesmo pedido processado duas vezes so credita uma vez", async () => {
    await ativarJornada();
    const pedido = {
      id: "ped_dup",
      telefone: "86977770001",
      status: "entregue" as const,
      itensDetalhados: [{ kind: "pizza" as const, name: "Pizza G", detail: "Calabresa", price: 50, qty: 3 }],
    };
    const r1 = await processarConclusaoPedidoJornada(pedido);
    const r2 = await processarConclusaoPedidoJornada(pedido);
    expect(r1?.processado).toBe(true);
    expect(r2?.processado).toBe(false);
    const estado = await obterEstadoJornada("cli_86977770001");
    expect(estado.pizzasNoCiclo).toBe(3); // nao duplicou
  });

  test("duas chamadas concorrentes (mesmo pedidoId) creditam uma unica vez", async () => {
    await ativarJornada();
    const pedido = {
      id: "ped_concorrente",
      telefone: "86977770002",
      status: "entregue" as const,
      itensDetalhados: [{ kind: "pizza" as const, name: "Pizza G", detail: "Calabresa", price: 50, qty: 5 }],
    };
    const [r1, r2] = await Promise.all([processarConclusaoPedidoJornada(pedido), processarConclusaoPedidoJornada(pedido)]);
    const processados = [r1, r2].filter((r) => r?.processado);
    expect(processados).toHaveLength(1);
    const estado = await obterEstadoJornada("cli_86977770002");
    expect(estado.pizzasNoCiclo).toBe(4); // teto de 4 aplicado uma unica vez, nunca 8
  });

  test("retry/webhook repetido (chamada identica varias vezes em sequencia) nao duplica", async () => {
    await ativarJornada();
    const pedido = {
      id: "ped_retry",
      telefone: "86977770003",
      status: "entregue" as const,
      itensDetalhados: [{ kind: "pizza" as const, name: "Pizza G", detail: "Calabresa", price: 50, qty: 2 }],
    };
    for (let i = 0; i < 5; i++) await processarConclusaoPedidoJornada(pedido);
    const estado = await obterEstadoJornada("cli_86977770003");
    expect(estado.pizzasNoCiclo).toBe(2);
  });
});

describe("derivarFaseAtual / calcularMensagemProgresso", () => {
  test.each([
    [0, 1],
    [2, 1],
    [3, 2],
    [5, 2],
    [6, 3],
    [8, 3],
    [9, 4],
    [11, 4],
  ])("pizzasNoCiclo=%i -> fase %i", (pizzas, faseEsperada) => {
    expect(derivarFaseAtual(pizzas, 12)).toBe(faseEsperada);
  });

  test("mensagens de progresso — singular e plural corretos", () => {
    expect(calcularMensagemProgresso(0, 12)).toBe("0 de 12 pizzas na sua Jornada do Chef.");
    expect(calcularMensagemProgresso(9, 12)).toBe("Faltam só 3 pizzas para abrir seu presente 🎁");
    expect(calcularMensagemProgresso(10, 12)).toBe("Faltam só 2 pizzas para abrir seu presente 🎁");
    expect(calcularMensagemProgresso(11, 12)).toBe("Falta só 1 pizza para o seu presente 👀");
  });
});

describe("salvarConfigJornadaChef — blindagem economica", () => {
  test("nunca aceita limite por pedido acima do maximo seguro (4), mesmo se enviado maior", async () => {
    const config = await salvarConfigJornadaChef({ ativo: true, limitePizzasPorPedido: 999 });
    expect(config.limitePizzasPorPedido).toBeLessThanOrEqual(4);
  });

  test("nunca aceita meta abaixo do minimo seguro", async () => {
    const config = await salvarConfigJornadaChef({ ativo: true, metaPizzas: 1 });
    expect(config.metaPizzas).toBeGreaterThanOrEqual(4);
  });

  test("TENANT_PADRAO e usado por padrao (namespace pronto para multi-tenant)", () => {
    expect(TENANT_PADRAO).toBe("default");
  });
});
