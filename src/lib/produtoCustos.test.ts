import { describe, expect, it } from "vitest";
import {
  avaliarCoberturaCustos,
  calcularCustoProduto,
  calcularSobraComCupom,
  contarVendasPorProduto,
  custoPorUnidadeBase,
  type IngredienteCusto,
  type ReceitaProduto,
} from "./produtoCustos";

const ingredientes: IngredienteCusto[] = [
  { id: "queijo", nome: "Queijo", quantidadeCompra: 5, unidadeCompra: "kg", precoCompraCents: 10000, aproveitamentoPercent: 95, atualizadoEm: "2026-10-08T12:00:00.000Z" },
  { id: "molho", nome: "Molho", quantidadeCompra: 1, unidadeCompra: "l", precoCompraCents: 1200, aproveitamentoPercent: 100, atualizadoEm: "2026-10-08T12:00:00.000Z" },
];

const receita: ReceitaProduto = {
  produtoId: "pizza-g",
  nomeProduto: "Pizza Grande",
  precoVendaCents: 5000,
  componentes: [
    { ingredienteId: "queijo", quantidade: 200, unidade: "g" },
    { ingredienteId: "molho", quantidade: 100, unidade: "ml" },
  ],
  embalagemCustoCents: 250,
  taxaVendaPercent: 3,
  ativo: true,
};

describe("produtoCustos", () => {
  it("converte compra em kg/l para custo por unidade aproveitável", () => {
    expect(custoPorUnidadeBase(ingredientes[0])).toBeCloseTo(2.1053, 4);
    expect(custoPorUnidadeBase(ingredientes[1])).toBeCloseTo(1.2, 4);
  });

  it("calcula ingredientes, embalagem, taxa e sobra sem arredondar antes da soma", () => {
    const custo = calcularCustoProduto(receita, Object.fromEntries(ingredientes.map((item) => [item.id, item])));
    expect(custo.completo).toBe(true);
    expect(custo.ingredientesCents).toBe(541);
    expect(custo.embalagemCustoCents).toBe(250);
    expect(custo.taxasCents).toBe(150);
    expect(custo.custoDiretoCents).toBe(941);
    expect(custo.sobraCents).toBe(4059);
    expect(calcularSobraComCupom(custo, 500)).toBe(3559);
  });

  it("não trata ingrediente faltante como custo zero", () => {
    const custo = calcularCustoProduto(receita, { queijo: ingredientes[0] });
    expect(custo.completo).toBe(false);
    expect(custo.custoDiretoCents).toBeNull();
    expect(custo.faltantes).toEqual(["molho"]);
    expect(calcularSobraComCupom(custo, 1_000)).toBeNull();
  });

  it("libera margem somente quando a cobertura de vendas chega ao limite", () => {
    const completo = calcularCustoProduto(receita, Object.fromEntries(ingredientes.map((item) => [item.id, item])));
    const incompleto = calcularCustoProduto({ ...receita, produtoId: "bebida", nomeProduto: "Bebida", componentes: [{ ingredienteId: "faltante", quantidade: 1, unidade: "un" }] }, Object.fromEntries(ingredientes.map((item) => [item.id, item])));
    expect(avaliarCoberturaCustos([completo, incompleto], { "pizza-g": 90, bebida: 10 }).modo).toBe("margem_parcial");
    expect(avaliarCoberturaCustos([completo], { "pizza-g": 100 }).modo).toBe("margem_ativa");
  });

  it("conta só itens entregues com ID estruturado", () => {
    expect(contarVendasPorProduto([
      { status: "entregue", snapshotOficial: { itens: [{ quantidade: 2, selecao: { productId: "product-x" } }] } },
      { status: "novo", snapshotOficial: { itens: [{ quantidade: 9, selecao: { productId: "product-x" } }] } },
      { status: "entregue", snapshotOficial: { itens: [{ quantidade: 3, nome: "legado" }] } },
    ])).toEqual({ "product-x": 2 });
  });
});
