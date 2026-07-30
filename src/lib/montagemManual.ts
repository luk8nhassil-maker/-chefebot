// Montagem manual de pedido no painel administrativo — lógica pura, sem I/O
// e sem React. Existe para que o atendente possa montar um pedido por
// telefone/balcão sem se perder, e para que essa montagem seja testável sem
// montar componente.
//
// Três decisões estruturais governam este módulo:
//
// 1. NÃO EXISTE CATÁLOGO PRÓPRIO. Tudo é derivado do `MenuType` que já chega
//    do cardápio oficial (`useLiveMenu` → GET /api/cardapio). Este módulo não
//    guarda nome, preço nem categoria de produto nenhum.
//
// 2. NÃO EXISTE MOTOR DE PREÇO PARALELO. O preço de qualquer item montado aqui
//    é calculado por `officialUnitPrice` (src/lib/pedidoAppItens.ts) — a MESMA
//    função que o servidor usa ao criar e ao editar o pedido. Um item que essa
//    função não souber precificar é recusado na montagem, em vez de ser
//    enviado e falhar no servidor. O servidor recalcula tudo de qualquer forma:
//    o preço daqui é para exibir, nunca para confiar.
//
// 3. O ITEM PRODUZIDO É O MESMO DOS OUTROS CANAIS. `name` e `detail` seguem
//    exatamente a gramática que `officialUnitPrice` sabe ler (a mesma que o
//    cardápio público produz), para que pedido de painel e pedido de site
//    sejam indistinguíveis para o resto do sistema.

import {
  norm,
  officialUnitPrice,
  type ItemApp,
  type MenuPedidoApp,
} from "./pedidoAppItens";

/** Forma do cardápio que este módulo consome — subconjunto de MenuType. */
export type MenuManual = MenuPedidoApp & {
  sizes: { code: string; label?: string; price: number }[];
  esgotados?: string[];
};

export type CategoriaManual = "pizza" | "lanches" | "bebidas" | "sucos";

export const CATEGORIAS: { id: CategoriaManual; label: string }[] = [
  { id: "pizza", label: "Pizzas" },
  { id: "lanches", label: "Lanches" },
  { id: "bebidas", label: "Bebidas" },
  { id: "sucos", label: "Sucos" },
];

/** Passos que um produto pode exigir antes de entrar no carrinho. */
export type TipoEtapa = "sabores" | "borda" | "sabor_unico" | "tamanho_item" | "leite";

export type OpcaoEtapa = {
  valor: string;
  label: string;
  /** Acréscimo sobre o preço base, só para exibição. */
  extra?: number;
  esgotado: boolean;
};

export type Etapa = {
  tipo: TipoEtapa;
  titulo: string;
  /** Instrução curta do que fazer nesta etapa. */
  ajuda: string;
  opcoes: OpcaoEtapa[];
  /** Quantas escolhas esta etapa aceita no máximo. */
  maxEscolhas: number;
};

export type ProdutoManual = {
  /** Estável entre renderizações e entre sincronizações de cardápio. */
  id: string;
  nome: string;
  categoria: CategoriaManual;
  categoriaLabel: string;
  /** Preço base; `null` quando só é conhecido depois das escolhas. */
  precoBase: number | null;
  esgotado: boolean;
  /** `true` quando o produto abre o fluxo guiado. */
  requerMontagem: boolean;
  /** Código do tamanho da pizza, quando o produto é uma pizza. */
  tamanhoPizza?: string;
  /** Texto já normalizado para busca — montado uma vez, não a cada tecla. */
  textoBusca: string;
};

export type SelecaoMontagem = {
  sabores: string[];
  /** `undefined` = ainda não decidiu; `null` = escolheu "sem borda". */
  borda?: string | null;
  tamanhoItem?: string;
  leite?: "com" | "sem";
};

export function selecaoVazia(): SelecaoMontagem {
  return { sabores: [] };
}

// ---------------------------------------------------------------------------
// Catálogo derivado
// ---------------------------------------------------------------------------

function estaEsgotado(nome: string, esgotados: readonly string[]): boolean {
  return esgotados.some((e) => norm(e) === norm(nome));
}

function ehCalzone(nome: string): boolean {
  return norm(nome) === "calzone";
}

function ehMiniPizza(nome: string): boolean {
  return norm(nome).replace(/[^a-z0-9]/g, "") === "minipizza";
}

function ehMacarronada(nome: string): boolean {
  return norm(nome).includes("macarronada");
}

function textoBuscavel(...partes: (string | undefined)[]): string {
  return norm(partes.filter(Boolean).join(" "));
}

