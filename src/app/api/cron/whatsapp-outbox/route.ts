import { NextResponse } from "next/server";
import { registrarMensagem } from "@/lib/conversa";
import { executarJobWhatsapp } from "@/lib/whatsappMensagem";
import {
  agendarDrenoWhatsapp,
  processarFilaWhatsapp,
  recuperarLeasesWhatsapp,
  resumoFilaWhatsapp,
  sincronizarHistoricoMensagensHumanas,
} from "@/lib/whatsappOutbox";

// Recuperação independente do publish QStash. A rota só é acionada pelo cron
// autenticado da plataforma e não cria schedules, chamadas ou custos externos
// durante o deploy/boot.
export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const recovered = await recuperarLeasesWhatsapp(500);
  const drained = await processarFilaWhatsapp(executarJobWhatsapp, 8, 100);
  const humanHistorySynced = await sincronizarHistoricoMensagensHumanas(async (job) => {
    await registrarMensagem(job.phone, "atendente", `[${job.humanSenderName}] ${job.text}`);
  });
  const queue = await resumoFilaWhatsapp();
  if (queue.pending > 0) void agendarDrenoWhatsapp();
  return NextResponse.json({ ok: true, recovered, ...drained, humanHistorySynced, queue });
}
