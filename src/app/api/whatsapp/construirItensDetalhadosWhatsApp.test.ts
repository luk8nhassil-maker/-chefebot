import { vi, describe, it, expect } from "vitest";

// Fase 7 — WhatsApp: itensDetalhados é um espelho estruturado ADITIVO do
// carrinho do bot (BotSession.cart), com IDs estáveis do catálogo oficial
// quando resolvíveis. `itens` (string[], o que Pix/impressão leem) nunca
// muda — só este campo novo é adicionado ao pedido persistido.

vi.mock("@/lib/redis", () => ({ redis: { get: vi.fn().mockResolvedValue(null), set: vi.fn() } }));

import { construirItensDetalhadosWhatsApp, type ItemCarrinhoParaDetalhes } from "./route";
import { MENU } from "@/lib/menu";

describe("construirItensDetalhadosWhatsApp", () => {
  it("pizza com sabor e tamanho reconhecidos ganha pizzaSelection com IDs do catálogo oficial", () => {
    const cart: ItemCarrinhoParaDetalhes[] = [
      { category: "pizza", name: "Pizza", size: "Grande", flavor: "Calabresa", border: "Sem borda", price: 45 },
    ];
    const [item] = construirItensDetalhadosWhatsApp(cart, MENU);
    expect(item.kind).toBe("pizza");
    expect(item.pizzaSelection?.flavorIds).toEqual(["flavor-calabresa"]);
    expect(item.pizzaSelection?.sizeId).toBeDefined();
    expect(item.pizzaSelection?.borderId).toBeUndefined();
    expect(item.price).toBe(45);
  });

  it("borda diferente de 'Sem borda' resolvível também ganha borderId", () => {
    const cart: ItemCarrinhoParaDetalhes[] = [
      { category: "pizza", name: "Pizza", size: "Grande", flavor: "Calabresa", border: "Catupiry", price: 50 },
    ];
    const [item] = construirItensDetalhadosWhatsApp(cart, MENU);
    expect(item.pizzaSelection?.borderId).toBe("border-catupiry");
  });

  it("lanche/bebida/suco reconhecido ganha simpleSelection com productId", () => {
    const cart: ItemCarrinhoParaDetalhes[] = [{ category: "bebida", name: MENU.bebidas[0].name, price: MENU.bebidas[0].price }];
    const [item] = construirItensDetalhadosWhatsApp(cart, MENU);
    expect(item.kind).toBe("simple");
    expect(item.simpleSelection?.productId).toBeDefined();
  });

  it("sabor não resolvível no catálogo atual ainda gera ItemApp válido, só sem seleção estruturada (nunca bloqueia)", () => {
    const cart: ItemCarrinhoParaDetalhes[] = [
      { category: "pizza", name: "Pizza", size: "Grande", flavor: "Sabor Que Não Existe Mais", price: 45 },
    ];
    const [item] = construirItensDetalhadosWhatsApp(cart, MENU);
    expect(item.kind).toBe("pizza");
    expect(item.pizzaSelection).toBeUndefined();
    expect(item.name).toContain("Sabor Que Não Existe Mais");
    expect(item.price).toBe(45);
  });

  it("nome do item é composto exatamente como a string legada (name + size + flavor + border)", () => {
    const cart: ItemCarrinhoParaDetalhes[] = [
      { category: "pizza", name: "Pizza", size: "Grande", flavor: "Calabresa", border: "Catupiry", price: 50 },
    ];
    const [item] = construirItensDetalhadosWhatsApp(cart, MENU);
    expect(item.name).toBe("Pizza Grande Calabresa + Catupiry");
  });

  it("comparação por nome é insensível a acento/maiúscula (mesma normalização do catálogo oficial)", () => {
    const cart: ItemCarrinhoParaDetalhes[] = [
      { category: "pizza", name: "Pizza", size: "grande", flavor: "CALABRESA", price: 45 },
    ];
    const [item] = construirItensDetalhadosWhatsApp(cart, MENU);
    expect(item.pizzaSelection?.flavorIds).toEqual(["flavor-calabresa"]);
  });

  it("carrinho vazio produz lista vazia", () => {
    expect(construirItensDetalhadosWhatsApp([], MENU)).toEqual([]);
  });

  it("qty é sempre 1 (carrinho do bot empilha 1 CartItem por unidade)", () => {
    const cart: ItemCarrinhoParaDetalhes[] = [
      { category: "pizza", name: "Pizza", size: "Grande", flavor: "Calabresa", price: 45 },
      { category: "pizza", name: "Pizza", size: "Grande", flavor: "Calabresa", price: 45 },
    ];
    const itens = construirItensDetalhadosWhatsApp(cart, MENU);
    expect(itens).toHaveLength(2);
    expect(itens.every((i) => i.qty === 1)).toBe(true);
  });
});
