import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import {
  behaviorAnalyticsConfig,
  readBehaviorFunnelOverview,
} from "@/lib/behaviorAnalytics";

const VALID_PERIODS = [7, 30, 90] as const;
type ValidPeriod = (typeof VALID_PERIODS)[number];

async function authenticateAdmin(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || !["admin", "dev"].includes(payload.role)) return null;
  return payload;
}

export async function GET(req: NextRequest) {
  const config = behaviorAnalyticsConfig();
  if (!config) {
    return NextResponse.json(
      { error: "Recurso indisponivel" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const auth = await authenticateAdmin(req);
  if (!auth) {
    return NextResponse.json(
      { error: "Nao autorizado" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const periodParam = Number(req.nextUrl.searchParams.get("periodo") ?? "30");
  if (!(VALID_PERIODS as readonly number[]).includes(periodParam)) {
    return NextResponse.json(
      { error: "periodo deve ser 7, 30 ou 90" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const now = Date.now();
  const period = periodParam as ValidPeriod;
  const startMs = now - period * 24 * 60 * 60 * 1000;
  const overview = await readBehaviorFunnelOverview({
    startMs,
    endMs: now,
  });

  if (!overview) {
    return NextResponse.json(
      { error: "Recurso indisponivel" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      mode: "aggregate_behavior_read_only",
      periodDays: period,
      retentionDays: config.retentionDays,
      overview,
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "X-ChefeBot-Customer360": "aggregate-read-only",
      },
    },
  );
}
