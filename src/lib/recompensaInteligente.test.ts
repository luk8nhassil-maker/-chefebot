import { describe, expect, test } from "vitest";
import { recomendarSaborMaisComprado } from "./recompensaInteligente";

const sabores = ["Calabresa", "Frango Catupiry", "Portuguesa", "Chocolate"];
const clienteId = "cli_11900000001";

describe("recompensa inteligente", () => {
  test("escolhe somente o sabor mais frequente em pedidos entregues", () => {
    const recomendacao = recomendarSaborMaisComprado(clienteId, [
      { clienteId, status: "entregue", itens: ["1x Pizza G - Calabresa"] },
      { clienteId, status: "entregue", itens: ["1x Pizza M - Calabresa"] },
      { clienteId, status: "cancelado", itens: ["1x Pizza G - Portuguesa"] },
    ], sabores, "1 Pizza Família");

    expect(recomendacao).toMatchObject({
      sabor: "Calabresa",
      descricao: "1 Pizza Família — sabor mais comprado: Calabresa",
      pedidosConsiderados: 2,
      ocorrencias: 2,
      confianca: 1,
    });
  });

  test("conta um sabor no máximo uma vez por pedido e desempata deterministicamente", () => {
    const recomendacao = recomendarSaborMaisComprado(clienteId, [
      { clienteId, status: "entregue", itens: ["2x Pizza G - Portuguesa", "1x Pizza M - Calabresa"] },
      { clienteId, status: "entregue", itens: ["1x Pizza M - Calabresa"] },
    ], sabores, "1 Pizza Família");
    expect(recomendacao.sabor).toBe("Calabresa");
    expect(recomendacao.ocorrencias).toBe(2);
  });

  test("usa o presente comercial configurado como fallback quando o histórico é insuficiente", () => {
    const recomendacao = recomendarSaborMaisComprado(clienteId, [
      { clienteId, status: "entregue", itens: ["1x Pizza G - Calabresa"] },
    ], sabores, "1 Pizza Família");
    expect(recomendacao.descricao).toBe("1 Pizza Família");
    expect(recomendacao.sabor).toBeUndefined();
    expect(recomendacao.confianca).toBe(0);
  });

  test("reconhece meio a meio e não confunde borda com sabor", () => {
    const recomendacao = recomendarSaborMaisComprado(clienteId, [
      { clienteId, status: "entregue", itensDetalhados: [{ kind: "pizza", name: "Pizza G (meio a meio)", detail: "Calabresa / Portuguesa · borda Chocolate", price: 50, qty: 1 }] },
      { clienteId, status: "entregue", itensDetalhados: [{ kind: "pizza", name: "Pizza M", detail: "Portuguesa", price: 40, qty: 1 }] },
    ], sabores, "1 Pizza Família");
    expect(recomendacao.sabor).toBe("Portuguesa");
    expect(recomendacao.descricao).not.toContain("Chocolate");
  });
});