/**
 * Achata o cardápio oficial em produtos pesquisáveis. Uma pizza vira um
 * produto POR TAMANHO — assim o atendente que ouve "uma grande de calabresa"
 * pesquisa "grande" e já entra na montagem com o tamanho resolvido, em vez de
 * ter de escolher o tamanho depois.
 */
export function listarProdutosManuais(menu: MenuManual | null | undefined): ProdutoManual[] {
  if (!menu) return [];
  const esgotados = menu.esgotados ?? [];
  const produtos: ProdutoManual[] = [];

  for (const size of menu.sizes ?? []) {
    if (!size || typeof size.code !== "string" || !Number.isFinite(size.price)) continue;
    const nome = `Pizza ${size.label || size.code}`;
    produtos.push({
      id: `pizza:${norm(size.code)}`,
      nome,
      categoria: "pizza",
      categoriaLabel: "Pizzas",
      precoBase: size.price,
      esgotado: false,
      requerMontagem: true,
      tamanhoPizza: size.code,
      textoBusca: textoBuscavel(nome, "pizza", "Pizzas", size.code),
    });
  }

  for (const lanche of menu.lanches ?? []) {
    if (!lanche?.name) continue;
    const temTamanhos = ehMacarronada(lanche.name) && (lanche.sizes?.length ?? 0) > 0;
    const exigeSabor = ehCalzone(lanche.name) || ehMiniPizza(lanche.name);
    produtos.push({
      id: `lanches:${norm(lanche.name)}`,
      nome: lanche.name,
      categoria: "lanches",
      categoriaLabel: "Lanches",
      precoBase: temTamanhos ? null : Number.isFinite(lanche.price) ? lanche.price : null,
      esgotado: estaEsgotado(lanche.name, esgotados),
      requerMontagem: temTamanhos || exigeSabor,
      textoBusca: textoBuscavel(lanche.name, "Lanches"),
    });
  }

  for (const bebida of menu.bebidas ?? []) {
    if (!bebida?.name) continue;
    produtos.push({
      id: `bebidas:${norm(bebida.name)}`,
      nome: bebida.name,
      categoria: "bebidas",
      categoriaLabel: "Bebidas",
      precoBase: Number.isFinite(bebida.price) ? bebida.price : null,
      esgotado: estaEsgotado(bebida.name, esgotados),
      requerMontagem: false,
      textoBusca: textoBuscavel(bebida.name, "Bebidas"),
    });
  }

  for (const suco of menu.sucos ?? []) {
    if (!suco?.name) continue;
    produtos.push({
      id: `sucos:${norm(suco.name)}`,
      nome: suco.name,
      categoria: "sucos",
      categoriaLabel: "Sucos",
      precoBase: Number.isFinite(suco.price) ? suco.price : null,
      esgotado: estaEsgotado(suco.name, esgotados),
      requerMontagem: true, // com leite / sem leite muda o preço
      textoBusca: textoBuscavel(suco.name, "Sucos"),
    });
  }

  return produtos;
}

// ---------------------------------------------------------------------------
// Busca
// ---------------------------------------------------------------------------

/** Normalização única do termo: sem acento, sem caixa, sem espaço nas pontas. */
export function normalizarTermo(termo: string | null | undefined): string {
  return typeof termo === "string" ? norm(termo) : "";
}

/**
 * Filtra por termo e, opcionalmente, por categoria. Termo vazio devolve o
 * conjunto inteiro (o chamador decide se mostra tudo ou só a categoria ativa).
 * A busca é ortogonal à categoria: o termo procura em TODAS as categorias,
 * porque o atendente ao telefone não sabe em que aba o produto está.
 */
export function buscarProdutos(
  produtos: readonly ProdutoManual[],
  termo: string,
  categoria?: CategoriaManual | "todas"
): ProdutoManual[] {
  const alvo = normalizarTermo(termo);
  const base =
    !categoria || categoria === "todas"
      ? produtos
      : produtos.filter((p) => p.categoria === categoria);
  if (!alvo) return [...base];
  // `textoBusca` já vem normalizado da montagem do catálogo: a cada tecla só
  // acontece um `includes`, nunca uma renormalização de todo o cardápio.
  return base.filter((p) => p.textoBusca.includes(alvo));
}

// ---------------------------------------------------------------------------
// Etapas obrigatórias
// ---------------------------------------------------------------------------

const MAX_SABORES_PIZZA = 2;

