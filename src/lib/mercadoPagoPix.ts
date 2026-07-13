export type CriarCobrancaPixMercadoPagoInput = {
  pedidoId: string;
  txid: string;
  valorEsperado: number;
  descricao?: string;
  clienteNome?: string;
  payerEmail?: string;
  accessTokenOverride?: string | null;
  payerEmailFallbackOverride?: string;
};

export type CobrancaPixMercadoPago = {
  provider: "mercadopago";
  providerPaymentId: string;
  qrCode: string;
  qrCodeBase64: string;
  ticketUrl: string;
  idempotencyKey: string;
  statusOriginal: string;
};

const MERCADO_PAGO_PIX_URL = "https://api.mercadopago.com/v1/payments";

export class MercadoPagoPixError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MercadoPagoPixError";
  }
}

function gerarIdempotencyKey(txid: string): string {
  return `chefebot_pix_${txid}`;
}

function normalizarValor(valor: number): number {
  return Math.round(valor * 100) / 100;
}

export async function criarCobrancaPixMercadoPago(
  input: CriarCobrancaPixMercadoPagoInput
): Promise<CobrancaPixMercadoPago> {
  const accessToken = input.accessTokenOverride || process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!accessToken) {
    throw new MercadoPagoPixError("MERCADOPAGO_ACCESS_TOKEN ausente");
  }

  const payerEmail = input.payerEmail || input.payerEmailFallbackOverride || process.env.MERCADOPAGO_PAYER_EMAIL_FALLBACK;
  if (!payerEmail) {
    throw new MercadoPagoPixError("payerEmail ausente");
  }

  const idempotencyKey = gerarIdempotencyKey(input.txid);
  const payload = {
    transaction_amount: normalizarValor(input.valorEsperado),
    description: input.descricao || `Pedido ChefeBot ${input.pedidoId}`,
    payment_method_id: "pix",
    external_reference: input.txid,
    metadata: {
      pedidoId: input.pedidoId,
      txid: input.txid,
    },
    payer: {
      email: payerEmail,
      ...(input.clienteNome ? { first_name: input.clienteNome } : {}),
    },
  };

  const response = await fetch(MERCADO_PAGO_PIX_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.message || data?.error || response.statusText || "erro_desconhecido";
    throw new MercadoPagoPixError(`Mercado Pago Pix falhou: ${detail}`);
  }

  const transactionData = data?.point_of_interaction?.transaction_data;
  return {
    provider: "mercadopago",
    providerPaymentId: String(data?.id || ""),
    qrCode: String(transactionData?.qr_code || ""),
    qrCodeBase64: String(transactionData?.qr_code_base64 || ""),
    ticketUrl: String(transactionData?.ticket_url || ""),
    idempotencyKey,
    statusOriginal: String(data?.status || ""),
  };
}
