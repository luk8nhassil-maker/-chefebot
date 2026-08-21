// Fachada do montador oficial com uma única especialização para o módulo
// Salão: Sucos. Todo o restante continua delegado 1:1 ao arquivo base.
//
// Regras aprovadas:
// 1) ao entrar em Sucos, escolher primeiro Copo ou Jarra;
// 2) Copo preserva sabores, preços e regra com/sem leite já existentes;
// 3) Jarra pergunta P (Pequena) ou G (Grande) antes do sabor;
// 4) Jarra pergunta com/sem leite antes de finalizar o produto;
// 5) com leite acrescenta R$2 na P e R$4 na G; sem leite mantém o preço-base;
// 6) todo preço continua vindo dos IDs/tamanhos validados no servidor — nunca
//    do navegador e nunca de uma conta paralela na tela.

export * from "./montagemManual.base";

import {
  construirItemManual as construirItemManualBase,
  listarProdutosManuais as listarProdutosManuaisBase,
  montarEtapas as montarEtapasBase,
  type Etapa,
  type MenuManual,
  type ProdutoManual as ProdutoManualBase,
  type SelecaoMontagem,
} from "./montagemManual.base";
import {
  ACRESCIMO_LEITE_JARRA_G_CENTS,
  ACRESCIMO_LEITE_JARRA_P_CENTS,
  resolverItemComSelecaoSimplesEstruturada,
} from "./pedidoAppSelecaoEstruturada";
import { norm, type ItemApp } from "./pedidoAppItens";
import type { SimpleCatalogProduct } from "./catalog/simpleProducts";

type ModoSucoSalao = "copo" | "jarra";

export type ProdutoManual = ProdutoManualBase & {
  /** Só existe nos dois atalhos sintéticos exibidos na categoria Sucos do Salão. */
  modoSucoSalao?: ModoSucoSalao;
};

function sucosCopo(menu: MenuManual): SimpleCatalogProduct[] {
  return menu.catalog?.sucos.filter((p) => p.id.startsWith("suco-")) ?? [];
}

function sucosJarra(menu: MenuManual): SimpleCatalogProduct[] {
  return menu.catalog?.sucos.filter((p) => p.id.startsWith("salao-suco-")) ?? [];
}

function temFluxoSalao(menu: MenuManual | null | undefined): menu is MenuManual {
  return !!menu?.catalogPresente && !!menu.catalog && sucosCopo(menu).length > 0 && sucosJarra(menu).length > 0;
}

function textoBuscaSuco(modo: ModoSucoSalao, produtos: readonly SimpleCatalogProduct[]): string {
  const tamanho = modo === "jarra" ? "P pequena G grande jarra leite" : "copo";
  return norm(["Sucos", modo, tamanho, ...produtos.map((p) => p.name)].join(" "));
}

/**
 * No Salão, a categoria Sucos não lista sabores logo de cara. Ela mostra
 * somente Copo e Jarra. O sabor vem depois, no fluxo guiado.
 */
export function listarProdutosManuais(menu: MenuManual | null | undefined): ProdutoManual[] {
  const base = listarProdutosManuaisBase(menu) as ProdutoManual[];
  if (!temFluxoSalao(menu)) return base;

  const copos = sucosCopo(menu);
  const jarras = sucosJarra(menu);
  const primeiroSuco = base.findIndex((p) => p.categoria === "sucos");
  if (primeiroSuco < 0) return base;

  const atalhos: ProdutoManual[] = [
    {
      id: "sucos:modo-copo",
      nome: "Copo",
      categoria: "sucos",
      categoriaLabel: "Sucos",
      precoBase: null,
      esgotado: copos.every((p) => !p.available),
      requerMontagem: true,
      textoBusca: textoBuscaSuco("copo", copos),
      modoSucoSalao: "copo",
    },
    {
      id: "sucos:modo-jarra",
      nome: "Jarra",
      categoria: "sucos",
      categoriaLabel: "Sucos",
      precoBase: null,
      esgotado: jarras.every((p) => !p.available),
      requerMontagem: true,
      textoBusca: textoBuscaSuco("jarra", jarras),
      modoSucoSalao: "jarra",
    },
  ];

  const antes = base.slice(0, primeiroSuco).filter((p) => p.categoria !== "sucos");
  const depois = base.slice(primeiroSuco).filter((p) => p.categoria !== "sucos");
  return [...antes, ...atalhos, ...depois];
}

