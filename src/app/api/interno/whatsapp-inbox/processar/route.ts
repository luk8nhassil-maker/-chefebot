import { NextRequest, NextResponse } from "next/server";
import { Receiver } from "@upstash/qstash";
import { POST as processarWebhook } from "@/app/api/whatsapp/route";
import {
  agendarInboxWhatsapp,
  comEscopoWorkerInbox,
  processarLoteInbox,
  urlWorkerInboxAssinada,
} from "@/lib/whatsappInbox";

// Isolado do webhook público. QStash exige assinatura para cada callback;
// não aceite headers informais vindos do navegador.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const signature = req.headers.get("upstash-signature");
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  const expectedUrl = urlWorkerInboxAssinada();
  if (!signature || !expectedUrl || !currentSigningKey || !nextSigningKey) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const body = await req.text();
  try {
    const receiver = new Receiver({ currentSigningKey, nextSigningKey });
    if (!await receiver.verify({ signature, body, url: expectedUrl })) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let result: Awaited<ReturnType<typeof processarLoteInbox>>;
  try {
    result = await processarLoteInbox(async (job) => {
      if (!job.payload || typeof job.payload !== "object") return false;
      // O contexto AsyncLocalStorage impede re-enfileirar o mesmo evento.
      const internalReq = new NextRequest("https://chefedapizza.com.br/api/whatsapp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(job.payload),
      });
      const response = await comEscopoWorkerInbox(() => processarWebhook(internalReq));
      if (!response.ok) return false;
      const data = await response.json().catch(() => null);
      return data?.ok === true;
    }, 60, 4);
  } catch {
    // Erro da própria fila/Redis deve manter a chamada recuperável pelo QStash.
    return NextResponse.json({ ok: false, motivo: "worker_inbox_indisponivel" }, { status: 503 });
  }

  // Continua drenando em novo callback, sem manter a função aberta. Quando
  // só há jobs ambíguos, o próximo lote processa 0 e não cria loop infinito.
  if (result.queue.pending > 0 && result.processed > 0) {
    await agendarInboxWhatsapp(true);
  }
  return NextResponse.json({ ok: true, ...result });
}
