import { describe, test, expect } from "vitest";
import {
  listarProdutosManuais,
  buscarProdutos,
  normalizarTermo,
  montarEtapas,
  etapaSatisfeita,
  indiceEtapaPendente,
  montagemCompleta,
  motivoBloqueio,
  resumoEtapa,
  alternarSabor,
  alternarAdicional,
  construirItemManual,
  calcularTotalManual,
  adicionarAoCarrinho,
  alterarQuantidade,
  removerItem,
  pendenciasDoPedido,
  pendenciaIdentificadorTentativa,
  selecaoVazia,
  adaptarCardapioParaMontagem,
  resolverPizzaSelectionIds,
  type MenuManual,
  type ProdutoManual,
  type DadosPedidoManual,
} from "./montagemManual";
import type { ItemApp } from "./pedidoAppItens";
import { buildPizzaCatalog } from "./catalog/pizzas";
import { buildSimpleCatalog, todosOsProdutos } from "./catalog/simpleProducts";
import { MENU as MENU_OFICIAL } from "@/lib/menu";

// Catálogo oficial 2026 real — a montagem manual não tem mais catálogo
// próprio, então o fixture principal destes testes É o cardápio oficial de
// verdade (mesma fonte que o servidor usa).
const PIZZA_CATALOG = buildPizzaCatalog(MENU_OFICIAL);
const SIMPLE_CATALOG = buildSimpleCatalog(MENU_OFICIAL);

const MENU: MenuManual = {
  sizes: MENU_OFICIAL.sizes,
  saltyFlavors: MENU_OFICIAL.saltyFlavors,
  sweetFlavors: MENU_OFICIAL.sweetFlavors,
  lanches: MENU_OFICIAL.lanches,
  bebidas: MENU_OFICIAL.bebidas,
  sucos: MENU_OFICIAL.sucos,
  borders: MENU_OFICIAL.borders,
  neighborhoods: MENU_OFICIAL.neighborhoods,
  payments: MENU_OFICIAL.payments,
  esgotados: [],
  pizzaCatalog: PIZZA_CATALOG,
  pizzaCatalogPresente: true,
  catalog: SIMPLE_CATALOG,
  catalogPresente: true,
};

// Menu SEM o catálogo oficial (reproduz uma resposta de GET /api/cardapio
// anterior ao cardápio 2026, ou cache antigo) — usado nos testes de
// caminho 100% legado.
const MENU_LEGADO: MenuManual = {
  sizes: [
    { code: "P", label: "Pequena", price: 30 },
    { code: "G", label: "Grande", price: 50 },
  ],
  saltyFlavors: ["Quatro Queijos", "Frango com Requeijão"],
  sweetFlavors: ["Chocolate"],
  lanches: [
    { name: "Calzone", price: 40 },
    { name: "Mini-Pizza", price: 20 },
    { name: "Macarronada", price: 0, sizes: [{ code: "P", price: 25 }, { code: "G", price: 45 }] },
    { name: "Sanduíche Simples", price: 18 },
  ],
  bebidas: [{ name: "Refrigerante 2L", price: 12 }],
  sucos: [{ name: "Suco de Açaí", price: 10 }],
  borders: [{ label: "Requeijão", priceSmall: 5, priceLarge: 8 }],
  neighborhoods: [{ name: "Centro", fee: 7 }],
  payments: ["Pix", "Dinheiro", "Cartao"],
  esgotados: [],
};

// menu.catalog/pizzaCatalog já vêm com a disponibilidade calculada (como o
// servidor faz em GET /api/cardapio) — mudar `menu.esgotados` sozinho NÃO
// re-deriva os catálogos. Testes que verificam propagação de esgotado
// precisam reconstruir os dois catálogos com a lista aplicada, como o
// servidor faria.
function menuComEsgotados(nomes: string[]): MenuManual {
  return {
    ...MENU,
    esgotados: nomes,
    pizzaCatalog: buildPizzaCatalog(MENU_OFICIAL, nomes),
    catalog: buildSimpleCatalog(MENU_OFICIAL, nomes),
  };
}

function produtoPorId(id: string, menu: MenuManual = MENU): ProdutoManual {
  const p = listarProdutosManuais(menu).find((x) => x.id === id);
  if (!p) throw new Error(`produto de teste ausente: ${id}`);
  return p;
}

const DADOS_BASE: DadosPedidoManual = {
  cliente: "Fulano de Tal",
  telefone: "86999998888",
  tipoEntrega: "retirada",
  pagamento: "Pix",
};

