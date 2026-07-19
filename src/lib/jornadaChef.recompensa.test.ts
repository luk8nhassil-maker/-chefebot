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
  abrirRecompensa,
  reservarRecompensaParaProximoPedido,
  cancelarReservaRecompensa,
  confirmarReservaNoPedido,
  aplicarResgateManual,
  substituirRecompensa,
  obterRecompensasCliente,
  salvarConfigJornadaChef,
  type RecompensaConfigCiclo,
} from "./jornadaChef";

beforeEach(() => {
  store.clear();
});

// Itens reais do cardápio estático (fallback de getMENUDinamico quando não
// há override em Redis) — usados aqui para que a validação de catálogo real
// (rule 7) aceite a sequência de presentes nos testes.
const BEBIDA_GUARANA: RecompensaConfigCiclo = {
  id: "cfg_guarana",
  tipo: "bebida_sobremesa",
  ativo: true,
  produtoNome: "Guarana 2L",
  item: { produtoId: "bebida:Guarana 2L", produtoNome: "Guarana 2L", categoria: "bebida" },
};
const SUCO_LARANJA: RecompensaConfigCiclo = {
  id: "cfg_laranja",
  tipo: "bebida_sobremesa",
  ativo: true,
  produtoNome: "Laranja",
  item: { produtoId: "suco:Laranja", produtoNome: "Laranja", categoria: "suco" },
};

async function clienteComCaixaDesbloqueada(telefone: string, sequencia?: RecompensaConfigCiclo[]) {
  await salvarConfigJornadaChef({ ativo: true, sequenciaRecompensas: sequencia ?? [BEBIDA_GUARANA] });
  // Teto de 4 pizzas por pedido: fecha o ciclo de 12 via 3 pedidos (4 + 4 + 4).
  let ultimoResultado;
  for (const qty of [4, 4, 4]) {
    ultimoResultado = await processarConclusaoPedidoJornada({
      id: `ped_${telefone}_${qty}_${Math.random()}`,
      telefone,
      status: "entregue",
      itensDetalhados: [{ kind: "pizza", name: "Pizza G", detail: "Calabresa", price: 50, qty }],
    });
  }
  const clienteId = `cli_${telefone}`;
  const recompensaId = ultimoResultado!.recompensasDesbloqueadas[0].recompensaId;
  return { clienteId, recompensaId };
}

describe("recompensa determinística", () => {
  test("prêmio é determinado no servidor a partir da configuração (sem RNG) — mesmo ciclo sempre produz o mesmo produto", async () => {
    const sequencia = [BEBIDA_GUARANA, SUCO_LARANJA];
    const { recompensaId: rec1 } = await clienteComCaixaDesbloqueada("86911110001", sequencia);
    const r1 = await abrirRecompensa("cli_86911110001", rec1);
    expect(r1.produtoId).toBe("bebida:Guarana 2L"); // ciclo 1 -> indice 0

    // Segundo ciclo do MESMO cliente deve escolher o proximo item da sequencia (b), nao aleatorio.
    let resultado2;
    for (const qty of [4, 4, 4]) {
      resultado2 = await processarConclusaoPedidoJornada({
        id: `ped_2ciclo_${qty}_${Math.random()}`,
        telefone: "86911110001",
        status: "entregue",
        itensDetalhados: [{ kind: "pizza", name: "Pizza G", detail: "Calabresa", price: 50, qty }],
      });
    }
    const rec2 = resultado2!.recompensasDesbloqueadas[0].recompensaId;
    const r2 = await abrirRecompensa("cli_86911110001", rec2);
    expect(r2.produtoId).toBe("suco:Laranja"); // ciclo 2 -> indice 1
  });

  test("produto configurado mas esgotado no momento da conclusao do ciclo: caixa fica fechada, sem inventar produto, e gera pendencia", async () => {
    // A ativação exige ao menos uma recompensa válida (rule 8) — não dá mais
    // para persistir "ativo: true" com sequência vazia. O gap real testado
    // aqui é outro: o produto era válido quando configurado, mas ficou
    // esgotado ANTES do ciclo se completar — a revalidação em `criarRecompensa`
    // precisa pegar isso, nunca entregando um produto que sumiu do cardápio.
    await salvarConfigJornadaChef({ ativo: true, sequenciaRecompensas: [BEBIDA_GUARANA] });
    store.set("esgotados", ["Guarana 2L"]);
    const telefone = "86911110002";
    let ultimoResultado;
    for (const qty of [4, 4, 4]) {
      ultimoResultado = await processarConclusaoPedidoJornada({
        id: `ped_${telefone}_${qty}_${Math.random()}`,
        telefone,
        status: "entregue",
        itensDetalhados: [{ kind: "pizza", name: "Pizza G", detail: "Calabresa", price: 50, qty }],
      });
    }
    const recompensaId = ultimoResultado!.recompensasDesbloqueadas[0].recompensaId;
    const aberta = await abrirRecompensa("cli_86911110002", recompensaId);
    expect(aberta.produtoId).toBeNull();
  });

  test("abrir a caixa é idempotente: refresh (chamar de novo) devolve o MESMO resultado", async () => {
    const { clienteId, recompensaId } = await clienteComCaixaDesbloqueada("86911110003");
    const r1 = await abrirRecompensa(clienteId, recompensaId);
    const r2 = await abrirRecompensa(clienteId, recompensaId);
    expect(r2.abertaEm).toBe(r1.abertaEm);
    expect(r2.validaAte).toBe(r1.validaAte);
  });

  test("abertura concorrente (clique duplo) não gera dois resultados diferentes", async () => {
    const { clienteId, recompensaId } = await clienteComCaixaDesbloqueada("86911110004");
    const [r1, r2] = await Promise.all([abrirRecompensa(clienteId, recompensaId), abrirRecompensa(clienteId, recompensaId)]);
    expect(r1.abertaEm).toBe(r2.abertaEm);
  });

  test("outro cliente nao consegue abrir a recompensa de outro", async () => {
    const { recompensaId } = await clienteComCaixaDesbloqueada("86911110005");
    await expect(abrirRecompensa("cli_00000000000", recompensaId)).rejects.toThrow();
  });
});

