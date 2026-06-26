import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { verifyToken } from "@/lib/auth";
import { registrarMensagem } from "@/lib/conversa";
import { validarEnvioMensagemHumana } from "@/lib/validarEnvioMensagemHumana";

const _evUrl =
  process.env.EVOLUTION_API_URL ?? "evolution-api-production-8f99.up.railway.app";
const EVOLUTION_BASE = _evUrl.startsWith("http") ? _evUrl : `https://${_evUrl}`;

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

  const emManual = await redis.get<boolean>(`manual:${phone}`);
  if (!emManual) {
    return NextResponse.json(
      { ok: false, error: "Conversa não está em atendimento humano" },
      { status: 409 },
    );
  }

  // Envia a mensagem pelo WhatsApp real via Evolution API
  try {
    const delay = Math.min(2500, Math.max(900, text.length * 22));
    const evResponse = await fetch(`${EVOLUTION_BASE}/message/sendText/chefebot`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.EVOLUTION_API_KEY!,
      },
      body: JSON.stringify({
        number: phone,
        text,
        delay,
        options: { delay, presence: "composing" },
      }),
    });

    if (!evResponse.ok) {
      return NextResponse.json(
        { ok: false, error: "Falha ao enviar mensagem para o WhatsApp" },
        { status: 502 },
      );
    }
  } catch {
    return NextResponse.json(
      { ok: false, error: "Falha ao enviar mensagem para o WhatsApp" },
      { status: 502 },
    );
  }

  // Só registra após confirmação de envio bem-sucedido pela Evolution API
  await registrarMensagem(phone, "atendente", `[${senderName}] ${text}`);
  await redis.del(`nova_msg_manual:${phone}`);

  return NextResponse.json({ ok: true, senderName, phone });
}

// Tipo helper local para o narrowing após validação
interface ValidacaoEnvioOk {
  ok: true;
  phone: string;
  text: string;
  senderName: string;
}