/**
 * Copo: sabor -> com/sem leite (mesma regra anterior).
 * Jarra: P/G -> sabor -> com/sem leite.
 */
export function montarEtapas(produto: ProdutoManual, menu: MenuManual): Etapa[] {
  if (produto.modoSucoSalao === "copo") {
    return [
      {
        tipo: "sabor_unico",
        titulo: "Sabor",
        ajuda: "Escolha o sabor do suco no copo.",
        maxEscolhas: 1,
        opcoes: sucosCopo(menu).map((p) => ({
          valor: p.name,
          label: p.name,
          esgotado: !p.available,
        })),
      },
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

  if (produto.modoSucoSalao === "jarra") {
    return [
      {
        tipo: "tamanho_item",
        titulo: "Tamanho da jarra",
        ajuda: "Escolha P - Pequena ou G - Grande.",
        maxEscolhas: 1,
        opcoes: [
          { valor: "P", label: "P - Pequena", esgotado: false },
          { valor: "G", label: "G - Grande", esgotado: false },
        ],
      },
      {
        tipo: "sabor_unico",
        titulo: "Sabor",
        ajuda: "Escolha o sabor da jarra.",
        maxEscolhas: 1,
        opcoes: sucosJarra(menu).map((p) => ({
          valor: p.name,
          label: p.name,
          esgotado: !p.available,
        })),
      },
      {
        tipo: "leite",
        titulo: "Com ou sem leite",
        ajuda: `Com leite: P +R$ ${ACRESCIMO_LEITE_JARRA_P_CENTS / 100} · G +R$ ${ACRESCIMO_LEITE_JARRA_G_CENTS / 100}.`,
        maxEscolhas: 1,
        opcoes: [
          { valor: "sem", label: "Sem leite", esgotado: false },
          { valor: "com", label: "Com leite", esgotado: false },
        ],
      },
    ];
  }

  return montarEtapasBase(produto, menu);
}

function resolverSelecaoSimples(
  simpleSelection: NonNullable<ItemApp["simpleSelection"]>,
  menu: MenuManual,
  qty: number,
): ItemApp | null {
  if (!menu.catalog) return null;
  const item: ItemApp = { kind: "simple", name: "", price: 0, qty, simpleSelection };
  const resolvido = resolverItemComSelecaoSimplesEstruturada(item, menu.catalog);
  return resolvido.ok ? { ...resolvido.item, simpleSelection } : null;
}

export function construirItemManual(
  produto: ProdutoManual,
  selecao: SelecaoMontagem,
  menu: MenuManual,
  qty = 1,
): ItemApp | null {
  if (!produto.modoSucoSalao) return construirItemManualBase(produto, selecao, menu, qty);
  if (!Number.isInteger(qty) || qty < 1 || !menu.catalogPresente || !menu.catalog) return null;

  if (produto.modoSucoSalao === "copo") {
    if (selecao.sabores.length !== 1) return null;
    if (selecao.leite !== "com" && selecao.leite !== "sem") return null;
    const sabor = sucosCopo(menu).find((p) => p.name === selecao.sabores[0]);
    if (!sabor) return null;
    return resolverSelecaoSimples({ productId: sabor.id, milk: selecao.leite }, menu, qty);
  }

  if (
    selecao.sabores.length !== 1 ||
    (selecao.tamanhoItem !== "P" && selecao.tamanhoItem !== "G") ||
    (selecao.leite !== "com" && selecao.leite !== "sem")
  ) {
    return null;
  }
  const sabor = sucosJarra(menu).find((p) => p.name === selecao.sabores[0]);
  if (!sabor) return null;

  // Compatibilidade deliberada: os IDs de tamanho já publicados na PR #383
  // são mantidos. O ID `-copo` passa a representar a Jarra P e `-jarra` a
  // Jarra G. Assim nenhuma comanda já aberta perde a referência, e o preço
  // continua sendo lido do MESMO sizeId validado no servidor.
  const codigoInterno = selecao.tamanhoItem === "P" ? "Copo" : "Jarra";
  const tamanho = sabor.sizes?.find((s) => s.code === codigoInterno);
  if (!tamanho) return null;

  return resolverSelecaoSimples(
    { productId: sabor.id, sizeId: tamanho.id, milk: selecao.leite },
    menu,
    qty,
  );
}
