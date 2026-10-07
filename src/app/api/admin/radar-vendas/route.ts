import { NextRequest, NextResponse } from "next/server";
import { usuarioAssinatura } from "@/lib/assinaturaApiAuth";
import { TENANT_PADRAO_ANALYTICS, type EventoAnalitico } from "@/lib/historicoAnalitico";
import { consultarEventosAnaliticosComFallback } from "@/lib/analyticsPedidosReadModel.server";
import { calcularRadarVendas } from "@/lib/radarVendas";
import { statusAcessoRadarVendas } from "@/lib/radarVendasEntitlement.server";

const JANELA_DIAS = 180;
const DIA_MS = 24 * 60 * 60 * 1000;

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await usuarioAssinatura(req);
  if (!user || !["admin", "dev"].includes(user.role)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const agora = Date.now();
  try {
    const [leitura, acesso] = await Promise.all([
      consultarEventosAnaliticosComFallback(
        TENANT_PADRAO_ANALYTICS,
        agora - JANELA_DIAS * DIA_MS,
        agora,
        agora,
      ),
      statusAcessoRadarVendas(),
    ]);
    const eventosComCliente = leitura.eventos.filter((evento): evento is EventoAnalitico => Boolean(evento.clienteId));
    const radar = calcularRadarVendas(eventosComCliente, agora, JANELA_DIAS);

    return NextResponse.json({
      ok: true,
      access: {
        active: acesso.ativo,
        source: acesso.fonte,
        currentPlanId: acesso.currentPlanId,
        permanentUnlock: acesso.desbloqueioPermanente,
        upgradePlanId: "pro",
      },
      summary: radar.resumo,
      dataSource: leitura.fonte,
      opportunities: acesso.ativo ? radar.oportunidades.slice(0, 50) : [],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[RadarVendas] Falha ao montar Radar:", error instanceof Error ? error.message : "erro desconhecido");
    return NextResponse.json({ ok: false, error: "radar_unavailable" }, { status: 503 });
  }
}