describe("catálogo derivado — cardápio oficial 2026", () => {
  test("uma pizza por tamanho, incluindo MINI", () => {
    const pizzas = listarProdutosManuais(MENU).filter((p) => p.categoria === "pizza");
    expect(pizzas.map((p) => p.tamanhoPizza).sort()).toEqual(["F", "G", "M", "MINI", "P"].sort());
  });

  test("cobre todas as categorias oficiais quando o catálogo está presente", () => {
    const cats = new Set(listarProdutosManuais(MENU).map((p) => p.categoria));
    expect([...cats].sort()).toEqual(
      ["pizza", "calzone", "pastelForno", "lanches", "hamburgueres", "macarronada", "bebidas", "sucos", "vitaminas"].sort()
    );
  });

  test("Calzone tem 12 sabores no catálogo, listado como 1 produto que requer montagem", () => {
    const calzone = produtoPorId("calzone:calzone");
    expect(calzone.requerMontagem).toBe(true);
    expect(calzone.precoBase).toBeNull(); // preço vem do sabor (flavor_priced)
  });

  test("produto fixed (ex.: X-Burguer) não requer montagem e tem preço base direto", () => {
    const xBurguer = produtoPorId("hamburgueres:x-burguer");
    expect(xBurguer.requerMontagem).toBe(false);
    expect(xBurguer.precoBase).toBe(17);
  });

  test("Macarronada requer montagem (tamanho obrigatório)", () => {
    const macarronada = produtoPorId("macarronada:macarronada de carne");
    expect(macarronada.requerMontagem).toBe(true);
    expect(macarronada.precoBase).toBeNull();
  });

  test("propaga o esgotamento do cardápio oficial", () => {
    const produtos = listarProdutosManuais(menuComEsgotados(["X-Tudo"]));
    expect(produtos.find((p) => p.id === "hamburgueres:x-tudo")?.esgotado).toBe(true);
    expect(produtos.find((p) => p.id === "hamburgueres:x-burguer")?.esgotado).toBe(false);
  });

  test("cardápio ausente ou vazio não quebra", () => {
    expect(listarProdutosManuais(null)).toEqual([]);
    expect(listarProdutosManuais(undefined)).toEqual([]);
    expect(listarProdutosManuais({ ...MENU_LEGADO, sizes: [], lanches: [], bebidas: [], sucos: [] })).toEqual([]);
  });

  test("catálogo genuinamente ausente: cai no caminho legado (sizes + lanches/bebidas/sucos antigos)", () => {
    const cats = new Set(listarProdutosManuais(MENU_LEGADO).map((p) => p.categoria));
    expect([...cats].sort()).toEqual(["bebidas", "lanches", "pizza", "sucos"]);
  });

  test("dois registros com o MESMO nome na MESMA seção nunca geram o mesmo id (chave do React)", () => {
    const catalogoComDuplicata = {
      ...SIMPLE_CATALOG,
      bebidas: [...SIMPLE_CATALOG.bebidas, { id: "product-teste", name: "Teste", priceCents: 100, available: true, strategy: "fixed" as const }, { id: "product-teste-2", name: "Teste", priceCents: 100, available: true, strategy: "fixed" as const }],
    };
    const menu: MenuManual = { ...MENU, catalog: catalogoComDuplicata };
    const produtos = listarProdutosManuais(menu);
    const ids = produtos.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const testes = produtos.filter((p) => p.nome === "Teste");
    expect(testes).toHaveLength(2);
    expect(testes[0].id).toBe("bebidas:teste");
    expect(testes[1].id).toBe("bebidas:teste#2");
  });

  test("descarta entradas malformadas do cardápio em vez de lançar", () => {
    const menu = {
      ...MENU_LEGADO,
      sizes: [{ code: "G", label: "Grande", price: Number.NaN }],
      bebidas: [{ name: "", price: 5 }],
    } as MenuManual;
    expect(listarProdutosManuais(menu).some((p) => p.categoria === "pizza")).toBe(false);
    expect(listarProdutosManuais(menu).some((p) => p.categoria === "bebidas")).toBe(false);
  });
});

describe("busca", () => {
  const produtos = listarProdutosManuais(MENU);

  test("normalizarTermo remove acento, caixa e espaços", () => {
    expect(normalizarTermo("  BACON  ")).toBe("bacon");
    expect(normalizarTermo(null)).toBe("");
    expect(normalizarTermo(undefined)).toBe("");
  });

  test("ignora maiúsculas e minúsculas", () => {
    expect(buscarProdutos(produtos, "CALZONE")).toHaveLength(1);
    expect(buscarProdutos(produtos, "calzone")).toHaveLength(1);
  });

  test("busca atravessa TODAS as categorias, não só a ativa", () => {
    const achados = buscarProdutos(produtos, "a");
    const categorias = new Set(achados.map((p) => p.categoria));
    expect(categorias.size).toBeGreaterThan(1);
  });

  test("pode ser restringida a uma categoria", () => {
    const so = buscarProdutos(produtos, "", "bebidas");
    expect(so.every((p) => p.categoria === "bebidas")).toBe(true);
    expect(buscarProdutos(produtos, "calzone", "bebidas")).toEqual([]);
  });

  test("produto inexistente devolve lista vazia", () => {
    expect(buscarProdutos(produtos, "produto que nao existe xpto")).toEqual([]);
  });

  test("termo vazio devolve o conjunto inteiro", () => {
    expect(buscarProdutos(produtos, "")).toHaveLength(produtos.length);
  });

  test("busca também por ingrediente (não só nome) para produtos com composição oficial", () => {
    // X-Tudo tem "Catupiry" na composição mas não no nome — a busca por
    // ingrediente precisa achar o produto assim como acharia pelo nome.
    const achados = buscarProdutos(produtos, "catupiry", "hamburgueres");
    expect(achados.map((p) => p.nome)).toContain("X-Tudo");
  });

  test("busca por ingrediente normaliza acento (com/sem acento acham o mesmo conjunto)", () => {
    const comAcento = buscarProdutos(produtos, "hambúrguer", "hamburgueres");
    const semAcento = buscarProdutos(produtos, "hamburguer", "hamburgueres");
    expect(comAcento).toEqual(semAcento);
    expect(comAcento.length).toBeGreaterThan(0);
  });
});

