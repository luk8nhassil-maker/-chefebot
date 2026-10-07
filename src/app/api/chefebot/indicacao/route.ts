import { NextRequest, NextResponse } from "next/server";
import { registrarLeadIndicacaoRadarVendas } from "@/lib/radarVendasEntitlement.server";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }

  // Campo invisível para bots simples. Não sinaliza o motivo para não ensinar o bypass.
  if (typeof body.website === "string" && body.website.trim()) {
    return NextResponse.json({ ok: true });
  }

  const result = await registrarLeadIndicacaoRadarVendas({
    token: body.ref,
    nome: body.nome,
    pizzaria: body.pizzaria,
    whatsapp: body.whatsapp,
  });

  if (!result.ok) {
    const status = result.reason === "invalid_referral" ? 404 : 400;
    return NextResponse.json({ ok: false, error: result.reason }, { status });
  }

  return NextResponse.json({ ok: true, duplicate: result.duplicate }, {
    status: result.duplicate ? 200 : 201,
    headers: { "Cache-Control": "no-store" },
  });
}
