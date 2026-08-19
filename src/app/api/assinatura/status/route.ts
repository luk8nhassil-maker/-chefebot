import { NextRequest, NextResponse } from "next/server";
import { usuarioAssinatura } from "@/lib/assinaturaApiAuth";
import { statusAssinaturaChefeBot } from "@/lib/assinaturaChefeBot.server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await usuarioAssinatura(req);
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  try {
    const status = await statusAssinaturaChefeBot();
    const configuredForUi = status.configured || process.env.VERCEL_ENV === "preview";
    return NextResponse.json({
      ok: true,
      configured: configuredForUi,
      status: status.avaliacao.status,
      blocked: status.avaliacao.blocked,
      daysUntilDue: status.avaliacao.daysUntilDue,
      daysLate: status.avaliacao.daysLate,
      dueDate: status.avaliacao.dueDate,
      currentPlanId: status.estado.activePlanId,
      pendingDowngradePlanId: status.estado.pendingDowngradePlanId ?? null,
      paidThroughDate: status.estado.paidThroughDate ?? null,
      plans: status.plans,
      canManage: ["admin", "dev", "financeiro"].includes(user.role),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "billing_status_unavailable", blocked: false }, { status: 503 });
  }
}
