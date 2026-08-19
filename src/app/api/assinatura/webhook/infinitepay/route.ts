import { NextRequest, NextResponse } from "next/server";
import { confirmarPagamentoAssinaturaChefeBot, lerFaturaAssinaturaChefeBot } from "@/lib/assinaturaChefeBot.server";
import { verificarPagamentoInfinitePay } from "@/lib/infinitePayAssinatura";

export const maxDuration = 10;

function textoCurto(value: unknown, max = 200): string {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : "";
}

export async function POST(req: NextRequest) {
  if (process.env.VERCEL_ENV !== "production") {
    return NextResponse.json(
      { success: false, message: "real_payment_webhook_blocked_outside_production" },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => null);
  const orderNsu = textoCurto(body?.order_nsu, 160);
  const transactionNsu = textoCurto(body?.transaction_nsu);
  const invoiceSlug = textoCurto(body?.invoice_slug, 160);

  if (!orderNsu || !transactionNsu || !invoiceSlug) {
    return NextResponse.json({ success: false, message: "invalid_payload" }, { status: 400 });
  }

  const fatura = await lerFaturaAssinaturaChefeBot(orderNsu);
  if (!fatura) {
    return NextResponse.json({ success: false, message: "invoice_not_found" }, { status: 400 });
  }

  try {
    // O webhook nunca libera o sistema sozinho. A confirmação final sempre
    // consulta payment_check e confere transação, slug e valor oficial.
    const check = await verificarPagamentoInfinitePay({ orderNsu, transactionNsu, slug: invoiceSlug });
    if (!check.paid || check.amount !== fatura.amountCentavos) {
      return NextResponse.json({ success: false, message: "payment_not_confirmed" }, { status: 400 });
    }

    const result = await confirmarPagamentoAssinaturaChefeBot({
      orderNsu,
      transactionNsu,
      amountCentavos: check.amount,
      captureMethod: check.captureMethod,
      invoiceSlug,
    });
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.reason }, { status: 400 });
    }

    return NextResponse.json({ success: true, message: null });
  } catch (error) {
    console.error("[Assinatura ChefeBot] Falha na confirmação InfinitePay:", error instanceof Error ? error.message : "erro desconhecido");
    return NextResponse.json({ success: false, message: "temporary_verification_failure" }, { status: 400 });
  }
}
