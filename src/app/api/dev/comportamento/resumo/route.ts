import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { behaviorAnalyticsEnabled } from "@/lib/behaviorAnalytics";
import { resumirFunilComportamental } from "@/lib/behaviorAnalyticsRead";

const PERIODOS = new Set([7, 30, 60, 90]);

async function devAutorizado(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get("auth-token")?.value;
  if (!token) return false;
  const payload = await verifyToken(token);
  return !!payload && payload.role === "dev";
}

export async function GET(req: NextRequest) {
  if (!behaviorAnalyticsEnabled()) {
    return NextResponse.json(
      { error: "Recurso indisponivel" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!(await devAutorizado(req))) {
    return NextResponse.json(
      { error: "Nao autorizado" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const dias = Number(req.nextUrl.searchParams.get("periodo") ?? "30");
  if (!PERIODOS.has(dias)) {
    return NextResponse.json(
      { error: "periodo deve ser 7, 30, 60 ou 90" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const endMs = Date.now();
  const startMs = endMs - dias * 24 * 60 * 60 * 1000;
  const summary = await resumirFunilComportamental({ startMs, endMs });

  return NextResponse.json(
    { ok: true, periodoDias: dias, summary },
    {
      headers: {
        "Cache-Control": "no-store",
        "X-ChefeBot-Analytics": "behavior-summary-v1",
      },
    },
  );
}