function opcoesSabores(menu: MenuManual): OpcaoEtapa[] {
  const esgotados = menu.esgotados ?? [];
  return [...(menu.saltyFlavors ?? []), ...(menu.sweetFlavors ?? [])]
    .filter(Boolean)
    .map((sabor) => ({ valor: sabor, label: sabor, esgotado: estaEsgotado(sabor, esgotados) }));
}

/**
 * Etapas obrigatórias de um produto, na ordem em que devem ser resolvidas.
 * Produto sem etapas entra direto no carrinho.
 */
export function montarEtapas(produto: ProdutoManual, menu: MenuManual): Etapa[] {
  const esgotados = menu.esgotados ?? [];

  if (produto.categoria === "pizza") {
    const grande = produto.tamanhoPizza !== "P" && produto.tamanhoPizza !== "M";
    return [
      {
        tipo: "sabores",
        titulo: "Sabores",
        ajuda: `Escolha 1 sabor, ou 2 para meio a meio.`,
        maxEscolhas: MAX_SABORES_PIZZA,
        opcoes: opcoesSabores(menu),
      },
      {
        tipo: "borda",
        titulo: "Borda",
        ajuda: "Escolha a borda ou marque “sem borda”.",
        maxEscolhas: 1,
        opcoes: [
          { valor: "", label: "Sem borda", esgotado: false },
          ...(menu.borders ?? [])
            .filter((b) => b?.label)
            .map((b) => ({
              valor: b.label,
              label: b.label,
              extra: grande ? b.priceLarge : b.priceSmall,
              esgotado: estaEsgotado(b.label, esgotados),
            })),
        ],
      },
    ];
  }

  if (produto.categoria === "sucos") {
    return [
      {
        tipo: "leite",
        titulo: "Com ou sem leite",
        ajuda: "O suco com leite tem acréscimo.",
        maxEscolhas: 1,
        opcoes: [
          { valor: "sem", label: "Sem leite", esgotado: false },
          { valor: "com", label: "Com leite", extra: 1, esgotado: false },
        ],
      },
    ];
  }

  if (produto.categoria === "lanches") {
    if (ehCalzone(produto.nome) || ehMiniPizza(produto.nome)) {
      return [
        {
          tipo: "sabor_unico",
          titulo: "Sabor",
          ajuda: "Escolha 1 sabor — este produto não é meio a meio.",
          maxEscolhas: 1,
          opcoes: opcoesSabores(menu),
        },
      ];
    }
    if (ehMacarronada(produto.nome)) {
      const item = (menu.lanches ?? []).find((l) => norm(l.name) === norm(produto.nome));
      const tamanhos = (item?.sizes ?? []).filter((s) => s?.code && Number.isFinite(s.price));
      if (tamanhos.length > 0) {
        return [
          {
            tipo: "tamanho_item",
            titulo: "Tamanho",
            ajuda: "Escolha o tamanho.",
            maxEscolhas: 1,
            opcoes: tamanhos.map((s) => ({ valor: s.code, label: `Tamanho ${s.code}`, esgotado: false })),
          },
        ];
      }
    }
  }

  return [];
}

/** Uma etapa está satisfeita quando tem escolha suficiente para avançar. */
export function etapaSatisfeita(etapa: Etapa, selecao: SelecaoMontagem): boolean {
  switch (etapa.tipo) {
    case "sabores":
      return selecao.sabores.length >= 1;
    case "sabor_unico":
      return selecao.sabores.length === 1;
    case "borda":
      // `undefined` = ainda não decidiu. `null` = escolheu "sem borda", que é
      // uma decisão legítima e não pode ser confundida com falta de escolha.
      return selecao.borda !== undefined;
    case "tamanho_item":
      return typeof selecao.tamanhoItem === "string" && selecao.tamanhoItem.length > 0;
    case "leite":
      return selecao.leite === "com" || selecao.leite === "sem";
    default:
      return false;
  }
}

/** Índice da primeira etapa ainda não satisfeita; `-1` quando todas estão. */
export function indiceEtapaPendente(etapas: readonly Etapa[], selecao: SelecaoMontagem): number {
  return etapas.findIndex((etapa) => !etapaSatisfeita(etapa, selecao));
}

export function montagemCompleta(etapas: readonly Etapa[], selecao: SelecaoMontagem): boolean {
  return indiceEtapaPendente(etapas, selecao) === -1;
}

/**
 * Por que o botão de avanço está bloqueado — texto pronto para a tela.
 * `null` quando não está bloqueado. A interface nunca redige esse motivo: sem
 * isso o atendente fica olhando um botão apagado sem saber o que falta.
 */
