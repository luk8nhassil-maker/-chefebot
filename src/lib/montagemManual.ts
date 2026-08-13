// Montagem manual de pedido no painel administrativo — lógica pura, sem I/O
// e sem React. Existe para que o atendente possa montar um pedido por
// telefone/balcão sem se perder, e para que essa montagem seja testável sem
// montar componente.
//
// Cardápio oficial 2026 — decisões estruturais atualizadas:
//
// 1. NÃO EXISTE CATÁLOGO PRÓPRIO. Tudo é derivado do `MenuManual` que já
//    chega do cardápio oficial (`useLiveMenu` → GET /api/cardapio):
//    `pizzaCatalog` (@/lib/catalog/pizzas) e `catalog` (@/lib/catalog/
//    simpleProducts) — a MESMA fonte comercial (@/lib/catalog/
//    officialMenu2026) que o servidor usa. Este módulo não guarda preço,
//    produto nem sabor nenhum por conta própria.
//
// 2. NÃO EXISTE MOTOR DE PREÇO PARALELO. Quando o catálogo oficial está
//    presente (sempre, em produção), o item é resolvido pelas MESMAS funções
//    que o servidor usa para validar/precificar (`resolverItemComSelecaoEstruturada`
//    / `resolverItemComSelecaoSimplesEstruturada`, @/lib/pedidoAppSelecaoEstruturada)
//    — puras, sem I/O, importadas diretamente aqui. Preço, name e detail
//    exibidos são exatamente os que o servidor recalculará na criação do
//    pedido, nunca uma segunda conta.
//
// 3. FAIL-CLOSED: com o catálogo oficial presente, uma seleção que não
//    resolve para IDs (sabor/tamanho/adicional sem correspondência, ou
//    catálogo malformado/vazio) é RECUSADA (`null`) — nunca cai
//    silenciosamente para um formato legado com preço possivelmente errado.
//    Só a AUSÊNCIA GENUÍNA do campo (`pizzaCatalogPresente`/`catalogPresente`
//    falso — resposta anterior ao cardápio 2026, ou cache antigo) autoriza o
//    caminho 100% legado (`officialUnitPrice`, name/detail em texto livre),
//    que continua usando o Menu antigo (@/lib/menu) tal como sempre foi —
//    nunca recalculado com preço novo.
import {
  norm,
  officialUnitPrice,
  type ItemApp,
  type MenuPedidoApp,
} from "./pedidoAppItens";
import {
  resolverItemComSelecaoEstruturada,
  resolverItemComSelecaoSimplesEstruturada,
} from "./pedidoAppSelecaoEstruturada";
import type { PizzaCatalog, PizzaCategoryId } from "./catalog/pizzas";
import type { SimpleCatalog, SimpleCatalogProduct, SimpleCatalogStrategy } from "./catalog/simpleProducts";
import { todosOsProdutos } from "./catalog/simpleProducts";

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
  /** Catálogo oficial de pizzas (cardápio 2026), com IDs estáveis, preço por
   *  sabor/tamanho, categorias e adicionais — já vem de GET /api/cardapio
   *  (campo aditivo). `undefined` quando ausente OU malformado — ver
   *  `pizzaCatalogPresente` para distinguir os dois casos. */
  pizzaCatalog?: PizzaCatalog;
  /** Flag interna: `true` quando a resposta de GET /api/cardapio TINHA a
   *  propriedade `pizzaCatalog` (mesmo que malformada/vazia), `false`/ausente
   *  quando o campo realmente não veio (resposta anterior ao cardápio 2026,
   *  ou cache antigo). `construirItemManual` usa isso para fail-closed: com o
   *  campo PRESENTE, uma pizza que não resolve para IDs é RECUSADA. */
  pizzaCatalogPresente?: boolean;
  /** Catálogo oficial dos demais produtos configuráveis (Calzone, Pastel de
   *  Forno/Feira, Macarronada, Hambúrguer, sucos, vitaminas, bebidas —
   *  cardápio 2026), com IDs estáveis, disponibilidade e `strategy` por
   *  produto — já vem de GET /api/cardapio (campo aditivo). `undefined`
   *  quando ausente OU malformado — mesma regra de `pizzaCatalogPresente`. */
  catalog?: SimpleCatalog;
  /** Mesma regra de presença de `pizzaCatalogPresente`, para `catalog`. */
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

const SIZE_CODES_PIZZA = ["F", "G", "M", "P", "MINI"] as const;
const SIZE_CODES_EXTRA = ["P", "M", "G", "F"] as const;

