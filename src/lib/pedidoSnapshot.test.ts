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

  it("monta o snapshot com valores agregados em centavos e entrega estruturada (sem desconto)", () => {
    const snapshot = construirSnapshotOficial({
      itens: baseItens,
      subtotalReais: 90,
      descontoReais: 0,
      taxaReais: 5,
      tipoEntrega: "delivery",
      bairro: "Centro",
      pagamento: "Pix",
      criadoEm: "2026-08-08T12:00:00.000Z",
    });

    expect(snapshot).toEqual({
      itens: baseItens,
      subtotalCents: 9000,
      descontoFidelidadeCents: 0,
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
      descontoReais: 0,
      taxaReais: 0,
      tipoEntrega: "retirada",
      pagamento: "Dinheiro",
      criadoEm: "2026-08-08T12:00:00.000Z",
    });

    expect(snapshot.entrega).toEqual({ tipo: "retirada" });
    expect(snapshot.taxaEntregaCents).toBe(0);
  });

  it("com desconto de fidelidade: descontoFidelidadeCents preenchido e invariante subtotal - desconto + taxa = total vale", () => {
    const snapshot = construirSnapshotOficial({
      itens: baseItens,
      subtotalReais: 90,
      descontoReais: 20,
      taxaReais: 5,
      tipoEntrega: "delivery",
      bairro: "Centro",
      pagamento: "Pix",
      criadoEm: "2026-08-08T12:00:00.000Z",
    });

    expect(snapshot.descontoFidelidadeCents).toBe(2000);
    expect(snapshot.totalCents).toBe(7500); // 9000 - 2000 + 500
    expect(snapshot.subtotalCents - snapshot.descontoFidelidadeCents + snapshot.taxaEntregaCents).toBe(snapshot.totalCents);
  });

  it("sem desconto, descontoFidelidadeCents é sempre 0", () => {
    const snapshot = construirSnapshotOficial({
      itens: baseItens, subtotalReais: 90, descontoReais: 0, taxaReais: 5,
      tipoEntrega: "delivery", bairro: "Centro", pagamento: "Pix", criadoEm: "2026-08-08T12:00:00.000Z",
    });
    expect(snapshot.descontoFidelidadeCents).toBe(0);
  });

  it("invariante subtotal - desconto + taxa = total vale sempre, para vários valores", () => {
    for (const [subtotalReais, descontoReais, taxaReais] of [[100, 0, 0], [55.5, 10, 3], [30, 30, 7], [12.34, 5.67, 1.23]]) {
      const snapshot = construirSnapshotOficial({
        itens: [], subtotalReais, descontoReais, taxaReais,
        tipoEntrega: "delivery", bairro: "Centro", pagamento: "Pix", criadoEm: "2026-08-08T12:00:00.000Z",
      });
      expect(snapshot.subtotalCents - snapshot.descontoFidelidadeCents + snapshot.taxaEntregaCents).toBe(snapshot.totalCents);
    }
  });
});

