// Escalonamento (🚨 "Assumir conversa") não tinha expiração: um pedido
// escalonado para atendimento humano ficava preso em "novo", bloqueando o
// fluxo normal de aceite, até alguém clicar em Assumir/Resolver. Se
// ninguém clicasse, o alerta urgente nunca saía da tela.
//
// Mesmo padrão de limpeza preguiçosa já usado para locks de edição
// expirados (ver limparEdicaoExpiradaSeNecessario em src/lib/pedidoEdicao.ts):
// sem cron novo, a expiração é resolvida no próximo carregamento do painel.
// Passado o prazo, o pedido volta ao fluxo normal (silenciosamente, sem
// mensagem nem mudança de status) — o atendente ainda pode agir nele
// normalmente, só para de aparecer como urgente.
export const ESCALONAMENTO_TTL_MS = 10 * 60 * 1000;

type PedidoComEscalonamento = {
  escalonado?: boolean;
  horarioEscalonado?: number;
};

export function limparEscalonamentoExpiradoSeNecessario<T extends PedidoComEscalonamento>(
  pedido: T,
  agora: number = Date.now()
): { pedido: T; mudou: boolean } {
  if (!pedido.escalonado || !pedido.horarioEscalonado) return { pedido, mudou: false };
  if (agora - pedido.horarioEscalonado < ESCALONAMENTO_TTL_MS) return { pedido, mudou: false };
  return { pedido: { ...pedido, escalonado: false, horarioEscalonado: undefined }, mudou: true };
}
