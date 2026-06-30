import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import {
  getMercadoPagoIntegrationConfig,
  toMercadoPagoPublicConfig,
  updateMercadoPagoIntegrationConfig,
} from "@/lib/mercadoPagoIntegracao";

async function requireAdminOrDev(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return { ok: false as const, status: 401 };

  const user = await verifyToken(token);
  if (!user) return { ok: false as const, status: 401 };
  if (user.role !== "admin" && user.role !== "dev") return { ok: false as const, status: 403 };

  return { ok: true as const, user };
}

export async function GET(req: NextRequest) {
  const auth = await requireAdminOrDev(req);
  if (!auth.ok) return NextResponse.json({ error: "Nao autorizado" }, { status: auth.status });

  const config = await getMercadoPagoIntegrationConfig();
  return NextResponse.json(toMercadoPagoPublicConfig(config));
}

export async function PUT(req: NextRequest) {
  const auth = await requireAdminOrDev(req);
  if (!auth.ok) return NextResponse.json({ error: "Nao autorizado" }, { status: auth.status });

  const body = await req.json();
  const config = await updateMercadoPagoIntegrationConfig({
    enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
    accessToken: typeof body.accessToken === "string" ? body.accessToken : undefined,
    clearToken: body.clearToken === true,
    payerEmailFallback: typeof body.payerEmailFallback === "string" ? body.payerEmailFallback : undefined,
    updatedBy: auth.user.username,
  });

  return NextResponse.json({ ok: true, config: toMercadoPagoPublicConfig(config) });
}
