import { NextRequest, NextResponse } from "next/server";
import { Receiver } from "@upstash/qstash";
import { executarJobWhatsapp } from "@/lib/whatsappMensagem";
import { processarFilaWhatsapp, recuperarLeasesWhatsapp, resumoFilaWhatsapp } from "@/lib/whatsappOutbox";

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
  const drained = await processarFilaWhatsapp(executarJobWhatsapp, 8);
  const queue = await resumoFilaWhatsapp();
  return NextResponse.json({ ok: true, recovered, ...drained, queue });
}
