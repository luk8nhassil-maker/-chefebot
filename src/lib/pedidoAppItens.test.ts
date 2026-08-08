// Testes de officialUnitPrice — hardening do caminho LEGADO (name/detail)
// para respeitar flavorsMode do Calzone mesmo quando o cliente omite
// `simpleSelection` de propósito (BLOQUEIO 1, auditoria independente
// pós-6ª rodada de hardening da Fase 6). Antes desta correção, um payload
// legado sempre validava o sabor do Calzone contra TODA a lista de sabores
// da pizza, ignorando o modo "own" configurado — contornando
// buildSimpleCatalog inteiramente.
import { describe, expect, it } from "vitest";
import { officialUnitPrice, ACRESCIMO_LEITE_CENTS, type ItemApp, type MenuPedidoApp } from "./pedidoAppItens";
import { MENU } from "@/lib/menu";

const menuLegado = MENU as unknown as MenuPedidoApp;

function calzoneEmModoOwn(): MenuPedidoApp {
  const menu = structuredClone(MENU);
  menu.lanches.find((l) => l.name === "Calzone")!.flavorsMode = "own";
  return menu as unknown as MenuPedidoApp;
}

describe("officialUnitPrice — Calzone respeita flavorsMode mesmo no caminho legado (BLOQUEIO 1)", () => {
  it("pré-condição do arquivo: 'Quatro Queijos' está fora de calzoneFlavors no cardápio real", () => {
    expect(MENU.calzoneFlavors).not.toContain("Quatro Queijos");
    expect(MENU.saltyFlavors).toContain("Quatro Queijos");
  });

  it("modo 'pizza' (padrão do MENU real): aceita qualquer sabor da pizza, mesmo fora de calzoneFlavors", () => {
    const item: ItemApp = { kind: "simple", name: "Calzone", detail: "Sabor: Quatro Queijos", price: 0, qty: 1 };
    expect(officialUnitPrice(item, menuLegado)).toBe(35);
  });

  it("REGRESSÃO — modo 'own': payload legado (sem simpleSelection) com sabor fora da lista própria é rejeitado, mesmo sendo um sabor de pizza válido", () => {
    const item: ItemApp = { kind: "simple", name: "Calzone", detail: "Sabor: Quatro Queijos", price: 0, qty: 1 };
    expect(officialUnitPrice(item, calzoneEmModoOwn())).toBeNull();
  });

  it("modo 'own': sabor permitido (dentro de calzoneFlavors) continua funcionando pelo caminho legado", () => {
    expect(MENU.calzoneFlavors).toContain("Calabresa");
    const item: ItemApp = { kind: "simple", name: "Calzone", detail: "Sabor: Calabresa", price: 0, qty: 1 };
    expect(officialUnitPrice(item, calzoneEmModoOwn())).toBe(35);
  });

  it("legado compatível: lanche sem flavorsKey/flavorsMode (config anterior à Fase 6) continua aceitando qualquer sabor da pizza", () => {
    const menuAntigo = structuredClone(MENU);
    const calzone = menuAntigo.lanches.find((l) => l.name === "Calzone")! as { flavorsKey?: string; flavorsMode?: "pizza" | "own" };
    delete calzone.flavorsKey;
    delete calzone.flavorsMode;
    const item: ItemApp = { kind: "simple", name: "Calzone", detail: "Sabor: Quatro Queijos", price: 0, qty: 1 };
    expect(officialUnitPrice(item, menuAntigo as unknown as MenuPedidoApp)).toBe(35);
  });

  it("exatamente 1 sabor continua obrigatório: formato 'Sabor: X / Y' é rejeitado, nos dois modos", () => {
    const itemDuplo: ItemApp = { kind: "simple", name: "Calzone", detail: "Sabor: Calabresa / Chocolate", price: 0, qty: 1 };
    expect(officialUnitPrice(itemDuplo, menuLegado)).toBeNull();
    expect(officialUnitPrice(itemDuplo, calzoneEmModoOwn())).toBeNull();
  });

  it("exatamente 1 sabor continua obrigatório: detail sem 'Sabor:' é rejeitado, nos dois modos", () => {
    const itemSemSabor: ItemApp = { kind: "simple", name: "Calzone", price: 0, qty: 1 };
    expect(officialUnitPrice(itemSemSabor, menuLegado)).toBeNull();
    expect(officialUnitPrice(itemSemSabor, calzoneEmModoOwn())).toBeNull();
  });

  it("Pizza não é afetada: precificação de pizza continua idêntica, sem nenhuma relação com flavorsMode do Calzone", () => {
    const itemPizza: ItemApp = { kind: "pizza", name: "Pizza G", detail: "Calabresa", price: 0, qty: 1 };
    expect(officialUnitPrice(itemPizza, menuLegado)).toBe(officialUnitPrice(itemPizza, calzoneEmModoOwn()));
    expect(officialUnitPrice(itemPizza, menuLegado)).toBe(50);
  });

  it("suco com leite: acréscimo oficial (fonte única) inalterado por esta correção", () => {
    const item: ItemApp = { kind: "simple", name: "Laranja", detail: "com leite", price: 0, qty: 1 };
    const semLeite = officialUnitPrice({ ...item, detail: "sem leite" }, menuLegado)!;
    const comLeite = officialUnitPrice(item, menuLegado)!;
    expect(Math.round((comLeite - semLeite) * 100)).toBe(ACRESCIMO_LEITE_CENTS);
  });
});
