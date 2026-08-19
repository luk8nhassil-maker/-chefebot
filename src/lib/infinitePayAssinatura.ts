import { formatarMoedaCentavos, PLANOS_ASSINATURA_CHEFEBOT, type PlanoAssinaturaId } from "./assinaturaChefeBot";
import type { FaturaAssinaturaChefeBot } from "./assinaturaChefeBot.server";

const LINKS_URL = "https://api.checkout.infinitepay.io/links";
const PAYMENT_CHECK_URL = "https://api.checkout.infinitepay.io/payment_check";

function handleInfinitePay(): string {
  const handle = process.env.INFINITEPAY_HANDLE?.trim();
  if (!handle) throw new Error("INFINITEPAY_HANDLE_not_configured");
  return handle;
}

function baseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;

  // Vercel injeta a URL de produção do próprio projeto. Isso evita exigir
  // uma segunda variável só para construir redirect/webhook e, sobretudo,
  // impede acoplamento a qualquer URL de outro projeto.
  const vercelProductionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ?.trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  if (vercelProductionUrl) return `https://${vercelProductionUrl}`;

  throw new Error("production_url_not_configured");
}

function garantirProducao() {
  if (process.env.VERCEL_ENV !== "production") {
    throw new Error("real_checkout_blocked_outside_production");
  }
}

async function fetchJson(url: string, init: RequestInit, timeoutMs = 7000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`infinitepay_http_${response.status}`);
    return data as Record<string, unknown>;
  } finally {
    clearTimeout(timeout);
  }
}

export async function criarCheckoutInfinitePayAssinatura(fatura: FaturaAssinaturaChefeBot): Promise<string> {
  garantirProducao();
  const plano = PLANOS_ASSINATURA_CHEFEBOT[fatura.targetPlanId];
  const appUrl = baseUrl();
  const descricao = fatura.type === "upgrade"
    ? `Upgrade proporcional ChefeBot para ${plano.nome} — ${formatarMoedaCentavos(fatura.amountCentavos)}`
    : `Assinatura mensal ChefeBot ${plano.nome}`;

  const data = await fetchJson(LINKS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      handle: handleInfinitePay(),
      redirect_url: `${appUrl}/pedidos?assinatura_retorno=1`,
      webhook_url: `${appUrl}/api/assinatura/webhook/infinitepay`,
      order_nsu: fatura.orderNsu,
      items: [{ quantity: 1, price: fatura.amountCentavos, description: descricao }],
    }),
  });

  const url = typeof data.url === "string" ? data.url : "";
  if (!/^https:\/\//.test(url)) throw new Error("infinitepay_invalid_checkout_url");
  return url;
}

export async function verificarPagamentoInfinitePay(params: {
  orderNsu: string;
  transactionNsu: string;
  slug: string;
}): Promise<{ paid: boolean; amount: number; paidAmount?: number; captureMethod?: string }> {
  garantirProducao();
  const data = await fetchJson(PAYMENT_CHECK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      handle: handleInfinitePay(),
      order_nsu: params.orderNsu,
      transaction_nsu: params.transactionNsu,
      slug: params.slug,
    }),
  });

  return {
    paid: data.paid === true && data.success !== false,
    amount: typeof data.amount === "number" ? Math.trunc(data.amount) : -1,
    paidAmount: typeof data.paid_amount === "number" ? Math.trunc(data.paid_amount) : undefined,
    captureMethod: typeof data.capture_method === "string" ? data.capture_method : undefined,
  };
}

export function planoIdValidoInfinitePay(value: unknown): value is PlanoAssinaturaId {
  return typeof value === "string" && value in PLANOS_ASSINATURA_CHEFEBOT;
}