function lerPrecosPorTamanho<T extends readonly string[]>(bruto: unknown, codigos: T): Partial<Record<T[number], number>> | null {
  if (!ehObjeto(bruto)) return null;
  const saida: Partial<Record<T[number], number>> = {};
  for (const codigo of codigos) {
    const valor = bruto[codigo];
    if (valor === undefined) continue;
    const cents = numeroFinito(valor);
    if (cents === null) return null;
    (saida as Record<string, number>)[codigo] = cents;
  }
  return saida;
}

/**
 * Valida `bruto.pizzaCatalog` (campo aditivo de GET /api/cardapio, cardápio
 * 2026) campo a campo — nunca um cast. Qualquer coisa fora do formato
 * esperado é descartada silenciosamente (`undefined`): a montagem de pizza
 * cai no formato 100% legado, nunca quebra a tela por causa de um campo
 * aditivo malformado.
 */
function lerPizzaCatalog(bruto: unknown): PizzaCatalog | undefined {
  if (!ehObjeto(bruto)) return undefined;

  const sizes = listaValida(bruto.sizes, (s) => {
    const id = texto(s.id);
    const code = texto(s.code);
    const label = texto(s.label);
    const fatias = numeroFinito(s.fatias);
    return id !== null && code !== null && label !== null && fatias !== null
      ? { id, code: code as (typeof SIZE_CODES_PIZZA)[number], label, fatias }
      : null;
  });

  const flavors = listaValida(bruto.flavors, (f) => {
    const id = texto(f.id);
    const name = texto(f.name);
    const category = texto(f.category);
    const ingredients = texto(f.ingredients) ?? "";
    const pricesBySizeCode = lerPrecosPorTamanho(f.pricesBySizeCode, SIZE_CODES_PIZZA);
    if (id === null || name === null || category === null || pricesBySizeCode === null) return null;
    if (category !== "tradicional" && category !== "especial" && category !== "doce") return null;
    return {
      id,
      name,
      category: category as PizzaCategoryId,
      ingredients,
      aliases: listaDeTextos(f.aliases),
      available: typeof f.available === "boolean" ? f.available : true,
      pricesBySizeCode,
    };
  });

  const borders = listaValida(bruto.borders, (b) => {
    const id = texto(b.id);
    const label = texto(b.label);
    const pricesBySizeCode = lerPrecosPorTamanho(b.pricesBySizeCode, SIZE_CODES_EXTRA);
    if (id === null || label === null || pricesBySizeCode === null) return null;
    if (SIZE_CODES_EXTRA.some((c) => pricesBySizeCode[c] === undefined)) return null;
    return {
      id,
      label,
      pricesBySizeCode: pricesBySizeCode as Record<"P" | "M" | "G" | "F", number>,
      available: typeof b.available === "boolean" ? b.available : true,
    };
  });

  const addOns = listaValida(bruto.addOns, (a) => {
    const id = texto(a.id);
    const label = texto(a.label);
    const pricesBySizeCode = lerPrecosPorTamanho(a.pricesBySizeCode, SIZE_CODES_EXTRA);
    if (id === null || label === null || pricesBySizeCode === null) return null;
    if (SIZE_CODES_EXTRA.some((c) => pricesBySizeCode[c] === undefined)) return null;
    return {
      id,
      label,
      pricesBySizeCode: pricesBySizeCode as Record<"P" | "M" | "G" | "F", number>,
      available: typeof a.available === "boolean" ? a.available : true,
    };
  });

  if (sizes.length === 0 && flavors.length === 0 && borders.length === 0) return undefined;
  return { sizes, flavors, borders, addOns };
}

function lerStrategy(v: unknown): SimpleCatalogStrategy | null {
  return v === "fixed" || v === "size" || v === "single_flavor" || v === "flavor_priced" || v === "milk" ? v : null;
}

function lerFlavor(item: Record<string, unknown>) {
  const id = texto(item.id);
  const name = texto(item.name);
  if (id === null || name === null) return null;
  const priceCents = numeroFinito(item.priceCents);
  const displayLabel = texto(item.displayLabel);
  return {
    id,
    name,
    available: typeof item.available === "boolean" ? item.available : true,
    ...(priceCents !== null ? { priceCents } : {}),
    ...(displayLabel !== null ? { displayLabel } : {}),
  };
}

