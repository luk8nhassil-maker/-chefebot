import { vi, describe, test, expect, beforeEach } from "vitest";

const store = new Map<string, unknown>();

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => {
      if (!store.has(key) && key.startsWith("cliente:")) {
        const telefone = key.slice("cliente:".length);
        if (telefone.replace(/\D/g, "").length >= 10) {
          return {
            clienteId: `cli_${telefone}`,
            telefone,
            createdAt: "2020-01-01T00:00:00.000Z",
            updatedAt: "2020-01-01T00:00:00.000Z",
            lastLoginAt: "2020-01-01T00:00:00.000Z",
            pontosAtivos: true,
            pontosAtivadoEm: "2020-01-01T00:00:00.000Z",
          };
        }
      }
      return store.has(key) ? store.get(key) : null;
    }),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
    // Replica a semântica dos dois scripts Lua reais sem interpretar Lua:
    // - liberarLockPontosSeDono (1 chave): GET == token -> DEL
    // - persistirEstadoPontosSeDono (2 chaves): GET(lock) == token -> SET(estado)
    eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
      if (keys.length === 1) {
        const [key] = keys;
        const [token] = args;
        if (store.get(key) === token) {
          store.delete(key);
          return 1;
        }
        return 0;
      }
      const [lockKey, estadoKey] = keys;
      const [token, estadoJson] = args;
      if (store.get(lockKey) === token) {
        store.set(estadoKey, JSON.parse(estadoJson));
        return 1;
      }
      return 0;
    }),
  },
}));

