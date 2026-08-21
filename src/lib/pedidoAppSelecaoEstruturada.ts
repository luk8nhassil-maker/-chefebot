// Fachada do resolver estruturado. Todo o cálculo/validação continua no
// arquivo base; aqui corrigimos somente o texto canônico dos dois sizeIds de
// Jarra publicados anteriormente, sem alterar produto, preço ou ID.

export * from "./pedidoAppSelecaoEstruturada.base";

import {
  resolverItemComSelecaoSimplesEstruturada as resolverItemComSelecaoSimplesEstruturadaBase,
} from "./pedidoAppSelecaoEstruturada.base";
import type { SimpleCatalog } from "./catalog/simpleProducts";
import type { ItemApp } from "./pedidoAppItens";

export function resolverItemComSelecaoSimplesEstruturada(
  item: ItemApp,
  catalog: SimpleCatalog,
): { ok: true; item: ItemApp } | { ok: false; error: string } {
  const resolvido = resolverItemComSelecaoSimplesEstruturadaBase(item, catalog);
  if (!resolvido.ok) return resolvido;

  const selecao = item.simpleSelection;
  if (!selecao?.productId.startsWith("salao-suco-") || !selecao.sizeId) return resolvido;

  if (selecao.sizeId.endsWith("-copo")) {
    return { ok: true, item: { ...resolvido.item, detail: "Jarra P - Pequena" } };
  }
  if (selecao.sizeId.endsWith("-jarra")) {
    return { ok: true, item: { ...resolvido.item, detail: "Jarra G - Grande" } };
  }
  return resolvido;
}
