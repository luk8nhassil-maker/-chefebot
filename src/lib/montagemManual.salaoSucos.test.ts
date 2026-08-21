import { describe, expect, it } from "vitest";
import { MENU } from "@/lib/menu";
import { buildSimpleCatalog, ehSucoExclusivoSalao } from "@/lib/catalog/simpleProducts";
import {
  adaptarCardapioParaMontagem,
  construirItemManual,
  listarProdutosManuais,
  montarEtapas,
  selecaoVazia,
} from "./montagemManual";

function menuSalao() {
  const catalogInterno = buildSimpleCatalog(MENU, [], [], "salao");
  const catalog = { ...catalogInterno, sucos: catalogInterno.sucos.filter(ehSucoExclusivoSalao) };
  const adaptado = adaptarCardapioParaMontagem({ ...MENU, catalog });
  if (!adaptado) throw new Error("Cardápio do Salão não adaptou");
  return adaptado;
}

describe("montagem manual — Sucos do Salão", () => {
  it("ao entrar em Sucos mostra primeiro somente Copo ou Jarra", () => {
    const menu = menuSalao();
    const sucos = listarProdutosManuais(menu).filter((p) => p.categoria === "sucos");

    expect(sucos.map((p) => p.nome)).toEqual(["Copo", "Jarra"]);
  });

  it("Copo preserva exatamente os sabores oficiais existentes e depois pergunta com/sem leite", () => {
    const menu = menuSalao();
    const copo = listarProdutosManuais(menu).find((p) => p.nome === "Copo" && p.categoria === "sucos");
    expect(copo).toBeDefined();

    const etapas = montarEtapas(copo!, menu);
    expect(etapas.map((e) => e.tipo)).toEqual(["sabor_unico", "leite"]);
    expect(etapas[0].opcoes.map((o) => o.valor)).toEqual([
      "Cajá",
      "Cajú",
      "Acerola",
      "Goiaba",
      "Bacuri",
      "Cupuaçú",
      "Laranja",
      "Maracujá",
      "Graviola",
      "Abacaxi",
      "Abacaxi c/ Hortelã",
    ]);
  });

  it("Copo de Acerola mantém R$7 sem leite e R$8 com leite", () => {
    const menu = menuSalao();
    const copo = listarProdutosManuais(menu).find((p) => p.nome === "Copo" && p.categoria === "sucos")!;

    const semLeite = construirItemManual(copo, { ...selecaoVazia(), sabores: ["Acerola"], leite: "sem" }, menu);
    expect(semLeite).toMatchObject({
      name: "Acerola",
      detail: "sem leite",
      price: 7,
      simpleSelection: { productId: "suco-acerola", milk: "sem" },
    });

    const comLeite = construirItemManual(copo, { ...selecaoVazia(), sabores: ["Acerola"], leite: "com" }, menu);
    expect(comLeite).toMatchObject({
      name: "Acerola",
      detail: "com leite",
      price: 8,
      simpleSelection: { productId: "suco-acerola", milk: "com" },
    });
  });

  it("Jarra pergunta P/G antes do sabor e oferece somente os 11 sabores informados para Jarra", () => {
    const menu = menuSalao();
    const jarra = listarProdutosManuais(menu).find((p) => p.nome === "Jarra" && p.categoria === "sucos");
    expect(jarra).toBeDefined();

    const etapas = montarEtapas(jarra!, menu);
    expect(etapas.map((e) => e.tipo)).toEqual(["tamanho_item", "sabor_unico"]);
    expect(etapas[0].opcoes.map((o) => ({ valor: o.valor, label: o.label }))).toEqual([
      { valor: "P", label: "P - Pequena" },
      { valor: "G", label: "G - Grande" },
    ]);
    expect(etapas[1].opcoes.map((o) => o.valor)).toEqual([
      "Maracujá",
      "Acerola",
      "Goiaba",
      "Caju",
      "Cajá",
      "Bacuri",
      "Cupuaçu",
      "Graviola",
      "Abacaxi",
      "Abacate + hortelã",
      "Laranja",
    ]);
  });

  it("Jarra P/G usa exatamente todos os preços informados, sem alterar o Copo", () => {
    const menu = menuSalao();
    const jarra = listarProdutosManuais(menu).find((p) => p.nome === "Jarra" && p.categoria === "sucos")!;
    const precos: Record<string, { P: number; G: number }> = {
      "Maracujá": { P: 20, G: 40 },
      "Acerola": { P: 14, G: 28 },
      "Goiaba": { P: 14, G: 28 },
      "Caju": { P: 14, G: 28 },
      "Cajá": { P: 14, G: 32 },
      "Bacuri": { P: 20, G: 40 },
      "Cupuaçu": { P: 19, G: 38 },
      "Graviola": { P: 20, G: 40 },
      "Abacaxi": { P: 14, G: 28 },
      "Abacate + hortelã": { P: 20, G: 40 },
      "Laranja": { P: 20, G: 40 },
    };

    for (const [sabor, esperado] of Object.entries(precos)) {
      const pequena = construirItemManual(jarra, { ...selecaoVazia(), sabores: [sabor], tamanhoItem: "P" }, menu);
      expect(pequena?.price, `${sabor} P`).toBe(esperado.P);
      expect(pequena?.detail, `${sabor} P detail`).toBe("Jarra P - Pequena");

      const grande = construirItemManual(jarra, { ...selecaoVazia(), sabores: [sabor], tamanhoItem: "G" }, menu);
      expect(grande?.price, `${sabor} G`).toBe(esperado.G);
      expect(grande?.detail, `${sabor} G detail`).toBe("Jarra G - Grande");
    }
  });
});