/**
 * Valida `bruto.catalog` (campo aditivo de GET /api/cardapio, cardápio 2026)
 * campo a campo, mesma disciplina de `lerPizzaCatalog` acima — nunca um
 * cast. `strategy` é lida como veio do servidor (@/lib/catalog/
 * simpleProducts) — nunca recalculada aqui a partir do nome do produto.
 */
function lerCatalog(bruto: unknown): SimpleCatalog | undefined {
  if (!ehObjeto(bruto)) return undefined;

  function lerSimpleProduct(item: Record<string, unknown>): SimpleCatalogProduct | null {
    const id = texto(item.id);
    const name = texto(item.name);
    const priceCents = numeroFinito(item.priceCents);
    const strategy = lerStrategy(item.strategy);
    if (id === null || name === null || priceCents === null || strategy === null) return null;
    const available = typeof item.available === "boolean" ? item.available : true;
    const sizes = listaValida(item.sizes, (s) => {
      const sid = texto(s.id);
      const code = texto(s.code);
      const sPriceCents = numeroFinito(s.priceCents);
      return sid !== null && code !== null && sPriceCents !== null ? { id: sid, code, priceCents: sPriceCents } : null;
    });
    const flavors = listaValida(item.flavors, lerFlavor);
    const addOnGroupBruto = item.addOnGroup;
    const addOnGroup =
      ehObjeto(addOnGroupBruto) && addOnGroupBruto.max === 1
        ? {
            max: 1 as const,
            options: listaValida(addOnGroupBruto.options, (o) => {
              const oid = texto(o.id);
              const label = texto(o.label);
              const oPriceCents = numeroFinito(o.priceCents);
              if (oid === null || label === null || oPriceCents === null) return null;
              return { id: oid, label, priceCents: oPriceCents, available: typeof o.available === "boolean" ? o.available : true };
            }),
          }
        : undefined;
    return {
      id,
      name,
      priceCents,
      available,
      strategy,
      ...(sizes.length > 0 ? { sizes } : {}),
      ...(flavors.length > 0 ? { flavors } : {}),
      ...(addOnGroup ? { addOnGroup } : {}),
    };
  }

  const lanches = listaValida(bruto.lanches, lerSimpleProduct);
  const hamburgueres = listaValida(bruto.hamburgueres, lerSimpleProduct);
  const calzone = listaValida(bruto.calzone, lerSimpleProduct);
  const pastelForno = listaValida(bruto.pastelForno, lerSimpleProduct);
  const macarronadas = listaValida(bruto.macarronadas, lerSimpleProduct);
  const sucos = listaValida(bruto.sucos, lerSimpleProduct);
  const vitaminas = listaValida(bruto.vitaminas, lerSimpleProduct);
  const bebidas = listaValida(bruto.bebidas, lerSimpleProduct);

  const total =
    lanches.length + hamburgueres.length + calzone.length + pastelForno.length + macarronadas.length + sucos.length + vitaminas.length + bebidas.length;
  if (total === 0) return undefined;
  return { lanches, hamburgueres, calzone, pastelForno, macarronadas, sucos, vitaminas, bebidas };
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
    menu.sizes.length > 0 ||
    menu.lanches.length > 0 ||
    menu.bebidas.length > 0 ||
    menu.sucos.length > 0 ||
    (menu.catalog ? todosOsProdutos(menu.catalog).length > 0 : false);
  return temProduto ? menu : null;
}

export type CategoriaManual =
  | "pizza"
  | "calzone"
  | "pastelForno"
  | "lanches"
  | "hamburgueres"
  | "macarronada"
  | "bebidas"
  | "sucos"
  | "vitaminas";

export const CATEGORIAS: { id: CategoriaManual; label: string }[] = [
  { id: "pizza", label: "Pizzas" },
  { id: "calzone", label: "Calzone" },
  { id: "pastelForno", label: "Pastel de Forno" },
  { id: "lanches", label: "Lanches" },
  { id: "hamburgueres", label: "Hambúrguer" },
  { id: "macarronada", label: "Macarronada" },
  { id: "bebidas", label: "Bebidas" },
  { id: "sucos", label: "Sucos" },
  { id: "vitaminas", label: "Vitaminas" },
];

/** Passos que um produto pode exigir antes de entrar no carrinho. */
export type TipoEtapa = "sabores" | "borda" | "adicionais" | "sabor_unico" | "tamanho_item" | "adicional_opcional" | "leite";

