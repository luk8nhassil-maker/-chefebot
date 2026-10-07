import { NextRequest, NextResponse } from "next/server";
import { usuarioAssinatura } from "@/lib/assinaturaApiAuth";
import { confirmarLeadPaganteRadarVendas } from "@/lib/radarVendasEntitlement.server";

export async function POST(req: NextRequest) {
  const user = await usuarioAssinatura(req);
  if (!user || user.role !== "dev") {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const leadId = typeof body?.leadId === "string" ? body.leadId : "";
  const result = await confirmarLeadPaganteRadarVendas(leadId);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.reason }, { status: result.reason === "lead_not_found" ? 404 : 400 });
  }
  return NextResponse.json({ ok: true, lead: result.lead, unlock: result.unlock }, {
    headers: { "Cache-Control": "no-store" },
  });
}
