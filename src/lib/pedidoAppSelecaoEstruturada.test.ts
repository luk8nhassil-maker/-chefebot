// Testes da ponte seleção estruturada -> ItemApp canônico — Fase 2 (pizza) e
// Fase 6 (Calzone, Mini-Pizza, Macarronada, sucos).
import { describe, expect, it } from "vitest";
import { buildPizzaCatalog } from "@/lib/catalog/pizzas";
import { buildCatalog } from "@/lib/catalog/adapter";
import { MENU } from "@/lib/menu";
import type { ItemApp } from "@/lib/pedidoAppItens";
import {
  resolverItemComSelecaoEstruturada,
  temSelecaoEstruturada,
  resolverItemComSelecaoSimplesEstruturada,
  temSelecaoSimplesEstruturada,
} from "./pedidoAppSelecaoEstruturada";

const catalog = buildPizzaCatalog(MENU);
const simpleCatalog = buildCatalog(MENU);

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

function productIdByName(name: string): string {
  const produto = [...simpleCatalog.lanches, ...simpleCatalog.bebidas, ...simpleCatalog.sucos].find((entry) => entry.name === name);
  if (!produto) throw new Error(`Produto ${name} não encontrado`);
  return produto.id;
}

function simpleFlavorIdByName(name: string): string {
  const flavor = [...simpleCatalog.saltyFlavors, ...simpleCatalog.sweetFlavors].find((entry) => entry.name === name);
  if (!flavor) throw new Error(`Sabor ${name} não encontrado`);
  return flavor.id;
}

