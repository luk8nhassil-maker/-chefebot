import { NextRequest, NextResponse } from "next/server";
import { usuarioAssinatura } from "@/lib/assinaturaApiAuth";
import { obterOuCriarTokenIndicacaoRadarVendas } from "@/lib/radarVendasEntitlement.server";

export async function POST(req: NextRequest) {
  const user = await usuarioAssinatura(req);
  if (!user || !["admin", "dev"].includes(user.role)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const token = await obterOuCriarTokenIndicacaoRadarVendas();
    return NextResponse.json({
      ok: true,
      sharePath: `/chefebot/indicacao?ref=${encodeURIComponent(token)}`,
      message: "Conheça o ChefeBot. Ele usa os dados da pizzaria para encontrar oportunidades de recompra e aumentar o ticket com mais inteligência.",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "referral_unavailable" }, { status: 503 });
  }
}
