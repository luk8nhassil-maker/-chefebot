import type { PixMetadata, PixStatus } from "./pix";

export type StatusPedidoPublico = "novo" | "em_preparo" | "saiu_entrega" | "entregue" | "cancelado";
export type PagamentoPixStatusPublico = "aguardando_pix" | "pago" | "em_revisao" | "conferencia_manual" | "nao_pix";

export type PedidoStatusPublicoFonte = {
  id: string;
  numero?: number;
  status: StatusPedidoPublico;
  total: number;
  pagamento?: string;
  pixConfirmado?: boolean;
  pix?: PixMetadata;
  tipoEntrega?: string;
};

function pagamentoTemPix(pagamento: string | undefined): boolean {
  return String(pagamento || "").toLowerCase().includes("pix");
}

export function classificarPagamentoPixPublico(pedido: PedidoStatusPublicoFonte): PagamentoPixStatusPublico {
  if (pedido.pixConfirmado === true || pedido.pix?.status === "confirmado") return "pago";
  if (pedido.pix?.status === "suspeito") return "conferencia_manual";
  if (pedido.pix?.status === "em_revisao" || pedido.pix?.status === "comprovante_recebido") return "em_revisao";
  if (pedido.pix || pagamentoTemPix(pedido.pagamento)) return "aguardando_pix";
  return "nao_pix";
}

export function mensagemPagamentoPixPublico(status: PagamentoPixStatusPublico): { titulo: string; mensagem: string } {
  const mensagens: Record<PagamentoPixStatusPublico, { titulo: string; mensagem: string }> = {
    aguardando_pix: {
      titulo: "Aguardando Pix",
      mensagem: "Depois de pagar, envie o comprovante pelo WhatsApp para confirmar o pedido.",
    },
    pago: {
      titulo: "Pagamento confirmado",
      mensagem: "Seu pagamento foi confirmado e o pedido foi liberado para preparo.",
    },
    em_revisao: {
      titulo: "Comprovante em análise",
      mensagem: "Recebemos o comprovante. A equipe vai conferir os detalhes antes de liberar o pedido.",
    },
    conferencia_manual: {
      titulo: "Conferência manual necessária",
      mensagem: "Recebemos o comprovante, mas a equipe precisa conferir esse pagamento manualmente.",
    },
    nao_pix: {
      titulo: "Pedido recebido",
      mensagem: "Acompanhe o andamento do pedido por aqui.",
    },
  };
  return mensagens[status];
}

export function sanitizarPixStatusPublico(pix: PixMetadata | undefined): {
  status?: PixStatus;
  confirmadoPor?: PixMetadata["confirmadoPor"];
  evidencia?: { decisao?: NonNullable<PixMetadata["evidencia"]>["decisao"] };
} | undefined {
  if (!pix) return undefined;
  return {
    ...(pix.status ? { status: pix.status } : {}),
    ...(pix.confirmadoPor ? { confirmadoPor: pix.confirmadoPor } : {}),
    ...(pix.evidencia?.decisao ? { evidencia: { decisao: pix.evidencia.decisao } } : {}),
  };
}

export function montarStatusPublicoPedido(pedido: PedidoStatusPublicoFonte) {
  const pagamentoStatus = classificarPagamentoPixPublico(pedido);
  const texto = mensagemPagamentoPixPublico(pagamentoStatus);
  return {
    id: pedido.id,
    numero: pedido.numero,
    status: pedido.status,
    total: pedido.total,
    tipoEntrega: pedido.tipoEntrega,
    pixConfirmado: pedido.pixConfirmado === true || pedido.pix?.status === "confirmado",
    pagamentoStatus,
    pix: sanitizarPixStatusPublico(pedido.pix),
    ...texto,
  };
}
