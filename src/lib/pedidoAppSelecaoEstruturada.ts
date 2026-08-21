// Fachada do resolver estruturado. Todo o cálculo/validação geral continua no
// arquivo base; aqui ficam somente as especializações compatíveis do Suco de
// Jarra do Salão, sem alterar produto, preço-base ou IDs já publicados.

export * from "./pedidoAppSelecaoEstruturada.base";

import {
  resolverItemComSelecaoSimplesEstruturada as resolverItemComSelecaoSimplesEstruturadaBase,
} from "./pedidoAppSelecaoEstruturada.base";
import type { SimpleCatalog } from "./catalog/simpleProducts";
import type { ItemApp } from "./pedidoAppItens";

// Fonte comercial: decisão explícita do usuário em 2026-08-21.
// O valor é unitário e sempre somado DEPOIS que o sizeId oficial da Jarra foi
// validado pelo servidor. Sem leite mantém exatamente o preço-base do tamanho.
export const ACRESCIMO_LEITE_JARRA_P_CENTS = 200;
export const ACRESCIMO_LEITE_JARRA_G_CENTS = 400;

export type TamanhoJarraSalao = "P" | "G";

export function tamanhoJarraSalaoPorSizeId(sizeId: string): TamanhoJarraSalao | null {
  // Compatibilidade dos IDs publicados na PR #383/#384:
  // - `-copo` representa Jarra P;
  // - `-jarra` representa Jarra G.
  if (sizeId.endsWith("-copo")) return "P";
  if (sizeId.endsWith("-jarra")) return "G";
  return null;
}

export function acrescimoLeiteJarraSalaoCents(tamanho: TamanhoJarraSalao): number {
  return tamanho === "P" ? ACRESCIMO_LEITE_JARRA_P_CENTS : ACRESCIMO_LEITE_JARRA_G_CENTS;
}

function detalheJarra(tamanho: TamanhoJarraSalao, leite?: "com" | "sem"): string {
  const base = tamanho === "P" ? "Jarra P - Pequena" : "Jarra G - Grande";
  if (!leite) return base;
  return `${base} · ${leite === "com" ? "com leite" : "sem leite"}`;
}

export function resolverItemComSelecaoSimplesEstruturada(
  item: ItemApp,
  catalog: SimpleCatalog,
): { ok: true; item: ItemApp } | { ok: false; error: string } {
  const selecao = item.simpleSelection;

  // Nova seleção do Salão: sizeId + milk. O resolver-base de strategy "size"
  // rejeita `milk` por design, então validamos o campo específico aqui e
  // delegamos TODO o restante (produto, disponibilidade, sizeId e preço-base)
  // ao mesmo resolver oficial, removendo apenas `milk` da cópia delegada.
  if (
    selecao &&
    typeof selecao.productId === "string" &&
    selecao.productId.startsWith("salao-suco-") &&
    selecao.milk !== undefined
  ) {
    if (selecao.milk !== "com" && selecao.milk !== "sem") {
      return { ok: false, error: "Seleção de produto inválida" };
    }
    if (selecao.flavorId !== undefined || selecao.addOnId !== undefined || typeof selecao.sizeId !== "string") {
      return { ok: false, error: "Seleção de produto inválida" };
    }

    const resolvidoBase = resolverItemComSelecaoSimplesEstruturadaBase(
      {
        ...item,
        simpleSelection: { productId: selecao.productId, sizeId: selecao.sizeId },
      },
      catalog,
    );
    if (!resolvidoBase.ok) return resolvidoBase;

    const tamanho = tamanhoJarraSalaoPorSizeId(selecao.sizeId);
    if (!tamanho) return { ok: false, error: "Tamanho não encontrado" };

    const acrescimoCents = selecao.milk === "com" ? acrescimoLeiteJarraSalaoCents(tamanho) : 0;
    const precoBaseCents = Math.round(resolvidoBase.item.price * 100);

    return {
      ok: true,
      item: {
        ...resolvidoBase.item,
        detail: detalheJarra(tamanho, selecao.milk),
        price: (precoBaseCents + acrescimoCents) / 100,
      },
    };
  }

  const resolvido = resolverItemComSelecaoSimplesEstruturadaBase(item, catalog);
  if (!resolvido.ok) return resolvido;

  // Compatibilidade deliberada para comandas antigas criadas antes da escolha
  // obrigatória com/sem leite: ausência de `milk` continua legível e mantém o
  // preço-base. A UI nova, porém, não deixa finalizar uma Jarra sem escolher.
  if (!selecao?.productId.startsWith("salao-suco-") || !selecao.sizeId) return resolvido;

  const tamanho = tamanhoJarraSalaoPorSizeId(selecao.sizeId);
  return tamanho ? { ok: true, item: { ...resolvido.item, detail: detalheJarra(tamanho) } } : resolvido;
}
