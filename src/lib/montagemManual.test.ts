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
import { officialUnitPrice, type ItemApp } from "./pedidoAppItens";
import type { PizzaCatalog } from "./catalog/pizzas";
import { buildSimpleCatalog, type SimpleCatalog } from "./catalog/simpleProducts";
import { MENU as MENU_OFICIAL } from "@/lib/menu";

// Cardápio de teste: nomes e valores inventados só para o teste, nunca
// copiados de nenhum estabelecimento. O que importa aqui é a FORMA do
// cardápio, não o seu conteúdo comercial.
const MENU: MenuManual = {
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

// Catálogo oficial de pizzas (Fase 2) correspondente ao MENU de teste acima —
// mesmos nomes/códigos, IDs estáveis inventados só para o teste.
const PIZZA_CATALOG: PizzaCatalog = {
  sizes: [
    { id: "size-p", code: "P", label: "Pequena", priceCents: 3000 },
    { id: "size-g", code: "G", label: "Grande", priceCents: 5000 },
  ],
  flavors: [
    { id: "flavor-quatro-queijos", name: "Quatro Queijos", category: "tradicional", aliases: [], available: true },
    { id: "flavor-frango-requeijao", name: "Frango com Requeijão", category: "tradicional", aliases: [], available: true },
    { id: "flavor-chocolate", name: "Chocolate", category: "doce", aliases: [], available: false },
  ],
  borders: [
    { id: "border-requeijao", label: "Requeijão", priceSmallCents: 500, priceLargeCents: 800, available: true },
  ],
};

const MENU_COM_CATALOGO: MenuManual = { ...MENU, pizzaCatalog: PIZZA_CATALOG, pizzaCatalogPresente: true };

// Catálogo oficial dos demais produtos configuráveis (Fase 6) correspondente
// ao MENU de teste acima — mesmos nomes/códigos, IDs estáveis inventados só
// para o teste. Cada produto declara sua própria `strategy` (Fase 6,
// hardening pós-auditoria 3ª rodada) e, quando `strategy === "single_flavor"`
// (Calzone, Mini-Pizza), os sabores permitidos DAQUELE produto em
// `flavors` — reutilizando o MESMO flavorId oficial (`flavor-*`) para o
// mesmo sabor em ambos, igual ao catálogo real, nunca um ID novo por
// produto.
const SIMPLE_CATALOG: SimpleCatalog = {
  lanches: [
    {
      id: "product-calzone",
      name: "Calzone",
      priceCents: 4000,
      available: true,
      strategy: "single_flavor",
      flavors: [
        { id: "flavor-quatro-queijos", name: "Quatro Queijos", available: true },
        { id: "flavor-frango-com-requeijao", name: "Frango com Requeijão", available: true },
        { id: "flavor-chocolate", name: "Chocolate", available: true },
      ],
    },
    {
      id: "product-mini-pizza",
      name: "Mini-Pizza",
      priceCents: 2000,
      available: true,
      strategy: "single_flavor",
      flavors: [
        { id: "flavor-quatro-queijos", name: "Quatro Queijos", available: true },
        { id: "flavor-chocolate", name: "Chocolate", available: true },
      ],
    },
    {
      id: "product-macarronada",
      name: "Macarronada",
      priceCents: 0,
      available: true,
      strategy: "size",
      sizes: [
        { id: "size-p", code: "P", priceCents: 2500 },
        { id: "size-g", code: "G", priceCents: 4500 },
      ],
    },
    { id: "product-sanduiche-simples", name: "Sanduíche Simples", priceCents: 1800, available: true, strategy: "fixed" },
  ],
  bebidas: [{ id: "product-refrigerante-2l", name: "Refrigerante 2L", priceCents: 1200, available: true, strategy: "fixed" }],
  sucos: [{ id: "product-suco-de-acai", name: "Suco de Açaí", priceCents: 1000, available: true, strategy: "milk" }],
};

const MENU_COM_CATALOGO_SIMPLES: MenuManual = { ...MENU, catalog: SIMPLE_CATALOG, catalogPresente: true };

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

describe("catálogo derivado", () => {
  test("uma pizza por tamanho, usando o rótulo do cardápio", () => {
    const pizzas = listarProdutosManuais(MENU).filter((p) => p.categoria === "pizza");
    expect(pizzas.map((p) => p.nome)).toEqual(["Pizza Pequena", "Pizza Grande"]);
    expect(pizzas.map((p) => p.tamanhoPizza)).toEqual(["P", "G"]);
  });

  test("cobre todas as categorias do cardápio", () => {
    const cats = new Set(listarProdutosManuais(MENU).map((p) => p.categoria));
    expect([...cats].sort()).toEqual(["bebidas", "lanches", "pizza", "sucos"]);
  });

  test("marca quem exige montagem guiada e quem entra direto", () => {
    const porId = Object.fromEntries(listarProdutosManuais(MENU).map((p) => [p.id, p]));
    expect(porId["pizza:g"].requerMontagem).toBe(true);
    expect(porId["lanches:calzone"].requerMontagem).toBe(true);
    expect(porId["lanches:macarronada"].requerMontagem).toBe(true);
    expect(porId["sucos:suco de acai"].requerMontagem).toBe(true);
    expect(porId["lanches:sanduiche simples"].requerMontagem).toBe(false);
    expect(porId["bebidas:refrigerante 2l"].requerMontagem).toBe(false);
  });

  test("propaga o esgotamento do cardápio oficial", () => {
    const produtos = listarProdutosManuais({ ...MENU, esgotados: ["Refrigerante 2L"] });
    expect(produtos.find((p) => p.id === "bebidas:refrigerante 2l")?.esgotado).toBe(true);
    expect(produtos.find((p) => p.id === "lanches:calzone")?.esgotado).toBe(false);
  });

  test("cardápio ausente ou vazio não quebra", () => {
    expect(listarProdutosManuais(null)).toEqual([]);
    expect(listarProdutosManuais(undefined)).toEqual([]);
    expect(listarProdutosManuais({ ...MENU, sizes: [], lanches: [], bebidas: [], sucos: [] })).toEqual([]);
  });

  test("dois registros com o MESMO nome na MESMA seção nunca geram o mesmo id (chave do React)", () => {
    // Reproduz o cardápio real: dois itens de bebida cadastrados com o
    // mesmo nome ("Teste"/"Teste"). Sem desambiguação, os dois ganhariam o
    // MESMO `id` — e portanto a MESMA `key` do React na lista renderizada,
    // o que o próprio React documenta como "não suportado" e que, na
    // prática, corrompe a reconciliação da lista inteira entre categorias
    // (comprovado: produtos de Bebidas vazavam para Pizzas/Lanches/Sucos
    // depois de trocar de categoria repetidas vezes).
    const menu: MenuManual = {
      ...MENU,
      bebidas: [...MENU.bebidas, { name: "Teste", price: 1 }, { name: "Teste", price: 1 }],
    };
    const produtos = listarProdutosManuais(menu);
    const ids = produtos.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);

    const testes = produtos.filter((p) => p.nome === "Teste");
    expect(testes).toHaveLength(2);
    expect(testes[0].id).toBe("bebidas:teste");
    expect(testes[1].id).toBe("bebidas:teste#2");
    // A primeira ocorrência preserva o id de sempre — catálogo sem
    // duplicatas (o caso comum) continua com os mesmos ids de antes.
    expect(produtos.find((p) => p.id === "bebidas:refrigerante 2l")).toBeDefined();
  });

  test("três ou mais registros duplicados continuam com ids únicos e sequenciais", () => {
    const menu: MenuManual = {
      ...MENU,
      sucos: [...MENU.sucos, { name: "Duplicado", price: 5 }, { name: "Duplicado", price: 5 }, { name: "Duplicado", price: 5 }],
    };
    const ids = listarProdutosManuais(menu)
      .filter((p) => p.nome === "Duplicado")
      .map((p) => p.id);
    expect(ids).toEqual(["sucos:duplicado", "sucos:duplicado#2", "sucos:duplicado#3"]);
  });

  test("descarta entradas malformadas do cardápio em vez de lançar", () => {
    const menu = {
      ...MENU,
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
    expect(normalizarTermo("  AÇAÍ  ")).toBe("acai");
    expect(normalizarTermo(null)).toBe("");
    expect(normalizarTermo(undefined)).toBe("");
  });

  test("encontra COM acento digitando SEM acento", () => {
    expect(buscarProdutos(produtos, "acai").map((p) => p.nome)).toEqual(["Suco de Açaí"]);
    expect(buscarProdutos(produtos, "sanduiche").map((p) => p.nome)).toEqual(["Sanduíche Simples"]);
  });

  test("encontra SEM acento digitando COM acento", () => {
    expect(buscarProdutos(produtos, "AÇAÍ").map((p) => p.nome)).toEqual(["Suco de Açaí"]);
  });

  test("ignora maiúsculas e minúsculas", () => {
    expect(buscarProdutos(produtos, "CALZONE")).toHaveLength(1);
    expect(buscarProdutos(produtos, "calzone")).toHaveLength(1);
    expect(buscarProdutos(produtos, "CaLzOnE")).toHaveLength(1);
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

  test("busca pelo rótulo da categoria também funciona", () => {
    expect(buscarProdutos(produtos, "pizzas").every((p) => p.categoria === "pizza")).toBe(true);
  });

  test("produto inexistente devolve lista vazia (estado sem resultado)", () => {
    expect(buscarProdutos(produtos, "produto que nao existe xpto")).toEqual([]);
  });

  test("termo vazio devolve o conjunto inteiro", () => {
    expect(buscarProdutos(produtos, "")).toHaveLength(produtos.length);
    expect(buscarProdutos(produtos, "   ")).toHaveLength(produtos.length);
  });

  test("o resultado continua correto ao trocar de categoria (busca é ortogonal)", () => {
    expect(buscarProdutos(produtos, "grande", "pizza").map((p) => p.nome)).toEqual(["Pizza Grande"]);
    expect(buscarProdutos(produtos, "grande", "sucos")).toEqual([]);
    expect(buscarProdutos(produtos, "grande", "todas").map((p) => p.nome)).toEqual(["Pizza Grande"]);
  });

  test("não devolve a mesma referência mutável do catálogo", () => {
    const r = buscarProdutos(produtos, "");
    expect(r).not.toBe(produtos);
  });
});

describe("etapas obrigatórias", () => {
  test("pizza pede sabores e depois borda, nessa ordem", () => {
    const etapas = montarEtapas(produtoPorId("pizza:g"), MENU);
    expect(etapas.map((e) => e.tipo)).toEqual(["sabores", "borda"]);
  });

  test("a borda de pizza grande custa o preço de tamanho grande", () => {
    const bordaG = montarEtapas(produtoPorId("pizza:g"), MENU)[1];
    const bordaP = montarEtapas(produtoPorId("pizza:p"), MENU)[1];
    expect(bordaG.opcoes.find((o) => o.valor === "Requeijão")?.extra).toBe(8);
    expect(bordaP.opcoes.find((o) => o.valor === "Requeijão")?.extra).toBe(5);
  });

  test("calzone pede 1 sabor só; suco pede leite; macarronada pede tamanho", () => {
    expect(montarEtapas(produtoPorId("lanches:calzone"), MENU).map((e) => e.tipo)).toEqual(["sabor_unico"]);
    expect(montarEtapas(produtoPorId("sucos:suco de acai"), MENU).map((e) => e.tipo)).toEqual(["leite"]);
    expect(montarEtapas(produtoPorId("lanches:macarronada"), MENU).map((e) => e.tipo)).toEqual(["tamanho_item"]);
  });

  test("produto simples não tem etapa nenhuma", () => {
    expect(montarEtapas(produtoPorId("bebidas:refrigerante 2l"), MENU)).toEqual([]);
    expect(montarEtapas(produtoPorId("lanches:sanduiche simples"), MENU)).toEqual([]);
  });

  test("sabor esgotado é marcado, não some da lista", () => {
    const menu = { ...MENU, esgotados: ["Chocolate"] };
    const sabores = montarEtapas(produtoPorId("pizza:g", menu), menu)[0];
    expect(sabores.opcoes.find((o) => o.valor === "Chocolate")?.esgotado).toBe(true);
    expect(sabores.opcoes).toHaveLength(3);
  });
});

describe("avanço bloqueado e retorno de etapa", () => {
  const etapas = montarEtapas(produtoPorId("pizza:g"), MENU);

  test("sem sabor, a etapa pendente é a primeira e o avanço é bloqueado com motivo", () => {
    const sel = selecaoVazia();
    expect(indiceEtapaPendente(etapas, sel)).toBe(0);
    expect(montagemCompleta(etapas, sel)).toBe(false);
    expect(motivoBloqueio(etapas[0], sel)).toBe("Escolha pelo menos 1 sabor para continuar.");
  });

  test("com sabor, a pendência passa para a borda", () => {
    const sel = { ...selecaoVazia(), sabores: ["Chocolate"] };
    expect(indiceEtapaPendente(etapas, sel)).toBe(1);
    expect(motivoBloqueio(etapas[1], sel)).toBe("Escolha uma borda ou marque “sem borda”.");
  });

  test("“sem borda” é uma decisão, não uma falta de decisão", () => {
    const semDecidir = { ...selecaoVazia(), sabores: ["Chocolate"] };
    const semBorda = { ...semDecidir, borda: null };
    expect(etapaSatisfeita(etapas[1], semDecidir)).toBe(false);
    expect(etapaSatisfeita(etapas[1], semBorda)).toBe(true);
    expect(montagemCompleta(etapas, semBorda)).toBe(true);
    expect(motivoBloqueio(etapas[1], semBorda)).toBeNull();
  });

  test("voltar uma etapa preserva o que já foi escolhido nas anteriores", () => {
    // Voltar é apenas recuar o índice visível: a seleção é o estado, e não é
    // tocada. Este teste trava essa garantia.
    const sel = { ...selecaoVazia(), sabores: ["Chocolate", "Quatro Queijos"], borda: "Requeijão" };
    expect(resumoEtapa(etapas[0], sel)).toBe("Chocolate / Quatro Queijos");
    expect(resumoEtapa(etapas[1], sel)).toBe("Borda Requeijão");
    // recuando para a etapa 0, os sabores continuam lá
    expect(etapaSatisfeita(etapas[0], sel)).toBe(true);
  });

  test("resumo de etapa ainda não resolvida é null", () => {
    expect(resumoEtapa(etapas[0], selecaoVazia())).toBeNull();
  });

  test("motivoBloqueio de etapa inexistente é null", () => {
    expect(motivoBloqueio(undefined, selecaoVazia())).toBeNull();
  });

  test("calzone exige exatamente 1 sabor — 2 não satisfaz", () => {
    const etapaCalzone = montarEtapas(produtoPorId("lanches:calzone"), MENU)[0];
    expect(etapaSatisfeita(etapaCalzone, { ...selecaoVazia(), sabores: ["Chocolate"] })).toBe(true);
    expect(etapaSatisfeita(etapaCalzone, { ...selecaoVazia(), sabores: ["Chocolate", "Quatro Queijos"] })).toBe(false);
  });
});

describe("alternarSabor", () => {
  test("adiciona, remove e respeita o limite substituindo o último", () => {
    let sel = selecaoVazia();
    sel = alternarSabor(sel, "Chocolate", 2);
    expect(sel.sabores).toEqual(["Chocolate"]);
    sel = alternarSabor(sel, "Quatro Queijos", 2);
    expect(sel.sabores).toEqual(["Chocolate", "Quatro Queijos"]);
    // 3º sabor com limite 2 substitui o último em vez de ser ignorado
    sel = alternarSabor(sel, "Frango com Requeijão", 2);
    expect(sel.sabores).toEqual(["Chocolate", "Frango com Requeijão"]);
    // tocar de novo remove
    sel = alternarSabor(sel, "Chocolate", 2);
    expect(sel.sabores).toEqual(["Frango com Requeijão"]);
  });

  test("limite 1 sempre troca o sabor", () => {
    let sel = alternarSabor(selecaoVazia(), "Chocolate", 1);
    sel = alternarSabor(sel, "Quatro Queijos", 1);
    expect(sel.sabores).toEqual(["Quatro Queijos"]);
  });
});

describe("construção do item — mesma gramática do motor oficial", () => {
  test("pizza de 1 sabor sem borda", () => {
    const item = construirItemManual(produtoPorId("pizza:g"), { sabores: ["Chocolate"], borda: null }, MENU);
    expect(item).toEqual({ kind: "pizza", name: "Pizza G", detail: "Chocolate", price: 50, qty: 1 });
  });

  test("pizza meio a meio com borda soma o preço da borda grande", () => {
    const item = construirItemManual(
      produtoPorId("pizza:g"),
      { sabores: ["Chocolate", "Quatro Queijos"], borda: "Requeijão" },
      MENU
    );
    expect(item?.name).toBe("Pizza G (meio a meio)");
    expect(item?.detail).toBe("Chocolate / Quatro Queijos · borda Requeijão");
    expect(item?.price).toBe(58); // 50 + 8
  });

  test("o item montado é sempre precificável pelo motor oficial do servidor", () => {
    const item = construirItemManual(
      produtoPorId("pizza:p"),
      { sabores: ["Chocolate"], borda: "Requeijão" },
      MENU
    );
    expect(item).not.toBeNull();
    expect(officialUnitPrice(item as ItemApp, MENU)).toBe(35); // 30 + 5
  });

  test("suco com leite tem o acréscimo do motor oficial", () => {
    const sem = construirItemManual(produtoPorId("sucos:suco de acai"), { sabores: [], leite: "sem" }, MENU);
    const com = construirItemManual(produtoPorId("sucos:suco de acai"), { sabores: [], leite: "com" }, MENU);
    expect(sem?.price).toBe(10);
    expect(com?.price).toBe(11);
    expect(com?.detail).toBe("Com leite");
  });

  test("calzone e macarronada seguem o formato de detail esperado", () => {
    expect(construirItemManual(produtoPorId("lanches:calzone"), { sabores: ["Chocolate"] }, MENU)).toMatchObject({
      name: "Calzone",
      detail: "Sabor: Chocolate",
      price: 40,
    });
    expect(
      construirItemManual(produtoPorId("lanches:macarronada"), { sabores: [], tamanhoItem: "G" }, MENU)
    ).toMatchObject({ name: "Macarronada", detail: "Tamanho G", price: 45 });
  });

  test("produto simples entra direto, sem detail", () => {
    expect(construirItemManual(produtoPorId("bebidas:refrigerante 2l"), selecaoVazia(), MENU)).toMatchObject({
      name: "Refrigerante 2L",
      detail: "",
      price: 12,
    });
  });

  test("montagem incompleta é recusada em vez de virar item inválido", () => {
    expect(construirItemManual(produtoPorId("pizza:g"), selecaoVazia(), MENU)).toBeNull();
    expect(construirItemManual(produtoPorId("sucos:suco de acai"), selecaoVazia(), MENU)).toBeNull();
    expect(construirItemManual(produtoPorId("lanches:calzone"), selecaoVazia(), MENU)).toBeNull();
  });

  test("sabor fora do cardápio é recusado pelo próprio motor oficial", () => {
    const item = construirItemManual(produtoPorId("pizza:g"), { sabores: ["Sabor Inexistente"], borda: null }, MENU);
    expect(item).toBeNull();
  });

  test("borda fora do cardápio é recusada", () => {
    const item = construirItemManual(produtoPorId("pizza:g"), { sabores: ["Chocolate"], borda: "Borda Fantasma" }, MENU);
    expect(item).toBeNull();
  });

  test("quantidade inválida é recusada", () => {
    const sel = { sabores: ["Chocolate"], borda: null };
    expect(construirItemManual(produtoPorId("pizza:g"), sel, MENU, 0)).toBeNull();
    expect(construirItemManual(produtoPorId("pizza:g"), sel, MENU, -1)).toBeNull();
    expect(construirItemManual(produtoPorId("pizza:g"), sel, MENU, 1.5)).toBeNull();
  });

  test("quantidade maior que 1 é preservada", () => {
    const item = construirItemManual(produtoPorId("bebidas:refrigerante 2l"), selecaoVazia(), MENU, 3);
    expect(item?.qty).toBe(3);
  });
});

describe("resolverPizzaSelectionIds — resolução de nomes para IDs do catálogo oficial (Fase 4)", () => {
  test("1 sabor sem borda resolve sizeId + flavorIds", () => {
    const r = resolverPizzaSelectionIds(PIZZA_CATALOG, "G", ["Quatro Queijos"], null);
    expect(r).toEqual({ sizeId: "size-g", flavorIds: ["flavor-quatro-queijos"] });
  });

  test("meio a meio resolve os dois flavorIds, na ordem recebida", () => {
    const r = resolverPizzaSelectionIds(PIZZA_CATALOG, "G", ["Quatro Queijos", "Frango com Requeijão"], null);
    expect(r?.flavorIds).toEqual(["flavor-quatro-queijos", "flavor-frango-requeijao"]);
  });

  test("com borda resolve borderId também", () => {
    const r = resolverPizzaSelectionIds(PIZZA_CATALOG, "P", ["Chocolate"], "Requeijão");
    expect(r).toEqual({ sizeId: "size-p", flavorIds: ["flavor-chocolate"], borderId: "border-requeijao" });
  });

  test("catálogo ausente devolve undefined — nunca bloqueia, cai no legado", () => {
    expect(resolverPizzaSelectionIds(undefined, "G", ["Chocolate"], null)).toBeUndefined();
  });

  test("tamanho fora do catálogo devolve undefined", () => {
    expect(resolverPizzaSelectionIds(PIZZA_CATALOG, "F", ["Chocolate"], null)).toBeUndefined();
  });

  test("sabor fora do catálogo devolve undefined", () => {
    expect(resolverPizzaSelectionIds(PIZZA_CATALOG, "G", ["Sabor Inexistente"], null)).toBeUndefined();
  });

  test("borda fora do catálogo devolve undefined", () => {
    expect(resolverPizzaSelectionIds(PIZZA_CATALOG, "G", ["Chocolate"], "Borda Fantasma")).toBeUndefined();
  });

  test("0 ou 3+ sabores devolve undefined", () => {
    expect(resolverPizzaSelectionIds(PIZZA_CATALOG, "G", [], null)).toBeUndefined();
    expect(resolverPizzaSelectionIds(PIZZA_CATALOG, "G", ["Chocolate", "Quatro Queijos", "Frango com Requeijão"], null)).toBeUndefined();
  });

  test("sabor esgotado (available: false) ainda resolve o ID — disponibilidade é checagem do servidor, não da resolução de nome", () => {
    // A UI já impede escolher um sabor esgotado (opção desabilitada), mas a
    // resolução pura de nome→ID não é o lugar de checar estoque: quem barra
    // um pizzaSelection com sabor indisponível é o motor nativo do servidor
    // (precificarPizzaPorId), com a lista de esgotados fresca no momento do
    // pedido — nunca uma cópia potencialmente desatualizada no cliente.
    const r = resolverPizzaSelectionIds(PIZZA_CATALOG, "P", ["Chocolate"], null);
    expect(r).toEqual({ sizeId: "size-p", flavorIds: ["flavor-chocolate"] });
  });
});

describe("construirItemManual — pizzaSelection (Fase 4)", () => {
  test("pizza de 1 sabor ganha pizzaSelection quando o catálogo resolve", () => {
    const item = construirItemManual(
      produtoPorId("pizza:g", MENU_COM_CATALOGO),
      { sabores: ["Quatro Queijos"], borda: null },
      MENU_COM_CATALOGO
    );
    expect(item?.pizzaSelection).toEqual({ sizeId: "size-g", flavorIds: ["flavor-quatro-queijos"] });
    // name/detail continuam exatamente os mesmos — pizzaSelection é aditivo.
    expect(item?.name).toBe("Pizza G");
    expect(item?.detail).toBe("Quatro Queijos");
    expect(item?.price).toBe(50);
  });

  test("meio a meio com borda ganha pizzaSelection com os dois flavorIds e borderId", () => {
    const item = construirItemManual(
      produtoPorId("pizza:g", MENU_COM_CATALOGO),
      { sabores: ["Chocolate", "Quatro Queijos"], borda: "Requeijão" },
      MENU_COM_CATALOGO
    );
    expect(item?.pizzaSelection).toEqual({
      sizeId: "size-g",
      flavorIds: ["flavor-chocolate", "flavor-quatro-queijos"],
      borderId: "border-requeijao",
    });
    expect(item?.price).toBe(58);
  });

  test("quantidade maior que 1 não afeta a seleção estruturada (é por unidade)", () => {
    const item = construirItemManual(
      produtoPorId("pizza:g", MENU_COM_CATALOGO),
      { sabores: ["Quatro Queijos"], borda: null },
      MENU_COM_CATALOGO,
      3
    );
    expect(item?.qty).toBe(3);
    expect(item?.pizzaSelection).toEqual({ sizeId: "size-g", flavorIds: ["flavor-quatro-queijos"] });
  });

  test("campo pizzaCatalog GENUINAMENTE ausente: legado continua funcionando normalmente", () => {
    // MENU não define pizzaCatalog nem pizzaCatalogPresente — reproduz uma
    // resposta de GET /api/cardapio anterior à Fase 2 (ou cache antigo).
    const item = construirItemManual(
      produtoPorId("pizza:g", MENU),
      { sabores: ["Quatro Queijos"], borda: null },
      MENU
    );
    expect(item).not.toBeNull();
    expect(item?.pizzaSelection).toBeUndefined();
    expect(item?.price).toBe(50);
  });

  test("mini-pizza/calzone/macarronada/sucos/bebidas nunca ganham pizzaSelection (fora do escopo da Fase 4)", () => {
    const calzone = construirItemManual(
      produtoPorId("lanches:calzone", MENU_COM_CATALOGO),
      { sabores: ["Chocolate"] },
      MENU_COM_CATALOGO
    );
    const suco = construirItemManual(
      produtoPorId("sucos:suco de acai", MENU_COM_CATALOGO),
      { sabores: [], leite: "sem" },
      MENU_COM_CATALOGO
    );
    const refri = construirItemManual(produtoPorId("bebidas:refrigerante 2l", MENU_COM_CATALOGO), selecaoVazia(), MENU_COM_CATALOGO);
    expect(calzone && "pizzaSelection" in calzone).toBe(false);
    expect(suco && "pizzaSelection" in suco).toBe(false);
    expect(refri && "pizzaSelection" in refri).toBe(false);
  });
});

describe("fail-closed: pizzaCatalog PRESENTE mas a seleção não resolve para IDs (hardening Fase 4)", () => {
  // Regra: com `pizzaCatalog` presente na resposta, o legado NUNCA é um
  // fallback silencioso — só a ausência genuína do campo autoriza name/detail
  // sem pizzaSelection. Qualquer falha de resolução aqui devolve `null`
  // (mesmo tratamento de erro já usado pela montagem, ex.: sabor fora do
  // cardápio, quantidade inválida etc.) — nunca um item legado disfarçado.

  test("sabor sem correspondência no catálogo: montagem recusada, nunca cai pro legado", () => {
    const menuCatalogoIncompleto: MenuManual = {
      ...MENU,
      saltyFlavors: [...MENU.saltyFlavors, "Sabor Novo Ainda Sem Catalogo"],
      pizzaCatalog: PIZZA_CATALOG, // não conhece "Sabor Novo Ainda Sem Catalogo"
      pizzaCatalogPresente: true,
    };
    const item = construirItemManual(
      produtoPorId("pizza:g", menuCatalogoIncompleto),
      { sabores: ["Sabor Novo Ainda Sem Catalogo"], borda: null },
      menuCatalogoIncompleto
    );
    expect(item).toBeNull();
  });

  test("tamanho sem correspondência no catálogo: montagem recusada", () => {
    // PIZZA_CATALOG só conhece os tamanhos P e G — "pizza:g" do MENU base
    // sempre existe, então simulamos um catálogo que não conhece o tamanho G.
    const catalogoSemG: PizzaCatalog = { ...PIZZA_CATALOG, sizes: PIZZA_CATALOG.sizes.filter((s) => s.code !== "G") };
    const menu: MenuManual = { ...MENU, pizzaCatalog: catalogoSemG, pizzaCatalogPresente: true };
    const item = construirItemManual(produtoPorId("pizza:g", menu), { sabores: ["Chocolate"], borda: null }, menu);
    expect(item).toBeNull();
  });

  test("borda sem correspondência no catálogo: montagem recusada", () => {
    const item = construirItemManual(
      produtoPorId("pizza:g", MENU_COM_CATALOGO),
      { sabores: ["Chocolate"], borda: "Borda Fantasma" },
      MENU_COM_CATALOGO
    );
    expect(item).toBeNull();
  });

  test("catálogo presente porém malformado (vazio): pizza recusada, sem fallback legado", () => {
    const catalogoVazio: PizzaCatalog = { sizes: [], flavors: [], borders: [] };
    const menu: MenuManual = { ...MENU, pizzaCatalog: catalogoVazio, pizzaCatalogPresente: true };
    const item = construirItemManual(produtoPorId("pizza:g", menu), { sabores: ["Chocolate"], borda: null }, menu);
    expect(item).toBeNull();
  });

  test("pizzaCatalogPresente true mas pizzaCatalog undefined (equivalente a resposta malformada já filtrada por adaptarCardapioParaMontagem): recusada", () => {
    const menu: MenuManual = { ...MENU, pizzaCatalog: undefined, pizzaCatalogPresente: true };
    const item = construirItemManual(produtoPorId("pizza:g", menu), { sabores: ["Chocolate"], borda: null }, menu);
    expect(item).toBeNull();
  });

  test("meio a meio: só 1 dos 2 sabores resolve — recusada (nunca resolve parcial)", () => {
    const menuUmSaborConhecido: MenuManual = {
      ...MENU,
      saltyFlavors: [...MENU.saltyFlavors, "Sabor Novo Ainda Sem Catalogo"],
      pizzaCatalog: PIZZA_CATALOG,
      pizzaCatalogPresente: true,
    };
    const item = construirItemManual(
      produtoPorId("pizza:g", menuUmSaborConhecido),
      { sabores: ["Chocolate", "Sabor Novo Ainda Sem Catalogo"], borda: null },
      menuUmSaborConhecido
    );
    expect(item).toBeNull();
  });

  test("seleção válida com pizzaCatalogPresente=true continua funcionando normalmente (não é bloqueio geral)", () => {
    const item = construirItemManual(
      produtoPorId("pizza:g", MENU_COM_CATALOGO),
      { sabores: ["Chocolate", "Quatro Queijos"], borda: "Requeijão" },
      MENU_COM_CATALOGO
    );
    expect(item).not.toBeNull();
    expect(item?.pizzaSelection).toEqual({
      sizeId: "size-g",
      flavorIds: ["flavor-chocolate", "flavor-quatro-queijos"],
      borderId: "border-requeijao",
    });
  });
});

describe("construirItemManual — simpleSelection (Fase 6)", () => {
  test("calzone: ganha productId + flavorId quando catalog resolve", () => {
    const item = construirItemManual(
      produtoPorId("lanches:calzone", MENU_COM_CATALOGO_SIMPLES),
      { sabores: ["Chocolate"] },
      MENU_COM_CATALOGO_SIMPLES
    );
    expect(item).not.toBeNull();
    expect(item?.simpleSelection).toEqual({ productId: "product-calzone", flavorId: "flavor-chocolate" });
  });

  test("macarronada: ganha productId + sizeId quando catalog resolve", () => {
    const item = construirItemManual(
      produtoPorId("lanches:macarronada", MENU_COM_CATALOGO_SIMPLES),
      { sabores: [], tamanhoItem: "G" },
      MENU_COM_CATALOGO_SIMPLES
    );
    expect(item).not.toBeNull();
    expect(item?.simpleSelection).toEqual({ productId: "product-macarronada", sizeId: "size-g" });
  });

  test("suco: ganha productId + milk quando catalog resolve", () => {
    const item = construirItemManual(
      produtoPorId("sucos:suco de acai", MENU_COM_CATALOGO_SIMPLES),
      { sabores: [], leite: "com" },
      MENU_COM_CATALOGO_SIMPLES
    );
    expect(item).not.toBeNull();
    expect(item?.simpleSelection).toEqual({ productId: "product-suco-de-acai", milk: "com" });
  });

  test("lanche plano (sem sabor/tamanho): nunca ganha simpleSelection — não há ID a resolver", () => {
    const item = construirItemManual(
      produtoPorId("lanches:sanduiche simples", MENU_COM_CATALOGO_SIMPLES),
      selecaoVazia(),
      MENU_COM_CATALOGO_SIMPLES
    );
    expect(item).not.toBeNull();
    expect(item && "simpleSelection" in item).toBe(false);
  });

  test("campo catalog GENUINAMENTE ausente: legado continua funcionando normalmente", () => {
    const item = construirItemManual(produtoPorId("lanches:calzone", MENU), { sabores: ["Chocolate"] }, MENU);
    expect(item).not.toBeNull();
    expect(item?.simpleSelection).toBeUndefined();
    expect(item?.price).toBe(40);
  });
});

describe("construirItemManual — Calzone flavorsMode 'pizza' com o catálogo oficial real (correção da regra comercial do Calzone, 6ª rodada)", () => {
  const catalogoOficial = buildSimpleCatalog(MENU_OFICIAL);
  const menuComCatalogoOficial: MenuManual = {
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
    catalog: catalogoOficial,
    catalogPresente: true,
  };
  const calzoneOficial = catalogoOficial.lanches.find((l) => l.name === "Calzone")!;

  test("REGRESSÃO — Calzone aceita um sabor da Pizza fora de calzoneFlavors (Quatro Queijos): modo padrão 'pizza' reaproveita a lista inteira da Pizza no Pedido Manual", () => {
    const produto = produtoPorId("lanches:calzone", menuComCatalogoOficial);
    const item = construirItemManual(produto, { sabores: ["Quatro Queijos"] }, menuComCatalogoOficial);
    expect(item).not.toBeNull();
    const flavorId = calzoneOficial.flavors!.find((f) => f.name === "Quatro Queijos")!.id;
    expect(item?.simpleSelection).toEqual({ productId: calzoneOficial.id, flavorId });
    expect(item?.price).toBe(35);
  });

  test("mesmo sabor mantém o MESMO flavorId entre Pizza e Calzone no Pedido Manual — nenhum ID novo por produto", () => {
    const produto = produtoPorId("lanches:calzone", menuComCatalogoOficial);
    const item = construirItemManual(produto, { sabores: ["Calabresa"] }, menuComCatalogoOficial);
    const flavorIdEsperado = calzoneOficial.flavors!.find((f) => f.name === "Calabresa")!.id;
    expect(item?.simpleSelection?.flavorId).toBe(flavorIdEsperado);
    expect(flavorIdEsperado).toBe("flavor-calabresa");
  });
});

describe("fail-closed: catalog PRESENTE mas a seleção não resolve para IDs (Fase 6)", () => {
  test("sabor sem correspondência no catálogo: montagem do calzone recusada, nunca cai pro legado", () => {
    const menuCatalogoIncompleto: MenuManual = {
      ...MENU_COM_CATALOGO_SIMPLES,
      saltyFlavors: [...MENU.saltyFlavors, "Sabor Novo Ainda Sem Catalogo"],
    };
    const item = construirItemManual(
      produtoPorId("lanches:calzone", menuCatalogoIncompleto),
      { sabores: ["Sabor Novo Ainda Sem Catalogo"] },
      menuCatalogoIncompleto
    );
    expect(item).toBeNull();
  });

  test("tamanho sem correspondência no catálogo: montagem da macarronada recusada", () => {
    const catalogoSemG: SimpleCatalog = {
      ...SIMPLE_CATALOG,
      lanches: SIMPLE_CATALOG.lanches.map((l) =>
        l.name === "Macarronada" ? { ...l, sizes: l.sizes?.filter((s) => s.code !== "G") } : l
      ),
    };
    const menu: MenuManual = { ...MENU, catalog: catalogoSemG, catalogPresente: true };
    const item = construirItemManual(produtoPorId("lanches:macarronada", menu), { sabores: [], tamanhoItem: "G" }, menu);
    expect(item).toBeNull();
  });

  test("catálogo presente porém malformado (vazio): recusada, sem fallback legado", () => {
    const catalogoVazio: SimpleCatalog = { lanches: [], bebidas: [], sucos: [] };
    const menu: MenuManual = { ...MENU, catalog: catalogoVazio, catalogPresente: true };
    const item = construirItemManual(produtoPorId("lanches:calzone", menu), { sabores: ["Chocolate"] }, menu);
    expect(item).toBeNull();
  });

  test("catalogPresente true mas catalog undefined (equivalente a resposta malformada já filtrada por adaptarCardapioParaMontagem): recusada", () => {
    const menu: MenuManual = { ...MENU, catalog: undefined, catalogPresente: true };
    const item = construirItemManual(produtoPorId("lanches:calzone", menu), { sabores: ["Chocolate"] }, menu);
    expect(item).toBeNull();
  });

  test("seleção válida com catalogPresente=true continua funcionando normalmente (não é bloqueio geral)", () => {
    const item = construirItemManual(
      produtoPorId("lanches:calzone", MENU_COM_CATALOGO_SIMPLES),
      { sabores: ["Chocolate"] },
      MENU_COM_CATALOGO_SIMPLES
    );
    expect(item).not.toBeNull();
    expect(item?.simpleSelection).toEqual({ productId: "product-calzone", flavorId: "flavor-chocolate" });
  });
});

describe("adaptarCardapioParaMontagem — catalogPresente distingue ausente de malformado (Fase 6)", () => {
  const bruto = {
    sizes: [{ code: "G", label: "Grande", price: 50 }],
    saltyFlavors: ["Quatro Queijos"],
    sweetFlavors: ["Chocolate"],
    lanches: [{ name: "Calzone", price: 40, hasFlavors: true, flavorsKey: "calzoneFlavors" }],
  };

  test("campo catalog ausente: catalogPresente é false (ou ausente)", () => {
    const menu = adaptarCardapioParaMontagem(bruto)!;
    expect(menu.catalog).toBeUndefined();
    expect(menu.catalogPresente).toBeFalsy();
  });

  test("campo catalog presente e bem formado: presente=true e catálogo populado, incluindo strategy/flavors por produto e available", () => {
    const menu = adaptarCardapioParaMontagem({
      ...bruto,
      catalog: {
        lanches: [
          {
            id: "product-calzone",
            name: "Calzone",
            priceCents: 4000,
            available: true,
            strategy: "single_flavor",
            flavors: [{ id: "flavor-quatro-queijos", name: "Quatro Queijos", available: true }],
          },
          {
            id: "product-mini-pizza",
            name: "Mini-Pizza",
            priceCents: 2000,
            available: true,
            strategy: "single_flavor",
            flavors: [{ id: "flavor-quatro-queijos", name: "Quatro Queijos", available: false }],
          },
        ],
        bebidas: [],
        sucos: [],
      },
    })!;
    expect(menu.catalogPresente).toBe(true);
    expect(menu.catalog?.lanches).toHaveLength(2);
    const calzone = menu.catalog?.lanches.find((l) => l.name === "Calzone");
    const miniPizza = menu.catalog?.lanches.find((l) => l.name === "Mini-Pizza");
    expect(calzone?.available).toBe(true);
    expect(calzone?.strategy).toBe("single_flavor");
    expect(calzone?.flavors).toEqual([{ id: "flavor-quatro-queijos", name: "Quatro Queijos", available: true }]);
    expect(miniPizza?.flavors).toEqual([{ id: "flavor-quatro-queijos", name: "Quatro Queijos", available: false }]);
  });

  test("produto sem `available` explícito (fronteira antiga/malformada): assume disponível por padrão", () => {
    const menu = adaptarCardapioParaMontagem({
      ...bruto,
      catalog: { lanches: [{ id: "product-calzone", name: "Calzone", priceCents: 4000, strategy: "fixed" }], bebidas: [], sucos: [] },
    })!;
    expect(menu.catalog?.lanches[0].available).toBe(true);
  });

  test("produto sem `strategy` (fronteira malformada): descartado, nunca vira lanche sem estratégia definida", () => {
    const menu = adaptarCardapioParaMontagem({
      ...bruto,
      catalog: { lanches: [{ id: "product-calzone", name: "Calzone", priceCents: 4000, available: true }], bebidas: [], sucos: [] },
    })!;
    expect(menu.catalog).toBeUndefined();
  });

  test("campo catalog presente porém totalmente vazio (sem nenhum produto): presente=true, catálogo undefined", () => {
    const menu = adaptarCardapioParaMontagem({
      ...bruto,
      catalog: { lanches: [], bebidas: [], sucos: [] },
    })!;
    expect(menu.catalogPresente).toBe(true);
    expect(menu.catalog).toBeUndefined();
  });

  test.each([null, false, 0, "", "texto", 42, []])("campo catalog presente porém com tipo errado (%p): presente=true, catálogo undefined", (v) => {
    const menu = adaptarCardapioParaMontagem({ ...bruto, catalog: v })!;
    expect(menu.catalogPresente).toBe(true);
    expect(menu.catalog).toBeUndefined();
  });
});

describe("adaptarCardapioParaMontagem — pizzaCatalogPresente distingue ausente de malformado (hardening Fase 4)", () => {
  const bruto = {
    sizes: [{ code: "G", label: "Grande", price: 50 }],
    saltyFlavors: ["Quatro Queijos"],
    sweetFlavors: ["Chocolate"],
    borders: [{ label: "Requeijão", priceSmall: 5, priceLarge: 8 }],
  };

  test("campo pizzaCatalog ausente: pizzaCatalogPresente é false (ou ausente)", () => {
    const menu = adaptarCardapioParaMontagem(bruto)!;
    expect(menu.pizzaCatalog).toBeUndefined();
    expect(menu.pizzaCatalogPresente).toBeFalsy();
  });

  test("campo pizzaCatalog presente e bem formado: presente=true e catálogo populado", () => {
    const menu = adaptarCardapioParaMontagem({
      ...bruto,
      pizzaCatalog: {
        sizes: [{ id: "size-g", code: "G", label: "Grande", priceCents: 5000 }],
        flavors: [],
        borders: [],
      },
    })!;
    expect(menu.pizzaCatalogPresente).toBe(true);
    expect(menu.pizzaCatalog?.sizes).toHaveLength(1);
  });

  test("campo pizzaCatalog presente porém totalmente vazio: presente=true, catálogo undefined (nunca um catálogo vazio disfarçado de ausente)", () => {
    const menu = adaptarCardapioParaMontagem({ ...bruto, pizzaCatalog: { sizes: [], flavors: [], borders: [] } })!;
    expect(menu.pizzaCatalogPresente).toBe(true);
    expect(menu.pizzaCatalog).toBeUndefined();
  });

  test("campo pizzaCatalog presente porém com tipo errado (string/número/array): presente=true, catálogo undefined", () => {
    for (const v of ["nope", 42, []]) {
      const menu = adaptarCardapioParaMontagem({ ...bruto, pizzaCatalog: v })!;
      expect(menu.pizzaCatalogPresente).toBe(true);
      expect(menu.pizzaCatalog).toBeUndefined();
    }
  });

  test("campo pizzaCatalog explicitamente null: conta como presente (a resposta tentou trazer o campo)", () => {
    const menu = adaptarCardapioParaMontagem({ ...bruto, pizzaCatalog: null })!;
    expect(menu.pizzaCatalogPresente).toBe(true);
    expect(menu.pizzaCatalog).toBeUndefined();
  });

  test("ponta a ponta: catálogo presente + sabor sem correspondência via adaptarCardapioParaMontagem real bloqueia a montagem", () => {
    const menu = adaptarCardapioParaMontagem({
      ...bruto,
      saltyFlavors: ["Quatro Queijos", "Sabor Sem Catalogo"],
      pizzaCatalog: {
        sizes: [{ id: "size-g", code: "G", label: "Grande", priceCents: 5000 }],
        flavors: [{ id: "flavor-quatro-queijos", name: "Quatro Queijos", category: "tradicional", aliases: [], available: true }],
        borders: [],
      },
    })!;
    const pizza = listarProdutosManuais(menu).find((p) => p.id === "pizza:g")!;
    const item = construirItemManual(pizza, { sabores: ["Sabor Sem Catalogo"], borda: null }, menu);
    expect(item).toBeNull();
  });
});

describe("carrinho e total", () => {
  const refri = construirItemManual(produtoPorId("bebidas:refrigerante 2l"), selecaoVazia(), MENU) as ItemApp;
  const pizza = construirItemManual(produtoPorId("pizza:g"), { sabores: ["Chocolate"], borda: null }, MENU) as ItemApp;

  test("itens idênticos são agrupados somando a quantidade", () => {
    let carrinho = adicionarAoCarrinho([], refri);
    carrinho = adicionarAoCarrinho(carrinho, refri);
    expect(carrinho).toHaveLength(1);
    expect(carrinho[0].qty).toBe(2);
  });

  test("itens diferentes não são agrupados", () => {
    let carrinho = adicionarAoCarrinho([], refri);
    carrinho = adicionarAoCarrinho(carrinho, pizza);
    expect(carrinho).toHaveLength(2);
  });

  test("total soma em centavos e aplica a taxa", () => {
    const carrinho = [refri, pizza];
    expect(calcularTotalManual(carrinho, MENU, 0)).toMatchObject({ subtotal: 62, taxa: 0, total: 62 });
    expect(calcularTotalManual(carrinho, MENU, 7.5)).toMatchObject({ subtotal: 62, taxa: 7.5, total: 69.5 });
  });

  test("total respeita a quantidade de cada item", () => {
    expect(calcularTotalManual([{ ...refri, qty: 3 }], MENU, 0).total).toBe(36);
  });

  test("total não acumula erro de ponto flutuante", () => {
    const menuCentavos: MenuManual = { ...MENU, bebidas: [{ name: "Refrigerante 2L", price: 0.1 }] };
    const item = { ...refri, qty: 3 };
    expect(calcularTotalManual([item], menuCentavos, 0.2).total).toBe(0.5);
  });

  test("item que o catálogo atual não precifica mais é contado como inválido, não somado", () => {
    const fantasma: ItemApp = { kind: "simple", name: "Produto Removido", detail: "", price: 99, qty: 1 };
    const r = calcularTotalManual([refri, fantasma], MENU, 0);
    expect(r.subtotal).toBe(12);
    expect(r.itensInvalidos).toBe(1);
  });

  test("o total ignora o preço gravado no item e recalcula pelo cardápio", () => {
    const adulterado: ItemApp = { ...refri, price: 0.01 };
    expect(calcularTotalManual([adulterado], MENU, 0).subtotal).toBe(12);
  });

  test("alterar quantidade e remover item", () => {
    const carrinho = [refri, pizza];
    expect(alterarQuantidade(carrinho, 0, 2)[0].qty).toBe(3);
    expect(alterarQuantidade(carrinho, 0, -1)).toHaveLength(1); // qty 1 - 1 = 0 → remove
    expect(removerItem(carrinho, 1)).toHaveLength(1);
  });

  test("índice fora da faixa não quebra nem altera o carrinho", () => {
    const carrinho = [refri];
    expect(alterarQuantidade(carrinho, 9, 1)).toEqual(carrinho);
    expect(alterarQuantidade(carrinho, -1, 1)).toEqual(carrinho);
    expect(removerItem(carrinho, 9)).toEqual(carrinho);
  });

  test("carrinho vazio tem total zero", () => {
    expect(calcularTotalManual([], MENU, 0)).toMatchObject({ subtotal: 0, total: 0, itensInvalidos: 0 });
  });
});

describe("pendências antes de enviar", () => {
  const item = construirItemManual(produtoPorId("bebidas:refrigerante 2l"), selecaoVazia(), MENU) as ItemApp;

  test("retirada com pagamento simples e um item está pronto para enviar", () => {
    expect(pendenciasDoPedido(DADOS_BASE, [item])).toEqual([]);
  });

  test("carrinho vazio bloqueia", () => {
    expect(pendenciasDoPedido(DADOS_BASE, [])).toContain("Adicione pelo menos um item ao pedido.");
  });

  test("nome e telefone são obrigatórios", () => {
    expect(pendenciasDoPedido({ ...DADOS_BASE, cliente: "  " }, [item])).toContain("Informe o nome do cliente.");
    expect(pendenciasDoPedido({ ...DADOS_BASE, telefone: "99" }, [item])).toContain(
      "Informe um telefone válido com DDD, ou marque “Sem número de telefone”."
    );
  });

  test("telefone com máscara é aceito quando tem dígitos suficientes", () => {
    expect(pendenciasDoPedido({ ...DADOS_BASE, telefone: "(86) 99999-8888" }, [item])).toEqual([]);
  });

  test("semTelefone dispensa o telefone, mas nunca dispensa o nome", () => {
    expect(pendenciasDoPedido({ ...DADOS_BASE, telefone: "", semTelefone: true }, [item])).toEqual([]);
    expect(
      pendenciasDoPedido({ ...DADOS_BASE, cliente: "  ", telefone: "", semTelefone: true }, [item])
    ).toContain("Informe o nome do cliente.");
  });

  test("delivery exige bairro, rua e número", () => {
    const faltas = pendenciasDoPedido({ ...DADOS_BASE, tipoEntrega: "delivery" }, [item]);
    expect(faltas).toContain("Selecione o bairro da entrega.");
    expect(faltas).toContain("Informe a rua da entrega.");
    expect(faltas).toContain("Informe o número do endereço.");
  });

  test("delivery completo não bloqueia", () => {
    const faltas = pendenciasDoPedido(
      { ...DADOS_BASE, tipoEntrega: "delivery", bairro: "Centro", rua: "Rua A", numero: "10" },
      [item]
    );
    expect(faltas).toEqual([]);
  });

  test("retirada não exige endereço", () => {
    expect(pendenciasDoPedido({ ...DADOS_BASE, tipoEntrega: "retirada" }, [item])).toEqual([]);
  });

  test("pagamento em dinheiro exige troco", () => {
    expect(pendenciasDoPedido({ ...DADOS_BASE, pagamento: "Dinheiro" }, [item])).toContain(
      "Informe o troco (ou marque “sem troco”)."
    );
    expect(pendenciasDoPedido({ ...DADOS_BASE, pagamento: "Dinheiro", troco: "Sem troco" }, [item])).toEqual([]);
  });

  test("pagamento misto conta como dinheiro e também exige troco", () => {
    const misto = "Pix (R$ 6,00) + Dinheiro (R$ 6,00)";
    expect(pendenciasDoPedido({ ...DADOS_BASE, pagamento: misto }, [item])).toContain(
      "Informe o troco (ou marque “sem troco”)."
    );
    expect(pendenciasDoPedido({ ...DADOS_BASE, pagamento: misto, troco: "Sem troco" }, [item])).toEqual([]);
  });

  test("pagamento não escolhido bloqueia", () => {
    expect(pendenciasDoPedido({ ...DADOS_BASE, pagamento: "" }, [item])).toContain("Escolha a forma de pagamento.");
  });
});

describe("pendenciaIdentificadorTentativa — falha na geração do clientRequestId no navegador", () => {
  test("com identificador, não há pendência", () => {
    expect(pendenciaIdentificadorTentativa(true)).toBeNull();
  });

  test("sem identificador (gerarClientRequestId lançou), devolve mensagem clara e não vazia", () => {
    const msg = pendenciaIdentificadorTentativa(false);
    expect(msg).not.toBeNull();
    expect(typeof msg).toBe("string");
    expect((msg as string).length).toBeGreaterThan(20);
  });

  test("a mensagem nunca é confundida com uma pendência de dado de negócio — não fala de cliente/telefone/pagamento", () => {
    const msg = pendenciaIdentificadorTentativa(false) as string;
    expect(msg.toLowerCase()).not.toContain("cliente");
    expect(msg.toLowerCase()).not.toContain("telefone");
    expect(msg.toLowerCase()).not.toContain("pagamento");
  });
});

describe("adaptarCardapioParaMontagem — fronteira validada, sem cast", () => {
  const bruto = {
    sizes: [{ code: "G", label: "Grande", price: 50 }],
    saltyFlavors: ["Quatro Queijos"],
    sweetFlavors: ["Chocolate"],
    lanches: [{ name: "Calzone", price: 40 }],
    bebidas: [{ name: "Refrigerante 2L", price: 12 }],
    sucos: [{ name: "Suco de Açaí", price: 10 }],
    borders: [{ label: "Requeijão", priceSmall: 5, priceLarge: 8 }],
    neighborhoods: [{ name: "Centro", fee: 7 }],
    payments: ["Pix"],
    esgotados: ["Chocolate"],
  };

  test("converte uma resposta bem formada", () => {
    const menu = adaptarCardapioParaMontagem(bruto);
    expect(menu).not.toBeNull();
    expect(menu?.sizes).toEqual([{ code: "G", label: "Grande", price: 50 }]);
    expect(menu?.neighborhoods).toEqual([{ name: "Centro", fee: 7 }]);
    expect(menu?.payments).toEqual(["Pix"]);
    expect(menu?.esgotados).toEqual(["Chocolate"]);
  });

  test("o resultado é utilizável de ponta a ponta pelo resto do módulo", () => {
    const menu = adaptarCardapioParaMontagem(bruto)!;
    const pizza = listarProdutosManuais(menu).find((p) => p.id === "pizza:g")!;
    const item = construirItemManual(pizza, { sabores: ["Quatro Queijos"], borda: "Requeijão" }, menu);
    expect(item?.price).toBe(58);
  });

  test("entrada que não é objeto falha de forma segura", () => {
    for (const v of [null, undefined, "cardapio", 42, [], true]) {
      expect(adaptarCardapioParaMontagem(v)).toBeNull();
    }
  });

  test("cardápio sem nenhum produto vendável é recusado — a tela não deve abrir", () => {
    expect(adaptarCardapioParaMontagem({ sizes: [], lanches: [], bebidas: [], sucos: [] })).toBeNull();
    expect(adaptarCardapioParaMontagem({})).toBeNull();
  });

  test("entradas individuais malformadas são descartadas sem derrubar o cardápio", () => {
    const menu = adaptarCardapioParaMontagem({
      ...bruto,
      sizes: [{ code: "G", label: "Grande", price: 50 }, { code: "P", price: "trinta" }, null, 7],
      bebidas: [{ name: "Refrigerante 2L", price: 12 }, { name: "", price: 5 }, { name: "X" }],
      borders: [{ label: "Requeijão", priceSmall: 5 }],
    });
    expect(menu?.sizes).toHaveLength(1);
    expect(menu?.bebidas).toHaveLength(1);
    expect(menu?.borders).toEqual([]); // priceLarge ausente invalida a borda inteira
  });

  test("campos ausentes viram listas vazias, nunca undefined", () => {
    const menu = adaptarCardapioParaMontagem({ bebidas: [{ name: "Água", price: 4 }] })!;
    expect(menu.sizes).toEqual([]);
    expect(menu.saltyFlavors).toEqual([]);
    expect(menu.neighborhoods).toEqual([]);
    expect(menu.payments).toEqual([]);
  });

  test("valores não finitos são descartados (NaN/Infinity nunca viram preço)", () => {
    const menu = adaptarCardapioParaMontagem({
      bebidas: [{ name: "A", price: Number.NaN }, { name: "B", price: Infinity }, { name: "C", price: 3 }],
    })!;
    expect(menu.bebidas).toEqual([{ name: "C", price: 3 }]);
  });

  describe("pizzaCatalog (campo aditivo, Fase 4)", () => {
    const pizzaCatalogBruto = {
      sizes: [{ id: "size-g", code: "G", label: "Grande", priceCents: 5000 }],
      flavors: [{ id: "flavor-quatro-queijos", name: "Quatro Queijos", category: "tradicional", aliases: ["4 queijos"], available: true }],
      borders: [{ id: "border-requeijao", label: "Requeijão", priceSmallCents: 500, priceLargeCents: 800, available: true }],
    };

    test("converte um pizzaCatalog bem formado", () => {
      const menu = adaptarCardapioParaMontagem({ ...bruto, pizzaCatalog: pizzaCatalogBruto });
      expect(menu?.pizzaCatalog).toEqual(pizzaCatalogBruto);
    });

    test("ausente não quebra nem bloqueia o resto do cardápio — vira undefined", () => {
      const menu = adaptarCardapioParaMontagem(bruto); // bruto original não tem pizzaCatalog
      expect(menu).not.toBeNull();
      expect(menu?.pizzaCatalog).toBeUndefined();
    });

    test("malformado (ex.: priceCents como string) descarta só a entrada ruim, sem derrubar o cardápio inteiro", () => {
      const menu = adaptarCardapioParaMontagem({
        ...bruto,
        pizzaCatalog: {
          sizes: [{ id: "size-g", code: "G", label: "Grande", priceCents: "cinquenta" }, { id: "size-p", code: "P", label: "Pequena", priceCents: 3000 }],
          flavors: pizzaCatalogBruto.flavors,
          borders: pizzaCatalogBruto.borders,
        },
      });
      expect(menu?.pizzaCatalog?.sizes).toEqual([{ id: "size-p", code: "P", label: "Pequena", priceCents: 3000 }]);
    });

    test("category fora do enum conhecido descarta o sabor", () => {
      const menu = adaptarCardapioParaMontagem({
        ...bruto,
        pizzaCatalog: {
          sizes: pizzaCatalogBruto.sizes,
          flavors: [{ id: "x", name: "Sabor X", category: "categoria-inventada", aliases: [], available: true }],
          borders: pizzaCatalogBruto.borders,
        },
      });
      expect(menu?.pizzaCatalog?.flavors).toEqual([]);
    });

    test("totalmente vazio (sizes/flavors/borders todos []) vira undefined, não um catálogo vazio", () => {
      const menu = adaptarCardapioParaMontagem({ ...bruto, pizzaCatalog: { sizes: [], flavors: [], borders: [] } });
      expect(menu?.pizzaCatalog).toBeUndefined();
    });

    test("não é objeto (string/número/array) vira undefined", () => {
      for (const v of ["nope", 42, []]) {
        const menu = adaptarCardapioParaMontagem({ ...bruto, pizzaCatalog: v });
        expect(menu?.pizzaCatalog).toBeUndefined();
      }
    });

    test("o resultado é usável de ponta a ponta: construirItemManual anexa pizzaSelection", () => {
      const menu = adaptarCardapioParaMontagem({ ...bruto, pizzaCatalog: pizzaCatalogBruto })!;
      const pizza = listarProdutosManuais(menu).find((p) => p.id === "pizza:g")!;
      const item = construirItemManual(pizza, { sabores: ["Quatro Queijos"], borda: "Requeijão" }, menu);
      expect(item?.pizzaSelection).toEqual({ sizeId: "size-g", flavorIds: ["flavor-quatro-queijos"], borderId: "border-requeijao" });
    });
  });
});