describe("etapas obrigatórias — pizza", () => {
  test("F/G/M/P pedem sabores, borda e adicionais, nessa ordem", () => {
    const etapas = montarEtapas(produtoPorId("pizza:g"), MENU);
    expect(etapas.map((e) => e.tipo)).toEqual(["sabores", "borda", "adicionais"]);
  });

  test("MINI pede só sabores (nunca borda nem adicionais)", () => {
    const etapas = montarEtapas(produtoPorId("pizza:mini"), MENU);
    expect(etapas.map((e) => e.tipo)).toEqual(["sabores"]);
    expect(etapas[0].maxEscolhas).toBe(1); // MINI nunca é meio a meio na etapa guiada
  });

  test("etapa de sabores no tamanho MINI só lista sabores Tradicionais/Doces (Especiais não têm MINI)", () => {
    const etapaMini = montarEtapas(produtoPorId("pizza:mini"), MENU)[0];
    const nomesEspeciais = PIZZA_CATALOG.flavors.filter((f) => f.category === "especial").map((f) => f.name);
    for (const nome of nomesEspeciais) {
      expect(etapaMini.opcoes.some((o) => o.valor === nome)).toBe(false);
    }
    expect(etapaMini.opcoes.length).toBe(PIZZA_CATALOG.flavors.filter((f) => f.category !== "especial").length);
  });

  test("etapa de sabores no tamanho G lista todos os 45 sabores oficiais", () => {
    const etapaG = montarEtapas(produtoPorId("pizza:g"), MENU)[0];
    expect(etapaG.opcoes).toHaveLength(45);
  });

  test("a etapa de borda mostra o preço oficial da borda naquele tamanho", () => {
    const etapaBordaG = montarEtapas(produtoPorId("pizza:g"), MENU)[1];
    const catupiry = etapaBordaG.opcoes.find((o) => o.valor === "Catupiry Original")!;
    expect(catupiry.extra).toBe(15); // R$15 em todos os tamanhos, cardápio 2026
  });

  test("a etapa de adicionais lista os 8 adicionais oficiais e é sempre opcional", () => {
    const etapaAdicionais = montarEtapas(produtoPorId("pizza:g"), MENU)[2];
    expect(etapaAdicionais.opcoes).toHaveLength(8);
    expect(etapaSatisfeita(etapaAdicionais, selecaoVazia())).toBe(true);
  });

  test("sabor esgotado é marcado, não some da lista", () => {
    const menu = menuComEsgotados(["Calabresa"]);
    const sabores = montarEtapas(produtoPorId("pizza:g", menu), menu)[0];
    expect(sabores.opcoes.find((o) => o.valor === "Calabresa")?.esgotado).toBe(true);
    expect(sabores.opcoes).toHaveLength(45);
  });

  test("caminho legado (sem pizzaCatalog): sabores/borda com preço do Menu antigo", () => {
    const etapas = montarEtapas(produtoPorId("pizza:g", MENU_LEGADO), MENU_LEGADO);
    expect(etapas.map((e) => e.tipo)).toEqual(["sabores", "borda"]);
    expect(etapas[1].opcoes.find((o) => o.valor === "Requeijão")?.extra).toBe(8);
  });

  // Sincronização com o cardápio oficial (CARDAPIO_CHEFE.pdf): a etapa de
  // sabores carrega os ingredientes vindos do catálogo (nunca inventados
  // aqui) — protege a associação sabor ↔ composição usada pela UX de
  // ingredientes do pedido manual/Salão.
  test("cada opção de sabor carrega os ingredientes oficiais do catálogo (nunca inventados)", () => {
    const sabores = montarEtapas(produtoPorId("pizza:g"), MENU)[0];
    const calabresa = sabores.opcoes.find((o) => o.valor === "Calabresa")!;
    expect(calabresa.ingredientes).toBe("Molho, Mussarela, Linguiça Calabresa, Cebola e Orégano.");
    const chocolate = sabores.opcoes.find((o) => o.valor === "Chocolate")!;
    expect(chocolate.ingredientes).toBe("Chocolate Preto.");
    const carneSecaEspecial = sabores.opcoes.find((o) => o.valor === "Carne Seca Especial")!;
    expect(carneSecaEspecial.ingredientes).toBe("Molho, Mussarela, Carne Seca, Catupiry Original, Queijo Coalho, Geleia de Pimenta, Pimenta Biquinho e Orégano.");
  });

  test("caminho legado (sem pizzaCatalog) não inventa ingredientes — opção fica sem o campo", () => {
    const sabores = montarEtapas(produtoPorId("pizza:g", MENU_LEGADO), MENU_LEGADO)[0];
    for (const opcao of sabores.opcoes) expect(opcao.ingredientes).toBeUndefined();
  });
});