describe("construirSnapshotItem — sanitização de selecao", () => {
  it("copia só sizeId/flavorIds/borderId, mesmo que o objeto de entrada (ex.: vindo de body.itens[i].pizzaSelection) tenha propriedades extras adulteradas", () => {
    const selecaoAdulterada = {
      sizeId: "size-g",
      flavorIds: ["flavor-calabresa"],
      borderId: "border-catupiry",
      // Propriedades extras que NUNCA devem ser persistidas — simula um
      // payload adulterado com campos fora do contrato oficial.
      priceCents: 1,
      admin: true,
      __proto__: { evil: true },
    } as unknown as { sizeId: string; flavorIds: string[]; borderId?: string };

    const item = construirSnapshotItem({
      kind: "pizza", nome: "Pizza G", quantidade: 1, precoUnitarioReais: 60, selecao: selecaoAdulterada,
    });

    expect(item.selecao).toEqual({ sizeId: "size-g", flavorIds: ["flavor-calabresa"], borderId: "border-catupiry" });
    expect(Object.keys(item.selecao!).sort()).toEqual(["borderId", "flavorIds", "sizeId"]);
    expect(item.selecao).not.toHaveProperty("priceCents");
    expect(item.selecao).not.toHaveProperty("admin");
  });

  it("selecao sem borderId: campo omitido, nunca gravado como undefined/null", () => {
    const item = construirSnapshotItem({
      kind: "pizza", nome: "Pizza G", quantidade: 1, precoUnitarioReais: 50,
      selecao: { sizeId: "size-g", flavorIds: ["flavor-calabresa"] },
    });
    expect(item.selecao).toEqual({ sizeId: "size-g", flavorIds: ["flavor-calabresa"] });
    expect(item.selecao).not.toHaveProperty("borderId");
  });

  it("flavorIds sanitizado é uma cópia nova (mutar o array original não afeta o snapshot já construído)", () => {
    const flavorIds = ["flavor-calabresa", "flavor-baiana"];
    const item = construirSnapshotItem({
      kind: "pizza", nome: "Pizza G", quantidade: 1, precoUnitarioReais: 60,
      selecao: { sizeId: "size-g", flavorIds },
    });
    flavorIds.push("flavor-adulterado");
    const selecaoPizza = item.selecao as { sizeId: string; flavorIds: string[] };
    expect(selecaoPizza.flavorIds).toEqual(["flavor-calabresa", "flavor-baiana"]);
  });
});

describe("construirSnapshotItem — sanitização de selecao de produto simples (Fase 6)", () => {
  it("copia só productId/sizeId/flavorId/milk, mesmo com propriedades extras adulteradas", () => {
    const selecaoAdulterada = {
      productId: "product-calzone",
      flavorId: "flavor-calabresa",
      // Propriedades extras que NUNCA devem ser persistidas.
      priceCents: 1,
      admin: true,
      __proto__: { evil: true },
    } as unknown as { productId: string; flavorId?: string };

    const item = construirSnapshotItem({
      kind: "simple", nome: "Calzone", detalhe: "Sabor: Calabresa", quantidade: 1, precoUnitarioReais: 35, selecao: selecaoAdulterada,
    });

    expect(item.selecao).toEqual({ productId: "product-calzone", flavorId: "flavor-calabresa" });
    expect(Object.keys(item.selecao!).sort()).toEqual(["flavorId", "productId"]);
    expect(item.selecao).not.toHaveProperty("priceCents");
    expect(item.selecao).not.toHaveProperty("admin");
  });

  it("seleção de macarronada: só productId/sizeId, sem flavorId/milk", () => {
    const item = construirSnapshotItem({
      kind: "simple", nome: "Macarronada de Carne", detalhe: "Tamanho G", quantidade: 1, precoUnitarioReais: 50,
      selecao: { productId: "product-macarronada-de-carne", sizeId: "size-g" },
    });
    expect(item.selecao).toEqual({ productId: "product-macarronada-de-carne", sizeId: "size-g" });
    expect(item.selecao).not.toHaveProperty("flavorId");
    expect(item.selecao).not.toHaveProperty("milk");
  });

  it("seleção de suco: só productId/milk", () => {
    const item = construirSnapshotItem({
      kind: "simple", nome: "Laranja", detalhe: "com leite", quantidade: 1, precoUnitarioReais: 10,
      selecao: { productId: "product-laranja", milk: "com" },
    });
    expect(item.selecao).toEqual({ productId: "product-laranja", milk: "com" });
  });

  it("seleção sem nenhum campo opcional (produto simples plano): só productId", () => {
    const item = construirSnapshotItem({
      kind: "simple", nome: "X-Burguer", quantidade: 1, precoUnitarioReais: 15,
      selecao: { productId: "product-x-burguer" },
    });
    expect(item.selecao).toEqual({ productId: "product-x-burguer" });
  });
});
