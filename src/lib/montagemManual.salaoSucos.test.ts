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

  it("Jarra pergunta P/G, depois sabor e por último com/sem leite", () => {
    const menu = menuSalao();
    const jarra = listarProdutosManuais(menu).find((p) => p.nome === "Jarra" && p.categoria === "sucos");
    expect(jarra).toBeDefined();

    const etapas = montarEtapas(jarra!, menu);
    expect(etapas.map((e) => e.tipo)).toEqual(["tamanho_item", "sabor_unico", "leite"]);
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
    expect(etapas[2].opcoes.map((o) => ({ valor: o.valor, label: o.label }))).toEqual([
      { valor: "sem", label: "Sem leite" },
      { valor: "com", label: "Com leite" },
    ]);
    expect(etapas[2].ajuda).toBe("Com leite: P +R$ 2 · G +R$ 4.");
  });

  it("Jarra mostra o preço P/G de todos os sabores antes da escolha", () => {
    const menu = menuSalao();
    const jarra = listarProdutosManuais(menu).find((p) => p.nome === "Jarra" && p.categoria === "sucos")!;
    const etapaSabor = montarEtapas(jarra, menu)[1];
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

    expect(etapaSabor.ajuda).toContain("Os preços abaixo são sem leite");
    for (const [sabor, esperado] of Object.entries(precos)) {
      const opcao = etapaSabor.opcoes.find((o) => o.valor === sabor);
      expect(opcao?.label).toBe(`${sabor} · P R$ ${esperado.P.toFixed(2).replace(".", ",")} · G R$ ${esperado.G.toFixed(2).replace(".", ",")}`);
    }
  });

  it("Jarra não finaliza o produto sem escolher com ou sem leite", () => {
    const menu = menuSalao();
    const jarra = listarProdutosManuais(menu).find((p) => p.nome === "Jarra" && p.categoria === "sucos")!;

    const incompleta = construirItemManual(
      jarra,
      { ...selecaoVazia(), sabores: ["Acerola"], tamanhoItem: "P" },
      menu,
    );

    expect(incompleta).toBeNull();
  });

  it("Jarra P/G mantém todos os preços sem leite e soma R$2/R$4 com leite", () => {
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
      const pequenaSem = construirItemManual(
        jarra,
        { ...selecaoVazia(), sabores: [sabor], tamanhoItem: "P", leite: "sem" },
        menu,
      );
      expect(pequenaSem?.price, `${sabor} P sem leite`).toBe(esperado.P);
      expect(pequenaSem?.detail, `${sabor} P sem leite detail`).toBe("Jarra P - Pequena · sem leite");

      const pequenaCom = construirItemManual(
        jarra,
        { ...selecaoVazia(), sabores: [sabor], tamanhoItem: "P", leite: "com" },
        menu,
      );
      expect(pequenaCom?.price, `${sabor} P com leite`).toBe(esperado.P + 2);
      expect(pequenaCom?.detail, `${sabor} P com leite detail`).toBe("Jarra P - Pequena · com leite");

      const grandeSem = construirItemManual(
        jarra,
        { ...selecaoVazia(), sabores: [sabor], tamanhoItem: "G", leite: "sem" },
        menu,
      );
      expect(grandeSem?.price, `${sabor} G sem leite`).toBe(esperado.G);
      expect(grandeSem?.detail, `${sabor} G sem leite detail`).toBe("Jarra G - Grande · sem leite");

      const grandeCom = construirItemManual(
        jarra,
        { ...selecaoVazia(), sabores: [sabor], tamanhoItem: "G", leite: "com" },
        menu,
      );
      expect(grandeCom?.price, `${sabor} G com leite`).toBe(esperado.G + 4);
      expect(grandeCom?.detail, `${sabor} G com leite detail`).toBe("Jarra G - Grande · com leite");
    }
  });
});