export const PAGAMENTO_SALAO_EM_ABERTO = "Comanda em aberto";

export type PedidoMinimoSalaoCozinha = {
  id: string;
  status?: unknown;
  tipoEntrega?: unknown;
  endereco?: unknown;
  pagamento?: unknown;
};

/**
 * Identifica exclusivamente pedidos oficiais que ainda aguardam aceite da
 * cozinha e vieram do fluxo de comanda do Salão. A combinação de consumo no
 * local + pagamento interno "Comanda em aberto" é produzida pelo servidor nas
 * rotas do Salão; pedidos Delivery/retirada e pedidos manuais pagos não entram.
 */
export function ehPedidoSalaoParaInicioAutomatico(
  pedido: PedidoMinimoSalaoCozinha,
): boolean {
  const consumoNoLocal = pedido.tipoEntrega === "dine_in" || pedido.endereco === "Consumo no local";
  return pedido.status === "novo"
    && consumoNoLocal
    && pedido.pagamento === PAGAMENTO_SALAO_EM_ABERTO;
}

/** Preview/dev nunca pode avançar pedido real nem disparar impressão. */
export function cozinhaAutomaticaSalaoAtiva(vercelEnv: string | undefined): boolean {
  return vercelEnv === "production";
}

/** Reutiliza exatamente a transição oficial que já concede o claim de impressão. */
export function payloadInicioAutomaticoSalao(pedidoId: string) {
  return {
    id: pedidoId,
    status: "em_preparo" as const,
    // Pedido de mesa não tem WhatsApp operacional para receber mudança de status.
    silent: true as const,
  };
}

/** Mesma rota de cupom já usada pela impressão automática do painel. */
export function urlImpressaoAutomaticaSalao(pedidoId: string): string {
  return `/pedidos/${encodeURIComponent(pedidoId)}/imprimir?auto=1&embedded=1`;
}