export function motivoBloqueio(etapa: Etapa | undefined, selecao: SelecaoMontagem): string | null {
  if (!etapa) return null;
  if (etapaSatisfeita(etapa, selecao)) return null;
  switch (etapa.tipo) {
    case "sabores":
      return "Escolha pelo menos 1 sabor para continuar.";
    case "sabor_unico":
      return "Escolha 1 sabor para continuar.";
    case "borda":
      return "Escolha uma borda ou marque “sem borda”.";
    case "tamanho_item":
      return "Escolha o tamanho para continuar.";
    case "leite":
      return "Escolha se o suco vai com ou sem leite.";
    default:
      return "Falta uma opção obrigatória.";
  }
}

/** Rótulo do que já foi escolhido numa etapa — `null` quando nada foi. */
export function resumoEtapa(etapa: Etapa, selecao: SelecaoMontagem): string | null {
  if (!etapaSatisfeita(etapa, selecao)) return null;
  switch (etapa.tipo) {
    case "sabores":
    case "sabor_unico":
      return selecao.sabores.join(" / ");
    case "borda":
      return selecao.borda ? `Borda ${selecao.borda}` : "Sem borda";
    case "tamanho_item":
      return `Tamanho ${selecao.tamanhoItem}`;
    case "leite":
      return selecao.leite === "com" ? "Com leite" : "Sem leite";
    default:
      return null;
  }
}

/**
 * Alterna um sabor respeitando o limite da etapa. Escolher um 3º sabor
 * substitui o último, em vez de ser ignorado silenciosamente — o atendente
 * sob pressão toca e vê o efeito, sem precisar desmarcar antes.
 */
export function alternarSabor(selecao: SelecaoMontagem, sabor: string, max: number): SelecaoMontagem {
  const atuais = selecao.sabores;
  if (atuais.includes(sabor)) {
    return { ...selecao, sabores: atuais.filter((s) => s !== sabor) };
  }
  if (atuais.length < max) return { ...selecao, sabores: [...atuais, sabor] };
  return { ...selecao, sabores: [...atuais.slice(0, max - 1), sabor] };
}

// ---------------------------------------------------------------------------
// Construção do item
// ---------------------------------------------------------------------------

/**
 * Monta o `ItemApp` na gramática que `officialUnitPrice` sabe ler — a mesma
 * que o cardápio público produz — e VALIDA rodando essa própria função. Se o
 * motor oficial não souber precificar, devolve `null` e a montagem é recusada
 * aqui, em vez de o pedido falhar no servidor depois de o atendente já ter
 * desligado o telefone.
 */
export function construirItemManual(
  produto: ProdutoManual,
  selecao: SelecaoMontagem,
  menu: MenuManual,
  qty = 1
): ItemApp | null {
  if (!Number.isInteger(qty) || qty < 1) return null;

  let item: ItemApp | null = null;

  if (produto.categoria === "pizza") {
    const code = produto.tamanhoPizza;
    if (!code || selecao.sabores.length < 1) return null;
    const meioAMeio = selecao.sabores.length === 2;
    const bordaTexto = selecao.borda ? ` · borda ${selecao.borda}` : "";
    item = {
      kind: "pizza",
      name: `Pizza ${code}${meioAMeio ? " (meio a meio)" : ""}`,
      detail: `${selecao.sabores.join(" / ")}${bordaTexto}`,
      price: 0,
      qty,
    };
  } else if (produto.categoria === "sucos") {
    if (selecao.leite !== "com" && selecao.leite !== "sem") return null;
    item = {
      kind: "simple",
      name: produto.nome,
      detail: selecao.leite === "com" ? "Com leite" : "Sem leite",
      price: 0,
      qty,
    };
  } else if (produto.categoria === "lanches") {
    if (ehCalzone(produto.nome) || ehMiniPizza(produto.nome)) {
      if (selecao.sabores.length !== 1) return null;
      item = { kind: "simple", name: produto.nome, detail: `Sabor: ${selecao.sabores[0]}`, price: 0, qty };
    } else if (ehMacarronada(produto.nome) && selecao.tamanhoItem) {
      item = { kind: "simple", name: produto.nome, detail: `Tamanho ${selecao.tamanhoItem}`, price: 0, qty };
    } else {
      item = { kind: "simple", name: produto.nome, detail: "", price: 0, qty };
    }
  } else {
    item = { kind: "simple", name: produto.nome, detail: "", price: 0, qty };
  }

  if (!item) return null;

  const preco = officialUnitPrice(item, menu);
  if (preco === null) return null;
  return { ...item, price: preco };
}

