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
  creditarPontosPedidoEntregue,
  salvarConfigFidelidadePontos,
  obterSaldoPontos,
  obterExtratoPontos,
} from "./fidelidade";

beforeEach(async () => {
  store.clear();
  await salvarConfigFidelidadePontos({
    ativo: true,
    metaPontos: 720,
    descricaoRecompensa: "1 Pizza Família",
  });
});

describe("creditarPontosPedidoEntregue — integração com pedidos reais", () => {
  test("1. pedido entregue gera pontos uma única vez", async () => {
    await creditarPontosPedidoEntregue({
      id: "ped_1",
      status: "entregue",
      telefone: "86999990001",
      total: 50,
      taxaEntrega: 5,
    });

    const saldo = await obterSaldoPontos("cli_86999990001");
    expect(saldo.disponivel).toBe(45);

    const extrato = await obterExtratoPontos("cli_86999990001");
    expect(extrato).toHaveLength(1);
    expect(extrato[0].tipo).toBe("confirmado");
    expect(extrato[0].pedidoId).toBe("ped_1");
    expect(extrato[0].pontos).toBe(45);
    expect(extrato[0].valorElegivel).toBe(45);
    expect(extrato[0].saldoApos).toBe(45);
    expect(typeof extrato[0].createdAt).toBe("string");
  });

  test("2. salvar novamente o mesmo pedido entregue não duplica pontos", async () => {
    const pedido = { id: "ped_2", status: "entregue", telefone: "86999990002", total: 40, taxaEntrega: 0 };
    await creditarPontosPedidoEntregue(pedido);
    await creditarPontosPedidoEntregue(pedido); // reprocessamento/resalvamento do mesmo pedido
    await creditarPontosPedidoEntregue(pedido); // uma terceira vez, por garantia

    const saldo = await obterSaldoPontos("cli_86999990002");
    expect(saldo.disponivel).toBe(40);
    const extrato = await obterExtratoPontos("cli_86999990002");
    expect(extrato).toHaveLength(1);
  });

  test("3. transição anterior para entregue gera pontos (independente do status anterior)", async () => {
    // A função não depende do status anterior — só do status observado agora
    // ser "entregue"; a idempotência é por pedidoId, não por transição.
    await creditarPontosPedidoEntregue({
      id: "ped_3",
      status: "entregue",
      telefone: "86999990003",
      total: 60,
    });

    const saldo = await obterSaldoPontos("cli_86999990003");
    expect(saldo.disponivel).toBe(60);
  });

  test("4. pedido cancelado não gera pontos", async () => {
    await creditarPontosPedidoEntregue({
      id: "ped_4",
      status: "cancelado",
      telefone: "86999990004",
      total: 80,
    });

    const saldo = await obterSaldoPontos("cli_86999990004");
    expect(saldo.disponivel).toBe(0);
    expect(await obterExtratoPontos("cli_86999990004")).toHaveLength(0);
  });

  test("4b. outros status intermediários (novo/em_preparo/saiu_entrega) não geram pontos", async () => {
    for (const status of ["novo", "em_preparo", "saiu_entrega"]) {
      await creditarPontosPedidoEntregue({ id: `ped_status_${status}`, status, telefone: "86999990044", total: 30 });
    }
    expect((await obterSaldoPontos("cli_86999990044")).disponivel).toBe(0);
  });

  test("5. taxa de entrega não entra no cálculo", async () => {
    await creditarPontosPedidoEntregue({
      id: "ped_5",
      status: "entregue",
      telefone: "86999990005",
      total: 100,
      taxaEntrega: 30,
    });

    const saldo = await obterSaldoPontos("cli_86999990005");
    expect(saldo.disponivel).toBe(70);
  });

  test("6. pedido sem telefone válido (e sem clienteId) não cria saldo órfão", async () => {
    await creditarPontosPedidoEntregue({ id: "ped_6a", status: "entregue", telefone: undefined, total: 50 });
    await creditarPontosPedidoEntregue({ id: "ped_6b", status: "entregue", telefone: "123", total: 50 }); // curto demais
    await creditarPontosPedidoEntregue({ id: "ped_6c", status: "entregue", telefone: "", total: 50 });

    // Nenhuma chave de extrato deve ter sido criada para nenhum "cliente" derivado desses telefones inválidos.
    expect(await obterExtratoPontos("cli_")).toHaveLength(0);
    expect(await obterExtratoPontos("cli_123")).toHaveLength(0);
  });

  test("7. dois pedidos diferentes do mesmo cliente somam corretamente", async () => {
    await creditarPontosPedidoEntregue({ id: "ped_7a", status: "entregue", telefone: "86999990007", total: 45 });
    await creditarPontosPedidoEntregue({ id: "ped_7b", status: "entregue", telefone: "86999990007", total: 32, taxaEntrega: 4 });

    const saldo = await obterSaldoPontos("cli_86999990007");
    expect(saldo.disponivel).toBe(45 + 28);

    const extrato = await obterExtratoPontos("cli_86999990007");
    expect(extrato).toHaveLength(2);
    expect(extrato[1].saldoApos).toBe(45 + 28);
  });

  test("clienteId explícito no pedido tem prioridade sobre a derivação por telefone", async () => {
    await creditarPontosPedidoEntregue({
      id: "ped_8",
      status: "entregue",
      clienteId: "cli_customizado_xyz",
      telefone: "86999990008", // seria outro clienteId se derivado — não deve ser usado
      total: 22,
    });

    expect((await obterSaldoPontos("cli_customizado_xyz")).disponivel).toBe(22);
    expect((await obterSaldoPontos("cli_86999990008")).disponivel).toBe(0);
  });

  test("fidelidade desativada na configuração não credita pontos", async () => {
    await salvarConfigFidelidadePontos({ ativo: false, metaPontos: 720, descricaoRecompensa: "1 Pizza Família" });
    await creditarPontosPedidoEntregue({ id: "ped_9", status: "entregue", telefone: "86999990009", total: 90 });

    expect((await obterSaldoPontos("cli_86999990009")).disponivel).toBe(0);
  });

  test("valor elegível zerado ou negativo (taxa >= total) não gera movimento", async () => {
    await creditarPontosPedidoEntregue({ id: "ped_10", status: "entregue", telefone: "86999990010", total: 10, taxaEntrega: 15 });
    expect(await obterExtratoPontos("cli_86999990010")).toHaveLength(0);
  });
});
