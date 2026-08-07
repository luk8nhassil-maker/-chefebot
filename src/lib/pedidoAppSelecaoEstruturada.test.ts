// Testes da ponte seleção estruturada -> ItemApp canônico — Fase 2.
import { describe, expect, it } from "vitest";
import { buildPizzaCatalog } from "@/lib/catalog/pizzas";
import { MENU } from "@/lib/menu";
import type { ItemApp } from "@/lib/pedidoAppItens";
import { resolverItemComSelecaoEstruturada, temSelecaoEstruturada } from "./pedidoAppSelecaoEstruturada";

const catalog = buildPizzaCatalog(MENU);

function flavorIdByName(name: string): string {
  const flavor = catalog.flavors.find((entry) => entry.name === name);
  if (!flavor) throw new Error(`Sabor ${name} não encontrado`);
  return flavor.id;
}

function sizeIdByCode(code: string): string {
  const size = catalog.sizes.find((entry) => entry.code === code);
  if (!size) throw new Error(`Tamanho ${code} não encontrado`);
  return size.id;
}

describe("temSelecaoEstruturada", () => {
  it("true quando pizzaSelection presente com objeto válido", () => {
    expect(temSelecaoEstruturada({ pizzaSelection: { sizeId: "x", flavorIds: ["y"] } })).toBe(true);
  });
  it("false quando a propriedade está totalmente ausente", () => {
    expect(temSelecaoEstruturada({})).toBe(false);
  });

  // Detecta PRESENÇA da propriedade, nunca truthiness do valor — um payload
  // adulterado com `pizzaSelection: null` (ou false/""/0/{}) ainda assim
  // declarou a intenção de usar o formato novo e precisa ser tratado (e
  // rejeitado) como tal, nunca reinterpretado como item legado.
  it.each([null, false, 0, "", {}, "texto", 42, []])("true mesmo quando pizzaSelection é %p (presente, mas com valor falsy/malformado)", (valor) => {
    expect(temSelecaoEstruturada({ pizzaSelection: valor })).toBe(true);
  });
});

describe("resolverItemComSelecaoEstruturada", () => {
  it("ignora name/detail enviados pelo cliente e reconstrói a partir do catálogo", () => {
    const itemAdulterado: ItemApp = {
      kind: "pizza",
      name: "Pizza F",
      detail: "algo que o cliente inventou · borda inventada",
      price: 0.01,
      qty: 1,
      pizzaSelection: { sizeId: sizeIdByCode("G"), flavorIds: [flavorIdByName("Calabresa")] },
    };
    const resultado = resolverItemComSelecaoEstruturada(itemAdulterado, catalog);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.item.name).toBe("Pizza G");
      expect(resultado.item.detail).toBe("Calabresa");
      expect(resultado.item.price).toBe(50); // preço oficial da Grande no Menu
    }
  });

  it("meio a meio: nome inclui '(meio a meio)' e detail lista os dois sabores", () => {
    const item: ItemApp = {
      kind: "pizza",
      name: "",
      price: 0,
      qty: 1,
      pizzaSelection: { sizeId: sizeIdByCode("G"), flavorIds: [flavorIdByName("Calabresa"), flavorIdByName("Baiana")] },
    };
    const resultado = resolverItemComSelecaoEstruturada(item, catalog);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.item.name).toBe("Pizza G (meio a meio)");
      expect(resultado.item.detail).toBe("Calabresa / Baiana");
    }
  });

  it("com borda: detail inclui '· borda <label>'", () => {
    const border = catalog.borders[0];
    const item: ItemApp = {
      kind: "pizza",
      name: "",
      price: 0,
      qty: 1,
      pizzaSelection: { sizeId: sizeIdByCode("G"), flavorIds: [flavorIdByName("Calabresa")], borderId: border.id },
    };
    const resultado = resolverItemComSelecaoEstruturada(item, catalog);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.item.detail).toBe(`Calabresa · borda ${border.label}`);
  });

  it("nunca tenta o caminho legado: falha definitiva quando a seleção é inválida, mesmo com name/detail válidos no payload", () => {
    const item: ItemApp = {
      kind: "pizza",
      name: "Pizza G", // válido no formato legado
      detail: "Calabresa", // válido no formato legado
      price: 0,
      qty: 1,
      pizzaSelection: { sizeId: "size-inexistente", flavorIds: [flavorIdByName("Calabresa")] },
    };
    const resultado = resolverItemComSelecaoEstruturada(item, catalog);
    expect(resultado).toEqual({ ok: false, error: "Tamanho não encontrado" });
  });

  it("rejeita kind diferente de pizza", () => {
    const item: ItemApp = {
      kind: "simple",
      name: "Refrigerante 2L",
      price: 0,
      qty: 1,
      pizzaSelection: { sizeId: sizeIdByCode("G"), flavorIds: [flavorIdByName("Calabresa")] },
    };
    const resultado = resolverItemComSelecaoEstruturada(item, catalog);
    expect(resultado).toEqual({ ok: false, error: "Seleção estruturada só é aceita para pizza" });
  });

  it("rejeita quantidade inválida", () => {
    const item: ItemApp = {
      kind: "pizza",
      name: "",
      price: 0,
      qty: 0,
      pizzaSelection: { sizeId: sizeIdByCode("G"), flavorIds: [flavorIdByName("Calabresa")] },
    };
    const resultado = resolverItemComSelecaoEstruturada(item, catalog);
    expect(resultado).toEqual({ ok: false, error: "Quantidade inválida" });
  });

  it("rejeita pizzaSelection: null explicitamente, sem lançar exceção", () => {
    const item = {
      kind: "pizza",
      name: "Pizza G",
      detail: "Calabresa",
      price: 50,
      qty: 1,
      pizzaSelection: null,
    } as unknown as ItemApp;
    const resultado = resolverItemComSelecaoEstruturada(item, catalog);
    expect(resultado).toEqual({ ok: false, error: "Seleção de pizza inválida" });
  });

  it.each([false, 0, "", "texto", 42, [], {}])("rejeita pizzaSelection malformado (%p), sem lançar exceção", (valor) => {
    const item = { kind: "pizza", name: "Pizza G", detail: "Calabresa", price: 50, qty: 1, pizzaSelection: valor } as unknown as ItemApp;
    const resultado = resolverItemComSelecaoEstruturada(item, catalog);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error).toBe("Seleção de pizza inválida");
  });
});
