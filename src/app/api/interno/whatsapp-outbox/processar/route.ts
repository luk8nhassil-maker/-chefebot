import { NextRequest, NextResponse } from "next/server";
import { Receiver } from "@upstash/qstash";
import { executarJobWhatsapp } from "@/lib/whatsappMensagem";
import { registrarMensagem } from "@/lib/conversa";
import {
  agendarDrenoWhatsapp,
  processarFilaWhatsapp,
  recuperarLeasesWhatsapp,
  resumoFilaWhatsapp,
  sincronizarHistoricoMensagensHumanas,
} from "@/lib/whatsappOutbox";

function receiver(): Receiver | null {
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  return currentSigningKey && nextSigningKey ? new Receiver({ currentSigningKey, nextSigningKey }) : null;
}

// Worker exclusivo da outbox. A assinatura QStash impede disparo pelo
// navegador; cada execução só drena um lote curto e o limite real é o lease
// Redis compartilhado entre todas as instâncias.
export async function POST(req: NextRequest) {
  const body = await req.text();
  const verifier = receiver();
  if (!verifier) return NextResponse.json({ ok: false, motivo: "assinatura_nao_configurada" }, { status: 503 });
  const signature = req.headers.get("upstash-signature");
  if (!signature) return NextResponse.json({ ok: false, motivo: "assinatura_ausente" }, { status: 401 });
  try {
    if (!await verifier.verify({ signature, body })) return NextResponse.json({ ok: false, motivo: "assinatura_invalida" }, { status: 401 });
  } catch {
    return NextResponse.json({ ok: false, motivo: "assinatura_invalida" }, { status: 401 });
  }
  const recovered = await recuperarLeasesWhatsapp();
  // Processa lote maior que a concorrência, mantendo o limite global no
  // Redis. Isso evita que uma fila acumulada dependa de novos enfileiramentos.
  const drained = await processarFilaWhatsapp(executarJobWhatsapp, 8, 100);
  const humanHistorySynced = await sincronizarHistoricoMensagensHumanas(async (job) => {
    await registrarMensagem(job.phone, "atendente", `[${job.humanSenderName}] ${job.text}`);
  });
  const queue = await resumoFilaWhatsapp();
  // Um lote cheio agenda a continuação, mas a recuperação cron também cobre
  // falha de publicação ou interrupção do worker.
  if (queue.pending > 0) await agendarDrenoWhatsapp();
  return NextResponse.json({ ok: true, recovered, ...drained, humanHistorySynced, queue });
}
