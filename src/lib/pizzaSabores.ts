// Fonte de verdade ÚNICA da regra de seleção de sabor de pizza no lado do
// cliente — usada pelo Cardápio Público (montagem da pizza, mini-pizza,
// calzone, pastel) e pela edição de pedido do cliente (/pedido/editar/[id]).
//
// Ficava exportada de dentro de `@/app/cardapio/page` e a tela de edição
// tinha uma cópia própria da mesma lógica, que divergia justamente no 3º
// clique. Extraída para cá para que as duas telas compartilhem literalmente
// a mesma função (nenhuma condicional espalhada por componente).

export type SelecaoSabores = { f1: string | null; f2: string | null };

/**
 * Próximo estado da seleção ao tocar no sabor `f`.
 *
 * Regra oficial (pizza normal, até 2 sabores):
 * - sabor já selecionado → desmarca (o outro permanece, e vira o 1º);
 * - há espaço livre → adiciona;
 * - limite atingido → NADA muda. O 3º sabor é recusado sem substituir
 *   nenhum dos dois já escolhidos: para trocar, o cliente desmarca primeiro.
 *   (Antes, o 3º clique substituía silenciosamente o 2º sabor — o cliente
 *   perdia uma escolha que não pediu para perder e o preço mudava junto.)
 *
 * `singleFlavor` trava em 1 sabor só (mini-pizza, calzone, pastel e o
 * tamanho MINI): tocar em outro sabor TROCA a escolha, porque nesses
 * produtos não existe um 2º lugar para ocupar — recusar o toque deixaria o
 * cliente preso no primeiro sabor que tocou.
 */
export function nextFlavorSelection(
  current: SelecaoSabores,
  f: string,
  singleFlavor: boolean
): SelecaoSabores {
  if (singleFlavor) return { f1: current.f1 === f ? null : f, f2: null };
  if (current.f1 === f) return { f1: current.f2, f2: null };
  if (current.f2 === f) return { f1: current.f1, f2: null };
  if (!current.f1) return { f1: f, f2: current.f2 };
  if (!current.f2) return { f1: current.f1, f2: f };
  // Limite (2) atingido: seleção intacta, o toque no 3º sabor é ignorado.
  return current;
}
