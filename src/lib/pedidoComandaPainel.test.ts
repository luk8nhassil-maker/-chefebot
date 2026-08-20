import { describe, expect, it } from "vitest";
import { mapearFamiliasVisiveis, selecionarPedidosPainel } from "./pedidoComandaPainel";

type PedidoTeste = {
  id: string;
  numero: number;
  cliente: string;
  telefone: string;
  status: "novo" | "em_preparo" | "entregue";
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
});