describe("etapas obrigatórias — demais categorias", () => {
  test("Calzone (flavor_priced): sabor único, extra = preço daquele sabor", () => {
    const etapa = montarEtapas(produtoPorId("calzone:calzone"), MENU)[0];
    expect(etapa.tipo).toBe("sabor_unico");
    const carneSeca = etapa.opcoes.find((o) => o.valor === "Carne Seca")!;
    const frango = etapa.opcoes.find((o) => o.valor === "Frango")!;
    expect(carneSeca.extra).toBe(40);
    expect(frango.extra).toBe(30);
  });

  test("Pastel de Forno (single_flavor): sabor único, sem extra (preço fixo do produto)", () => {
    const etapa = montarEtapas(produtoPorId("pastelForno:pastel de forno"), MENU)[0];
    expect(etapa.tipo).toBe("sabor_unico");
    expect(etapa.opcoes.every((o) => o.extra === undefined)).toBe(true);
    expect(etapa.opcoes).toHaveLength(12);
  });

  test("Pastel de Feira (dentro de Lanches): sabor único, 6 recheios", () => {
    const etapa = montarEtapas(produtoPorId("lanches:pastel de feira"), MENU)[0];
    expect(etapa.tipo).toBe("sabor_unico");
    expect(etapa.opcoes).toHaveLength(6);
  });

  test("Macarronada: tamanho obrigatório + adicional opcional (Bacon/Ovos)", () => {
    const etapas = montarEtapas(produtoPorId("macarronada:macarronada de carne"), MENU);
    expect(etapas.map((e) => e.tipo)).toEqual(["tamanho_item", "adicional_opcional"]);
    expect(etapas[0].opcoes.map((o) => o.valor).sort()).toEqual(["G", "M", "P", "PP"]);
    expect(etapas[1].opcoes.map((o) => o.valor)).toEqual(["", "Bacon", "Ovos"]);
    expect(etapaSatisfeita(etapas[1], selecaoVazia())).toBe(true); // opcional
  });

  test("suco pede leite", () => {
    expect(montarEtapas(produtoPorId("sucos:caja"), MENU).map((e) => e.tipo)).toEqual(["leite"]);
  });

  test("Vitamina de Banana (fixed) não tem etapa nenhuma", () => {
    expect(montarEtapas(produtoPorId("vitaminas:vitamina de banana"), MENU)).toEqual([]);
  });

  test("produto fixed (Hambúrguer/Bebida) não tem etapa nenhuma", () => {
    expect(montarEtapas(produtoPorId("hamburgueres:x-burguer"), MENU)).toEqual([]);
    expect(montarEtapas(produtoPorId("bebidas:cerveja long neck"), MENU)).toEqual([]);
  });

  test("Calzone/Pastel de Forno/Pastel de Feira: sabor único também carrega ingredientes oficiais", () => {
    const calzone = montarEtapas(produtoPorId("calzone:calzone"), MENU)[0];
    expect(calzone.opcoes.find((o) => o.valor === "Carne Seca")?.ingredientes).toBe("Molho, Mussarela, Carne seca, Requeijão Cremoso e Orégano.");
    const pastelForno = montarEtapas(produtoPorId("pastelForno:pastel de forno"), MENU)[0];
    expect(pastelForno.opcoes.find((o) => o.valor === "Baiana")?.ingredientes).toBe("Molho, Mussarela, Calabresa Processada, Azeite de Dedê, Orégano e Pimenta.");
    const pastelFeira = montarEtapas(produtoPorId("lanches:pastel de feira"), MENU)[0];
    expect(pastelFeira.opcoes.find((o) => o.valor === "Queijo")?.ingredientes).toBe("queijo coalho");
  });

  test("Hambúrguer (produto fixed, sem etapa) carrega ingredientes no próprio ProdutoManual — pedido manual consegue exibi-los sem abrir etapa", () => {
    const xTudo = produtoPorId("hamburgueres:x-tudo");
    expect(xTudo.ingredients).toContain("Bacon");
    expect(xTudo.ingredients).toContain("Catupiry");
  });

  test("Macarronada (etapa de tamanho, sem sabor): sem campo ingredientes na opção de tamanho — nada inventado", () => {
    const tamanho = montarEtapas(produtoPorId("macarronada:macarronada de carne"), MENU)[0];
    for (const opcao of tamanho.opcoes) expect(opcao.ingredientes).toBeUndefined();
  });
});