function simpleSizeIdByCode(productName: string, code: string): string {
  const produto = simpleCatalog.lanches.find((entry) => entry.name === productName);
  const size = produto?.sizes?.find((entry) => entry.code === code);
  if (!size) throw new Error(`Tamanho ${code} não encontrado para ${productName}`);
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

describe("temSelecaoSimplesEstruturada (Fase 6)", () => {
  it("true quando simpleSelection presente com objeto válido", () => {
    expect(temSelecaoSimplesEstruturada({ simpleSelection: { productId: "x" } })).toBe(true);
  });
  it("false quando a propriedade está totalmente ausente", () => {
    expect(temSelecaoSimplesEstruturada({})).toBe(false);
  });
  it.each([null, false, 0, "", {}, "texto", 42, []])("true mesmo quando simpleSelection é %p (presente, mas com valor falsy/malformado)", (valor) => {
    expect(temSelecaoSimplesEstruturada({ simpleSelection: valor })).toBe(true);
  });
});

describe("resolverItemComSelecaoSimplesEstruturada (Fase 6)", () => {
  it("Calzone: ignora name/detail enviados pelo cliente e reconstrói a partir do catálogo", () => {
    const itemAdulterado: ItemApp = {
      kind: "simple",
      name: "Calzone",
      detail: "algo que o cliente inventou",
      price: 0.01,
      qty: 1,
      simpleSelection: { productId: productIdByName("Calzone"), flavorId: simpleFlavorIdByName("Calabresa") },
    };
    const resultado = resolverItemComSelecaoSimplesEstruturada(itemAdulterado, MENU);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.item.name).toBe("Calzone");
      expect(resultado.item.detail).toBe("Sabor: Calabresa");
      expect(resultado.item.price).toBe(35); // preço oficial do Calzone no Menu
    }
  });

  it("Mini-Pizza: exige e usa o sabor escolhido", () => {
    const item: ItemApp = {
      kind: "simple",
      name: "",
      price: 0,
      qty: 2,
      simpleSelection: { productId: productIdByName("Mini-Pizza"), flavorId: simpleFlavorIdByName("Baiana") },
    };
    const resultado = resolverItemComSelecaoSimplesEstruturada(item, MENU);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.item.name).toBe("Mini-Pizza");
      expect(resultado.item.detail).toBe("Sabor: Baiana");
      expect(resultado.item.price).toBe(17);
    }
  });

  it("Macarronada: exige e usa o tamanho escolhido", () => {
    const item: ItemApp = {
      kind: "simple",
      name: "",
      price: 0,
      qty: 1,
      simpleSelection: { productId: productIdByName("Macarronada de Carne"), sizeId: simpleSizeIdByCode("Macarronada de Carne", "G") },
    };
    const resultado = resolverItemComSelecaoSimplesEstruturada(item, MENU);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.item.name).toBe("Macarronada de Carne");
      expect(resultado.item.detail).toBe("Tamanho G");
      expect(resultado.item.price).toBe(50);
    }
  });

  it("suco com leite: acrescenta o adicional oficial", () => {
    const item: ItemApp = {
      kind: "simple",
      name: "",
      price: 0,
      qty: 1,
      simpleSelection: { productId: productIdByName("Laranja"), milk: "com" },
    };
    const resultado = resolverItemComSelecaoSimplesEstruturada(item, MENU);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.item.detail).toBe("com leite");
      expect(resultado.item.price).toBe(10); // 9 + 1 de adicional
    }
  });

  it("produto simples plano (sem sabor/tamanho): resolve só pelo productId", () => {
    const item: ItemApp = {
      kind: "simple",
      name: "",
      price: 0,
      qty: 1,
      simpleSelection: { productId: productIdByName("X-Burguer") },
    };
    const resultado = resolverItemComSelecaoSimplesEstruturada(item, MENU);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.item.name).toBe("X-Burguer");
      expect(resultado.item.price).toBe(15);
    }
  });

  it("nunca tenta o caminho legado: falha definitiva quando a seleção é inválida, mesmo com name/detail válidos no payload", () => {
    const item: ItemApp = {
      kind: "simple",
      name: "Calzone", // válido no formato legado
      detail: "Sabor: Calabresa", // válido no formato legado
      price: 0,
      qty: 1,
      simpleSelection: { productId: "product-inexistente" },
    };
    const resultado = resolverItemComSelecaoSimplesEstruturada(item, MENU);
    expect(resultado).toEqual({ ok: false, error: "Produto não encontrado" });
  });

  it("rejeita kind diferente de simple", () => {
    const item: ItemApp = {
      kind: "pizza",
      name: "Pizza G",
      price: 0,
      qty: 1,
      simpleSelection: { productId: productIdByName("Calzone"), flavorId: simpleFlavorIdByName("Calabresa") },
    };
    const resultado = resolverItemComSelecaoSimplesEstruturada(item, MENU);
    expect(resultado).toEqual({ ok: false, error: "Seleção estruturada só é aceita para produto simples" });
  });

  it("rejeita quantidade inválida", () => {
    const item: ItemApp = {
      kind: "simple",
      name: "",
      price: 0,
      qty: 0,
      simpleSelection: { productId: productIdByName("X-Burguer") },
    };
    const resultado = resolverItemComSelecaoSimplesEstruturada(item, MENU);
    expect(resultado).toEqual({ ok: false, error: "Quantidade inválida" });
  });

  it("rejeita Calzone sem flavorId (sabor obrigatório)", () => {
    const item: ItemApp = {
      kind: "simple",
      name: "",
      price: 0,
      qty: 1,
      simpleSelection: { productId: productIdByName("Calzone") },
    };
    const resultado = resolverItemComSelecaoSimplesEstruturada(item, MENU);
    expect(resultado).toEqual({ ok: false, error: "Sabor não encontrado" });
  });

  it("rejeita Macarronada sem sizeId (tamanho obrigatório)", () => {
    const item: ItemApp = {
      kind: "simple",
      name: "",
      price: 0,
      qty: 1,
      simpleSelection: { productId: productIdByName("Macarronada de Carne") },
    };
    const resultado = resolverItemComSelecaoSimplesEstruturada(item, MENU);
    expect(resultado).toEqual({ ok: false, error: "Tamanho não encontrado" });
  });

  it("rejeita simpleSelection: null explicitamente, sem lançar exceção", () => {
    const item = {
      kind: "simple",
      name: "Calzone",
      detail: "Sabor: Calabresa",
      price: 35,
      qty: 1,
      simpleSelection: null,
    } as unknown as ItemApp;
    const resultado = resolverItemComSelecaoSimplesEstruturada(item, MENU);
    expect(resultado).toEqual({ ok: false, error: "Seleção de produto inválida" });
  });

  it.each([false, 0, "", "texto", 42, [], {}])("rejeita simpleSelection malformado (%p), sem lançar exceção", (valor) => {
    const item = { kind: "simple", name: "Calzone", detail: "Sabor: Calabresa", price: 35, qty: 1, simpleSelection: valor } as unknown as ItemApp;
    const resultado = resolverItemComSelecaoSimplesEstruturada(item, MENU);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error).toBe("Seleção de produto inválida");
  });

  it("rejeita milk fora de com/sem", () => {
    const item: ItemApp = {
      kind: "simple",
      name: "",
      price: 0,
      qty: 1,
      simpleSelection: { productId: productIdByName("Laranja"), milk: "banana" as unknown as "com" },
    };
    const resultado = resolverItemComSelecaoSimplesEstruturada(item, MENU);
    expect(resultado).toEqual({ ok: false, error: "Seleção de produto inválida" });
  });
});
