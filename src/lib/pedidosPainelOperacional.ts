import {
  chaveExpedienteDoPedido,
  chaveExpedienteOperacional,
  type PedidoComTempoOperacional,
} from "./expedienteOperacional";

type PedidoPainelOperacional = PedidoComTempoOperacional & {
  status?: unknown;
};

const STATUS_TERMINAIS = new Set(["entregue", "cancelado"]);

/**
 * Visibilidade da área operacional do painel:
 * - todo pedido NÃO terminal continua visível, inclusive carry-over do turno
 *   anterior, para nunca esconder uma pendência;
 * - pedido terminal aparece somente no expediente em que nasceu;
 * - pedido legado sem instante confiável permanece visível (fail-open para
 *   histórico operacional), evitando sumiço silencioso de dado antigo.
 *
 * Esta função não arquiva, apaga ou altera pedido algum. É só uma projeção de
 * leitura para a tela /pedidos.
 */
export function pedidosVisiveisNoPainel<T extends PedidoPainelOperacional>(
  pedidos: readonly T[],
  agora: number = Date.now()
): T[] {
  if (!Array.isArray(pedidos)) return [];
  const expedienteAtual = chaveExpedienteOperacional(agora);

  return pedidos.filter((pedido) => {
    const status = typeof pedido?.status === "string" ? pedido.status : "";
    if (!STATUS_TERMINAIS.has(status)) return true;

    const expedientePedido = chaveExpedienteDoPedido(pedido, agora);
    if (expedientePedido === null) return true;
    return expedientePedido === expedienteAtual;
  });
}
