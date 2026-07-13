import { createHmac, timingSafeEqual } from "node:crypto";
import { resolveActiveMercadoPagoToken } from "./mercadoPagoIntegracao";
import type { PixWebhookPayload } from "./pix";

// Adaptador ISOLADO para o webhook real do Mercado Pago (Nivel 6.1). Traduz a
// notificacao MP para o `PixWebhookPayload` interno ja usado por
// `avaliarWebhookPixPassivo` — NAO altera geracao de Pix, serializador do
// cliente nem fallback manual. Nao muda token/env: reaproveita o token que o
// sistema ja resolve (`resolveActiveMercadoPagoToken`).

const MP_PAYMENTS_URL = "https://api.mercadopago.com/v1/payments";

export type MercadoPagoWebhookBody = {
  type?: string;
  action?: string;
  data?: { id?: string | number };
};

export type PagamentoMercadoPago = {
  id: string;
  status: string;
  transactionAmount: number | null;
  externalReference: string | null;
};

// 1. Deteccao — MP manda { type: "payment", data: { id } } (id numerico/string).
export function isMercadoPagoWebhook(body: unknown): body is MercadoPagoWebhookBody {
  if (!body || typeof body !== "object") return false;
  const b = body as MercadoPagoWebhookBody;
  if (b.type !== "payment") return false;
  const id = b.data?.id;
  return typeof id === "string" || typeof id === "number";
}

export function extrairPaymentIdMercadoPago(body: MercadoPagoWebhookBody): string | null {
  const id = body.data?.id;
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  if (typeof id === "string" && id.trim()) return id.trim();
  return null;
}

// 2. Assinatura — header x-signature no formato "ts=...,v1=...".
export function parseXSignature(header: string | null): { ts: string; v1: string } | null {
  if (!header) return null;
  let ts = "";
  let v1 = "";
  for (const parte of header.split(",")) {
    const idx = parte.indexOf("=");
    if (idx < 0) continue;
    const chave = parte.slice(0, idx).trim();
    const valor = parte.slice(idx + 1).trim();
    if (chave === "ts") ts = valor;
    else if (chave === "v1") v1 = valor;
  }
  if (!ts || !v1) return null;
  return { ts, v1 };
}

// Manifest no padrao Mercado Pago: id:<data.id>;request-id:<x-request-id>;ts:<ts>;
// HMAC-SHA256 com MERCADOPAGO_WEBHOOK_SECRET, comparado com timingSafeEqual.
export function validarAssinaturaMercadoPago(params: {
  dataId: string;
  xSignature: string | null;
  xRequestId: string | null;
  secret: string | undefined;
}): boolean {
  const { dataId, xSignature, xRequestId, secret } = params;
  if (!secret || !dataId) return false;
  const parsed = parseXSignature(xSignature);
  if (!parsed) return false;

  const manifest = `id:${dataId};request-id:${xRequestId ?? ""};ts:${parsed.ts};`;
  const esperado = createHmac("sha256", secret).update(manifest).digest("hex");

  const a = Buffer.from(esperado, "utf8");
  const b = Buffer.from(parsed.v1, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// 3. Busca autoritativa do pagamento no Mercado Pago (nunca confia no corpo).
export async function buscarPagamentoMercadoPago(paymentId: string): Promise<PagamentoMercadoPago | null> {
  const token = await resolveActiveMercadoPagoToken();
  if (!token) return null;

  const res = await fetch(`${MP_PAYMENTS_URL}/${encodeURIComponent(paymentId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;

  const data = await res.json().catch(() => null);
  if (!data || typeof data !== "object") return null;

  const bruto = data as Record<string, unknown>;
  return {
    id: String(bruto.id ?? paymentId),
    status: typeof bruto.status === "string" ? bruto.status : "",
    transactionAmount: typeof bruto.transaction_amount === "number" ? bruto.transaction_amount : null,
    externalReference: typeof bruto.external_reference === "string" ? bruto.external_reference : null,
  };
}

// 4. Mapeamento MP -> interno.
export function mapearStatusMercadoPago(mpStatus: string): "pago" | "pendente" | "rejeitado" {
  const s = mpStatus.trim().toLowerCase();
  if (s === "approved") return "pago";
  if (s === "pending" || s === "in_process") return "pendente";
  // rejected, cancelled, refunded, charged_back e quaisquer outros: nunca confirma.
  return "rejeitado";
}

export function mapearPagamentoParaPayloadInterno(pgto: PagamentoMercadoPago): PixWebhookPayload {
  return {
    txid: pgto.externalReference ?? undefined,
    valor: pgto.transactionAmount ?? undefined,
    status: mapearStatusMercadoPago(pgto.status),
    providerPaymentId: pgto.id,
  };
}