export type OpcaoEtapa = {
  valor: string;
  label: string;
  /** Acréscimo sobre o preço base, só para exibição. */
  extra?: number;
  esgotado: boolean;
  /** Ingredientes/descrição do catálogo, só para leitura (referência visual
   *  — nunca usado em lógica de seleção/preço). Ausente quando a etapa não
   *  tem essa informação (borda, adicionais, tamanho, leite). */
  ingredientes?: string;
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
  /** ID do produto no catálogo oficial (menu.catalog) — presente quando este
   *  produto veio do catálogo estruturado, usado para localizá-lo por ID
   *  (nunca por nome) em montarEtapas/construirItemManual. */
  catalogProductId?: string;
  /** Texto já normalizado para busca — montado uma vez, não a cada tecla. */
  textoBusca: string;
  /** Ingredientes/composição do catálogo oficial, só para leitura (referência
   *  visual) — presente apenas quando a fonte já tem o campo (produtos de
   *  composição fixa como Hambúrguer; nunca inventado aqui). */
  ingredients?: string;
};

export type SelecaoMontagem = {
  sabores: string[];
  /** `undefined` = ainda não decidiu; `null` = escolheu "sem borda". */
  borda?: string | null;
  /** Adicionais de pizza (rótulos) — opcional, nunca bloqueia avanço. */
  adicionais?: string[];
  tamanhoItem?: string;
  /** Adicional opcional único (ex.: Macarronada — Bacon OU Ovos); `null` =
   *  "nenhum" explícito, `undefined` = ainda não decidido. */
  adicionalOpcional?: string | null;
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

// Helpers do caminho 100% LEGADO (só usados quando menu.catalog está
// genuinamente ausente — cache antigo/resposta anterior ao cardápio 2026).
function ehCalzoneLegado(nome: string): boolean {
  return norm(nome) === "calzone";
}
function ehMiniPizzaLegado(nome: string): boolean {
  return norm(nome).replace(/[^a-z0-9]/g, "") === "minipizza";
}
function ehMacarronadaLegado(nome: string): boolean {
  return norm(nome).includes("macarronada");
}

function textoBuscavel(...partes: (string | undefined)[]): string {
  return norm(partes.filter(Boolean).join(" "));
}

const SECOES_CATALOGO: { categoria: CategoriaManual; label: string; chave: keyof SimpleCatalog }[] = [
  { categoria: "calzone", label: "Calzone", chave: "calzone" },
  { categoria: "pastelForno", label: "Pastel de Forno", chave: "pastelForno" },
  { categoria: "lanches", label: "Lanches", chave: "lanches" },
  { categoria: "hamburgueres", label: "Hambúrguer", chave: "hamburgueres" },
  { categoria: "macarronada", label: "Macarronada", chave: "macarronadas" },
  { categoria: "bebidas", label: "Bebidas", chave: "bebidas" },
  { categoria: "sucos", label: "Sucos", chave: "sucos" },
  { categoria: "vitaminas", label: "Vitaminas", chave: "vitaminas" },
];

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

  // Dois registros com o MESMO nome na MESMA seção do catálogo produziriam o
  // mesmo `id` base — e portanto a mesma `key` do React na lista do seletor,
  // o que corrompe a reconciliação. Cada ocorrência repetida ganha um
  // sufixo `#N`; a primeira mantém o `id` de sempre.
  const idsUsados = new Map<string, number>();
  function idUnico(base: string): string {
    const usos = idsUsados.get(base) ?? 0;
    idsUsados.set(base, usos + 1);
    return usos === 0 ? base : `${base}#${usos + 1}`;
  }

  // Tamanhos de pizza: com o catálogo oficial presente, MINI só existe lá
  // (menu.sizes é o Menu legado, sem MINI) — fonte de tamanhos passa a ser
  // pizzaCatalog.sizes (preço vem por sabor, nunca por tamanho, então
  // precoBase fica null); sem o catálogo (caminho legado), continua
  // menu.sizes, exigindo preço finito como sempre.
  const catalogoDePizzaPresente = menu.pizzaCatalogPresente && menu.pizzaCatalog;
  const tamanhosPizza = catalogoDePizzaPresente ? menu.pizzaCatalog!.sizes : menu.sizes ?? [];
  for (const size of tamanhosPizza) {
    if (!size || typeof size.code !== "string") continue;
    if (!catalogoDePizzaPresente && !Number.isFinite((size as { price: number }).price)) continue;
    const nome = `Pizza ${size.label || size.code}`;
    produtos.push({
      id: idUnico(`pizza:${norm(size.code)}`),
      nome,
      categoria: "pizza",
      categoriaLabel: "Pizzas",
      precoBase: catalogoDePizzaPresente ? null : (size as { price: number }).price,
      esgotado: false,
      requerMontagem: true,
      tamanhoPizza: size.code,
      textoBusca: textoBuscavel(nome, "pizza", "Pizzas", size.code),
    });
  }

  if (menu.catalogPresente && menu.catalog) {
    // Catálogo oficial 2026 presente: fonte ÚNICA para todas as demais
    // categorias — nunca menu.lanches/bebidas/sucos legados, que continuam
    // apontando para o cardápio ANTIGO (frozen, só para officialUnitPrice).
    for (const { categoria, label, chave } of SECOES_CATALOGO) {
      for (const produto of menu.catalog[chave] as SimpleCatalogProduct[]) {
        if (!produto?.name) continue;
        const precoBase = produto.strategy === "size" || produto.strategy === "flavor_priced" ? null : produto.priceCents / 100;
        produtos.push({
          id: idUnico(`${categoria}:${norm(produto.name)}`),
          nome: produto.name,
          categoria,
          categoriaLabel: label,
          precoBase,
          esgotado: !produto.available,
          requerMontagem: produto.strategy !== "fixed",
          catalogProductId: produto.id,
          textoBusca: textoBuscavel(produto.name, label, produto.ingredients),
          ...(produto.ingredients ? { ingredients: produto.ingredients } : {}),
        });
      }
    }
  } else {
    // Caminho 100% legado — só quando o catálogo oficial está genuinamente
    // ausente (resposta anterior ao cardápio 2026, ou cache antigo).
    for (const lanche of menu.lanches ?? []) {
      if (!lanche?.name) continue;
      const temTamanhos = ehMacarronadaLegado(lanche.name) && (lanche.sizes?.length ?? 0) > 0;
      const exigeSabor = ehCalzoneLegado(lanche.name) || ehMiniPizzaLegado(lanche.name);
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
        requerMontagem: true,
        textoBusca: textoBuscavel(suco.name, "Sucos"),
      });
    }
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

