import { NextRequest, NextResponse } from "next/server";
import { autenticarRequisicao, exigirRole } from "@/lib/apiAuth";
import {
  configuracaoInboxWhatsapp, inboxAtivaParaClientes, resumoInboxWhatsapp,
} from "@/lib/whatsappInbox";

// Painel técnico exclusivo dev, somente leitura: não drena nem altera jobs.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await autenticarRequisicao(req);
  const denied = exigirRole(user, ["dev"]);
  if (denied) return denied;
  const config = configuracaoInboxWhatsapp();
  try {
    const data = await resumoInboxWhatsapp();
    return NextResponse.json({
      checkedAt: Date.now(),
      rollout: process.env.WHATSAPP_INBOX_ROLLOUT === "all" ? "all" : "off",
      active: inboxAtivaParaClientes() && config.ready,
      configuration: config,
      queue: data,
      warning: data.ambiguousTotal > 0 || data.unresolved > 0
        ? "Existem jobs em quarentena; não reenvie sem reconciliação individual"
        : null,
      note: "Contadores desde o início da inbox. done significa processamento local, não entrega no aparelho.",
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch {
    return NextResponse.json({
      checkedAt: Date.now(), active: false, configuration: config,
      error: "inbox_redis_indisponivel",
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