describe("avanço bloqueado e retorno de etapa", () => {
  const etapas = montarEtapas(produtoPorId("pizza:g"), MENU);

  test("sem sabor, a etapa pendente é a primeira", () => {
    const sel = selecaoVazia();
    expect(indiceEtapaPendente(etapas, sel)).toBe(0);
    expect(montagemCompleta(etapas, sel)).toBe(false);
    expect(motivoBloqueio(etapas[0], sel)).toBe("Escolha pelo menos 1 sabor para continuar.");
  });

  test("com sabor, a pendência passa para a borda", () => {
    const sel = { ...selecaoVazia(), sabores: ["Calabresa"] };
    expect(indiceEtapaPendente(etapas, sel)).toBe(1);
  });

  test("“sem borda” satisfaz a etapa; adicionais nunca bloqueia", () => {
    const semBorda = { sabores: ["Calabresa"], borda: null };
    expect(montagemCompleta(etapas, semBorda)).toBe(true);
  });

  test("motivoBloqueio de etapa inexistente é null", () => {
    expect(motivoBloqueio(undefined, selecaoVazia())).toBeNull();
  });

  test("Calzone exige exatamente 1 sabor — 2 não satisfaz", () => {
    const etapaCalzone = montarEtapas(produtoPorId("calzone:calzone"), MENU)[0];
    expect(etapaSatisfeita(etapaCalzone, { sabores: ["Calabresa"] })).toBe(true);
    expect(etapaSatisfeita(etapaCalzone, { sabores: ["Calabresa", "Frango"] })).toBe(false);
  });
});

describe("alternarSabor / alternarAdicional", () => {
  test("adiciona, remove e respeita o limite substituindo o último", () => {
    let sel = selecaoVazia();
    sel = alternarSabor(sel, "Calabresa", 2);
    expect(sel.sabores).toEqual(["Calabresa"]);
    sel = alternarSabor(sel, "Baiana", 2);
    expect(sel.sabores).toEqual(["Calabresa", "Baiana"]);
    sel = alternarSabor(sel, "Frango", 2);
    expect(sel.sabores).toEqual(["Calabresa", "Frango"]);
    sel = alternarSabor(sel, "Calabresa", 2);
    expect(sel.sabores).toEqual(["Frango"]);
  });

  test("alternarAdicional adiciona e remove livremente", () => {
    let sel = selecaoVazia();
    sel = alternarAdicional(sel, "Bacon");
    expect(sel.adicionais).toEqual(["Bacon"]);
    sel = alternarAdicional(sel, "Calabresa");
    expect(sel.adicionais).toEqual(["Bacon", "Calabresa"]);
    sel = alternarAdicional(sel, "Bacon");
    expect(sel.adicionais).toEqual(["Calabresa"]);
  });
});

