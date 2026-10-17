import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { verifyToken } from "@/lib/auth";
import { registrarMensagemOutbox } from "@/lib/conversa";
import { validarEnvioMensagemHumana } from "@/lib/validarEnvioMensagemHumana";
import { marcarEcoPainel } from "@/lib/conversaEcoPainel";
import { enviarTextoWhatsApp } from "@/lib/whatsappMensagem";
import { obterConfigEvolution } from "@/lib/evolutionApi";
import { confirmarHistoricoMensagemHumana, reivindicarHistoricoMensagemHumana } from "@/lib/whatsappOutbox";

async function checkAuth(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || !["atendente", "admin", "dev"].includes(payload.role as string))
    return null;
  return payload;
}

export async function POST(req: NextRequest) {
  const auth = await checkAuth(req);
  if (!auth)
    return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body inválido" }, { status: 400 });
  }

  const validacao = validarEnvioMensagemHumana({
    phone: body.phone as string | undefined,
    text: body.text as string | undefined,
    senderName: (body.senderName as string | undefined) ?? "Kellyne",
  });

  if (!validacao.ok) {
    return NextResponse.json({ ok: false, error: validacao.error }, { status: 400 });
  }

  const { phone, text, senderName } = validacao as Required<ValidacaoEnvioOk>;
  const clientMessageId = typeof body.clientMessageId === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(body.clientMessageId)
    ? body.clientMessageId
    : null;

  const emManual = await redis.get<boolean>(`manual:${phone}`);
  if (!emManual) {
    return NextResponse.json(
      { ok: false, error: "Conversa não está em atendimento humano" },
      { status: 409 },
    );
  }

  const delay = Math.min(2500, Math.max(900, text.length * 22));
  if (!obterConfigEvolution()) {
    return NextResponse.json({ ok: false, error: "Provider de WhatsApp não configurado (EVOLUTION_API_URL/EVOLUTION_API_KEY)" }, { status: 503 });
  }
  const resultado = await enviarTextoWhatsApp(phone, text, {
    delay, prioridade: "critica", humanSenderName: senderName,
    idempotencyKey: clientMessageId ? `human:${phone}:${clientMessageId}` : undefined,
  });
  // Aceite durável já representa atividade humana, mesmo se a confirmação da
  // Evolution vier depois. Assim o bot não reassume durante a espera.
  if (resultado.jobId) {
    await redis.set(`manual:${phone}`, true, { ex: 7200 });
    const sessaoEnvio = await redis.get(`session:${phone}`);
    if (sessaoEnvio) await redis.set(`session:${phone}`, sessaoEnvio, { ex: 7200 });
  }
  if (!resultado.ok) {
    if (resultado.motivo === "queued_pending") {
      // Aceite durável, ainda sem confirmação da Evolution. O painel recebe
      // um estado explícito e não deve reenviar pelo simples 202.
      return NextResponse.json({ ok: true, status: "queued", jobId: resultado.jobId, senderName, phone }, { status: 202 });
    }
    return NextResponse.json(
      {
        ok: false,
        status: resultado.motivo === "timeout" || resultado.motivo === "network_error" || resultado.statusHttp && resultado.statusHttp >= 500
          ? "ambiguous" : "failed",
        jobId: resultado.jobId,
        error: "Resultado do envio incerto; não reenvie. A mensagem foi preservada para reconciliação.",
      },
      { status: 502 },
    );
  }

    // Marca o messageId como eco do painel IMEDIATAMENTE após confirmar o
    // envio, ANTES de registrar a mensagem no histórico — fecha a janela de
    // corrida em que o webhook fromMe (eco da Evolution) chegaria entre o
    // registro e a marcação e registraria a mensagem de novo. Sem messageId
    // confiável, não há deduplicação: a mensagem do painel será registrada
    // normalmente abaixo, e um eventual eco (se vier) será tratado no
    // webhook como uma mensagem "atendente" adicional — melhor um possível
    // duplicado raro do que descartar mensagens reais por dedup baseada só
    // em texto.
  if (!resultado.deduplicated && resultado.messageIdInterno) {
    try {
      await marcarEcoPainel(resultado.messageIdInterno);
    } catch {
      // O envio foi confirmado pelo provider. A gravação durável do histórico
      // poderá reexecutar o marcador; não mande o atendente reenviar a mensagem.
    }
  }

  // Só registra após confirmação de envio bem-sucedido pela Evolution API.
  // A claim evita duplicação com o worker assíncrono; se ele já tiver tomado
  // a claim, o índice durável dele atualizará o histórico em seguida.
  if (!resultado.deduplicated && resultado.jobId && await reivindicarHistoricoMensagemHumana(resultado.jobId)) {
    await registrarMensagemOutbox(phone, "atendente", `[${senderName}] ${text}`, resultado.jobId);
    await confirmarHistoricoMensagemHumana(resultado.jobId);
  }
  await redis.del(`nova_msg_manual:${phone}`);

  return NextResponse.json({ ok: true, status: "delivered", jobId: resultado.jobId, senderName, phone });
}

// Tipo helper local para o narrowing após validação
interface ValidacaoEnvioOk {
  ok: true;
  phone: string;
  text: string;
  senderName: string;
}