function opcoesSaboresPizza(menu: MenuManual, sizeCode: string | undefined): OpcaoEtapa[] {
  const esgotados = menu.esgotados ?? [];
  if (menu.pizzaCatalogPresente && menu.pizzaCatalog) {
    // Só sabores que têm preço para o tamanho escolhido (Especiais não têm
    // MINI) — nunca oferece na tela uma combinação que o servidor rejeitaria.
    return menu.pizzaCatalog.flavors
      .filter((f) => !sizeCode || f.pricesBySizeCode[sizeCode as keyof typeof f.pricesBySizeCode] !== undefined)
      .map((f) => ({ valor: f.name, label: f.name, esgotado: !f.available, ingredientes: f.ingredients }));
  }
  return [...(menu.saltyFlavors ?? []), ...(menu.sweetFlavors ?? [])]
    .filter(Boolean)
    .map((sabor) => ({ valor: sabor, label: sabor, esgotado: estaEsgotado(sabor, esgotados) }));
}

function produtoDoCatalogoPorId(menu: MenuManual, catalogProductId: string): SimpleCatalogProduct | undefined {
  if (!menu.catalog) return undefined;
  return todosOsProdutos(menu.catalog).find((p) => p.id === catalogProductId);
}

/**
 * Etapas obrigatórias de um produto, na ordem em que devem ser resolvidas.
 * Produto sem etapas entra direto no carrinho. Dispatch por `produto.
 * catalogProductId` → `strategy` (catálogo oficial), nunca por nome.
 */
