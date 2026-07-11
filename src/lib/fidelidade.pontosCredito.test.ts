import { vi, describe, test, expect, beforeEach } from "vitest";

const store = new Map<string, unknown>();

function realGet(key: string) {
  return store.has(key) ? store.get(key) : null;
}
function realSet(key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) {
  if (opts?.nx && store.has(key)) return null;
  store.set(key, value);
  return "OK";
}
function realDel(key: string) {
  store.delete(key);
  return 1;
}

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => realGet(key)),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => realSet(key, value, opts)),
    del: vi.fn(async (key: string) => realDel(key)),
  },
}));

import { redis } from "@/lib/redis";
import {
  creditarPontosPedidoEntregue,
  salvarConfigFidelidadePontos,
  obterSaldoPontos,
  obterExtratoPontos,
  obterRecompensasPontos,
  notificacaoRecompensaHabilitada,
  derivarClienteIdPorTelefone,
} from "./fidelidade";
import { obterOuCriarCliente, clienteIdDoTelefone } from "./clientes";

beforeEach(async () => {
  store.clear();
  vi.mocked(redis.get).mockImplementation(async (key: string) => realGet(key));
  vi.mocked(redis.set).mockImplementation(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => realSet(key, value, opts));
  vi.mocked(redis.del).mockImplementation(async (key: string) => realDel(key));
  await salvarConfigFidelidadePontos({
    ativo: true,
    metaPontos: 720,
    descricaoRecompensa: "1 Pizza Família",
  });
});

describe("creditarPontosPedidoEntregue — identidade canônica por telefone", () => {
  test("1. pedido do WhatsApp entregue com telefone válido gera pontos", async () => {
    await creditarPontosPedidoEntregue({
      id: "ped_wpp_1",
      status: "entregue",
      telefone: "86999990001",
      total: 50,
      taxaEntrega: 5,
    });

    const saldo = await obterSaldoPontos(derivarClienteIdPorTelefone("86999990001")!);
    expect(saldo.disponivel).toBe(45);
  });

  test("2. pedido do app entregue com o mesmo telefone soma no mesmo saldo do WhatsApp", async () => {
    const telefone = "86999990002";
    await creditarPontosPedidoEntregue({ id: "ped_wpp_2", status: "entregue", telefone, total: 40 }); // "veio do WhatsApp"
    await creditarPontosPedidoEntregue({ id: "ped_app_2", status: "entregue", telefone, clienteId: derivarClienteIdPorTelefone(telefone), total: 32, taxaEntrega: 4 }); // "veio do app, logado"

    const saldo = await obterSaldoPontos(derivarClienteIdPorTelefone(telefone)!);
    expect(saldo.disponivel).toBe(40 + 28);
    expect(await obterExtratoPontos(derivarClienteIdPorTelefone(telefone)!)).toHaveLength(2);
  });

  test("3. telefone em formatos diferentes gera o mesmo clienteId", async () => {
    await creditarPontosPedidoEntregue({ id: "ped_fmt_a", status: "entregue", telefone: "(86) 99999-0099", total: 30 });
    await creditarPontosPedidoEntregue({ id: "ped_fmt_b", status: "entregue", telefone: "86999990099", total: 20 });

    const saldo = await obterSaldoPontos("cli_86999990099");
    expect(saldo.disponivel).toBe(50);
  });

  test("4. cliente sem perfil ativado no app acumula normalmente", async () => {
    await creditarPontosPedidoEntregue({ id: "ped_sem_perfil", status: "entregue", telefone: "86999990098", total: 77 });

    // nenhum registro de Cliente (obterOuCriarCliente) foi criado — o extrato
    // de fidelidade existe pelo telefone independente do perfil no app.
    const saldo = await obterSaldoPontos(clienteIdDoTelefone("86999990098"));
    expect(saldo.disponivel).toBe(77);
  });

  test("5. ao ativar perfil com o mesmo telefone, o saldo já existente é encontrado", async () => {
    const telefone = "86999990097";
    await creditarPontosPedidoEntregue({ id: "ped_antes_perfil", status: "entregue", telefone, total: 88 });

    // simula o cliente entrando/se cadastrando no app com o mesmo WhatsApp
    const cliente = await obterOuCriarCliente(telefone);
    expect(cliente.clienteId).toBe(clienteIdDoTelefone(telefone));

    const saldo = await obterSaldoPontos(cliente.clienteId);
    expect(saldo.disponivel).toBe(88);
  });

  test("6. pedido sem telefone válido não gera saldo (mesmo com clienteId preenchido)", async () => {
    await creditarPontosPedidoEntregue({ id: "ped_6a", status: "entregue", telefone: undefined, total: 50 });
    await creditarPontosPedidoEntregue({ id: "ped_6b", status: "entregue", telefone: "123", total: 50 }); // curto demais
    await creditarPontosPedidoEntregue({ id: "ped_6c", status: "entregue", telefone: "", total: 50 });
    // clienteId preenchido nao basta — sem telefone valido, nunca credita.
    await creditarPontosPedidoEntregue({ id: "ped_6d", status: "entregue", telefone: "", clienteId: "cli_forjado", total: 50 });

    expect(await obterExtratoPontos("cli_forjado")).toHaveLength(0);
    expect(await obterExtratoPontos("cli_123")).toHaveLength(0);
    expect(await obterExtratoPontos("cli_")).toHaveLength(0);
  });

  test("clienteId divergente do telefone nunca cria um segundo saldo — telefone sempre vence", async () => {
    const telefone = "86999990096";
    await creditarPontosPedidoEntregue({
      id: "ped_diverg",
      status: "entregue",
      telefone,
      clienteId: "cli_outro_completamente_diferente",
      total: 22,
    });

    expect((await obterSaldoPontos(derivarClienteIdPorTelefone(telefone)!)).disponivel).toBe(22);
    expect((await obterSaldoPontos("cli_outro_completamente_diferente")).disponivel).toBe(0);
  });

  test("7. pedido cancelado não gera pontos", async () => {
    await creditarPontosPedidoEntregue({ id: "ped_7", status: "cancelado", telefone: "86999990007", total: 80 });
    expect((await obterSaldoPontos("cli_86999990007")).disponivel).toBe(0);
  });

  test("7b. outros status intermediários não geram pontos", async () => {
    for (const status of ["novo", "em_preparo", "saiu_entrega"]) {
      await creditarPontosPedidoEntregue({ id: `ped_status_${status}`, status, telefone: "86999990077", total: 30 });
    }
    expect((await obterSaldoPontos("cli_86999990077")).disponivel).toBe(0);
  });

  test("8. taxa de entrega não entra no cálculo", async () => {
    await creditarPontosPedidoEntregue({ id: "ped_8", status: "entregue", telefone: "86999990008", total: 100, taxaEntrega: 30 });
    expect((await obterSaldoPontos("cli_86999990008")).disponivel).toBe(70);
  });

  test("fidelidade desativada na configuração não credita pontos", async () => {
    await salvarConfigFidelidadePontos({ ativo: false, metaPontos: 720, descricaoRecompensa: "1 Pizza Família" });
    await creditarPontosPedidoEntregue({ id: "ped_desativada", status: "entregue", telefone: "86999990009", total: 90 });
    expect((await obterSaldoPontos("cli_86999990009")).disponivel).toBe(0);
  });

  test("valor elegível zerado ou negativo (taxa >= total) não gera movimento", async () => {
    await creditarPontosPedidoEntregue({ id: "ped_10", status: "entregue", telefone: "86999990010", total: 10, taxaEntrega: 15 });
    expect(await obterExtratoPontos("cli_86999990010")).toHaveLength(0);
  });

  test("10. salvar novamente o mesmo pedido não duplica pontos", async () => {
    const pedido = { id: "ped_10dup", status: "entregue", telefone: "86999990020", total: 40 };
    await creditarPontosPedidoEntregue(pedido);
    await creditarPontosPedidoEntregue(pedido);
    await creditarPontosPedidoEntregue(pedido);

    expect((await obterSaldoPontos("cli_86999990020")).disponivel).toBe(40);
    expect(await obterExtratoPontos("cli_86999990020")).toHaveLength(1);
  });
});

