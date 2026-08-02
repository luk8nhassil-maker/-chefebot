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
  type MenuManual,
  type ProdutoManual,
  type DadosPedidoManual,
} from "./montagemManual";
import { officialUnitPrice, type ItemApp } from "./pedidoAppItens";

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
});
