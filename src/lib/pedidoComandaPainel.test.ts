import { describe, expect, it } from "vitest";
import { mapearFamiliasVisiveis, selecionarPedidosPainel, selecionarProximaAcaoFamilia } from "./pedidoComandaPainel";

type PedidoTeste = {
  id: string;
  numero: number;
  cliente: string;
  telefone: string;
  status: "novo" | "em_preparo" | "saiu_entrega" | "entregue" | "cancelado";
  pagamento: string;
  comandaId?: string;
  comandaNumero?: number;
  rodadaNumero?: number;
  comandaMesa?: string;
};

const familia: PedidoTeste[] = [
  {
    id: "p-20",
    numero: 20,
    cliente: "Família Silva",
    telefone: "",
    status: "entregue",
    pagamento: "Comanda em aberto",
    comandaId: "c-9",
    comandaNumero: 9,
    rodadaNumero: 2,
    comandaMesa: "4",
  },
  {
    id: "p-19",
    numero: 19,
    cliente: "Família Silva",
    telefone: "",
    status: "em_preparo",
    pagamento: "Comanda em aberto",
    comandaId: "c-9",
    comandaNumero: 9,
    rodadaNumero: 1,
    comandaMesa: "4",
  },
];

const delivery: PedidoTeste = {
  id: "p-21",
  numero: 21,
  cliente: "Outro cliente",
  telefone: "71999990000",
  status: "novo",
  pagamento: "Dinheiro",
};

describe("painel — família visual da comanda", () => {
  it("mantém as rodadas da mesma comanda juntas e em ordem, sem fundir os pedidos", () => {
    const resultado = selecionarPedidosPainel([familia[0], delivery, familia[1]], "todos", "");
    const idsFamilia = resultado.filter((p) => p.comandaId === "c-9").map((p) => p.id);

    expect(idsFamilia).toEqual(["p-19", "p-20"]);
    expect(resultado).toHaveLength(3);
    expect(new Set(resultado.map((p) => p.id)).size).toBe(3);
  });

  it("ao filtrar Fazendo exibe a comanda inteira quando uma rodada está em preparo", () => {
    const resultado = selecionarPedidosPainel([...familia, delivery], "em_preparo", "");
    expect(resultado.map((p) => p.id)).toEqual(["p-19", "p-20"]);
  });

  it("buscar pelo número de uma rodada retorna a família inteira da comanda", () => {
    const resultado = selecionarPedidosPainel([...familia, delivery], "todos", "20");
    expect(resultado.map((p) => p.id)).toEqual(["p-19", "p-20"]);
  });

  it("buscar por comanda ou mesa encontra todas as rodadas", () => {
    expect(selecionarPedidosPainel([...familia, delivery], "todos", "comanda 9").map((p) => p.id))
      .toEqual(["p-19", "p-20"]);
    expect(selecionarPedidosPainel([...familia, delivery], "todos", "mesa 4").map((p) => p.id))
      .toEqual(["p-19", "p-20"]);
  });

  it("pedido de Delivery continua individual e respeita o filtro normal", () => {
    const resultado = selecionarPedidosPainel([...familia, delivery], "novo", "Outro");
    expect(resultado).toEqual([delivery]);
  });

  it("gera mapa de família só para pedidos com comandaId", () => {
    const mapa = mapearFamiliasVisiveis([...familia, delivery]);
    expect(mapa.get("c-9")?.map((p) => p.id)).toEqual(["p-20", "p-19"]);
    expect(mapa.size).toBe(1);
  });

  it("escolhe uma única próxima ação e respeita a etapa aberta no painel", () => {
    const duasRodadas: PedidoTeste[] = [
      { ...familia[1], id: "r1", numero: 31, rodadaNumero: 1, status: "em_preparo" },
      { ...familia[1], id: "r2", numero: 32, rodadaNumero: 2, status: "em_preparo" },
    ];

    expect(selecionarProximaAcaoFamilia(duasRodadas, "em_preparo")?.id).toBe("r1");

    duasRodadas[0] = { ...duasRodadas[0], status: "entregue" };
    expect(selecionarProximaAcaoFamilia(duasRodadas, "em_preparo")?.id).toBe("r2");
  });

  it("não atualiza em lote: uma rodada nova pode ser a ação enquanto outra mantém seu status próprio", () => {
    const mistas: PedidoTeste[] = [
      { ...familia[1], id: "fazendo", numero: 41, rodadaNumero: 1, status: "em_preparo" },
      { ...familia[1], id: "novo", numero: 42, rodadaNumero: 2, status: "novo" },
    ];

    expect(selecionarProximaAcaoFamilia(mistas, "em_preparo")?.id).toBe("fazendo");
    expect(selecionarProximaAcaoFamilia(mistas, "novo")?.id).toBe("novo");
    expect(mistas.map((p) => p.status)).toEqual(["em_preparo", "novo"]);
  });

  it("não oferece ação de comanda quando todas as rodadas terminaram", () => {
    const concluidas: PedidoTeste[] = [
      { ...familia[1], id: "fim-1", status: "entregue" },
      { ...familia[0], id: "fim-2", status: "cancelado" },
    ];
    expect(selecionarProximaAcaoFamilia(concluidas, "todos")).toBeUndefined();
  });
});
