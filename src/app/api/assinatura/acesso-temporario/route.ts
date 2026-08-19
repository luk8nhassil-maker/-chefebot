import { NextRequest, NextResponse } from "next/server";
import { podeGerenciarAssinatura } from "@/lib/assinaturaApiAuth";
import { iniciarAcessoTemporarioChefeBot } from "@/lib/assinaturaChefeBot.server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!(await podeGerenciarAssinatura(req))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  // Preview/local nunca podem gravar a janela real de operação.
  if (process.env.VERCEL_ENV !== "production") {
    return NextResponse.json(
      { ok: false, error: "temporary_access_blocked_outside_production" },
      { status: 409 },
    );
  }

  try {
    const result = await iniciarAcessoTemporarioChefeBot();
    if (!result.ok) {
      const status = result.reason === "billing_not_configured" ? 409
        : result.reason === "subscription_not_blocked" ? 409
          : 423;
      return NextResponse.json({ ok: false, error: result.reason }, { status });
    }

    return NextResponse.json({
      ok: true,
      alreadyStarted: result.alreadyStarted,
      endsAt: result.endsAt,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "temporary_access_unavailable" }, { status: 503 });
  }
}