describe("construção do item — cardápio oficial 2026 (reaproveita o motor do servidor)", () => {
  test("pizza de 1 sabor sem borda: mesmo preço/name/detail que o servidor produziria", () => {
    const item = construirItemManual(produtoPorId("pizza:g"), { sabores: ["Calabresa"], borda: null }, MENU);
    expect(item?.name).toBe("Pizza G");
    expect(item?.detail).toBe("Calabresa");
    expect(item?.price).toBe(45);
    expect(item?.pizzaSelection).toBeDefined();
  });

  test("pizza meio a meio com borda: preço = maior sabor + borda", () => {
    const item = construirItemManual(
      produtoPorId("pizza:g"),
      { sabores: ["Calabresa", "Á Moda da Casa"], borda: "Cheddar" },
      MENU
    );
    expect(item?.name).toBe("Pizza G (meio a meio)");
    expect(item?.price).toBe(60); // max(45, 50) + 10
  });

  test("pizza com adicionais: soma corretamente", () => {
    const item = construirItemManual(
      produtoPorId("pizza:g"),
      { sabores: ["Calabresa"], borda: null, adicionais: ["Bacon"] },
      MENU
    );
    expect(item?.price).toBe(55); // 45 + 10 (Bacon G)
  });

  test("MINI + Especial é recusado (servidor rejeitaria)", () => {
    const especial = PIZZA_CATALOG.flavors.find((f) => f.category === "especial")!.name;
    const item = construirItemManual(produtoPorId("pizza:mini"), { sabores: [especial], borda: null }, MENU);
    expect(item).toBeNull();
  });

  test("Calzone: preço vem do sabor escolhido, nunca fixo", () => {
    const carneSeca = construirItemManual(produtoPorId("calzone:calzone"), { sabores: ["Carne Seca"] }, MENU);
    const frango = construirItemManual(produtoPorId("calzone:calzone"), { sabores: ["Frango"] }, MENU);
    expect(carneSeca?.price).toBe(40);
    expect(frango?.price).toBe(30);
    expect(carneSeca?.detail).toBe("Sabor: Carne Seca");
  });

  test("Pastel de Forno: preço fixo R$25 independente do sabor", () => {
    const item = construirItemManual(produtoPorId("pastelForno:pastel de forno"), { sabores: ["Carne Seca"] }, MENU);
    expect(item?.price).toBe(25);
  });

  test("Macarronada com tamanho: preço do tamanho", () => {
    const item = construirItemManual(produtoPorId("macarronada:macarronada de carne"), { sabores: [], tamanhoItem: "G" }, MENU);
    expect(item?.detail).toBe("Tamanho G");
    expect(item?.price).toBe(50);
  });

  test("Macarronada com adicional opcional: soma R$10", () => {
    const item = construirItemManual(
      produtoPorId("macarronada:macarronada de carne"),
      { sabores: [], tamanhoItem: "G", adicionalOpcional: "Bacon" },
      MENU
    );
    expect(item?.price).toBe(60);
    expect(item?.detail).toBe("Tamanho G + Bacon");
  });

  test("suco com leite: acréscimo de R$1", () => {
    const sem = construirItemManual(produtoPorId("sucos:caja"), { sabores: [], leite: "sem" }, MENU);
    const com = construirItemManual(produtoPorId("sucos:caja"), { sabores: [], leite: "com" }, MENU);
    expect(sem?.price).toBe(8);
    expect(com?.price).toBe(9);
  });

  test("Vitamina de Banana: preço fixo, sem etapa nenhuma", () => {
    const item = construirItemManual(produtoPorId("vitaminas:vitamina de banana"), selecaoVazia(), MENU);
    expect(item?.price).toBe(10);
  });

  test("produto fixed entra direto", () => {
    const item = construirItemManual(produtoPorId("hamburgueres:x-burguer"), selecaoVazia(), MENU);
    expect(item?.name).toBe("X-Burguer");
    expect(item?.price).toBe(17);
  });

  test("montagem incompleta é recusada", () => {
    expect(construirItemManual(produtoPorId("pizza:g"), selecaoVazia(), MENU)).toBeNull();
    expect(construirItemManual(produtoPorId("sucos:caja"), selecaoVazia(), MENU)).toBeNull();
    expect(construirItemManual(produtoPorId("calzone:calzone"), selecaoVazia(), MENU)).toBeNull();
  });

  test("sabor fora do cardápio é recusado", () => {
    expect(construirItemManual(produtoPorId("pizza:g"), { sabores: ["Sabor Inexistente"], borda: null }, MENU)).toBeNull();
  });

  test("quantidade inválida é recusada", () => {
    const sel = { sabores: ["Calabresa"], borda: null };
    expect(construirItemManual(produtoPorId("pizza:g"), sel, MENU, 0)).toBeNull();
    expect(construirItemManual(produtoPorId("pizza:g"), sel, MENU, 1.5)).toBeNull();
  });

  test("quantidade maior que 1 é preservada", () => {
    const item = construirItemManual(produtoPorId("hamburgueres:x-burguer"), selecaoVazia(), MENU, 3);
    expect(item?.qty).toBe(3);
  });
});

describe("resolverPizzaSelectionIds", () => {
  test("1 sabor sem borda resolve sizeId + flavorIds", () => {
    const r = resolverPizzaSelectionIds(PIZZA_CATALOG, "G", ["Calabresa"], null);
    expect(r?.sizeId).toBe("size-g");
    expect(r?.flavorIds).toEqual(["flavor-calabresa"]);
  });

  test("com borda e adicionais resolve os três", () => {
    const r = resolverPizzaSelectionIds(PIZZA_CATALOG, "P", ["Calabresa"], "Cheddar", ["Bacon"]);
    expect(r?.borderId).toBe("border-cheddar");
    expect(r?.addOnIds).toEqual(["addon-bacon"]);
  });

  test("catálogo ausente devolve undefined", () => {
    expect(resolverPizzaSelectionIds(undefined, "G", ["Calabresa"], null)).toBeUndefined();
  });

  test("sabor fora do catálogo devolve undefined", () => {
    expect(resolverPizzaSelectionIds(PIZZA_CATALOG, "G", ["Sabor Inexistente"], null)).toBeUndefined();
  });

  test("adicional fora do catálogo devolve undefined", () => {
    expect(resolverPizzaSelectionIds(PIZZA_CATALOG, "G", ["Calabresa"], null, ["Adicional Fantasma"])).toBeUndefined();
  });
});

describe("fail-closed: catálogo PRESENTE mas a seleção não resolve", () => {
  test("pizzaCatalog presente porém vazio: pizza recusada, sem fallback legado", () => {
    // O produto "pizza:g" vem da listagem normal (catálogo cheio); só o
    // catálogo passado a construirItemManual é que fica vazio — reproduz o
    // cardápio ficando desincronizado entre o load da tela e o envio.
    const produto = produtoPorId("pizza:g");
    const menu: MenuManual = { ...MENU, pizzaCatalog: { sizes: [], flavors: [], borders: [], addOns: [] } };
    expect(construirItemManual(produto, { sabores: ["Calabresa"], borda: null }, menu)).toBeNull();
  });

  test("catalog presente porém vazio: calzone recusado, sem fallback legado", () => {
    const produto = produtoPorId("calzone:calzone");
    const menu: MenuManual = {
      ...MENU,
      catalog: { lanches: [], hamburgueres: [], calzone: [], pastelForno: [], macarronadas: [], sucos: [], vitaminas: [], bebidas: [] },
    };
    expect(construirItemManual(produto, { sabores: ["Calabresa"] }, menu)).toBeNull();
  });
});

