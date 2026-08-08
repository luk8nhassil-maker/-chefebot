// Testes de buildSimpleCatalog — correção da regra comercial do Calzone
// (Fase 6, 6ª rodada de hardening pós-auditoria).
//
// `flavorsMode` decide de onde vêm os sabores de um produto "single_flavor"
// (Calzone, Mini-Pizza): "pizza" (padrão/ausente) reaproveita a lista
// inteira da Pizza; "own" usa a lista própria apontada por `flavorsKey`.
// Configuração explícita por produto — nunca inferida por lista vazia nem
// pelo nome do produto.
import { describe, expect, it } from "vitest";
import { buildSimpleCatalog } from "./simpleProducts";
import { buildPizzaCatalog } from "./pizzas";
import { MENU } from "@/lib/menu";

// "Quatro Queijos" está em saltyFlavors mas de propósito NÃO está em
// calzoneFlavors nem miniPizzaFlavors no cardápio real — usado em todo este
// arquivo para provar a diferença entre os dois modos.
const SABOR_FORA_DAS_LISTAS_PROPRIAS = "Quatro Queijos";

function calzoneDe(menu: typeof MENU) {
  return menu.lanches.find((l) => l.name === "Calzone")!;
}

describe("buildSimpleCatalog — Calzone.flavorsMode (correção da regra comercial do Calzone)", () => {
  it("pré-condição do arquivo: 'Quatro Queijos' está fora de calzoneFlavors e miniPizzaFlavors no cardápio real", () => {
    expect(MENU.saltyFlavors).toContain(SABOR_FORA_DAS_LISTAS_PROPRIAS);
    expect(MENU.calzoneFlavors).not.toContain(SABOR_FORA_DAS_LISTAS_PROPRIAS);
    expect(MENU.miniPizzaFlavors).not.toContain(SABOR_FORA_DAS_LISTAS_PROPRIAS);
  });

  it("MENU real: Calzone está em modo 'pizza' (padrão aprovado) e aceita todos os sabores efetivos da Pizza, calzoneFlavors não restringe", () => {
    expect(calzoneDe(MENU).flavorsMode).toBe("pizza");

    const pizzaCatalog = buildPizzaCatalog(MENU);
    const simpleCatalog = buildSimpleCatalog(MENU);
    const calzone = simpleCatalog.lanches.find((l) => l.name === "Calzone")!;

    expect(calzone.strategy).toBe("single_flavor");
    expect(calzone.flavors?.length).toBe(pizzaCatalog.flavors.length);
    expect(calzone.flavors?.some((f) => f.name === SABOR_FORA_DAS_LISTAS_PROPRIAS)).toBe(true);
  });

  it("mesmo sabor reutiliza o MESMO flavorId entre Pizza e Calzone em modo 'pizza' — nenhum ID novo", () => {
    const pizzaCatalog = buildPizzaCatalog(MENU);
    const simpleCatalog = buildSimpleCatalog(MENU);
    const calzone = simpleCatalog.lanches.find((l) => l.name === "Calzone")!;

    for (const flavor of pizzaCatalog.flavors) {
      const mesmoSaborNoCalzone = calzone.flavors!.find((f) => f.name === flavor.name)!;
      expect(mesmoSaborNoCalzone.id).toBe(flavor.id);
    }
  });

  it("REGRESSÃO — cardápio antigo sem `flavorsMode` (campo ausente, ex.: config gravada antes desta correção): Calzone continua reaproveitando a Pizza — compatibilidade preservada", () => {
    const menuSemCampo = structuredClone(MENU);
    delete calzoneDe(menuSemCampo).flavorsMode;

    const simpleCatalog = buildSimpleCatalog(menuSemCampo);
    const calzone = simpleCatalog.lanches.find((l) => l.name === "Calzone")!;
    expect(calzone.flavors?.some((f) => f.name === SABOR_FORA_DAS_LISTAS_PROPRIAS)).toBe(true);
  });

  it("modo 'own': Calzone passa a aceitar SÓ os sabores de calzoneFlavors — esconder um sabor não afeta a Pizza", () => {
    const menuModoOwn = structuredClone(MENU);
    calzoneDe(menuModoOwn).flavorsMode = "own";

    const simpleCatalog = buildSimpleCatalog(menuModoOwn);
    const pizzaCatalog = buildPizzaCatalog(menuModoOwn);
    const calzone = simpleCatalog.lanches.find((l) => l.name === "Calzone")!;

    // "Quatro Queijos" some da lista do Calzone (lista permitida, modo own)...
    expect(calzone.flavors?.some((f) => f.name === SABOR_FORA_DAS_LISTAS_PROPRIAS)).toBe(false);
    // ...mas cada sabor que SOBROU continua com o mesmo flavorId oficial.
    const calabresaPizza = pizzaCatalog.flavors.find((f) => f.name === "Calabresa")!;
    const calabresaCalzone = calzone.flavors!.find((f) => f.name === "Calabresa")!;
    expect(calabresaCalzone.id).toBe(calabresaPizza.id);
    // ...e a Pizza continua 100% disponível/precificável para esse sabor, sem nenhum efeito.
    expect(pizzaCatalog.flavors.some((f) => f.name === SABOR_FORA_DAS_LISTAS_PROPRIAS)).toBe(true);
  });

  it("modo 'own' explícito com valor diferente de 'pizza'/'own' nunca acontece via TypeScript, mas em runtime qualquer valor que não seja 'own' cai no padrão 'pizza' (fail-open só para o modo, nunca para a validação de sabor em si)", () => {
    const menuValorInesperado = structuredClone(MENU);
    // Simula um dado corrompido/desconhecido persistido em Redis (fronteira
    // de storage, não confiável) — o `as` é só para o teste burlar o tipo.
    (calzoneDe(menuValorInesperado) as { flavorsMode?: string }).flavorsMode = "modo-desconhecido";

    const simpleCatalog = buildSimpleCatalog(menuValorInesperado);
    const calzone = simpleCatalog.lanches.find((l) => l.name === "Calzone")!;
    expect(calzone.flavors?.some((f) => f.name === SABOR_FORA_DAS_LISTAS_PROPRIAS)).toBe(true);
  });

  it("Mini-Pizza continua em modo 'own' — comportamento preservado, não alterado por esta correção (escopo é só o Calzone)", () => {
    expect(MENU.lanches.find((l) => l.name === "Mini-Pizza")!.flavorsMode).toBe("own");

    const simpleCatalog = buildSimpleCatalog(MENU);
    const miniPizza = simpleCatalog.lanches.find((l) => l.name === "Mini-Pizza")!;
    expect(miniPizza.flavors?.some((f) => f.name === SABOR_FORA_DAS_LISTAS_PROPRIAS)).toBe(false);
  });

  it("preço do Calzone não muda por sabor nem por modo", () => {
    const calzoneMenu = calzoneDe(MENU);
    const simpleCatalogPizza = buildSimpleCatalog(MENU);
    const calzonePizzaModo = simpleCatalogPizza.lanches.find((l) => l.name === "Calzone")!;
    expect(calzonePizzaModo.priceCents).toBe(Math.round(calzoneMenu.price * 100));

    const menuModoOwn = structuredClone(MENU);
    calzoneDe(menuModoOwn).flavorsMode = "own";
    const calzoneOwnModo = buildSimpleCatalog(menuModoOwn).lanches.find((l) => l.name === "Calzone")!;
    expect(calzoneOwnModo.priceCents).toBe(calzonePizzaModo.priceCents);
  });

  it("preço, id e strategy do Calzone são idênticos entre os dois modos — só a lista de sabores muda", () => {
    const menuModoOwn = structuredClone(MENU);
    calzoneDe(menuModoOwn).flavorsMode = "own";

    const calzonePizza = buildSimpleCatalog(MENU).lanches.find((l) => l.name === "Calzone")!;
    const calzoneOwn = buildSimpleCatalog(menuModoOwn).lanches.find((l) => l.name === "Calzone")!;

    expect(calzoneOwn.id).toBe(calzonePizza.id);
    expect(calzoneOwn.priceCents).toBe(calzonePizza.priceCents);
    expect(calzoneOwn.strategy).toBe(calzonePizza.strategy);
    expect(calzoneOwn.flavors!.length).toBeLessThan(calzonePizza.flavors!.length);
  });

  it("disponibilidade (esgotados) continua recalculada por sabor independentemente do modo", () => {
    const simpleCatalog = buildSimpleCatalog(MENU, ["Calabresa"]);
    const calzone = simpleCatalog.lanches.find((l) => l.name === "Calzone")!;
    const calabresa = calzone.flavors!.find((f) => f.name === "Calabresa")!;
    expect(calabresa.available).toBe(false);
    const quatroQueijos = calzone.flavors!.find((f) => f.name === SABOR_FORA_DAS_LISTAS_PROPRIAS)!;
    expect(quatroQueijos.available).toBe(true);
  });
});
