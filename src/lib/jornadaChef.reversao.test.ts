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
  processarConclusaoPedidoJornada,
  reverterConclusaoPedidoJornada,
  obterEstadoJornada,
  obterRecompensasCliente,
  obterPendencias,
  abrirRecompensa,
  salvarConfigJornadaChef,
} from "./jornadaChef";

beforeEach(async () => {
  store.clear();
  await salvarConfigJornadaChef({
    modoRollout: "on",
    sequenciaRecompensas: [
      { id: "padrao", tipo: "bebida_sobremesa", ativo: true, produtoNome: "", item: { produtoId: "bebida:Guarana 2L", produtoNome: "Guarana 2L", categoria: "bebida" } },
    ],
  });
});

describe("reversao de credito", () => {
  test("pedido reaberto/cancelado ANTES de qualquer outra coisa acontecer: reversao total, sem sobra", async () => {
    const telefone = "86944440001";
    await processarConclusaoPedidoJornada({
      id: "ped_rev_1",
      telefone,
      status: "entregue",
      itensDetalhados: [{ kind: "pizza", name: "Pizza G", detail: "Calabresa", price: 50, qty: 3 }],
    });
    expect((await obterEstadoJornada("cli_86944440001")).pizzasNoCiclo).toBe(3);

    const resultado = await reverterConclusaoPedidoJornada("ped_rev_1", "Pedido reaberto por engano");
    expect(resultado.ok).toBe(true);
    expect(resultado.pendenciaAberta).toBe(false);
    expect((await obterEstadoJornada("cli_86944440001")).pizzasNoCiclo).toBe(0);
  });

  test("reversao e idempotente: reverter duas vezes nao causa saldo negativo", async () => {
    const telefone = "86944440002";
    await processarConclusaoPedidoJornada({
      id: "ped_rev_2",
      telefone,
      status: "entregue",
      itensDetalhados: [{ kind: "pizza", name: "Pizza G", detail: "Calabresa", price: 50, qty: 5 }],
    });
    await reverterConclusaoPedidoJornada("ped_rev_2", "cancelado");
    await reverterConclusaoPedidoJornada("ped_rev_2", "cancelado de novo");
    const estado = await obterEstadoJornada("cli_86944440002");
    expect(estado.pizzasNoCiclo).toBe(0); // nunca fica negativo nem duplica a reversao
  });

  test("pedido que nunca creditou (nao entregue) nao tem nada a reverter", async () => {
    const resultado = await reverterConclusaoPedidoJornada("pedido_inexistente", "cancelado antes de entregar");
    expect(resultado.ok).toBe(true);
    expect(resultado.pendenciaAberta).toBe(false);
  });

  test("caixa desbloqueada e ainda FECHADA (nao aberta): reverte a caixa junto (cancela) e devolve o progresso", async () => {
    const telefone = "86944440003";
    for (const qty of [4, 4, 4]) {
      await processarConclusaoPedidoJornada({
        id: `ped_rev_3_${qty}_${Math.random()}`,
        telefone,
        status: "entregue",
        itensDetalhados: [{ kind: "pizza", name: "Pizza G", detail: "Calabresa", price: 50, qty }],
      });
    }
    const estadoAntes = await obterEstadoJornada("cli_86944440003");
    expect(estadoAntes.totalJornadasConcluidas).toBe(1);

    // Encontra qual dos 3 pedidos foi o que completou o ciclo (o que tem recompensasDesbloqueadas).
    const recompensas = await obterRecompensasCliente("cli_86944440003");
    expect(recompensas).toHaveLength(1);
    const pedidoOrigemId = recompensas[0].pedidoOrigemId;

    const resultado = await reverterConclusaoPedidoJornada(pedidoOrigemId, "Pedido cancelado antes da abertura do presente");
    expect(resultado.pendenciaAberta).toBe(false);
    const recompensasDepois = await obterRecompensasCliente("cli_86944440003");
    expect(recompensasDepois[0].status).toBe("cancelada");
  });

  test("caixa JA ABERTA quando o pedido e cancelado depois: nunca reverte silenciosamente — abre pendencia", async () => {
    const telefone = "86944440004";
    let ultimoPedidoId = "";
    for (const qty of [4, 4, 4]) {
      const id = `ped_rev_4_${qty}_${Math.random()}`;
      ultimoPedidoId = id;
      await processarConclusaoPedidoJornada({
        id,
        telefone,
        status: "entregue",
        itensDetalhados: [{ kind: "pizza", name: "Pizza G", detail: "Calabresa", price: 50, qty }],
      });
    }
    const recompensas = await obterRecompensasCliente("cli_86944440004");
    const recompensaId = recompensas[0].recompensaId;
    const pedidoOrigemId = recompensas[0].pedidoOrigemId;
    void ultimoPedidoId;

    // Cliente ja abriu a caixa antes do pedido ser cancelado.
    await abrirRecompensa("cli_86944440004", recompensaId);

    const resultado = await reverterConclusaoPedidoJornada(pedidoOrigemId, "Pedido cancelado apos o cliente ja ter aberto o presente");
    expect(resultado.pendenciaAberta).toBe(true);

    const pendencias = await obterPendencias();
    expect(pendencias.some((p) => p.recompensaId === recompensaId || p.pedidoId === pedidoOrigemId)).toBe(true);

    // O progresso NAO deve ter sido mexido retroativamente (nada de saldo negativo silencioso).
    const estado = await obterEstadoJornada("cli_86944440004");
    expect(estado.totalJornadasConcluidas).toBeGreaterThanOrEqual(1);
  });

  test("progresso ja avancou por pedidos posteriores: reversao de um pedido antigo NAO corrompe o progresso atual, so sinaliza pendencia", async () => {
    const telefone = "86944440005";
    await processarConclusaoPedidoJornada({
      id: "ped_rev_5_a",
      telefone,
      status: "entregue",
      itensDetalhados: [{ kind: "pizza", name: "Pizza G", detail: "Calabresa", price: 50, qty: 2 }],
    });
    await processarConclusaoPedidoJornada({
      id: "ped_rev_5_b",
      telefone,
      status: "entregue",
      itensDetalhados: [{ kind: "pizza", name: "Pizza G", detail: "Calabresa", price: 50, qty: 3 }],
    });
    const estadoAntesReversao = await obterEstadoJornada("cli_86944440005");
    expect(estadoAntesReversao.pizzasNoCiclo).toBe(5);

    // Reverte o PRIMEIRO pedido (2 pizzas) depois que o segundo (3 pizzas) ja teve efeito.
    const resultado = await reverterConclusaoPedidoJornada("ped_rev_5_a", "Pedido reaberto tardiamente");
    expect(resultado.pendenciaAberta).toBe(true);

    // Progresso permanece intacto — nunca subtrai retroativamente de cima de progresso legitimo posterior.
    const estadoDepois = await obterEstadoJornada("cli_86944440005");
    expect(estadoDepois.pizzasNoCiclo).toBe(5);
  });

  test("pizzasNaTrilha=0 (pedido sem pizzas elegiveis) reverte trivialmente, sem tocar estado", async () => {
    const telefone = "86944440006";
    await processarConclusaoPedidoJornada({
      id: "ped_rev_6",
      telefone,
      status: "entregue",
      itensDetalhados: [{ kind: "simple", name: "Guarana 2L", price: 12, qty: 1 }],
    });
    const resultado = await reverterConclusaoPedidoJornada("ped_rev_6", "cancelado");
    expect(resultado.ok).toBe(true);
    expect(resultado.pendenciaAberta).toBe(false);
  });
});
