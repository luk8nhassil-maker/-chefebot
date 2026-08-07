// Testes do catálogo oficial de pizzas — Fase 2.
import { describe, expect, it } from "vitest";
import { MENU } from "@/lib/menu";
import { buildPizzaCatalog } from "./pizzas";

describe("buildPizzaCatalog", () => {
  it("inclui todo sabor salgado como categoria tradicional e todo sabor doce como categoria doce", () => {
    const catalog = buildPizzaCatalog(MENU);
    for (const nome of MENU.saltyFlavors) {
      const flavor = catalog.flavors.find((f) => f.name === nome);
      expect(flavor).toBeDefined();
      expect(flavor?.category).toBe("tradicional");
    }
    for (const nome of MENU.sweetFlavors) {
      const flavor = catalog.flavors.find((f) => f.name === nome);
      expect(flavor).toBeDefined();
      expect(flavor?.category).toBe("doce");
    }
  });

  it("nenhum sabor é classificado como especial hoje (sem dado comercial oficial para essa distinção)", () => {
    const catalog = buildPizzaCatalog(MENU);
    expect(catalog.flavors.some((f) => f.category === "especial")).toBe(false);
  });

  it("todo sabor está disponível por padrão (sem lista de esgotados)", () => {
    const catalog = buildPizzaCatalog(MENU);
    expect(catalog.flavors.every((f) => f.available)).toBe(true);
    expect(catalog.borders.every((b) => b.available)).toBe(true);
  });

  it("marca sabor esgotado como indisponível, comparação insensível a acento/maiúscula", () => {
    const catalog = buildPizzaCatalog(MENU, ["CALABRESA"]);
    const calabresa = catalog.flavors.find((f) => f.name === "Calabresa");
    expect(calabresa?.available).toBe(false);
  });

  it("marca borda esgotada como indisponível", () => {
    const catalog = buildPizzaCatalog(MENU, ["catupiry"]);
    const catupiry = catalog.borders.find((b) => b.label === "Catupiry");
    expect(catupiry?.available).toBe(false);
  });

  it("traz os apelidos conhecidos do bot do WhatsApp para os sabores que têm (ex.: Quatro Queijos)", () => {
    const catalog = buildPizzaCatalog(MENU);
    const quatroQueijos = catalog.flavors.find((f) => f.name === "Quatro Queijos");
    expect(quatroQueijos?.aliases).toContain("4 queijos");
  });

  it("sabor sem apelido conhecido tem lista vazia (nunca undefined)", () => {
    const catalog = buildPizzaCatalog(MENU);
    const semApelido = catalog.flavors.find((f) => f.name === "Baiana");
    expect(semApelido?.aliases).toEqual([]);
  });

  it("IDs são estáveis entre duas construções (determinísticos por nome, não por posição/tempo)", () => {
    const a = buildPizzaCatalog(MENU);
    const b = buildPizzaCatalog(MENU);
    expect(a.flavors.map((f) => f.id)).toEqual(b.flavors.map((f) => f.id));
    expect(a.sizes.map((s) => s.id)).toEqual(b.sizes.map((s) => s.id));
  });

  it("tamanhos e bordas trazem preço em centavos inteiros, batendo com o Menu legado (reais * 100)", () => {
    const catalog = buildPizzaCatalog(MENU);
    for (const size of MENU.sizes) {
      const found = catalog.sizes.find((s) => s.code === size.code);
      expect(found?.priceCents).toBe(Math.round(size.price * 100));
    }
  });
});
