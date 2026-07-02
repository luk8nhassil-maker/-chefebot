import { describe, expect, it } from "vitest";
import { MENU } from "./menu";
import { catalogoDoMenu, precoFinalPromocao, promocaoIndisponivel, promocoesPublicas, validarPromocao, type Promocao } from "./promocoes";

const menu = MENU as never;

function basePromo(extra: Partial<Promocao> = {}): Promocao {
  return {
    id: "p1",
    active: true,
    featured: true,
    badge: "PROMO DE HOJE",
    title: "Pizza G + Guaraná 1L grátis",
    description: "Uma escolha fácil.",
    buttonText: "Pedir essa promoção →",
    type: "combo_fixed_price",
    mainItems: [{ productId: "pizza:G", productName: "Pizza G", category: "pizza", sizeRequired: "G", quantity: 1, customerMustChooseFlavor: true }],
    freeItems: [{ productId: "bebida:Guarana 1L", productName: "Guarana 1L", category: "bebida", quantity: 1, priceImpact: 0 }],
    promotionalPrice: 49.9,
    includedText: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

describe("catalogoDoMenu", () => {
  it("gera produtos reais: pizzas por tamanho, lanches, bebidas e sucos", () => {
    const cat = catalogoDoMenu(menu);
    expect(cat.some((p) => p.productId === "pizza:G" && p.category === "pizza")).toBe(true);
    expect(cat.some((p) => p.productName === "X-Burguer" && p.category === "lanche")).toBe(true);
    expect(cat.some((p) => p.productName === "Guarana 1L" && p.category === "bebida")).toBe(true);
    expect(cat.some((p) => p.category === "macarronada")).toBe(true);
  });
});

describe("validarPromocao (regras de segurança)", () => {
  it("rejeita promoção ativa sem título", () => {
    const erros = validarPromocao(basePromo({ title: "" }), menu);
    expect(erros.join(" ")).toMatch(/Título/);
  });

  it("rejeita promoção ativa sem descrição", () => {
    const erros = validarPromocao(basePromo({ description: " " }), menu);
    expect(erros.join(" ")).toMatch(/Descrição/);
  });

  it("rejeita promoção sem item principal real do cardápio", () => {
    expect(validarPromocao(basePromo({ mainItems: [] }), menu).join(" ")).toMatch(/item principal/);
    const fake = basePromo({ mainItems: [{ productId: "lanche:Nao Existe", productName: "Nao Existe", category: "lanche", quantity: 1 }] });
    expect(validarPromocao(fake, menu).join(" ")).toMatch(/não existe no cardápio/);
  });

  it("rejeita item grátis inexistente", () => {
    const fake = basePromo({ freeItems: [{ productId: "bebida:Suco de Unicornio", productName: "Suco de Unicornio", category: "bebida", quantity: 1, priceImpact: 0 }] });
    expect(validarPromocao(fake, menu).join(" ")).toMatch(/Item grátis não existe/);
  });

  it("rejeita preço promocional negativo", () => {
    expect(validarPromocao(basePromo({ promotionalPrice: -5 }), menu).join(" ")).toMatch(/negativo/);
  });

  it("rejeita desconto maior que o valor original", () => {
    const promo = basePromo({ type: "product_discount", mainItems: [{ productId: "lanche:X-Burguer", productName: "X-Burguer", category: "lanche", quantity: 1 }], freeItems: [], originalPrice: 15, discountValue: 20, promotionalPrice: undefined });
    expect(validarPromocao(promo, menu).join(" ")).toMatch(/maior que o valor original/);
  });

  it("rejeita quantidade menor que 1", () => {
    const promo = basePromo({ mainItems: [{ productId: "pizza:G", productName: "Pizza G", category: "pizza", quantity: 0 }] });
    expect(validarPromocao(promo, menu).join(" ")).toMatch(/Quantidade inválida/);
  });

  it("rejeita brinde duplicado como item cobrado", () => {
    const promo = basePromo({
      mainItems: [{ productId: "bebida:Guarana 1L", productName: "Guarana 1L", category: "bebida", quantity: 1 }],
      freeItems: [{ productId: "bebida:Guarana 1L", productName: "Guarana 1L", category: "bebida", quantity: 1, priceImpact: 0 }],
    });
    expect(validarPromocao(promo, menu).join(" ")).toMatch(/cobrado e grátis/);
  });

  it("aceita promoção completa e válida", () => {
    expect(validarPromocao(basePromo(), menu)).toEqual([]);
  });
});

describe("precoFinalPromocao", () => {
  const cat = catalogoDoMenu(menu);

  it("combo com preço fixo usa o preço configurado", () => {
    expect(precoFinalPromocao(basePromo(), cat)).toBe(49.9);
  });

  it("produto com brinde cobra o preço real do item principal", () => {
    const promo = basePromo({ type: "buy_get_free", promotionalPrice: undefined });
    const pizzaG = cat.find((p) => p.productId === "pizza:G")!;
    expect(precoFinalPromocao(promo, cat)).toBe(pizzaG.price);
  });

  it("desconto em produto: original - desconto", () => {
    const promo = basePromo({ type: "product_discount", mainItems: [{ productId: "lanche:X-Burguer", productName: "X-Burguer", category: "lanche", quantity: 1 }], originalPrice: 18, discountValue: 3, promotionalPrice: undefined });
    expect(precoFinalPromocao(promo, cat)).toBe(15);
  });
});

describe("promocoesPublicas (GET público)", () => {
  it("retorna somente promoções ativas", () => {
    const ativa = basePromo({ id: "a" });
    const inativa = basePromo({ id: "b", active: false });
    const pub = promocoesPublicas([ativa, inativa], menu, []);
    expect(pub.map((p) => p.id)).toEqual(["a"]);
  });

  it("esconde promoção com produto fixo esgotado", () => {
    const promo = basePromo();
    expect(promocaoIndisponivel(promo, ["Guarana 1L"])).toBe(true);
    expect(promocoesPublicas([promo], menu, ["Guarana 1L"])).toEqual([]);
  });

  it("não deixa promoção inválida vazar para o público", () => {
    const semTitulo = basePromo({ title: "" });
    expect(promocoesPublicas([semTitulo], menu, [])).toEqual([]);
  });

  it("destaque (featured) vem primeiro", () => {
    const comum = basePromo({ id: "comum", featured: false });
    const destaque = basePromo({ id: "destaque", featured: true });
    const pub = promocoesPublicas([comum, destaque], menu, []);
    expect(pub[0].id).toBe("destaque");
  });
});