import {
  calcularMetaPontos,
  calcularPontosPorValor,
  calcularPontosElegiveisPedido,
  calcularSaldoDoExtrato,
  calcularPontosPrevistos,
  calcularProgressoPontos,
  ordenarExtratoPontosDesc,
  obterConfigFidelidadePontos,
  salvarConfigFidelidadePontos,
  obterExtratoPontos,
  obterSaldoPontos,
  registrarMovimentoPontosIdempotente,
  construirEventoIdPontos,
  creditarPontosPedidoEntregue,
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

describe("calcularMetaPontos — meta em pontos como fonte principal", () => {
  test("metaPontos explícito sempre vence, mesmo com referências de pizza presentes", () => {
    expect(calcularMetaPontos({ metaPontos: 500, valorPizzaFamiliaReferencia: 60, metaPizzasFamilia: 12 })).toBe(500);
  });

  test("metaPontos explícito funciona sozinho, sem nenhuma referência de pizza", () => {
    expect(calcularMetaPontos({ metaPontos: 900 })).toBe(900);
  });

  test("sem metaPontos, deriva de valor de referência × quantidade (ex.: R$60 × 12 = 720)", () => {
    expect(calcularMetaPontos({ valorPizzaFamiliaReferencia: 60, metaPizzasFamilia: 12 })).toBe(720);
  });

  test("sem metaPontos e sem nenhuma referência de pizza, meta é 0 (nada obrigatório)", () => {
    expect(calcularMetaPontos({})).toBe(0);
  });

  test("configuração de referência inválida (valor ou quantidade <= 0) retorna meta 0", () => {
    expect(calcularMetaPontos({ valorPizzaFamiliaReferencia: 0, metaPizzasFamilia: 12 })).toBe(0);
    expect(calcularMetaPontos({ valorPizzaFamiliaReferencia: 60, metaPizzasFamilia: 0 })).toBe(0);
  });

  test("metaPontos zero ou negativo é ignorado, cai para a derivação por pizza", () => {
    expect(calcularMetaPontos({ metaPontos: 0, valorPizzaFamiliaReferencia: 60, metaPizzasFamilia: 12 })).toBe(720);
    expect(calcularMetaPontos({ metaPontos: -50, valorPizzaFamiliaReferencia: 60, metaPizzasFamilia: 12 })).toBe(720);
  });
});

describe("calcularSaldoDoExtrato — distinção previsto/confirmado/cancelado/estornado/resgatado", () => {
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

  test("estornado reverte um crédito confirmado, sem apagar o movimento original", () => {
    const extrato: MovimentoPontos[] = [
      { movimentoId: "m1", clienteId: "cli_x", pedidoId: "ped_9", tipo: "confirmado", pontos: 90, motivo: "entregue", createdAt: "2026-01-01T00:00:00.000Z" },
      { movimentoId: "m2", clienteId: "cli_x", pedidoId: "ped_9", tipo: "estornado", pontos: 90, motivo: "corrigido para cancelado", createdAt: "2026-01-02T00:00:00.000Z" },
    ];
    expect(calcularSaldoDoExtrato(extrato)).toBe(0);
    // o movimento "confirmado" original continua no extrato, intacto — nunca é removido/reescrito.
    expect(extrato).toHaveLength(2);
    expect(extrato[0].tipo).toBe("confirmado");
    expect(extrato[0].pontos).toBe(90);
  });

  test("estorno parcial preserva o restante do crédito confirmado", () => {
    const extrato = [mov("confirmado", 200), mov("estornado", 50)];
    expect(calcularSaldoDoExtrato(extrato)).toBe(150);
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
  test("retorna o padrão quando nada foi salvo ainda (metaPontos 720 como fonte principal)", async () => {
    const config = await obterConfigFidelidadePontos();
    expect(config).toEqual(CONFIG_FIDELIDADE_PONTOS_PADRAO);
    expect(config.metaPontos).toBe(720);
  });

  test("salva e lê de volta a configuração com metaPontos explícito", async () => {
    await salvarConfigFidelidadePontos({
      ativo: true,
      metaPontos: 780,
      valorPizzaFamiliaReferencia: 65,
      metaPizzasFamilia: 12,
      descricaoRecompensa: "1 Pizza Família",
    });
    const config = await obterConfigFidelidadePontos();
    expect(config.ativo).toBe(true);
    expect(config.metaPontos).toBe(780);
    expect(calcularMetaPontos(config)).toBe(780);
  });

  test("salva configuração sem nenhuma referência de pizza (campos opcionais ausentes)", async () => {
    await salvarConfigFidelidadePontos({
      ativo: true,
      metaPontos: 500,
      descricaoRecompensa: "Desconto de R$50",
    });
    const config = await obterConfigFidelidadePontos();
    expect(config.valorPizzaFamiliaReferencia).toBeUndefined();
    expect(config.metaPizzasFamilia).toBeUndefined();
    expect(calcularMetaPontos(config)).toBe(500);
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

  test("eventoId explícito permite dois eventos do MESMO tipo no MESMO pedido (não dedupe por pedidoId+tipo)", async () => {
    await registrarMovimentoPontosIdempotente("cli_multi", {
      eventoId: construirEventoIdPontos("ped_6", "ajuste", "correcao-1"),
      pedidoId: "ped_6",
      tipo: "ajuste",
      pontos: 10,
      motivo: "correção manual 1",
    });
    await registrarMovimentoPontosIdempotente("cli_multi", {
      eventoId: construirEventoIdPontos("ped_6", "ajuste", "correcao-2"),
      pedidoId: "ped_6",
      tipo: "ajuste",
      pontos: -3,
      motivo: "correção manual 2",
    });

    const extrato = await obterExtratoPontos("cli_multi");
    expect(extrato).toHaveLength(2);
    expect(calcularSaldoDoExtrato(extrato)).toBe(7);
  });

  test("repetir o mesmo eventoId explícito é ignorado, mesmo com pedidoId/tipo diferentes entre as chamadas", async () => {
    const eventoId = "evento-fixo-123";
    const primeira = await registrarMovimentoPontosIdempotente("cli_evento", {
      eventoId,
      pedidoId: "ped_7",
      tipo: "confirmado",
      pontos: 40,
      motivo: "primeira",
    });
    const segunda = await registrarMovimentoPontosIdempotente("cli_evento", {
      eventoId,
      pedidoId: "ped_8",
      tipo: "ajuste",
      pontos: 999,
      motivo: "tentativa duplicada com dados diferentes",
    });

    expect(primeira).not.toBeNull();
    expect(segunda).toBeNull();
    const extrato = await obterExtratoPontos("cli_evento");
    expect(extrato).toHaveLength(1);
    expect(extrato[0].pontos).toBe(40);
  });

  test("crédito confirmado seguido de estorno: saldo volta a 0, extrato preserva os dois movimentos", async () => {
    const clienteId = "cli_estorno";
    const pedidoId = "ped_estorno_1";

    const credito = await registrarMovimentoPontosIdempotente(clienteId, {
      eventoId: construirEventoIdPontos(pedidoId, "confirmado"),
      pedidoId,
      tipo: "confirmado",
      pontos: 65,
      motivo: "Pedido entregue",
    });
    expect(credito).not.toBeNull();
    expect((await obterSaldoPontos(clienteId)).disponivel).toBe(65);

    // corrigido depois: pedido na verdade foi cancelado após já ter sido
    // marcado "entregue" por engano — precisa de eventoId PRÓPRIO (distinto
    // do crédito original), já que é um evento diferente para o mesmo pedido.
    const estorno = await registrarMovimentoPontosIdempotente(clienteId, {
      eventoId: construirEventoIdPontos(pedidoId, "estornado"),
      pedidoId,
      tipo: "estornado",
      pontos: 65,
      motivo: "Pedido corrigido para cancelado após entrega indevida",
    });
    expect(estorno).not.toBeNull();

    const saldoFinal = await obterSaldoPontos(clienteId);
    expect(saldoFinal.disponivel).toBe(0);

    const extrato = await obterExtratoPontos(clienteId);
    expect(extrato).toHaveLength(2);
    expect(extrato.map((m) => m.tipo)).toEqual(["confirmado", "estornado"]);

    // repetir o mesmo estorno não duplica o débito (idempotência do estorno em si)
    const estornoRepetido = await registrarMovimentoPontosIdempotente(clienteId, {
      eventoId: construirEventoIdPontos(pedidoId, "estornado"),
      pedidoId,
      tipo: "estornado",
      pontos: 65,
      motivo: "tentativa duplicada de estorno",
    });
    expect(estornoRepetido).toBeNull();
    expect((await obterExtratoPontos(clienteId))).toHaveLength(2);
    expect((await obterSaldoPontos(clienteId)).disponivel).toBe(0);
  });
});

describe("compatibilidade com extrato legado de pontos do PR #172", () => {
  function legado(overrides: Partial<MovimentoPontos>): MovimentoPontos {
    return {
      movimentoId: "legado_1",
      clienteId: "cli_86999990100",
      pedidoId: "ped_legado_1",
      tipo: "confirmado",
      pontos: 45,
      motivo: "Pedido legado entregue",
      createdAt: "2026-07-11T20:00:00.000Z",
      eventoId: "confirmado:ped_legado_1",
      ...overrides,
    };
  }

  test("extrato legado do PR #172 continua visivel e mantendo o mesmo saldo", async () => {
    store.set("fidelidade:pontos:extrato:cli_86999990100", [legado({})]);

    const extrato = await obterExtratoPontos("cli_86999990100");
    expect(extrato).toHaveLength(1);
    expect(extrato[0].pedidoId).toBe("ped_legado_1");
    expect((await obterSaldoPontos("cli_86999990100")).disponivel).toBe(45);
  });

  test("primeiro credito novo migra o legado para o estado combinado sem perda", async () => {
    await salvarConfigFidelidadePontos({ ativo: true, metaPontos: 720, descricaoRecompensa: "1 Pizza Familia" });
    store.set("fidelidade:pontos:extrato:cli_86999990100", [legado({})]);

    const saldoAntes = (await obterSaldoPontos("cli_86999990100")).disponivel;
    await creditarPontosPedidoEntregue({ id: "ped_novo_migracao", status: "entregue", telefone: "86999990100", total: 20 });

    const estado = store.get("fidelidade:pontos:estado:cli_86999990100") as { extrato: MovimentoPontos[] };
    expect(estado.extrato.map((m) => m.pedidoId)).toEqual(["ped_legado_1", "ped_novo_migracao"]);
    expect(store.has("fidelidade:pontos:extrato:cli_86999990100")).toBe(true);
    expect(saldoAntes).toBe(45);
    expect((await obterSaldoPontos("cli_86999990100")).disponivel).toBe(65);
  });

  test("migracao repetida nao duplica movimentos legados", async () => {
    await salvarConfigFidelidadePontos({ ativo: true, metaPontos: 720, descricaoRecompensa: "1 Pizza Familia" });
    store.set("fidelidade:pontos:extrato:cli_86999990100", [legado({})]);

    await creditarPontosPedidoEntregue({ id: "ped_novo_migracao", status: "entregue", telefone: "86999990100", total: 20 });
    await creditarPontosPedidoEntregue({ id: "ped_novo_migracao", status: "entregue", telefone: "86999990100", total: 20 });

    const extrato = await obterExtratoPontos("cli_86999990100");
    expect(extrato).toHaveLength(2);
    expect(extrato.filter((m) => m.pedidoId === "ped_legado_1")).toHaveLength(1);
    expect(extrato.filter((m) => m.pedidoId === "ped_novo_migracao")).toHaveLength(1);
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

describe("calcularPontosPrevistos — soma só o 'previsto' de pedidos ainda não resolvidos", () => {
  function mov(overrides: Partial<MovimentoPontos>): MovimentoPontos {
    return { movimentoId: "m", clienteId: "cli_x", tipo: "previsto", pontos: 0, motivo: "teste", createdAt: new Date().toISOString(), ...overrides };
  }

  test("previsto sem confirmado/cancelado correspondente conta como estimativa", () => {
    const extrato = [mov({ tipo: "previsto", pontos: 40, pedidoId: "p1" })];
    expect(calcularPontosPrevistos(extrato)).toBe(40);
  });

  test("previsto cujo pedido já foi confirmado não conta mais (evita contar 2x)", () => {
    const extrato = [
      mov({ tipo: "previsto", pontos: 40, pedidoId: "p1" }),
      mov({ tipo: "confirmado", pontos: 40, pedidoId: "p1" }),
    ];
    expect(calcularPontosPrevistos(extrato)).toBe(0);
  });

  test("previsto cujo pedido foi cancelado também não conta mais", () => {
    const extrato = [
      mov({ tipo: "previsto", pontos: 25, pedidoId: "p2" }),
      mov({ tipo: "cancelado", pontos: 25, pedidoId: "p2" }),
    ];
    expect(calcularPontosPrevistos(extrato)).toBe(0);
  });

  test("soma vários previstos ainda pendentes de pedidos diferentes", () => {
    const extrato = [
      mov({ tipo: "previsto", pontos: 10, pedidoId: "p1" }),
      mov({ tipo: "previsto", pontos: 15, pedidoId: "p2" }),
    ];
    expect(calcularPontosPrevistos(extrato)).toBe(25);
  });

  test("array vazio ou inválido retorna 0", () => {
    expect(calcularPontosPrevistos([])).toBe(0);
    expect(calcularPontosPrevistos(undefined as unknown as MovimentoPontos[])).toBe(0);
  });
});

describe("calcularProgressoPontos — progresso, faltantes e meta atingida", () => {
  test("progresso parcial calcula percentual, faltantes e meta não atingida", () => {
    const r = calcularProgressoPontos(360, 720);
    expect(r.progressoPercentual).toBe(50);
    expect(r.pontosFaltantes).toBe(360);
    expect(r.metaAtingida).toBe(false);
  });

  test("saldo igual à meta: meta atingida, sem faltantes", () => {
    const r = calcularProgressoPontos(720, 720);
    expect(r.progressoPercentual).toBe(100);
    expect(r.pontosFaltantes).toBe(0);
    expect(r.metaAtingida).toBe(true);
  });

  test("saldo acima da meta: percentual nunca ultrapassa 100 e faltantes nunca fica negativo", () => {
    const r = calcularProgressoPontos(5000, 720);
    expect(r.progressoPercentual).toBe(100);
    expect(r.pontosFaltantes).toBe(0);
    expect(r.metaAtingida).toBe(true);
  });

  test("meta inválida (<= 0) retorna progresso neutro, nunca divide por zero", () => {
    expect(calcularProgressoPontos(100, 0)).toEqual({ pontosFaltantes: 0, progressoPercentual: 0, metaAtingida: false });
    expect(calcularProgressoPontos(100, -10)).toEqual({ pontosFaltantes: 0, progressoPercentual: 0, metaAtingida: false });
  });

  test("saldo negativo ou não finito é tratado como 0", () => {
    const r = calcularProgressoPontos(-50, 100);
    expect(r.progressoPercentual).toBe(0);
    expect(r.pontosFaltantes).toBe(100);
  });
});

describe("ordenarExtratoPontosDesc — mais recente primeiro, sem mutar a lista original", () => {
  function mov(id: string, createdAt: string): MovimentoPontos {
    return { movimentoId: id, clienteId: "cli_x", tipo: "confirmado", pontos: 1, motivo: "x", createdAt };
  }

  test("ordena do mais recente para o mais antigo", () => {
    const extrato = [
      mov("a", "2026-01-01T00:00:00.000Z"),
      mov("b", "2026-03-01T00:00:00.000Z"),
      mov("c", "2026-02-01T00:00:00.000Z"),
    ];
    const ordenado = ordenarExtratoPontosDesc(extrato);
    expect(ordenado.map((m) => m.movimentoId)).toEqual(["b", "c", "a"]);
  });

  test("não muta o array original", () => {
    const extrato = [mov("a", "2026-01-01T00:00:00.000Z"), mov("b", "2026-03-01T00:00:00.000Z")];
    const original = [...extrato];
    ordenarExtratoPontosDesc(extrato);
    expect(extrato).toEqual(original);
  });

  test("array vazio ou inválido retorna array vazio", () => {
    expect(ordenarExtratoPontosDesc([])).toEqual([]);
    expect(ordenarExtratoPontosDesc(undefined as unknown as MovimentoPontos[])).toEqual([]);
  });
});