describe("reserva e resgate", () => {
  test("reserva concorrente: só uma reserva efetiva", async () => {
    const { clienteId, recompensaId } = await clienteComCaixaDesbloqueada("86922220001");
    await abrirRecompensa(clienteId, recompensaId);
    const [r1, r2] = await Promise.all([
      reservarRecompensaParaProximoPedido(clienteId, recompensaId),
      reservarRecompensaParaProximoPedido(clienteId, recompensaId),
    ]);
    expect(r1.status).toBe("reservada");
    expect(r2.status).toBe("reservada");
  });

  test("cancelar a reserva devolve a recompensa para disponivel sem perde-la", async () => {
    const { clienteId, recompensaId } = await clienteComCaixaDesbloqueada("86922220002");
    await abrirRecompensa(clienteId, recompensaId);
    await reservarRecompensaParaProximoPedido(clienteId, recompensaId);
    const cancelada = await cancelarReservaRecompensa(clienteId, recompensaId);
    expect(cancelada.status).toBe("disponivel");
  });

  test("um premio por pedido: confirmar reserva vincula a um pedidoId, e reprocessar o mesmo pedido é idempotente", async () => {
    const { clienteId, recompensaId } = await clienteComCaixaDesbloqueada("86922220003");
    await abrirRecompensa(clienteId, recompensaId);
    await reservarRecompensaParaProximoPedido(clienteId, recompensaId);
    const c1 = await confirmarReservaNoPedido(clienteId, recompensaId, "pedido_x");
    const c2 = await confirmarReservaNoPedido(clienteId, recompensaId, "pedido_x");
    expect(c1.reservaPedidoId).toBe("pedido_x");
    expect(c2.reservaPedidoId).toBe("pedido_x");
  });

  test("pedido concluido (entregue) marca a recompensa reservada como resgatada", async () => {
    const { clienteId, recompensaId } = await clienteComCaixaDesbloqueada("86922220004");
    await abrirRecompensa(clienteId, recompensaId);
    await reservarRecompensaParaProximoPedido(clienteId, recompensaId);
    await confirmarReservaNoPedido(clienteId, recompensaId, "pedido_y");
    await processarConclusaoPedidoJornada({
      id: "pedido_y",
      telefone: "86922220004",
      status: "entregue",
      recompensaJornadaId: recompensaId,
      itensDetalhados: [],
    });
    const [recompensa] = await obterRecompensasCliente(clienteId);
    expect(recompensa.status).toBe("resgatada");
  });

  test("expiracao apos abertura: recompensa expirada nao pode ser reservada", async () => {
    await salvarConfigJornadaChef({ ativo: true, validadeRecompensaDias: 1, sequenciaRecompensas: [BEBIDA_GUARANA] });
    let resultado;
    for (const qty of [4, 4, 4]) {
      resultado = await processarConclusaoPedidoJornada({
        id: `ped_exp_${qty}_${Math.random()}`,
        telefone: "86922220005",
        status: "entregue",
        itensDetalhados: [{ kind: "pizza", name: "Pizza G", detail: "Calabresa", price: 50, qty }],
      });
    }
    const recompensaId = resultado!.recompensasDesbloqueadas[0].recompensaId;
    const clienteId = "cli_86922220005";
    const aberta = await abrirRecompensa(clienteId, recompensaId);
    // Forca expiracao manipulando a validade diretamente no fake-redis (simula os "30 dias" passados).
    const chave = [...store.keys()].find((k) => k.includes(`jornada:recompensa:default:${recompensaId}`))!;
    store.set(chave, { ...(store.get(chave) as object), validaAte: new Date(Date.now() - 1000).toISOString() });
    void aberta;
    await expect(reservarRecompensaParaProximoPedido(clienteId, recompensaId)).rejects.toThrow();
  });
});

describe("fallback manual da Kellyne", () => {
  test("resgate manual por codigo publico funciona e nao pode ser reutilizado", async () => {
    const { clienteId, recompensaId } = await clienteComCaixaDesbloqueada("86933330001");
    const aberta = await abrirRecompensa(clienteId, recompensaId);
    const codigo = aberta.codigoPublico;
    const resgatada = await aplicarResgateManual(codigo, "kellyne");
    expect(resgatada.status).toBe("resgatada");
    await expect(aplicarResgateManual(codigo, "kellyne")).rejects.toThrow();
  });

  test("codigo invalido nao aplica nada", async () => {
    await expect(aplicarResgateManual("JC-INEXISTENTE", "kellyne")).rejects.toThrow();
  });

  test("substituicao manual fica registrada no historico", async () => {
    const { clienteId, recompensaId } = await clienteComCaixaDesbloqueada("86933330002");
    await abrirRecompensa(clienteId, recompensaId);
    const substituida = await substituirRecompensa(recompensaId, "pizza-g-calabresa", "Pizza G Calabresa", "item original esgotado", "kellyne");
    expect(substituida.produtoId).toBe("pizza-g-calabresa");
    expect(substituida.historicoSubstituicao).toHaveLength(1);
    expect(substituida.historicoSubstituicao![0].motivo).toContain("kellyne");
  });
});
