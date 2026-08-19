import { NextRequest, NextResponse } from "next/server";
import { usuarioAssinatura } from "@/lib/assinaturaApiAuth";
import { confirmarPagamentoAssinaturaChefeBot, lerFaturaAssinaturaChefeBot } from "@/lib/assinaturaChefeBot.server";
import { verificarPagamentoInfinitePay } from "@/lib/infinitePayAssinatura";

function textoCurto(value: unknown, max = 200): string {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : "";
}

export async function POST(req: NextRequest) {
  if (!(await usuarioAssinatura(req))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  if (process.env.VERCEL_ENV !== "production") {
    return NextResponse.json(
      { ok: false, error: "real_payment_confirmation_blocked_outside_production" },
      { status: 409 },
    );
  }

  const body = await req.json().catch(() => null);
  const orderNsu = textoCurto(body?.orderNsu, 160);
  const transactionNsu = textoCurto(body?.transactionNsu);
  const slug = textoCurto(body?.slug, 160);
  if (!orderNsu || !transactionNsu || !slug) {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }

  const fatura = await lerFaturaAssinaturaChefeBot(orderNsu);
  if (!fatura) return NextResponse.json({ ok: false, error: "invoice_not_found" }, { status: 404 });

  try {
    const check = await verificarPagamentoInfinitePay({ orderNsu, transactionNsu, slug });
    if (!check.paid || check.amount !== fatura.amountCentavos) {
      return NextResponse.json({ ok: false, error: "payment_not_confirmed" }, { status: 409 });
    }
    const result = await confirmarPagamentoAssinaturaChefeBot({
      orderNsu,
      transactionNsu,
      amountCentavos: check.amount,
      captureMethod: check.captureMethod,
      invoiceSlug: slug,
    });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.reason }, { status: 409 });
    return NextResponse.json({ ok: true, alreadyApplied: result.alreadyApplied });
  } catch {
    return NextResponse.json({ ok: false, error: "verification_unavailable" }, { status: 503 });
  }
}
