import { describe, expect, it } from "vitest";
import {
  ehNomeDeTeste,
  faturamentoDosPedidosEntregues,
  selecionarComandasDeTeste,
  selecionarPedidosDeTeste,
  resumirRiscosLaterais,
} from "./limpezaPedidosTeste";

describe("limpeza controlada de dados de teste", () => {
  it.each([
    "teste A",
    "Teste B",
    "TESTES",
    "Cliente teste",
    "pedido-testes-qa",
  ])("reconhece %s como nome de teste", (nome) => {
    expect(ehNomeDeTeste(nome)).toBe(true);
  });

  it.each([
    "Testemunho",
    "Testesilva",
    "Atestado",
    "Cliente real",
    "",
  ])("não classifica %s por substring", (nome) => {
    expect(ehNomeDeTeste(nome)).toBe(false);
  });

  it("seleciona pedidos e comandas pelo mesmo critério conservador", () => {
    const pedidos = selecionarPedidosDeTeste([
      { id: "1", cliente: "Teste A" },
      { id: "2", cliente: "Maria" },
      { id: "3", cliente: "Cliente testes" },
    ]);
    const comandas = selecionarComandasDeTeste([
      { id: "c1", cliente: "Teste B" },
      { id: "c2", cliente: "João" },
    ]);

    expect(pedidos.map((p) => p.id)).toEqual(["1", "3"]);
    expect(comandas.map((c) => c.id)).toEqual(["c1"]);
  });

  it("calcula apenas pedidos entregues como impacto no faturamento atual", () => {
    expect(faturamentoDosPedidosEntregues([
      { id: "1", cliente: "Teste A", status: "entregue", total: 33 },
      { id: "2", cliente: "Teste B", status: "em_preparo", total: 77 },
      { id: "3", cliente: "Testes", status: "entregue", total: 9 },
    ])).toBe(42);
  });

  it("sinaliza efeitos laterais que exigem atenção antes da exclusão", () => {
    expect(resumirRiscosLaterais([
      { id: "1", cliente: "Teste", telefone: "999", clienteId: "c1", pizzasCount: 1 },
      { id: "2", cliente: "Teste", resgateId: "r1", itensJornada: [{}] },
    ])).toEqual({
      comTelefone: 1,
      comClienteId: 1,
      comResgate: 1,
      comRecompensaJornada: 0,
      comItensJornada: 1,
      comPizzasFidelidade: 1,
    });
  });
});
