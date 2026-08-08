// Testes de officialUnitPrice — hardening do caminho LEGADO (name/detail)
// para respeitar flavorsMode de QUALQUER produto de 1 sabor só (Calzone,
// Mini-Pizza, ou qualquer outro que venha a existir) mesmo quando o cliente
// omite `simpleSelection` de propósito (BLOQUEIO 1, auditoria independente
// pós-6ª e 7ª rodadas de hardening da Fase 6).
//
// 6ª rodada: um payload legado sempre validava o sabor do Calzone contra
// TODA a lista de sabores da pizza, ignorando o modo "own" configurado —
// contornando buildSimpleCatalog inteiramente.
//
// 7ª rodada: a correção da 6ª rodada só disparava para `norm(found.name) ===
// "calzone"` — reintroduzindo acoplamento por nome e deixando QUALQUER outro
// produto single_flavor (Mini-Pizza, especificamente) cair no `return
// found.price` genérico sem nenhuma validação de sabor. Corrigido: a decisão
// de aplicar a validação agora é `found.hasFlavors && found.flavorsKey` — a
// MESMA configuração oficial que buildSimpleCatalog usa para
// `strategy === "single_flavor"` — nunca o nome do produto.
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

describe("officialUnitPrice — Mini-Pizza respeita flavorsMode mesmo no caminho legado (BLOQUEIO 1, 7ª rodada — generalização por configuração, não por nome)", () => {
  it("pré-condição do arquivo: Mini-Pizza está em flavorsMode 'own' no MENU real, com miniPizzaFlavors um subconjunto de saltyFlavors+sweetFlavors", () => {
    expect(MENU.lanches.find((l) => l.name === "Mini-Pizza")!.flavorsMode).toBe("own");
    expect(MENU.miniPizzaFlavors).not.toContain("Quatro Queijos");
    expect(MENU.saltyFlavors).toContain("Quatro Queijos");
  });

  it("REGRESSÃO — payload legado (sem simpleSelection) com sabor fora de miniPizzaFlavors é rejeitado, mesmo sendo um sabor de pizza válido", () => {
    const item: ItemApp = { kind: "simple", name: "Mini-Pizza", detail: "Sabor: Quatro Queijos", price: 0, qty: 1 };
    expect(officialUnitPrice(item, menuLegado)).toBeNull();
  });

  it("sabor permitido (dentro de miniPizzaFlavors) continua funcionando pelo caminho legado", () => {
    expect(MENU.miniPizzaFlavors).toContain("Calabresa");
    const item: ItemApp = { kind: "simple", name: "Mini-Pizza", detail: "Sabor: Calabresa", price: 0, qty: 1 };
    expect(officialUnitPrice(item, menuLegado)).toBe(17);
  });

  it("exatamente 1 sabor continua obrigatório para Mini-Pizza (formato duplo e ausência de sabor rejeitados)", () => {
    const itemDuplo: ItemApp = { kind: "simple", name: "Mini-Pizza", detail: "Sabor: Calabresa / Bacon", price: 0, qty: 1 };
    expect(officialUnitPrice(itemDuplo, menuLegado)).toBeNull();
    const itemSemSabor: ItemApp = { kind: "simple", name: "Mini-Pizza", price: 0, qty: 1 };
    expect(officialUnitPrice(itemSemSabor, menuLegado)).toBeNull();
  });
});

describe("officialUnitPrice — produto single_flavor renomeado mantém exatamente a mesma validação (BLOQUEIO 1, 7ª rodada)", () => {
  it("REGRESSÃO — renomear o Calzone para um nome sem qualquer relação com 'calzone' preserva a validação de sabor (modo own continua rejeitando fora da lista)", () => {
    const menuRenomeado = calzoneEmModoOwn();
    const calzone = menuRenomeado.lanches.find((l) => l.flavorsKey === "calzoneFlavors")!;
    calzone.name = "Combo Dobrado";

    const itemForaDaLista: ItemApp = { kind: "simple", name: "Combo Dobrado", detail: "Sabor: Quatro Queijos", price: 0, qty: 1 };
    expect(officialUnitPrice(itemForaDaLista, menuRenomeado)).toBeNull();

    const itemPermitido: ItemApp = { kind: "simple", name: "Combo Dobrado", detail: "Sabor: Calabresa", price: 0, qty: 1 };
    expect(officialUnitPrice(itemPermitido, menuRenomeado)).toBe(35);
  });

  it("REGRESSÃO — um produto batizado literalmente 'Calzone' mas SEM hasFlavors/flavorsKey oficiais nunca ganha a validação de sabor só pelo nome", () => {
    const menuFalsoCalzone = structuredClone(MENU);
    const calzoneReal = menuFalsoCalzone.lanches.find((l) => l.name === "Calzone")!;
    calzoneReal.name = "Produto Sem Nome Especial";
    const xBurguer = menuFalsoCalzone.lanches.find((l) => l.name === "X-Burguer")!;
    xBurguer.name = "Calzone";

    // hasFlavors:false/flavorsKey:"" (config real do X-Burguer) — nenhuma
    // validação de sabor se aplica, mesmo o nome sendo "Calzone".
    const item: ItemApp = { kind: "simple", name: "Calzone", detail: "Sabor: Quatro Queijos", price: 0, qty: 1 };
    expect(officialUnitPrice(item, menuFalsoCalzone as unknown as MenuPedidoApp)).toBe(15); // preço do X-Burguer, sabor ignorado
  });

  it("preço continua vindo 100% do servidor (found.price), nunca do price/detail que o cliente mandou", () => {
    const item: ItemApp = { kind: "simple", name: "Calzone", detail: "Sabor: Calabresa", price: 999.99, qty: 1 };
    expect(officialUnitPrice(item, menuLegado)).toBe(35);
  });
});
