import { NextRequest, NextResponse } from "next/server";
import { lerPicosTrafegoWhatsapp } from "@/lib/whatsappTrafficPeak";
import { avaliarSaudeInbox, type InboxScheduleHealth } from "@/lib/whatsappInboxReadiness";
import { urlWorkerInboxAssinada } from "@/lib/whatsappInbox";

// Leitura autenticada e sem efeitos: não cria agenda, não envia mensagens.
// Não retornar URL, headers ou token do QStash na API.
async function verificarAgendaRecuperacao(): Promise<InboxScheduleHealth> {
  const base = process.env.QSTASH_URL?.trim();
  const token = process.env.QSTASH_TOKEN?.trim();
  const destino = urlWorkerInboxAssinada;
  if (!base || !token || !destino) return "nao_configurada";
  try {
    const u = new URL(base);
    if (u.protocol !== "https:" || u.pathname !== "/"
        || !["qstash.upstash.io", "qstash-us-east-1.upstash.io", "qstash-eu-central-1.upstash.io"].includes(u.hostname)) {
      return "nao_configurada";
    }
    const endpoint = new URL("/v2/schedules/chefebot-whatsapp-inbox-recovery-v1", u.origin);
    const r = await fetch(endpoint, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (r.status === 404) return "ausente";
    if (!r.ok) return "indisponivel";
    const schedule: unknown = await r.json();
    if (!schedule || typeof schedule !== "object") return "incorreta";
    const props = schedule as { destination?: unknown; cron?: unknown; isPaused?: unknown };
    return props.destination === destino && props.cron === "*/5 * * * *" && props.isPaused !== true ? "ok" : "incorreta";
  } catch {
    return "indisponivel";
  }
}

import { configuracaoRolloutInboxWhatsapp } from "@/lib/whatsappInboxRollout";
import { webhookEvolutionProtegido } from "@/lib/evolutionWebhookAuth";
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
  const rollout = configuracaoRolloutInboxWhatsapp();
  try {
    const [data, agendaRecuperacao, trafego] = await Promise.all([resumoInboxWhatsapp(), verificarAgendaRecuperacao(), lerPicosTrafegoWhatsapp()]);
    const active = inboxAtivaParaClientes() && config.ready;
    const avaliacao = avaliarSaudeInbox(data, agendaRecuperacao, active);
    return NextResponse.json({
      checkedAt: Date.now(),
      rollout: rollout.mode,
      rolloutValid: rollout.valid,
      allowedPhoneCount: rollout.phones.length,
      gradualSupported: true,
      ingressGuardConfigured: webhookEvolutionProtegido(),
      active,
      agendaRecuperacao,
      avaliacao,
      trafego,
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
