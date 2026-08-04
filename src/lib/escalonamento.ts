// Escalonamento (🚨 "Assumir conversa") não tinha expiração: um pedido
// escalonado para atendimento humano ficava preso em "novo", bloqueando o
// fluxo normal de aceite, até alguém clicar em Assumir/Resolver. Se
// ninguém clicasse, o alerta urgente nunca saía da tela.
//
// Mesmo padrão de limpeza preguiçosa já usado para locks de edição
// expirados (ver limparEdicaoExpiradaSeNecessario em src/lib/pedidoEdicao.ts):
// sem cron novo, a expiração é resolvida no próximo carregamento do painel.
export const ESCALONAMENTO_TTL_MS = 10 * 60 * 1000;

// Único texto usado como "itens" quando o cliente pede atendimento humano
// sem ter nenhum pedido de comida ativo (ver salvarEscalonamento em
// src/app/api/whatsapp/route.ts) — nunca é um pedido de verdade, é só um
// jeito de fazer o alerta aparecer para o atendente. Combinado com total
// zero, identifica esse caso sem precisar de um campo novo espalhado por
// todas as rotas que leem "pedidos".
const MARCADOR_ATENDIMENTO_HUMANO = "Cliente precisa de atendimento humano";

type PedidoComEscalonamento = {
  escalonado?: boolean;
  horarioEscalonado?: number;
  status?: string;
  total?: number;
  itens?: string[];
  isArchived?: boolean;
  archivedAt?: string;
  archivedReason?: string;
};

function ehApenasPedidoDeAtendimento(pedido: PedidoComEscalonamento): boolean {
  return (
    pedido.total === 0 &&
    Array.isArray(pedido.itens) &&
    pedido.itens.length === 1 &&
    pedido.itens[0] === MARCADOR_ATENDIMENTO_HUMANO
  );
}

/**
 * Um pedido escalonado que tinha itens/valor reais (cliente já tinha um
 * pedido em andamento e pediu ajuda) volta ao fluxo normal de aceite
 * quando expira — ele é um pedido de verdade, só parou de ser urgente.
 *
 * Já um "pedido" que só existe porque o cliente pediu atendimento humano
 * sem ter nada no carrinho (itens = [marcador], total = 0) nunca deveria
 * virar um card acionável na cozinha ("Começar a fazer" não faz sentido
 * para R$0,00 sem itens reais). Esse caso é arquivado em vez de só perder
 * o alerta — some da tela de vez, sem exigir um clique manual, e sem
 * inflar a lista de "Prontos" (não usa o status "entregue"). Nada é
 * apagado: continua consultável em Arquivados.
 */
export function limparEscalonamentoExpiradoSeNecessario<T extends PedidoComEscalonamento>(
  pedido: T,
  agora: number = Date.now()
): { pedido: T; mudou: boolean } {
  if (pedido.isArchived) return { pedido, mudou: false };

  const semTempoRestante =
    !pedido.escalonado || !pedido.horarioEscalonado || agora - pedido.horarioEscalonado >= ESCALONAMENTO_TTL_MS;

  if (ehApenasPedidoDeAtendimento(pedido) && pedido.status === "novo") {
    if (!semTempoRestante) return { pedido, mudou: false };
    return {
      pedido: {
        ...pedido,
        escalonado: false,
        horarioEscalonado: undefined,
        isArchived: true,
        archivedAt: new Date(agora).toISOString(),
        archivedReason: "atendimento_humano_sem_pedido",
      },
      mudou: true,
    };
  }

  if (!pedido.escalonado || !pedido.horarioEscalonado) return { pedido, mudou: false };
  if (agora - pedido.horarioEscalonado < ESCALONAMENTO_TTL_MS) return { pedido, mudou: false };
  return { pedido: { ...pedido, escalonado: false, horarioEscalonado: undefined }, mudou: true };
}