describe("concorrência — lock exclusivo por cliente", () => {
  test("11. duas chamadas simultâneas para o mesmo pedido geram um único movimento", async () => {
    const pedido = { id: "ped_11", status: "entregue", telefone: "86999990011", total: 50 };
    await Promise.all([creditarPontosPedidoEntregue(pedido), creditarPontosPedidoEntregue(pedido)]);

    expect(await obterExtratoPontos("cli_86999990011")).toHaveLength(1);
    expect((await obterSaldoPontos("cli_86999990011")).disponivel).toBe(50);
  });

  test("12. dois pedidos diferentes simultâneos do mesmo cliente preservam os dois movimentos", async () => {
    const telefone = "86999990012";
    await Promise.all([
      creditarPontosPedidoEntregue({ id: "ped_12a", status: "entregue", telefone, total: 30 }),
      creditarPontosPedidoEntregue({ id: "ped_12b", status: "entregue", telefone, total: 20 }),
    ]);

    const extrato = await obterExtratoPontos("cli_86999990012");
    expect(extrato).toHaveLength(2);
    expect((await obterSaldoPontos("cli_86999990012")).disponivel).toBe(50);
  });

  test("13. falha durante persistência permite reprocessamento posterior, sem deixar o pedido preso", async () => {
    const setMock = vi.mocked(redis.set);
    const implementacaoReal = setMock.getMockImplementation()!;

    setMock.mockImplementationOnce(implementacaoReal); // 1) SET NX do lock — passa normalmente
    setMock.mockImplementationOnce(async () => {
      throw new Error("falha simulada de persistencia do extrato");
    }); // 2) escrita do extrato — falha

    await expect(
      creditarPontosPedidoEntregue({ id: "ped_13", status: "entregue", telefone: "86999990013", total: 44 })
    ).rejects.toThrow("falha simulada de persistencia do extrato");

    // nada foi marcado como "processado" antes da escrita real — o extrato continua vazio
    expect(await obterExtratoPontos("cli_86999990013")).toHaveLength(0);
    // e o lock foi liberado no finally, mesmo com a falha — nao fica preso
    expect(store.has("fidelidade:pontos:lock:cli_86999990013")).toBe(false);

    // reprocessamento: mesma chamada, sem falha simulada desta vez, funciona normalmente
    await creditarPontosPedidoEntregue({ id: "ped_13", status: "entregue", telefone: "86999990013", total: 44 });
    expect((await obterSaldoPontos("cli_86999990013")).disponivel).toBe(44);
  });
});

