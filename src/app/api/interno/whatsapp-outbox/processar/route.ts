import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { Receiver } from "@upstash/qstash";
import { executarJobWhatsapp } from "@/lib/whatsappMensagem";
import { registrarMensagemOutbox } from "@/lib/conversa";
import { marcarEcoPainel } from "@/lib/conversaEcoPainel";
import { marcarOutboundConfirmado } from "@/lib/whatsappDiag";
import {
  agendarDrenoWhatsapp,
  processarFilaWhatsapp,
  recuperarLeasesWhatsapp,
  resumoFilaWhatsapp,
  sincronizarHistoricoMensagensHumanas,
  urlWorkerWhatsappAssinada,
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
  const urlAssinada = urlWorkerWhatsappAssinada();
  if (!urlAssinada) return NextResponse.json({ ok: false, motivo: "callback_nao_configurado" }, { status: 503 });
  try {
    if (!await verifier.verify({ signature, body, url: urlAssinada })) return NextResponse.json({ ok: false, motivo: "assinatura_invalida" }, { status: 401 });
  } catch {
    return NextResponse.json({ ok: false, motivo: "assinatura_invalida" }, { status: 401 });
  }
  const recovered = await recuperarLeasesWhatsapp();
  // Processa lote maior que a concorrência, mantendo o limite global no
  // Redis. Isso evita que uma fila acumulada dependa de novos enfileiramentos.
  const drained = await processarFilaWhatsapp(async (job) => {
    const result = await executarJobWhatsapp(job);
    // O webhook fromMe pode chegar logo após a confirmação HTTP. Registre a
    // marca antes de o job ser finalizado e antes do histórico assíncrono;
    // somente jobs gerados pelo sistema recebem a marca, nunca mensagens do
    // iPhone/WhatsApp Business digitadas manualmente.
    if (result.ok && (job.humanSenderName || job.history) && typeof result.messageIdInterno === "string") {
      // Falha secundária no marcador de eco NÃO transforma em "ambíguo" um
      // sendText já confirmado pela Evolution. O sincronizador de histórico
      // tenta marcar novamente antes de gravar a mensagem idempotente.
      try {
        await marcarEcoPainel(result.messageIdInterno);
      } catch {
        // Sem log de ID, telefone ou conteúdo da mensagem.
      }
    }
    return result;
  }, 8, 100);
  const humanHistorySynced = await sincronizarHistoricoMensagensHumanas(async (job) => {
    const result = job.result as { messageIdInterno?: unknown } | undefined;
    if (job.humanSenderName) {
      if (typeof result?.messageIdInterno === "string") await marcarEcoPainel(result.messageIdInterno);
      await registrarMensagemOutbox(job.phone, "atendente", `[${job.humanSenderName}] ${job.text}`, job.id);
    } else if (job.history) {
      if (typeof result?.messageIdInterno === "string") await marcarEcoPainel(result.messageIdInterno);
      await registrarMensagemOutbox(job.phone, job.history.autor, job.history.texto, job.id);
      if (job.history.markOutbound) await marcarOutboundConfirmado();
    }
  });
  const queue = await resumoFilaWhatsapp();
  // Um lote cheio agenda a continuação, mas a recuperação cron também cobre
  // falha de publicação ou interrupção do worker.
  if (queue.pending > 0) await agendarDrenoWhatsapp();
  // Evidência de callback QStash assinado que terminou com sucesso.
  // Telemetria é melhor esforço: falha jamais altera o resultado do worker.
  try {
    await redis.hset("whatsapp:outbox:monitor:metrics", { lastWorkerOkAt: Date.now() });
  } catch { /* apenas observabilidade */ }
  return NextResponse.json({ ok: true, recovered, ...drained, humanHistorySynced, queue });
}
