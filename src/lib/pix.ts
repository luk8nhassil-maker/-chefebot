import { temPixNoPagamento, valorPixEsperado } from "./bot";
import { criarCobrancaPixMercadoPago } from "./mercadoPagoPix";

export type PixMetadata = {
  txid?: string;
  valorEsperado?: number;
  status?: "pendente" | "confirmado";
  confirmadoPor?: "manual" | "webhook" | "comprovante";
  confirmadoEm?: string;
  provider?: "mercadopago";
  providerPaymentId?: string;
  qrCode?: string;
  qrCodeBase64?: string;
  ticketUrl?: string;
  idempotencyKey?: string;
};

export type PixWebhookPayload = {
  txid?: string;
  valor?: number;
  status?: string;
  providerPaymentId?: string;
};

export type PedidoComPix = {
  id?: string;
  total?: number;
  pix?: PixMetadata;
};

export type PixWebhookResultado = {
  wouldConfirm: boolean;
  reason?: string;
  pedidoId?: string;
  txid?: string;
  valorEsperado?: number;
  valorRecebido?: number;
  providerPaymentId?: string;
};

export type PrepararPixProviderInput = {
  pedidoId: string;
  pix: PixMetadata | undefined;
  descricao?: string;
  clienteNome?: string;
  payerEmail?: string;
};

const STATUS_PIX_PAGO = new Set(["pago", "paid", "liquidado", "settled", "confirmed", "confirmado"]);

function emCentavos(valor: number): number {
  return Math.round(valor * 100);
}

export function gerarTxidPixInterno(pedidoId: string): string {
  return `chefebot_${pedidoId}`;
}

export function criarPixMetadata(pedidoId: string, pagamento: string | undefined, total: number): PixMetadata | undefined {
  if (!temPixNoPagamento(pagamento)) return undefined;

  return {
    txid: gerarTxidPixInterno(pedidoId),
    valorEsperado: valorPixEsperado(pagamento, total),
    status: "pendente",
  };
}

export async function prepararPixProviderMercadoPago(input: PrepararPixProviderInput): Promise<PixMetadata | undefined> {
  const pix = input.pix;
  if (!pix) return undefined;
  if (process.env.PIX_PROVIDER !== "mercadopago") return pix;
  if (!pix.txid || typeof pix.valorEsperado !== "number" || !Number.isFinite(pix.valorEsperado)) return pix;

  try {
    const cobranca = await criarCobrancaPixMercadoPago({
      pedidoId: input.pedidoId,
      txid: pix.txid,
      valorEsperado: pix.valorEsperado,
      descricao: input.descricao,
      clienteNome: input.clienteNome,
      payerEmail: input.payerEmail,
    });

    return {
      ...pix,
      provider: cobranca.provider,
      providerPaymentId: cobranca.providerPaymentId,
      qrCode: cobranca.qrCode,
      qrCodeBase64: cobranca.qrCodeBase64,
      ticketUrl: cobranca.ticketUrl,
      idempotencyKey: cobranca.idempotencyKey,
      status: "pendente",
    };
  } catch (error) {
    console.warn("[Pix] Mercado Pago indisponivel; mantendo Pix manual", error);
    return pix;
  }
}

export function avaliarWebhookPixPassivo(payload: PixWebhookPayload, pedidos: PedidoComPix[]): PixWebhookResultado {
  const txid = typeof payload.txid === "string" ? payload.txid.trim() : "";
  const valorRecebido = Number(payload.valor);
  const status = typeof payload.status === "string" ? payload.status.trim().toLowerCase() : "";

  if (!txid) return { wouldConfirm: false, reason: "txid_obrigatorio" };
  if (!Number.isFinite(valorRecebido)) return { wouldConfirm: false, reason: "valor_invalido", txid };

  const pedido = pedidos.find((p) => p.pix?.txid === txid);
  if (!pedido) return { wouldConfirm: false, reason: "pedido_nao_encontrado", txid, valorRecebido };
  if (!pedido.pix) return { wouldConfirm: false, reason: "pedido_sem_pix", pedidoId: pedido.id, txid, valorRecebido };
  if (pedido.pix.status === "confirmado") {
    return {
      wouldConfirm: false,
      reason: "pix_ja_confirmado",
      pedidoId: pedido.id,
      txid,
      valorEsperado: pedido.pix.valorEsperado,
      valorRecebido,
      providerPaymentId: payload.providerPaymentId,
    };
  }
  const valorEsperado = pedido.pix.valorEsperado;
  if (typeof valorEsperado !== "number" || !Number.isFinite(valorEsperado)) {
    return { wouldConfirm: false, reason: "pix_valor_esperado_ausente", pedidoId: pedido.id, txid, valorRecebido };
  }
  if (emCentavos(valorRecebido) !== emCentavos(valorEsperado)) {
    return {
      wouldConfirm: false,
      reason: "valor_divergente",
      pedidoId: pedido.id,
      txid,
      valorEsperado,
      valorRecebido,
      providerPaymentId: payload.providerPaymentId,
    };
  }
  if (!STATUS_PIX_PAGO.has(status)) {
    return {
      wouldConfirm: false,
      reason: "status_nao_pago",
      pedidoId: pedido.id,
      txid,
      valorEsperado,
      valorRecebido,
      providerPaymentId: payload.providerPaymentId,
    };
  }

  return {
    wouldConfirm: true,
    pedidoId: pedido.id,
    txid,
    valorEsperado,
    valorRecebido,
    providerPaymentId: payload.providerPaymentId,
  };
}