describe("recompensa desbloqueada — surpresa ao atingir a meta", () => {
  test("14. atingir a meta cria um único evento de recompensa desbloqueada", async () => {
    await salvarConfigFidelidadePontos({ ativo: true, metaPontos: 100, descricaoRecompensa: "1 Pizza Família" });
    await creditarPontosPedidoEntregue({ id: "ped_14a", status: "entregue", telefone: "86999990014", total: 60 });
    await creditarPontosPedidoEntregue({ id: "ped_14b", status: "entregue", telefone: "86999990014", total: 50 }); // cruza 100

    const recompensas = await obterRecompensasPontos("cli_86999990014");
    expect(recompensas).toHaveLength(1);
    expect(recompensas[0].status).toBe("disponivel");
    expect(recompensas[0].notificacaoStatus).toBe("pendente");
    expect(recompensas[0].pontosNaDesbloqueio).toBe(110);
    expect(recompensas[0].metaNaDesbloqueio).toBe(100);
    expect(recompensas[0].pedidoId).toBe("ped_14b");
  });

  test("15. saldo já acima da meta não cria notificações repetidas", async () => {
    await salvarConfigFidelidadePontos({ ativo: true, metaPontos: 100, descricaoRecompensa: "1 Pizza Família" });
    await creditarPontosPedidoEntregue({ id: "ped_15a", status: "entregue", telefone: "86999990015", total: 150 }); // ja cruza na primeira
    await creditarPontosPedidoEntregue({ id: "ped_15b", status: "entregue", telefone: "86999990015", total: 40 }); // continua acima, nao deve duplicar

    expect(await obterRecompensasPontos("cli_86999990015")).toHaveLength(1);
  });

  test("meta não configurada (0) nunca gera recompensa", async () => {
    await salvarConfigFidelidadePontos({ ativo: true, descricaoRecompensa: "1 Pizza Família" }); // sem metaPontos nem referencia de pizza
    await creditarPontosPedidoEntregue({ id: "ped_sem_meta", status: "entregue", telefone: "86999990098x", total: 900 });
    expect(await obterRecompensasPontos("cli_86999990098x")).toHaveLength(0);
  });
});

describe("16. notificação de recompensa protegida por feature flag", () => {
  test("desativada por padrão (variável de ambiente ausente)", () => {
    expect(notificacaoRecompensaHabilitada()).toBe(false);
  });

  test("continua desativada com valor diferente de 'true'", () => {
    const original = process.env.FIDELIDADE_NOTIFICACAO_RECOMPENSA_ATIVA;
    process.env.FIDELIDADE_NOTIFICACAO_RECOMPENSA_ATIVA = "1";
    expect(notificacaoRecompensaHabilitada()).toBe(false);
    process.env.FIDELIDADE_NOTIFICACAO_RECOMPENSA_ATIVA = original;
  });

  test("habilitada quando a variável de ambiente é exatamente 'true'", () => {
    const original = process.env.FIDELIDADE_NOTIFICACAO_RECOMPENSA_ATIVA;
    process.env.FIDELIDADE_NOTIFICACAO_RECOMPENSA_ATIVA = "true";
    expect(notificacaoRecompensaHabilitada()).toBe(true);
    process.env.FIDELIDADE_NOTIFICACAO_RECOMPENSA_ATIVA = original;
  });

  test("criar a recompensa nunca envia nada nem muda notificacaoStatus, independente da flag", async () => {
    process.env.FIDELIDADE_NOTIFICACAO_RECOMPENSA_ATIVA = "true";
    await salvarConfigFidelidadePontos({ ativo: true, metaPontos: 50, descricaoRecompensa: "1 Pizza Família" });
    await creditarPontosPedidoEntregue({ id: "ped_flag", status: "entregue", telefone: "86999990016", total: 60 });

    const recompensas = await obterRecompensasPontos("cli_86999990016");
    expect(recompensas[0].notificacaoStatus).toBe("pendente");
    delete process.env.FIDELIDADE_NOTIFICACAO_RECOMPENSA_ATIVA;
  });
});
