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
//
// Fase 4 (aditiva às três decisões acima): a pizza normal também ganha
// `pizzaSelection` (sizeId/flavorIds/borderId, catálogo oficial da Fase 2)
// quando o cardápio traz `pizzaCatalog` e os nomes escolhidos resolvem —
// mesma função usada pelo cardápio público (`resolverPizzaSelectionIds`).
// Isso não cria um segundo motor: o servidor (POST /api/pedido-app) já sabe
// ignorar name/detail/price e reprecificar pelo motor nativo sempre que esse
// campo está presente, para qualquer canal.
//
// FAIL-CLOSED (hardening): o formato legado só é permitido quando o campo
// `pizzaCatalog` está GENUINAMENTE AUSENTE da resposta de GET /api/cardapio
// (resposta anterior à Fase 2, ou cache antigo). Com o campo presente, uma
// pizza que não resolve para IDs (nome sem correspondência, ou catálogo
// malformado/vazio) é RECUSADA na montagem — nunca cai silenciosamente para
// name/detail. Só a ausência de verdade do campo autoriza o legado. Ver
// `pizzaCatalogPresente` em `MenuManual` e `construirItemManual`.

import {
  norm,
  officialUnitPrice,
  type ItemApp,
  type MenuPedidoApp,
} from "./pedidoAppItens";
import type { PizzaCatalog, PizzaCategoryId } from "./catalog/pizzas";
import type { SimpleCatalog } from "./catalog/simpleProducts";

/**
 * Contrato de cardápio da montagem manual. Declarado AQUI, em `src/lib`, e
 * não importado de uma página de rota: um módulo de domínio não deve depender
 * do arquivo de uma tela para saber a forma dos seus próprios dados.
 */
export type MenuManual = MenuPedidoApp & {
  sizes: { code: string; label?: string; price: number }[];
  neighborhoods: { name: string; fee: number }[];
  payments: string[];
  esgotados?: string[];
  // Catálogo oficial de pizzas com IDs estáveis (Fase 2), já vem de
  // GET /api/cardapio (campo aditivo) — usado SÓ para resolver
  // sizeId/flavorIds/borderId da pizza normal (ver resolverPizzaSelectionIds
  // abaixo). `undefined` quando ausente OU malformado — ver
  // `pizzaCatalogPresente` para distinguir os dois casos (hardening Fase 4).
  pizzaCatalog?: PizzaCatalog;
  // Flag interna (nunca lida fora deste módulo): `true` quando a resposta
  // de GET /api/cardapio TINHA a propriedade `pizzaCatalog` (mesmo que
  // malformada/vazia), `false`/ausente quando o campo realmente não veio
  // (resposta anterior à Fase 2, ou cache antigo). `construirItemManual` usa
  // isso para decidir fail-closed: com o campo PRESENTE, uma pizza que não
  // resolve para IDs é RECUSADA (nunca cai pro formato legado); só a
  // AUSÊNCIA genuína do campo permite o formato legado.
  pizzaCatalogPresente?: boolean;
  // Catálogo oficial dos demais produtos configuráveis, com IDs estáveis e
  // disponibilidade em tempo real (Fase 6), já vem de GET /api/cardapio
  // (campo aditivo) — usado SÓ para resolver productId/sizeId/flavorId/milk
  // (ver resolverSimpleSelectionIds abaixo). Sabores de Calzone/Mini-Pizza
  // vêm das listas oficiais já existentes (calzoneFlavors/miniPizzaFlavors),
  // nunca da lista de sabores de pizza. `undefined` quando ausente OU
  // malformado — ver `catalogPresente` para distinguir os dois casos, mesma
  // regra de `pizzaCatalogPresente`.
  catalog?: SimpleCatalog;
  // Flag interna (nunca lida fora deste módulo): `true` quando a resposta de
  // GET /api/cardapio TINHA a propriedade `catalog` (mesmo que
  // malformada/vazia), `false`/ausente quando o campo realmente não veio
  // (resposta anterior à Fase 6, ou cache antigo). `construirItemManual` usa
  // isso para decidir fail-closed, mesma regra de `pizzaCatalogPresente`.
  catalogPresente?: boolean;
};

