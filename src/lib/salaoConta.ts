export type StatusPedidoSalao = "novo" | "em_preparo" | "saiu_entrega" | "entregue" | "cancelado";

export type StatusContaSalao = "aberta" | "conta_solicitada" | "fechando" | "fechada";

export type EstadoContaSalao = {
  comandaId: string;
  status: StatusContaSalao;
  contaSolicitadaEm?: string;
  contaSolicitadaPor?: string;
  fechamentoRequestId?: string;
  fechamentoIniciadoEm?: string;
  fechadaEm?: string;
  fechadaPor?: string;
  totalFinalCentavos?: number;
  pagamento?: string;
  troco?: string;
  atualizadoEm: string;
};

export type EnvioOperacionalSalao = {
  rodadaId: string;
  numero: number;
  pedidoId?: string;
  subtotalCentavos: number;
  status?: StatusPedidoSalao;
  statusAtualizadoEm?: string;
};

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
    orientacao: "Este envio já foi servido. A mesa pode continuar consumindo ou pedir a conta.",
    prioridade: 5,
    tom: "sucesso",
  },
  cancelado: {
    rotulo: "Pedido cancelado",
    orientacao: "Este envio foi cancelado e não entra no total da conta.",
    prioridade: 1,
    tom: "perigo",
  },
};

const SINCRONIZACAO_PENDENTE: EstadoPedidoSalao = {
  rotulo: "Atualização pendente",
  orientacao: "Não foi possível confirmar a etapa deste envio. Atualize antes de agir sobre a mesa.",
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

export function estadoInicialContaSalao(comandaId: string, agora = new Date().toISOString()): EstadoContaSalao {
  return { comandaId, status: "aberta", atualizadoEm: agora };
}

export function subtotalParaCentavos(valor: number): number {
  if (!Number.isFinite(valor) || valor < 0) return 0;
  return Math.round(valor * 100);
}

export function totalAtivoCentavos(envios: EnvioOperacionalSalao[]): number {
  return envios.reduce((total, envio) => {
    if (!envio.pedidoId || envio.status === "cancelado") return total;
    return total + Math.max(0, Math.trunc(envio.subtotalCentavos));
  }, 0);
}

export type AvaliacaoSolicitarConta =
  | { ok: true; totalCentavos: number }
  | { ok: false; code: "sem_envios" | "envio_pendente" | "sincronizacao_pendente" | "rascunho_aberto"; error: string };

export function avaliarSolicitacaoConta(params: {
  envios: EnvioOperacionalSalao[];
  temRodadaEmAndamento: boolean;
}): AvaliacaoSolicitarConta {
  if (params.temRodadaEmAndamento) {
    return { ok: false, code: "rascunho_aberto", error: "Finalize ou descarte o pedido que ainda está sendo montado antes de pedir a conta." };
  }

  const ativos = params.envios.filter((envio) => envio.pedidoId && envio.status !== "cancelado");
  if (ativos.length === 0) {
    return { ok: false, code: "sem_envios", error: "A comanda não possui nenhum envio ativo para fechar." };
  }

  if (ativos.some((envio) => !envio.status)) {
    return { ok: false, code: "sincronizacao_pendente", error: "Não foi possível confirmar a situação de todos os envios. Atualize e tente novamente." };
  }

  if (ativos.some((envio) => envio.status !== "entregue")) {
    return { ok: false, code: "envio_pendente", error: "Todos os pedidos ativos precisam estar servidos antes de pedir a conta." };
  }

  return { ok: true, totalCentavos: totalAtivoCentavos(params.envios) };
}

export function contaBloqueiaNovosItens(estado: EstadoContaSalao): boolean {
  return estado.status !== "aberta";
}

export function compararTotalEsperado(totalEsperadoCentavos: unknown, totalOficialCentavos: number): boolean {
  return Number.isInteger(totalEsperadoCentavos)
    && Number(totalEsperadoCentavos) >= 0
    && Math.abs(Number(totalEsperadoCentavos) - totalOficialCentavos) <= 1;
}