// ---------------------------------------------------------------------------
// Carrinho e total
// ---------------------------------------------------------------------------

/** Preço unitário oficial recalculado — nunca o `price` guardado no item. */
export function precoUnitarioOficial(item: ItemApp, menu: MenuManual): number | null {
  return officialUnitPrice(item, menu);
}

export type TotalManual = {
  subtotal: number;
  taxa: number;
  total: number;
  /** Itens que o catálogo atual não sabe mais precificar. */
  itensInvalidos: number;
};

/**
 * Total do pedido em construção. Somado em CENTAVOS INTEIROS e dividido por
 * 100 só na saída — nunca soma de reais em ponto flutuante. É valor de
 * exibição: o servidor recalcula tudo na criação do pedido.
 */
export function calcularTotalManual(
  itens: readonly ItemApp[],
  menu: MenuManual,
  taxa: number
): TotalManual {
  let subtotalCent = 0;
  let itensInvalidos = 0;

  for (const item of itens) {
    const unit = officialUnitPrice(item, menu);
    if (unit === null) {
      itensInvalidos += 1;
      continue;
    }
    subtotalCent += Math.round(unit * 100) * item.qty;
  }

  const taxaCent = Number.isFinite(taxa) ? Math.round(taxa * 100) : 0;
  return {
    subtotal: subtotalCent / 100,
    taxa: taxaCent / 100,
    total: (subtotalCent + taxaCent) / 100,
    itensInvalidos,
  };
}

/** Junta itens idênticos (mesmo kind/name/detail) somando a quantidade. */
export function adicionarAoCarrinho(itens: readonly ItemApp[], novo: ItemApp): ItemApp[] {
  const idx = itens.findIndex(
    (i) => i.kind === novo.kind && i.name === novo.name && (i.detail || "") === (novo.detail || "")
  );
  if (idx < 0) return [...itens, novo];
  const copia = [...itens];
  copia[idx] = { ...copia[idx], qty: copia[idx].qty + novo.qty };
  return copia;
}

/** Altera a quantidade de um item; quantidade ≤ 0 remove o item. */
export function alterarQuantidade(itens: readonly ItemApp[], indice: number, delta: number): ItemApp[] {
  if (indice < 0 || indice >= itens.length) return [...itens];
  const alvo = itens[indice];
  const nova = alvo.qty + delta;
  if (nova <= 0) return itens.filter((_, i) => i !== indice);
  return itens.map((item, i) => (i === indice ? { ...item, qty: nova } : item));
}

export function removerItem(itens: readonly ItemApp[], indice: number): ItemApp[] {
  if (indice < 0 || indice >= itens.length) return [...itens];
  return itens.filter((_, i) => i !== indice);
}

// ---------------------------------------------------------------------------
// Validação do pedido antes de enviar
// ---------------------------------------------------------------------------

export type DadosPedidoManual = {
  cliente: string;
  telefone: string;
  tipoEntrega: "delivery" | "retirada" | "dine_in";
  bairro?: string;
  rua?: string;
  numero?: string;
  referencia?: string;
  observacao?: string;
  pagamento: string;
  troco?: string;
};

/**
 * O que ainda falta para o pedido poder ser enviado, em texto pronto para a
 * tela. Lista vazia = pode enviar. Espelha as validações de entrada da rota
 * POST /api/pedido-app, para que o atendente veja o problema antes do envio —
 * o servidor continua sendo a fonte da verdade e revalida tudo.
 */
export function pendenciasDoPedido(
  dados: DadosPedidoManual,
  itens: readonly ItemApp[]
): string[] {
  const faltas: string[] = [];

  if (itens.length === 0) faltas.push("Adicione pelo menos um item ao pedido.");
  if (!dados.cliente.trim()) faltas.push("Informe o nome do cliente.");
  if (dados.telefone.replace(/\D/g, "").length < 10) faltas.push("Informe um telefone válido com DDD.");

  if (dados.tipoEntrega === "delivery") {
    if (!dados.bairro?.trim()) faltas.push("Selecione o bairro da entrega.");
    if (!dados.rua?.trim()) faltas.push("Informe a rua da entrega.");
    if (!dados.numero?.trim()) faltas.push("Informe o número do endereço.");
  }

  if (!dados.pagamento.trim()) faltas.push("Escolha a forma de pagamento.");
  else if (/dinheiro/i.test(dados.pagamento) && !dados.troco?.trim()) {
    faltas.push("Informe o troco (ou marque “sem troco”).");
  }

  return faltas;
}