// ---------------------------------------------------------------------------
// Adaptador validado da resposta de GET /api/cardapio
// ---------------------------------------------------------------------------

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function numeroFinito(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Mapeia um array desconhecido descartando as entradas que não validam. */
function listaValida<T>(bruto: unknown, ler: (item: Record<string, unknown>) => T | null): T[] {
  if (!Array.isArray(bruto)) return [];
  const saida: T[] = [];
  for (const item of bruto) {
    if (!ehObjeto(item)) continue;
    const lido = ler(item);
    if (lido !== null) saida.push(lido);
  }
  return saida;
}

function listaDeTextos(bruto: unknown): string[] {
  return Array.isArray(bruto) ? bruto.filter((v): v is string => typeof v === "string" && v.trim().length > 0) : [];
}

/**
 * Valida `bruto.pizzaCatalog` (campo aditivo de GET /api/cardapio, Fase 2)
 * campo a campo, na mesma linha dos demais leitores desta fronteira — nunca
 * um cast. Qualquer coisa fora do formato esperado é descartada silenciosamente
 * (`undefined`): a montagem de pizza cai no formato 100% legado, nunca quebra
 * a tela por causa de um campo aditivo malformado.
 */
function lerPizzaCatalog(bruto: unknown): PizzaCatalog | undefined {
  if (!ehObjeto(bruto)) return undefined;

  const sizes = listaValida(bruto.sizes, (s) => {
    const id = texto(s.id);
    const code = texto(s.code);
    const label = texto(s.label);
    const priceCents = numeroFinito(s.priceCents);
    return id !== null && code !== null && label !== null && priceCents !== null
      ? { id, code, label, priceCents }
      : null;
  });

  const flavors = listaValida(bruto.flavors, (f) => {
    const id = texto(f.id);
    const name = texto(f.name);
    const category = texto(f.category);
    if (id === null || name === null || category === null) return null;
    if (category !== "tradicional" && category !== "especial" && category !== "doce") return null;
    return {
      id,
      name,
      category: category as PizzaCategoryId,
      aliases: listaDeTextos(f.aliases),
      available: typeof f.available === "boolean" ? f.available : true,
    };
  });

  const borders = listaValida(bruto.borders, (b) => {
    const id = texto(b.id);
    const label = texto(b.label);
    const priceSmallCents = numeroFinito(b.priceSmallCents);
    const priceLargeCents = numeroFinito(b.priceLargeCents);
    return id !== null && label !== null && priceSmallCents !== null && priceLargeCents !== null
      ? { id, label, priceSmallCents, priceLargeCents, available: typeof b.available === "boolean" ? b.available : true }
      : null;
  });

  if (sizes.length === 0 && flavors.length === 0 && borders.length === 0) return undefined;
  return { sizes, flavors, borders };
}

/**
 * Valida `bruto.catalog` (campo aditivo de GET /api/cardapio, Fase 6) campo a
 * campo, mesma disciplina de `lerPizzaCatalog` acima — nunca um cast.
 * Qualquer coisa fora do formato esperado é descartada silenciosamente
 * (`undefined`): a montagem dos produtos configuráveis (Calzone, Mini-Pizza,
 * Macarronada, sucos) cai no formato 100% legado, nunca quebra a tela por
 * causa de um campo aditivo malformado.
 */
function lerCatalog(bruto: unknown): SimpleCatalog | undefined {
  if (!ehObjeto(bruto)) return undefined;

  function lerSimpleProduct(item: Record<string, unknown>) {
    const id = texto(item.id);
    const name = texto(item.name);
    const priceCents = numeroFinito(item.priceCents);
    if (id === null || name === null || priceCents === null) return null;
    const available = typeof item.available === "boolean" ? item.available : true;
    const sizes = listaValida(item.sizes, (s) => {
      const sid = texto(s.id);
      const code = texto(s.code);
      const sPriceCents = numeroFinito(s.priceCents);
      return sid !== null && code !== null && sPriceCents !== null ? { id: sid, code, priceCents: sPriceCents } : null;
    });
    return { id, name, priceCents, available, ...(sizes.length > 0 ? { sizes } : {}) };
  }

  const lanches = listaValida(bruto.lanches, lerSimpleProduct);
  const bebidas = listaValida(bruto.bebidas, lerSimpleProduct);
  const sucos = listaValida(bruto.sucos, lerSimpleProduct);

  function lerFlavor(item: Record<string, unknown>) {
    const id = texto(item.id);
    const name = texto(item.name);
    if (id === null || name === null) return null;
    return { id, name, available: typeof item.available === "boolean" ? item.available : true };
  }
  const calzoneFlavors = listaValida(bruto.calzoneFlavors, lerFlavor);
  const miniPizzaFlavors = listaValida(bruto.miniPizzaFlavors, lerFlavor);

  if (lanches.length === 0 && bebidas.length === 0 && sucos.length === 0) return undefined;
  return { lanches, bebidas, sucos, calzoneFlavors, miniPizzaFlavors };
}

/**
 * Converte a resposta crua de `GET /api/cardapio` no contrato desta montagem,
 * validando campo a campo. Substitui o cast — um `as unknown as` aceitaria uma
 * resposta corrompida e só quebraria mais tarde, no meio de um atendimento.
 *
 * Devolve `null` quando o cardápio não tem o mínimo para montar um pedido
 * (nenhum produto vendável), para que a tela nem chegue a abrir. Entradas
 * individuais malformadas são descartadas em silêncio: um produto com preço
 * inválido some da lista, mas não derruba o cardápio inteiro.
 */
export function adaptarCardapioParaMontagem(bruto: unknown): MenuManual | null {
  if (!ehObjeto(bruto)) return null;

  const menu: MenuManual = {
    sizes: listaValida(bruto.sizes, (s) => {
      const code = texto(s.code);
      const price = numeroFinito(s.price);
      return code !== null && price !== null ? { code, label: texto(s.label) ?? undefined, price } : null;
    }),
    saltyFlavors: listaDeTextos(bruto.saltyFlavors),
    sweetFlavors: listaDeTextos(bruto.sweetFlavors),
    lanches: listaValida(bruto.lanches, (l) => {
      const name = texto(l.name);
      const price = numeroFinito(l.price);
      if (name === null || price === null) return null;
      const sizes = listaValida(l.sizes, (t) => {
        const code = texto(t.code);
        const preco = numeroFinito(t.price);
        return code !== null && preco !== null ? { code, price: preco } : null;
      });
      return { name, price, ...(sizes.length > 0 ? { sizes } : {}) };
    }),
    bebidas: listaValida(bruto.bebidas, (b) => {
      const name = texto(b.name);
      const price = numeroFinito(b.price);
      return name !== null && price !== null ? { name, price } : null;
    }),
    sucos: listaValida(bruto.sucos, (s) => {
      const name = texto(s.name);
      const price = numeroFinito(s.price);
      return name !== null && price !== null ? { name, price } : null;
    }),
    borders: listaValida(bruto.borders, (b) => {
      const label = texto(b.label);
      const priceSmall = numeroFinito(b.priceSmall);
      const priceLarge = numeroFinito(b.priceLarge);
      return label !== null && priceSmall !== null && priceLarge !== null
        ? { label, priceSmall, priceLarge }
        : null;
    }),
    neighborhoods: listaValida(bruto.neighborhoods, (n) => {
      const name = texto(n.name);
      const fee = numeroFinito(n.fee);
      return name !== null && fee !== null ? { name, fee } : null;
    }),
    payments: listaDeTextos(bruto.payments),
    esgotados: listaDeTextos(bruto.esgotados),
    pizzaCatalog: lerPizzaCatalog(bruto.pizzaCatalog),
    // Presença bruta do campo — independente de `lerPizzaCatalog` ter
    // conseguido validar algo. `null`/objeto vazio/tipo errado contam como
    // PRESENTE (a resposta tentou trazer o campo e falhou), só a chave
    // realmente ausente (`undefined`) conta como ausente de verdade.
    pizzaCatalogPresente: bruto.pizzaCatalog !== undefined,
    catalog: lerCatalog(bruto.catalog),
    // Mesma regra de presença de `pizzaCatalogPresente`, para `catalog`.
    catalogPresente: bruto.catalog !== undefined,
  };

  // Sem nenhum produto vendável não há pedido a montar: falhar aqui, com a
  // tela fechada, é melhor do que abrir um fluxo que só produziria itens que
  // o servidor recusaria.
  const temProduto =
    menu.sizes.length > 0 || menu.lanches.length > 0 || menu.bebidas.length > 0 || menu.sucos.length > 0;
  return temProduto ? menu : null;
}

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

  // Dois registros com o MESMO nome na MESMA seção do catálogo (ex.: um item
  // "Teste" cadastrado duas vezes por engano) produziriam o mesmo `id` base
  // — e portanto a mesma `key` do React na lista do seletor. Key duplicada
  // não é um detalhe cosmético: o React documenta que corrompe a
  // reconciliação da lista inteira (itens somem/duplicam de forma
  // imprevisível entre re-renders), o que já foi observado corrompendo as
  // OUTRAS categorias também depois de trocar de aba repetidas vezes. Cada
  // ocorrência repetida do mesmo `id` base ganha um sufixo `#N` — a primeira
  // ocorrência mantém o `id` de sempre (compatível com o catálogo sem
  // duplicatas, o caso comum).
  const idsUsados = new Map<string, number>();
  function idUnico(base: string): string {
    const usos = idsUsados.get(base) ?? 0;
    idsUsados.set(base, usos + 1);
    return usos === 0 ? base : `${base}#${usos + 1}`;
  }

  for (const size of menu.sizes ?? []) {
    if (!size || typeof size.code !== "string" || !Number.isFinite(size.price)) continue;
    const nome = `Pizza ${size.label || size.code}`;
    produtos.push({
      id: idUnico(`pizza:${norm(size.code)}`),
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
      id: idUnico(`lanches:${norm(lanche.name)}`),
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
      id: idUnico(`bebidas:${norm(bebida.name)}`),
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
      id: idUnico(`sucos:${norm(suco.name)}`),
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
// Seleção estruturada de pizza (Fase 4)
// ---------------------------------------------------------------------------

/**
 * Resolve a pizza normal (tamanho + 1/2 sabores + borda, os mesmos já
 * escolhidos pela etapa guiada por NOME) para os IDs estáveis do catálogo
 * oficial (Fase 2, `menu.pizzaCatalog`) — puro, sem I/O. Mesma regra da
 * versão já usada pelo cardápio público (`resolverPizzaSelectionIds` em
 * src/app/cardapio/page.tsx): nunca inventa nem "corrige" nada — catálogo
 * ausente ou qualquer nome sem correspondência devolve `undefined`, e o item
 * cai no formato 100% legado (name/detail), nunca bloqueia adicionar ao
 * pedido.
 */
export function resolverPizzaSelectionIds(
  catalog: PizzaCatalog | undefined,
  sizeCode: string,
  flavorNames: readonly string[],
  borderLabel: string | null
): { sizeId: string; flavorIds: string[]; borderId?: string } | undefined {
  if (!catalog) return undefined;
  if (flavorNames.length !== 1 && flavorNames.length !== 2) return undefined;

  const size = catalog.sizes.find((s) => s.code === sizeCode);
  if (!size) return undefined;

  const flavorIds: string[] = [];
  for (const name of flavorNames) {
    const flavor = catalog.flavors.find((f) => f.name === name);
    if (!flavor) return undefined;
    flavorIds.push(flavor.id);
  }

  if (!borderLabel) return { sizeId: size.id, flavorIds };
  const border = catalog.borders.find((b) => b.label === borderLabel);
  if (!border) return undefined;
  return { sizeId: size.id, flavorIds, borderId: border.id };
}

/**
 * Resolve a seleção de um produto simples configurável (Calzone, Mini-Pizza,
 * Macarronada, sucos) para os IDs estáveis do catálogo oficial (Fase 6,
 * `menu.catalog`) — puro, sem I/O. Mesma regra de resolverPizzaSelectionIds:
 * catálogo ausente ou nome sem correspondência devolve `undefined`. Sabor de
 * Calzone/Mini-Pizza é resolvido contra a lista oficial DAQUELE produto
 * (calzoneFlavors/miniPizzaFlavors) — nunca contra a lista de sabores de
 * pizza, que é uma lista comercial diferente.
 */
export function resolverSimpleSelectionIds(
  catalog: SimpleCatalog | undefined,
  productName: string,
  opts: { sizeCode?: string; flavorName?: string; milk?: "com" | "sem" }
): { productId: string; sizeId?: string; flavorId?: string; milk?: "com" | "sem" } | undefined {
  if (!catalog) return undefined;
  const produto = [...catalog.lanches, ...catalog.bebidas, ...catalog.sucos].find((p) => p.name === productName);
  if (!produto) return undefined;

  if (opts.milk !== undefined) return { productId: produto.id, milk: opts.milk };

  if (opts.sizeCode !== undefined) {
    const lanche = catalog.lanches.find((l) => l.id === produto.id);
    const size = lanche?.sizes?.find((s) => s.code === opts.sizeCode);
    if (!size) return undefined;
    return { productId: produto.id, sizeId: size.id };
  }

  if (opts.flavorName !== undefined) {
    const flavors = ehCalzone(productName) ? catalog.calzoneFlavors : ehMiniPizza(productName) ? catalog.miniPizzaFlavors : [];
    const flavor = flavors.find((f) => f.name === opts.flavorName);
    if (!flavor) return undefined;
    return { productId: produto.id, flavorId: flavor.id };
  }

  return { productId: produto.id };
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
 *
 * Pizza normal também ganha `pizzaSelection` (IDs estáveis) quando o
 * catálogo oficial resolve os nomes escolhidos (Fase 4) — o servidor
 * (POST /api/pedido-app) já ignora name/detail/price e reprecifica pelo
 * motor nativo sempre que esse campo está presente, igual ao cardápio
 * público. `price` aqui continua vindo de `officialUnitPrice`, só para
 * exibição: os dois motores produzem o mesmo valor hoje (nenhum sabor tem
 * preço diferenciado no cardápio oficial) — quem decide de verdade é sempre
 * o servidor.
 *
 * FAIL-CLOSED (hardening Fase 4): o formato legado (name/detail, sem
 * `pizzaSelection`) só é permitido quando `menu.pizzaCatalog` está
 * GENUINAMENTE AUSENTE (`menu.pizzaCatalogPresente` falso — resposta anterior
 * à Fase 2 ou cache antigo). Com o campo PRESENTE na resposta, a pizza
 * SEMPRE precisa resolver para IDs: se o tamanho/sabor/borda escolhido não
 * bate com o catálogo (nome sem correspondência) ou o catálogo veio
 * malformado/vazio, a montagem é RECUSADA (`null`) — nunca cai
 * silenciosamente para name/detail. Isso fecha a brecha de uma pizza escapar
 * do caminho estruturado só porque um nome não bateu (cardápio dessincronizado
 * entre o load da tela e a montagem, por exemplo).
 *
 * Fase 6: a mesma ideia (IDs estáveis + fail-closed quando `menu.catalog`
 * está presente) se aplica a Calzone, Mini-Pizza, Macarronada e sucos, via
 * `simpleSelection` (ver resolverSimpleSelectionIds acima). Lanches/bebidas
 * sem configuração alguma (sem sabor/tamanho/leite) continuam 100% legado —
 * não há ID a resolver para eles.
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
    const pizzaSelection = resolverPizzaSelectionIds(menu.pizzaCatalog, code, selecao.sabores, selecao.borda ?? null);
    if (!pizzaSelection && menu.pizzaCatalogPresente) {
      // O cardápio trouxe pizzaCatalog, mas a seleção não resolveu para IDs
      // (nome sem correspondência, ou o catálogo em si veio malformado/vazio)
      // — nunca cai para o formato legado quando o campo estruturado existe.
      return null;
    }
    item = {
      kind: "pizza",
      name: `Pizza ${code}${meioAMeio ? " (meio a meio)" : ""}`,
      detail: `${selecao.sabores.join(" / ")}${bordaTexto}`,
      price: 0,
      qty,
      ...(pizzaSelection ? { pizzaSelection } : {}),
    };
  } else if (produto.categoria === "sucos") {
    if (selecao.leite !== "com" && selecao.leite !== "sem") return null;
    // FAIL-CLOSED (Fase 6, mesma regra da pizza acima): com `catalog`
    // presente, um suco que não resolve para ID é recusado, nunca cai
    // silenciosamente para name/detail.
    const simpleSelection = resolverSimpleSelectionIds(menu.catalog, produto.nome, { milk: selecao.leite });
    if (!simpleSelection && menu.catalogPresente) return null;
    item = {
      kind: "simple",
      name: produto.nome,
      detail: selecao.leite === "com" ? "Com leite" : "Sem leite",
      price: 0,
      qty,
      ...(simpleSelection ? { simpleSelection } : {}),
    };
  } else if (produto.categoria === "lanches") {
    if (ehCalzone(produto.nome) || ehMiniPizza(produto.nome)) {
      if (selecao.sabores.length !== 1) return null;
      const simpleSelection = resolverSimpleSelectionIds(menu.catalog, produto.nome, { flavorName: selecao.sabores[0] });
      if (!simpleSelection && menu.catalogPresente) return null;
      item = {
        kind: "simple",
        name: produto.nome,
        detail: `Sabor: ${selecao.sabores[0]}`,
        price: 0,
        qty,
        ...(simpleSelection ? { simpleSelection } : {}),
      };
    } else if (ehMacarronada(produto.nome) && selecao.tamanhoItem) {
      const simpleSelection = resolverSimpleSelectionIds(menu.catalog, produto.nome, { sizeCode: selecao.tamanhoItem });
      if (!simpleSelection && menu.catalogPresente) return null;
      item = {
        kind: "simple",
        name: produto.nome,
        detail: `Tamanho ${selecao.tamanhoItem}`,
        price: 0,
        qty,
        ...(simpleSelection ? { simpleSelection } : {}),
      };
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
  /** Opção explícita "Sem número de telefone" — dispensa o telefone só quando marcada (nunca por telefone vazio sozinho). */
  semTelefone?: boolean;
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
  if (!dados.semTelefone && dados.telefone.replace(/\D/g, "").length < 10) {
    faltas.push("Informe um telefone válido com DDD, ou marque “Sem número de telefone”.");
  }

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

/**
 * Pendência técnica (não de negócio) para quando o navegador não conseguiu
 * gerar um identificador de tentativa (`gerarClientRequestId`, em
 * src/survival/clientRequestId.ts, lança na ausência de fonte criptográfica).
 *
 * Uma sessão administrativa EXIGE esse identificador no servidor (ver POST
 * /api/pedido-app) — não é opcional como no cardápio público. Por isso esta
 * função nunca devolve `null` só porque "não há dado de negócio faltando": o
 * pedido não pode ser enviado sem proteção de idempotência, e a mensagem
 * precisa deixar isso claro para o atendente, não apenas travar o botão
 * silenciosamente.
 */
export function pendenciaIdentificadorTentativa(temIdentificador: boolean): string | null {
  return temIdentificador
    ? null
    : "Não foi possível preparar o pedido com segurança neste navegador. Recarregue a página e tente novamente.";
}
