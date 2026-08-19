import { NextRequest, NextResponse } from "next/server";
import { podeGerenciarAssinatura } from "@/lib/assinaturaApiAuth";
import { formatarDataLocalChefeBot } from "@/lib/assinaturaChefeBot";
import {
  assinaturaInfinitePayConfigurada,
  lerFaturaAssinaturaChefeBot,
  orderNsuAssinatura,
  prepararMudancaPlanoChefeBot,
  salvarFaturaAssinaturaChefeBot,
  type FaturaAssinaturaChefeBot,
} from "@/lib/assinaturaChefeBot.server";
import { criarCheckoutInfinitePayAssinatura, planoIdValidoInfinitePay } from "@/lib/infinitePayAssinatura";

export async function POST(req: NextRequest) {
  if (!(await podeGerenciarAssinatura(req))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!planoIdValidoInfinitePay(body?.planId)) {
    return NextResponse.json({ ok: false, error: "invalid_plan" }, { status: 400 });
  }
  if (!assinaturaInfinitePayConfigurada()) {
    return NextResponse.json({ ok: false, error: "billing_not_configured" }, { status: 503 });
  }
  if (process.env.VERCEL_ENV !== "production") {
    return NextResponse.json({ ok: false, error: "real_checkout_blocked_in_preview" }, { status: 409 });
  }

  try {
    const today = formatarDataLocalChefeBot();
    const change = await prepararMudancaPlanoChefeBot(body.planId, today);

    if (change.kind === "payment_required_before_change") {
      return NextResponse.json({
        ok: false,
        error: "pay_overdue_before_plan_change",
        currentPlanId: change.currentPlanId,
        amountCentavos: change.amountCentavos,
        dueDate: change.dueDate,
      }, { status: 409 });
    }
    if (change.kind === "downgrade") {
      return NextResponse.json({ ok: true, kind: "downgrade", effectiveOn: change.effectiveOn });
    }
    if (change.kind === "same") {
      return NextResponse.json({ ok: true, kind: "same" });
    }

    const type = change.kind === "upgrade" ? "upgrade" : "monthly";
    const orderNsu = orderNsuAssinatura({
      type,
      targetPlanId: change.targetPlanId,
      dueDate: change.dueDate,
      today,
    });

    const existente = await lerFaturaAssinaturaChefeBot(orderNsu);
    if (existente?.status === "pending" && existente.checkoutUrl) {
      return NextResponse.json({
        ok: true,
        kind: type,
        checkoutUrl: existente.checkoutUrl,
        amountCentavos: existente.amountCentavos,
        calculation: existente.calculation ?? null,
      });
    }

    const fatura: FaturaAssinaturaChefeBot = {
      orderNsu,
      type,
      targetPlanId: change.targetPlanId,
      amountCentavos: change.amountCentavos,
      dueDate: change.dueDate,
      status: "pending",
      createdAt: new Date().toISOString(),
      calculation: change.kind === "upgrade" ? change.calculation : undefined,
    };

    await salvarFaturaAssinaturaChefeBot(fatura);
    const checkoutUrl = await criarCheckoutInfinitePayAssinatura(fatura);
    await salvarFaturaAssinaturaChefeBot({ ...fatura, checkoutUrl });

    return NextResponse.json({
      ok: true,
      kind: type,
      checkoutUrl,
      amountCentavos: fatura.amountCentavos,
      calculation: fatura.calculation ?? null,
    });
  } catch (error) {
    console.error("[Assinatura ChefeBot] Falha ao criar checkout:", error instanceof Error ? error.message : "erro desconhecido");
    return NextResponse.json({ ok: false, error: "checkout_unavailable" }, { status: 503 });
  }
}
