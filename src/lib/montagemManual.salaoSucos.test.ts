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

describe("montagem manual — sucos exclusivos do Salão", () => {
  it("a categoria Sucos mostra somente os 11 novos sabores do Salão", () => {
    const menu = menuSalao();
    const sucos = listarProdutosManuais(menu).filter((p) => p.categoria === "sucos");

    expect(sucos).toHaveLength(11);
    expect(sucos.map((p) => p.nome)).toEqual([
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

  it("ao clicar em Maracujá, a etapa obrigatória oferece somente Copo ou Jarra", () => {
    const menu = menuSalao();
    const maracuja = listarProdutosManuais(menu).find((p) => p.catalogProductId === "salao-suco-maracuja");
    expect(maracuja).toBeDefined();

    const etapas = montarEtapas(maracuja!, menu);
    expect(etapas).toHaveLength(1);
    expect(etapas[0].tipo).toBe("tamanho_item");
    expect(etapas[0].opcoes.map((o) => o.valor)).toEqual(["Copo", "Jarra"]);
  });

  it("Copo constrói item estruturado de R$20 e Jarra de R$40", () => {
    const menu = menuSalao();
    const maracuja = listarProdutosManuais(menu).find((p) => p.catalogProductId === "salao-suco-maracuja")!;

    const copo = construirItemManual(maracuja, { ...selecaoVazia(), tamanhoItem: "Copo" }, menu, 1);
    expect(copo).toMatchObject({
      name: "Maracujá",
      detail: "Tamanho Copo",
      price: 20,
      simpleSelection: { productId: "salao-suco-maracuja", sizeId: "salao-suco-maracuja-copo" },
    });

    const jarra = construirItemManual(maracuja, { ...selecaoVazia(), tamanhoItem: "Jarra" }, menu, 1);
    expect(jarra).toMatchObject({
      name: "Maracujá",
      detail: "Tamanho Jarra",
      price: 40,
      simpleSelection: { productId: "salao-suco-maracuja", sizeId: "salao-suco-maracuja-jarra" },
    });
  });
});