describe("construirItemManual — caminho 100% legado (catálogo genuinamente ausente)", () => {
  test("pizza legada: preço do Menu antigo", () => {
    const item = construirItemManual(produtoPorId("pizza:g", MENU_LEGADO), { sabores: ["Chocolate"], borda: null }, MENU_LEGADO);
    expect(item).toEqual({ kind: "pizza", name: "Pizza G", detail: "Chocolate", price: 50, qty: 1 });
    expect(item && "pizzaSelection" in item).toBe(false);
  });

  test("calzone legado: Sabor: <nome>, preço fixo do Menu antigo", () => {
    const item = construirItemManual(produtoPorId("lanches:calzone", MENU_LEGADO), { sabores: ["Chocolate"] }, MENU_LEGADO);
    expect(item).toMatchObject({ name: "Calzone", detail: "Sabor: Chocolate", price: 40 });
  });

  test("macarronada legada: Tamanho <code>", () => {
    const item = construirItemManual(produtoPorId("lanches:macarronada", MENU_LEGADO), { sabores: [], tamanhoItem: "G" }, MENU_LEGADO);
    expect(item).toMatchObject({ name: "Macarronada", detail: "Tamanho G", price: 45 });
  });

  test("produto simples entra direto", () => {
    const item = construirItemManual(produtoPorId("bebidas:refrigerante 2l", MENU_LEGADO), selecaoVazia(), MENU_LEGADO);
    expect(item).toMatchObject({ name: "Refrigerante 2L", detail: "", price: 12 });
  });
});

describe("carrinho e total", () => {
  const xBurguer = construirItemManual(produtoPorId("hamburgueres:x-burguer"), selecaoVazia(), MENU) as ItemApp;
  const pizza = construirItemManual(produtoPorId("pizza:g"), { sabores: ["Calabresa"], borda: null }, MENU) as ItemApp;

  test("itens idênticos são agrupados somando a quantidade", () => {
    let carrinho = adicionarAoCarrinho([], xBurguer);
    carrinho = adicionarAoCarrinho(carrinho, xBurguer);
    expect(carrinho).toHaveLength(1);
    expect(carrinho[0].qty).toBe(2);
  });

  test("itens diferentes não são agrupados", () => {
    let carrinho = adicionarAoCarrinho([], xBurguer);
    carrinho = adicionarAoCarrinho(carrinho, pizza);
    expect(carrinho).toHaveLength(2);
  });

  test("total soma em centavos, reprecificando pelo catálogo estruturado (pizzaSelection/simpleSelection)", () => {
    const carrinho = [xBurguer, pizza];
    expect(calcularTotalManual(carrinho, MENU, 0)).toMatchObject({ subtotal: 62, taxa: 0, total: 62 });
    expect(calcularTotalManual(carrinho, MENU, 7.5)).toMatchObject({ subtotal: 62, taxa: 7.5, total: 69.5 });
  });

  test("item com seleção estruturada que não resolve mais (ex.: sabor removido do catálogo) conta como inválido", () => {
    const itemFantasma: ItemApp = {
      kind: "pizza",
      name: "Pizza G",
      detail: "Sabor Removido",
      price: 45,
      qty: 1,
      pizzaSelection: { sizeId: "size-g", flavorIds: ["flavor-sabor-removido"] },
    };
    const r = calcularTotalManual([itemFantasma], MENU, 0);
    expect(r.itensInvalidos).toBe(1);
    expect(r.subtotal).toBe(0);
  });

  test("o total ignora o preço gravado no item e reprecifica pelo catálogo", () => {
    const adulterado: ItemApp = { ...xBurguer, price: 0.01 };
    expect(calcularTotalManual([adulterado], MENU, 0).subtotal).toBe(17);
  });

  test("alterar quantidade e remover item", () => {
    const carrinho = [xBurguer, pizza];
    expect(alterarQuantidade(carrinho, 0, 2)[0].qty).toBe(3);
    expect(alterarQuantidade(carrinho, 0, -1)).toHaveLength(1);
    expect(removerItem(carrinho, 1)).toHaveLength(1);
  });

  test("carrinho vazio tem total zero", () => {
    expect(calcularTotalManual([], MENU, 0)).toMatchObject({ subtotal: 0, total: 0, itensInvalidos: 0 });
  });
});

