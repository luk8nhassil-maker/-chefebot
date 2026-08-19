export type StatusPedidoSalao = "novo" | "em_preparo" | "saiu_entrega" | "entregue" | "cancelado";

export type EstadoPedidoSalao = {
  rotulo: string;
  orientacao: string;
  prioridade: number;
  tom: "neutro" | "atencao" | "sucesso" | "perigo";
};

const ESTADOS: Record<StatusPedidoSalao, EstadoPedidoSalao> = {
  novo: {
    rotulo: "Aguardando cozinha",
    orientacao: "O pedido já foi enviado. Aguarde a cozinha começar o preparo.",
    prioridade: 4,
    tom: "neutro",
  },
  em_preparo: {
    rotulo: "Em preparo",
    orientacao: "A cozinha está preparando. Acompanhe até o pedido ficar pronto.",
    prioridade: 3,
    tom: "atencao",
  },
  saiu_entrega: {
    rotulo: "Pronto para servir",
    orientacao: "Retire o pedido na cozinha e leve até a mesa.",
    prioridade: 0,
    tom: "atencao",
  },
  entregue: {
    rotulo: "Servido",
    orientacao: "Este pedido foi concluído. A mesa pode continuar consumindo ou seguir para o fechamento.",
    prioridade: 5,
    tom: "sucesso",
  },
  cancelado: {
    rotulo: "Pedido cancelado",
    orientacao: "Confira este envio antes de seguir. Ele não deve ser servido nem considerado como pedido ativo.",
    prioridade: 1,
    tom: "perigo",
  },
};

const SINCRONIZACAO_PENDENTE: EstadoPedidoSalao = {
  rotulo: "Atualização pendente",
  orientacao: "Não foi possível confirmar o estágio deste pedido. Atualize antes de tomar uma decisão sobre a mesa.",
  prioridade: 2,
  tom: "atencao",
};

export function ehStatusPedidoSalao(valor: unknown): valor is StatusPedidoSalao {
  return valor === "novo" || valor === "em_preparo" || valor === "saiu_entrega" || valor === "entregue" || valor === "cancelado";
}

export function descreverStatusPedidoSalao(status: unknown): EstadoPedidoSalao {
  return ehStatusPedidoSalao(status) ? ESTADOS[status] : SINCRONIZACAO_PENDENTE;
}

export function prioridadeStatusPedidoSalao(status: unknown): number {
  return descreverStatusPedidoSalao(status).prioridade;
}