export function montarEtapas(produto: ProdutoManual, menu: MenuManual): Etapa[] {
  const esgotados = menu.esgotados ?? [];

  if (produto.categoria === "pizza") {
    const code = produto.tamanhoPizza;
    const isMini = code === "MINI";
    const etapas: Etapa[] = [
      {
        tipo: "sabores",
        titulo: "Sabores",
        ajuda: isMini ? "Escolha 1 sabor (Mini não é meio a meio)." : "Escolha 1 sabor, ou 2 para meio a meio.",
        maxEscolhas: isMini ? 1 : MAX_SABORES_PIZZA,
        opcoes: opcoesSaboresPizza(menu, code),
      },
    ];
    // MINI nunca tem borda nem adicional (sem preço no cardápio oficial).
    if (!isMini) {
      const bordasOpcoes: OpcaoEtapa[] =
        menu.pizzaCatalogPresente && menu.pizzaCatalog
          ? menu.pizzaCatalog.borders.map((b) => ({
              valor: b.label,
              label: b.label,
              extra: b.pricesBySizeCode[(code ?? "G") as "P" | "M" | "G" | "F"] / 100,
              esgotado: !b.available,
            }))
          : (menu.borders ?? [])
              .filter((b) => b?.label)
              .map((b) => ({
                valor: b.label,
                label: b.label,
                extra: code === "P" || code === "M" ? b.priceSmall : b.priceLarge,
                esgotado: estaEsgotado(b.label, esgotados),
              }));
      etapas.push({
        tipo: "borda",
        titulo: "Borda",
        ajuda: "Escolha a borda ou marque “sem borda”.",
        maxEscolhas: 1,
        opcoes: [{ valor: "", label: "Sem borda", esgotado: false }, ...bordasOpcoes],
      });
      if (menu.pizzaCatalogPresente && menu.pizzaCatalog && menu.pizzaCatalog.addOns.length > 0) {
        etapas.push({
          tipo: "adicionais",
          titulo: "Adicionais",
          ajuda: "Opcional — escolha quantos quiser.",
          maxEscolhas: menu.pizzaCatalog.addOns.length,
          opcoes: menu.pizzaCatalog.addOns.map((a) => ({
            valor: a.label,
            label: a.label,
            extra: a.pricesBySizeCode[(code ?? "G") as "P" | "M" | "G" | "F"] / 100,
            esgotado: !a.available,
          })),
        });
      }
    }
    return etapas;
  }

  if (!produto.catalogProductId) return [];
  const catalogProduto = produtoDoCatalogoPorId(menu, produto.catalogProductId);
  if (!catalogProduto) return [];

  switch (catalogProduto.strategy) {
    case "milk":
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
    case "single_flavor":
    case "flavor_priced":
      return [
        {
          tipo: "sabor_unico",
          titulo: "Sabor",
          ajuda: "Escolha 1 sabor — este produto não é meio a meio.",
          maxEscolhas: 1,
          opcoes: (catalogProduto.flavors ?? []).map((f) => ({
            valor: f.displayLabel ?? f.name,
            label: f.displayLabel ?? f.name,
            extra: f.priceCents !== undefined ? f.priceCents / 100 : undefined,
            esgotado: !f.available,
            ingredientes: f.ingredients,
          })),
        },
      ];
    case "size": {
      const etapas: Etapa[] = [
        {
          tipo: "tamanho_item",
          titulo: "Tamanho",
          ajuda: "Escolha o tamanho.",
          maxEscolhas: 1,
          opcoes: (catalogProduto.sizes ?? []).map((s) => ({ valor: s.code, label: `Tamanho ${s.code}`, esgotado: false })),
        },
      ];
      if (catalogProduto.addOnGroup) {
        etapas.push({
          tipo: "adicional_opcional",
          titulo: "Adicional",
          ajuda: "Opcional — no máximo 1.",
          maxEscolhas: 1,
          opcoes: [
            { valor: "", label: "Nenhum", esgotado: false },
            ...catalogProduto.addOnGroup.options.map((o) => ({
              valor: o.label,
              label: o.label,
              extra: o.priceCents / 100,
              esgotado: !o.available,
            })),
          ],
        });
      }
      return etapas;
    }
    case "fixed":
    default:
      return [];
  }
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
    case "adicionais":
      // Sempre opcional — zero adicionais é um estado válido por padrão.
      return true;
    case "tamanho_item":
      return typeof selecao.tamanhoItem === "string" && selecao.tamanhoItem.length > 0;
    case "adicional_opcional":
      // Sempre opcional — "ainda não decidido" já conta como "nenhum".
      return true;
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
    case "adicionais":
      return (selecao.adicionais?.length ?? 0) > 0 ? selecao.adicionais!.join(", ") : "Sem adicionais";
    case "tamanho_item":
      return `Tamanho ${selecao.tamanhoItem}`;
    case "adicional_opcional":
      return selecao.adicionalOpcional ? selecao.adicionalOpcional : "Nenhum";
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

/** Alterna um adicional de pizza (multi-seleção livre, sem limite artificial além do catálogo). */
export function alternarAdicional(selecao: SelecaoMontagem, label: string): SelecaoMontagem {
  const atuais = selecao.adicionais ?? [];
  return atuais.includes(label)
    ? { ...selecao, adicionais: atuais.filter((a) => a !== label) }
    : { ...selecao, adicionais: [...atuais, label] };
}

// ---------------------------------------------------------------------------
// Seleção estruturada de pizza
// ---------------------------------------------------------------------------

/**
 * Resolve a pizza normal (tamanho + 1/2 sabores + borda + adicionais, os
 * mesmos já escolhidos pela etapa guiada por NOME) para os IDs estáveis do
 * catálogo oficial — puro, sem I/O. Mesma regra do cardápio público
 * (`resolverPizzaSelectionIds` em src/app/cardapio/page.tsx): nunca inventa
 * nem "corrige" nada — catálogo ausente ou qualquer nome sem correspondência
 * devolve `undefined`, e o item cai no formato 100% legado (name/detail),
 * nunca bloqueia adicionar ao pedido.
 */
export function resolverPizzaSelectionIds(
  catalog: PizzaCatalog | undefined,
  sizeCode: string,
  flavorNames: readonly string[],
  borderLabel: string | null,
  addOnLabels: readonly string[] = []
): { sizeId: string; flavorIds: string[]; borderId?: string; addOnIds?: string[] } | undefined {
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

  const addOnIds: string[] = [];
  for (const label of addOnLabels) {
    const addOn = catalog.addOns.find((a) => a.label === label);
    if (!addOn) return undefined;
    addOnIds.push(addOn.id);
  }

  const base = { sizeId: size.id, flavorIds, ...(addOnIds.length > 0 ? { addOnIds } : {}) };
  if (!borderLabel) return base;
  const border = catalog.borders.find((b) => b.label === borderLabel);
  if (!border) return undefined;
  return { ...base, borderId: border.id };
}

// ---------------------------------------------------------------------------
// Construção do item
// ---------------------------------------------------------------------------

/**
 * Monta o `ItemApp` do produto. Com o catálogo oficial presente (sempre em
 * produção), reaproveita as MESMAS funções que o servidor usa para validar/
 * precificar (`resolverItemComSelecaoEstruturada`/
 * `resolverItemComSelecaoSimplesEstruturada`) — name, detail e price
 * exibidos aqui são exatamente os que o servidor recalculará na criação do
 * pedido, nunca uma segunda conta. Só quando o catálogo está genuinamente
 * ausente (`pizzaCatalogPresente`/`catalogPresente` falso) o item é montado
 * no formato 100% legado (name/detail em texto livre) e precificado por
 * `officialUnitPrice` contra o Menu antigo — nunca recalculado com preço
 * novo.
 */
export function construirItemManual(
  produto: ProdutoManual,
  selecao: SelecaoMontagem,
  menu: MenuManual,
  qty = 1
): ItemApp | null {
  if (!Number.isInteger(qty) || qty < 1) return null;

  if (produto.categoria === "pizza") {
    const code = produto.tamanhoPizza;
    if (!code || selecao.sabores.length < 1) return null;

    if (menu.pizzaCatalogPresente) {
      if (!menu.pizzaCatalog) return null;
      const pizzaSelection = resolverPizzaSelectionIds(
        menu.pizzaCatalog,
        code,
        selecao.sabores,
        selecao.borda ?? null,
        selecao.adicionais ?? []
      );
      if (!pizzaSelection) return null;
      const item: ItemApp = { kind: "pizza", name: "", price: 0, qty, pizzaSelection };
      const resolvido = resolverItemComSelecaoEstruturada(item, menu.pizzaCatalog);
      // resolverItemComSelecaoEstruturada devolve só name/detail/price/qty —
      // pizzaSelection precisa ser reanexado aqui, é ele que POST
      // /api/admin/pedido-app vai ler quando este item for enviado.
      return resolvido.ok ? { ...resolvido.item, pizzaSelection } : null;
    }

    const meioAMeio = selecao.sabores.length === 2;
    const bordaTexto = selecao.borda ? ` · borda ${selecao.borda}` : "";
    const item: ItemApp = {
      kind: "pizza",
      name: `Pizza ${code}${meioAMeio ? " (meio a meio)" : ""}`,
      detail: `${selecao.sabores.join(" / ")}${bordaTexto}`,
      price: 0,
      qty,
    };
    const preco = officialUnitPrice(item, menu);
    return preco === null ? null : { ...item, price: preco };
  }

  if (menu.catalogPresente) {
    if (!menu.catalog || !produto.catalogProductId) return null;
    const catalogProduto = produtoDoCatalogoPorId(menu, produto.catalogProductId);
    if (!catalogProduto) return null;

    let simpleSelection: ItemApp["simpleSelection"];
    switch (catalogProduto.strategy) {
      case "milk":
        if (selecao.leite !== "com" && selecao.leite !== "sem") return null;
        simpleSelection = { productId: catalogProduto.id, milk: selecao.leite };
        break;
      case "single_flavor":
      case "flavor_priced": {
        if (selecao.sabores.length !== 1) return null;
        const flavor = catalogProduto.flavors?.find((f) => (f.displayLabel ?? f.name) === selecao.sabores[0]);
        if (!flavor) return null;
        simpleSelection = { productId: catalogProduto.id, flavorId: flavor.id };
        break;
      }
      case "size": {
        if (!selecao.tamanhoItem) return null;
        const size = catalogProduto.sizes?.find((s) => s.code === selecao.tamanhoItem);
        if (!size) return null;
        let addOnId: string | undefined;
        if (selecao.adicionalOpcional) {
          const opcao = catalogProduto.addOnGroup?.options.find((o) => o.label === selecao.adicionalOpcional);
          if (!opcao) return null;
          addOnId = opcao.id;
        }
        simpleSelection = { productId: catalogProduto.id, sizeId: size.id, ...(addOnId ? { addOnId } : {}) };
        break;
      }
      case "fixed":
        simpleSelection = { productId: catalogProduto.id };
        break;
      default:
        return null;
    }

    const item: ItemApp = { kind: "simple", name: "", price: 0, qty, simpleSelection };
    const resolvido = resolverItemComSelecaoSimplesEstruturada(item, menu.catalog);
    // Mesma razão da pizza acima: simpleSelection precisa ser reanexado.
    return resolvido.ok ? { ...resolvido.item, simpleSelection } : null;
  }

  // Caminho 100% legado (catálogo genuinamente ausente).
  let item: ItemApp;
  if (ehCalzoneLegado(produto.nome) || ehMiniPizzaLegado(produto.nome)) {
    if (selecao.sabores.length !== 1) return null;
    item = { kind: "simple", name: produto.nome, detail: `Sabor: ${selecao.sabores[0]}`, price: 0, qty };
  } else if (ehMacarronadaLegado(produto.nome) && selecao.tamanhoItem) {
    item = { kind: "simple", name: produto.nome, detail: `Tamanho ${selecao.tamanhoItem}`, price: 0, qty };
  } else if (produto.categoria === "sucos") {
    if (selecao.leite !== "com" && selecao.leite !== "sem") return null;
    item = { kind: "simple", name: produto.nome, detail: selecao.leite === "com" ? "Com leite" : "Sem leite", price: 0, qty };
  } else {
    item = { kind: "simple", name: produto.nome, detail: "", price: 0, qty };
  }
  const preco = officialUnitPrice(item, menu);
  return preco === null ? null : { ...item, price: preco };
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
 * exibição: o servidor recalcula tudo na criação do pedido. Itens com
 * seleção estruturada (pizzaSelection/simpleSelection) são reprecificados
 * pelo MESMO catálogo/motor que os criou — nunca por officialUnitPrice
 * (que não conhece o cardápio 2026 e devolveria "item inválido").
 */
export function calcularTotalManual(
  itens: readonly ItemApp[],
  menu: MenuManual,
  taxa: number
): TotalManual {
  let subtotalCent = 0;
  let itensInvalidos = 0;

  for (const item of itens) {
    let unit: number | null;
    if (item.pizzaSelection && menu.pizzaCatalog) {
      const resolvido = resolverItemComSelecaoEstruturada(item, menu.pizzaCatalog);
      unit = resolvido.ok ? resolvido.item.price : null;
    } else if (item.simpleSelection && menu.catalog) {
      const resolvido = resolverItemComSelecaoSimplesEstruturada(item, menu.catalog);
      unit = resolvido.ok ? resolvido.item.price : null;
    } else {
      unit = officialUnitPrice(item, menu);
    }
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
 * POST /api/admin/pedido-app, para que o atendente veja o problema antes do
 * envio — o servidor continua sendo a fonte da verdade e revalida tudo.
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
 * /api/admin/pedido-app) — não é opcional como no cardápio público. Por isso
 * esta função nunca devolve `null` só porque "não há dado de negócio
 * faltando": o pedido não pode ser enviado sem proteção de idempotência, e a
 * mensagem precisa deixar isso claro para o atendente, não apenas travar o
 * botão silenciosamente.
 */
export function pendenciaIdentificadorTentativa(temIdentificador: boolean): string | null {
  return temIdentificador
    ? null
    : "Não foi possível preparar o pedido com segurança neste navegador. Recarregue a página e tente novamente.";
}
