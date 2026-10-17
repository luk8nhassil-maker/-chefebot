import { NextRequest, NextResponse } from "next/server";
import { autenticarRequisicao, exigirRole } from "@/lib/apiAuth";
import { lerMonitorWhatsapp } from "@/lib/whatsappMonitoramento";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const user = await autenticarRequisicao(req);
  const denied = exigirRole(user, ["dev"]);
  if (denied) return denied;
  try {
    const snapshot = await lerMonitorWhatsapp();
    return NextResponse.json(snapshot, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch {
    return NextResponse.json({ error: "Dados de monitoramento indisponíveis" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
// Sem métodos de escrita: não envia WhatsApp, não faz retry e não muda estágio.