describe("pendências antes de enviar", () => {
  const item = construirItemManual(produtoPorId("hamburgueres:x-burguer"), selecaoVazia(), MENU) as ItemApp;

  test("retirada com pagamento simples e um item está pronto para enviar", () => {
    expect(pendenciasDoPedido(DADOS_BASE, [item])).toEqual([]);
  });

  test("carrinho vazio bloqueia", () => {
    expect(pendenciasDoPedido(DADOS_BASE, [])).toContain("Adicione pelo menos um item ao pedido.");
  });

  test("nome e telefone são obrigatórios", () => {
    expect(pendenciasDoPedido({ ...DADOS_BASE, cliente: "  " }, [item])).toContain("Informe o nome do cliente.");
  });

  test("semTelefone dispensa o telefone, mas nunca dispensa o nome", () => {
    expect(pendenciasDoPedido({ ...DADOS_BASE, telefone: "", semTelefone: true }, [item])).toEqual([]);
  });

  test("delivery exige bairro, rua e número", () => {
    const faltas = pendenciasDoPedido({ ...DADOS_BASE, tipoEntrega: "delivery" }, [item]);
    expect(faltas).toContain("Selecione o bairro da entrega.");
  });

  test("pagamento em dinheiro exige troco", () => {
    expect(pendenciasDoPedido({ ...DADOS_BASE, pagamento: "Dinheiro" }, [item])).toContain(
      "Informe o troco (ou marque “sem troco”)."
    );
  });
});

describe("pendenciaIdentificadorTentativa", () => {
  test("com identificador, não há pendência", () => {
    expect(pendenciaIdentificadorTentativa(true)).toBeNull();
  });

  test("sem identificador, devolve mensagem clara", () => {
    const msg = pendenciaIdentificadorTentativa(false);
    expect(msg).not.toBeNull();
    expect(typeof msg).toBe("string");
  });
});

describe("adaptarCardapioParaMontagem — fronteira validada", () => {
  test("entrada que não é objeto falha de forma segura", () => {
    for (const v of [null, undefined, "cardapio", 42, [], true]) {
      expect(adaptarCardapioParaMontagem(v)).toBeNull();
    }
  });

  test("cardápio sem nenhum produto vendável é recusado", () => {
    expect(adaptarCardapioParaMontagem({})).toBeNull();
  });

  test("converte pizzaCatalog e catalog reais (cardápio 2026) de ponta a ponta", () => {
    const bruto = {
      sizes: MENU_OFICIAL.sizes,
      saltyFlavors: MENU_OFICIAL.saltyFlavors,
      sweetFlavors: MENU_OFICIAL.sweetFlavors,
      lanches: MENU_OFICIAL.lanches,
      bebidas: MENU_OFICIAL.bebidas,
      sucos: MENU_OFICIAL.sucos,
      borders: MENU_OFICIAL.borders,
      neighborhoods: MENU_OFICIAL.neighborhoods,
      payments: MENU_OFICIAL.payments,
      esgotados: [],
      pizzaCatalog: PIZZA_CATALOG,
      catalog: SIMPLE_CATALOG,
    };
    const menu = adaptarCardapioParaMontagem(bruto)!;
    expect(menu.pizzaCatalogPresente).toBe(true);
    expect(menu.pizzaCatalog?.flavors).toHaveLength(45);
    expect(menu.catalogPresente).toBe(true);
    expect(todosOsProdutos(menu.catalog!).length).toBe(todosOsProdutos(SIMPLE_CATALOG).length);

    const pizza = listarProdutosManuais(menu).find((p) => p.id === "pizza:g")!;
    const item = construirItemManual(pizza, { sabores: ["Calabresa"], borda: "Cheddar" }, menu);
    expect(item?.price).toBe(55);
  });

  test("pizzaCatalog/catalog ausentes: presente=false, undefined", () => {
    const menu = adaptarCardapioParaMontagem({ sizes: [{ code: "G", price: 50 }] })!;
    expect(menu.pizzaCatalog).toBeUndefined();
    expect(menu.pizzaCatalogPresente).toBeFalsy();
    expect(menu.catalog).toBeUndefined();
    expect(menu.catalogPresente).toBeFalsy();
  });

  test("pizzaCatalog presente porém malformado (sizes com priceCents em vez de fatias): sabor/tamanho inválido descartado", () => {
    const menu = adaptarCardapioParaMontagem({
      sizes: [{ code: "G", price: 50 }],
      pizzaCatalog: { sizes: [{ id: "size-g", code: "G", label: "Grande" }], flavors: [], borders: [] },
    })!;
    expect(menu.pizzaCatalogPresente).toBe(true);
    expect(menu.pizzaCatalog).toBeUndefined();
  });

  test("catalog presente porém totalmente vazio: presente=true, catalog undefined", () => {
    const menu = adaptarCardapioParaMontagem({
      sizes: [{ code: "G", price: 50 }],
      catalog: { lanches: [], hamburgueres: [], calzone: [], pastelForno: [], macarronadas: [], sucos: [], vitaminas: [], bebidas: [] },
    })!;
    expect(menu.catalogPresente).toBe(true);
    expect(menu.catalog).toBeUndefined();
  });
});
