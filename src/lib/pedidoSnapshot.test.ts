// Testes do snapshot oficial do pedido — Fase 3.
import { describe, expect, it } from "vitest";
import { construirSnapshotItem, construirSnapshotOficial } from "./pedidoSnapshot";

describe("construirSnapshotItem", () => {
  it("converte reais para centavos inteiros e calcula totalCents = unitário * quantidade", () => {
    const item = construirSnapshotItem({ kind: "pizza", nome: "Pizza G", detalhe: "Calabresa", quantidade: 2, precoUnitarioReais: 50 });
    expect(item.precoUnitarioCents).toBe(5000);
    expect(item.totalCents).toBe(10000);
  });

  it("omite detalhe quando ausente (nunca grava string vazia)", () => {
    const item = construirSnapshotItem({ kind: "simple", nome: "Refrigerante 2L", quantidade: 1, precoUnitarioReais: 15 });
    expect(item).not.toHaveProperty("detalhe");
  });

  it("inclui selecao só quando fornecida", () => {
    const semSelecao = construirSnapshotItem({ kind: "pizza", nome: "Pizza G", quantidade: 1, precoUnitarioReais: 50 });
    expect(semSelecao).not.toHaveProperty("selecao");

    const comSelecao = construirSnapshotItem({
      kind: "pizza",
      nome: "Pizza G",
      quantidade: 1,
      precoUnitarioReais: 50,
      selecao: { sizeId: "size-g", flavorIds: ["flavor-calabresa"], borderId: "border-catupiry" },
    });
    expect(comSelecao.selecao).toEqual({ sizeId: "size-g", flavorIds: ["flavor-calabresa"], borderId: "border-catupiry" });
  });

  it("arredonda corretamente valores fracionários (nunca trunca)", () => {
    // 12,345 reais nunca ocorre no cardápio real, mas o arredondamento
    // precisa ser robusto a qualquer valor numérico vindo do cálculo oficial.
    const item = construirSnapshotItem({ kind: "simple", nome: "X", quantidade: 1, precoUnitarioReais: 12.345 });
    expect(item.precoUnitarioCents).toBe(1235);
  });

  it("preço zero (presente da Jornada do Chef) produz totalCents zero", () => {
    const item = construirSnapshotItem({ kind: "pizza", nome: "Pizza Presente", quantidade: 1, precoUnitarioReais: 0 });
    expect(item.precoUnitarioCents).toBe(0);
    expect(item.totalCents).toBe(0);
  });
});

describe("construirSnapshotOficial", () => {
  const baseItens = [
    construirSnapshotItem({ kind: "pizza", nome: "Pizza G", detalhe: "Calabresa · borda Catupiry", quantidade: 1, precoUnitarioReais: 60, selecao: { sizeId: "size-g", flavorIds: ["flavor-calabresa"], borderId: "border-catupiry" } }),
    construirSnapshotItem({ kind: "simple", nome: "Refrigerante 2L", quantidade: 2, precoUnitarioReais: 15 }),
  ];

  it("monta o snapshot com valores agregados em centavos e entrega estruturada", () => {
    const snapshot = construirSnapshotOficial({
      itens: baseItens,
      subtotalReais: 90,
      taxaReais: 5,
      totalReais: 95,
      tipoEntrega: "delivery",
      bairro: "Centro",
      pagamento: "Pix",
      criadoEm: "2026-08-08T12:00:00.000Z",
    });

    expect(snapshot).toEqual({
      itens: baseItens,
      subtotalCents: 9000,
      taxaEntregaCents: 500,
      totalCents: 9500,
      entrega: { tipo: "delivery", bairro: "Centro" },
      pagamento: "Pix",
      criadoEm: "2026-08-08T12:00:00.000Z",
    });
  });

  it("omite bairro quando retirada/consumo local (sem taxa de entrega)", () => {
    const snapshot = construirSnapshotOficial({
      itens: baseItens,
      subtotalReais: 90,
      taxaReais: 0,
      totalReais: 90,
      tipoEntrega: "retirada",
      pagamento: "Dinheiro",
      criadoEm: "2026-08-08T12:00:00.000Z",
    });

    expect(snapshot.entrega).toEqual({ tipo: "retirada" });
    expect(snapshot.taxaEntregaCents).toBe(0);
  });
});
