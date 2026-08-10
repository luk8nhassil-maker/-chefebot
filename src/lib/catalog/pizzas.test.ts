// Testes do catálogo oficial de pizzas — cardápio 2026.
import { describe, expect, it } from "vitest";
import { MENU } from "@/lib/menu";
import { PIZZA_FLAVORS } from "./officialMenu2026";
import { buildPizzaCatalog } from "./pizzas";

describe("buildPizzaCatalog", () => {
  it("expõe os 45 sabores oficiais (18 tradicionais + 20 especiais + 7 doces)", () => {
    const catalog = buildPizzaCatalog(MENU);
    expect(catalog.flavors).toHaveLength(45);
    expect(catalog.flavors.filter((f) => f.category === "tradicional")).toHaveLength(18);
    expect(catalog.flavors.filter((f) => f.category === "especial")).toHaveLength(20);
    expect(catalog.flavors.filter((f) => f.category === "doce")).toHaveLength(7);
  });

  it("expõe os 5 tamanhos oficiais (F/G/M/P/MINI)", () => {
    const catalog = buildPizzaCatalog(MENU);
    expect(catalog.sizes.map((s) => s.code)).toEqual(["F", "G", "M", "P", "MINI"]);
  });

  it("sabores Especiais não têm preço MINI no catálogo", () => {
    const catalog = buildPizzaCatalog(MENU);
    for (const flavor of catalog.flavors.filter((f) => f.category === "especial")) {
      expect(flavor.pricesBySizeCode.MINI).toBeUndefined();
    }
  });

  it("sabores Tradicionais e Doces têm preço para os 5 tamanhos", () => {
    const catalog = buildPizzaCatalog(MENU);
    for (const flavor of catalog.flavors.filter((f) => f.category !== "especial")) {
      expect(Object.keys(flavor.pricesBySizeCode).sort()).toEqual(["F", "G", "M", "MINI", "P"]);
    }
  });

  it("expõe os 4 adicionais e as 4 bordas oficiais", () => {
    const catalog = buildPizzaCatalog(MENU);
    expect(catalog.addOns).toHaveLength(8);
    expect(catalog.borders).toHaveLength(4);
  });

  it("todo sabor/borda/adicional está disponível por padrão (sem lista de esgotados)", () => {
    const catalog = buildPizzaCatalog(MENU);
    expect(catalog.flavors.every((f) => f.available)).toBe(true);
    expect(catalog.borders.every((b) => b.available)).toBe(true);
    expect(catalog.addOns.every((a) => a.available)).toBe(true);
  });

  it("marca sabor esgotado como indisponível, comparação insensível a acento/maiúscula", () => {
    const catalog = buildPizzaCatalog(MENU, ["CALABRESA"]);
    const calabresa = catalog.flavors.find((f) => f.name === "Calabresa");
    expect(calabresa?.available).toBe(false);
  });

  it("aceita indisponibilidade estruturada por ID sem depender do nome", () => {
    const catalog = buildPizzaCatalog(MENU, [], ["flavor-peruana"]);
    expect(catalog.flavors.find((f) => f.name === "Peruana")?.available).toBe(false);
    expect(catalog.flavors.find((f) => f.name === "Calabresa")?.available).toBe(true);
  });

  it("marca borda esgotada como indisponível", () => {
    const catalog = buildPizzaCatalog(MENU, ["catupiry original"]);
    const catupiry = catalog.borders.find((b) => b.label === "Catupiry Original");
    expect(catupiry?.available).toBe(false);
  });

  it("marca adicional esgotado como indisponível", () => {
    const catalog = buildPizzaCatalog(MENU, ["bacon"]);
    const bacon = catalog.addOns.find((a) => a.label === "Bacon");
    expect(bacon?.available).toBe(false);
  });

  it("esgotar um sabor de pizza não afeta outro sabor nem borda", () => {
    // "Calabresa" é intencionalmente também o nome de um adicional — a
    // mesma entidade física (calabresa faltando na cozinha) fica
    // indisponível nos dois contextos, propositalmente (mesmo nome = mesmo
    // ingrediente). Isso não é o mesmo que "esconder do Calzone remove da
    // Pizza indevidamente" (curadoria de lista, não estoque compartilhado).
    const catalog = buildPizzaCatalog(MENU, ["Peruana"]);
    expect(catalog.flavors.find((f) => f.name === "Frango")?.available).toBe(true);
    expect(catalog.borders.every((b) => b.available)).toBe(true);
    expect(catalog.addOns.every((a) => a.available)).toBe(true);
  });

  it("esgotar 'Calabresa' (mesmo nome do sabor e do adicional) afeta os dois — mesmo ingrediente físico", () => {
    const catalog = buildPizzaCatalog(MENU, ["Calabresa"]);
    expect(catalog.flavors.find((f) => f.name === "Calabresa")?.available).toBe(false);
    expect(catalog.addOns.find((a) => a.label === "Calabresa")?.available).toBe(false);
    // Nenhum outro adicional/sabor é afetado.
    expect(catalog.addOns.find((a) => a.label === "Bacon")?.available).toBe(true);
    expect(catalog.flavors.find((f) => f.name === "Bacon")?.available).toBe(true);
  });

  it("IDs são estáveis entre duas construções (determinísticos por nome, não por posição/tempo)", () => {
    const a = buildPizzaCatalog(MENU);
    const b = buildPizzaCatalog(MENU);
    expect(a.flavors.map((f) => f.id)).toEqual(b.flavors.map((f) => f.id));
    expect(a.sizes.map((s) => s.id)).toEqual(b.sizes.map((s) => s.id));
  });

  it("ingredientes vêm junto de cada sabor (para exibição no cardápio)", () => {
    const catalog = buildPizzaCatalog(MENU);
    const calabresa = catalog.flavors.find((f) => f.name === "Calabresa");
    expect(calabresa?.ingredients).toContain("Linguiça Calabresa");
  });

  it("todo preço do catálogo bate com a fonte oficial (officialMenu2026)", () => {
    const catalog = buildPizzaCatalog(MENU);
    for (const oficial of PIZZA_FLAVORS) {
      const doCatalogo = catalog.flavors.find((f) => f.id === oficial.id);
      expect(doCatalogo?.pricesBySizeCode).toEqual(oficial.pricesBySizeCode);
    }
  });
});
