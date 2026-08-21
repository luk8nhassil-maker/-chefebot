// Fachada do catálogo simples.
//
// O arquivo base preserva integralmente o motor/catálogo validado que já está
// em produção. Esta fachada altera somente a projeção autorizada do módulo
// Salão: a tela precisa receber tanto os sucos públicos de COPO quanto os
// produtos exclusivos usados para JARRA. A autorização continua sendo feita
// em GET /api/cardapio por origem + sessão válida do Salão; este helper nunca
// concede acesso por conta própria.

export { buildSimpleCatalog, todosOsProdutos } from "./simpleProducts.base";
export type {
  SimpleCatalogStrategy,
  SimpleCatalogScope,
  SimpleCatalogFlavor,
  SimpleCatalogAddOnOption,
  SimpleCatalogProduct,
  SimpleCatalog,
} from "./simpleProducts.base";

import type { SimpleCatalogProduct } from "./simpleProducts.base";

/**
 * Nome histórico mantido para não ampliar o patch da rota. No canal Salão,
 * são visíveis:
 * - IDs `salao-suco-*`: sabores exclusivos de JARRA;
 * - IDs `suco-*`: sabores oficiais já existentes de COPO.
 *
 * Fora do Salão, a rota nem aplica este filtro e o catálogo público continua
 * exatamente como antes.
 */
export function ehSucoExclusivoSalao(produto: Pick<SimpleCatalogProduct, "id">): boolean {
  return produto.id.startsWith("salao-suco-") || produto.id.startsWith("suco-");
}
