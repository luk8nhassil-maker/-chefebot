import { temPixNoPagamento } from "./bot";
import type { PixMetadata } from "./pix";
import { telefonesCorrespondem } from "./telefone";

export type PedidoPixMatching = {
  id?: string;
  telefone?: string;
  status?: string;
  escalonado?: boolean;
  pixConfirmado?: boolean;
  pagamento?: string;
  pix?: PixMetadata;
};

export function pedidoPixPendenteCorrespondeTelefone(pedido: PedidoPixMatching, phone: string): boolean {
  return pedido.status === "novo"
    && !pedido.escalonado
    && !pedido.pixConfirmado
    && pedido.pix?.status !== "confirmado"
    && telefonesCorrespondem(pedido.telefone, phone)
    && (temPixNoPagamento(pedido.pagamento) || !!pedido.pix);
}

export function encontrarPedidoPixPendentePorTelefone<T extends PedidoPixMatching>(
  pedidos: T[],
  phone: string,
): T | undefined {
  return pedidos
    .filter((pedido) => pedidoPixPendenteCorrespondeTelefone(pedido, phone))
    .sort((a, b) => String(b.id || "").localeCompare(String(a.id || "")))[0];
}
