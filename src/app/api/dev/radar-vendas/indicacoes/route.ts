import { NextRequest, NextResponse } from "next/server";
import { usuarioAssinatura } from "@/lib/assinaturaApiAuth";
import { listarLeadsIndicacaoRadarVendas } from "@/lib/radarVendasEntitlement.server";

export async function GET(req: NextRequest) {
  const user = await usuarioAssinatura(req);
  if (!user || user.role !== "dev") {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const leads = await listarLeadsIndicacaoRadarVendas();
  return NextResponse.json({ ok: true, leads }, { headers: { "Cache-Control": "no-store" } });
}
