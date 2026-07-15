import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { verifyToken } from "@/lib/auth";
import { registrarMensagem } from "@/lib/conversa";
import { validarEnvioMensagemHumana } from "@/lib/validarEnvioMensagemHumana";
import { obterConfigEvolution } from "@/lib/evolutionApi";
import { extrairMessageIdEnvio, marcarEcoPainel } from "@/lib/conversaEcoPainel";

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
  const config = obterConfigEvolution();
  if (!config) {
    return NextResponse.json(
      { ok: false, error: "Provider de WhatsApp não configurado (EVOLUTION_API_URL/EVOLUTION_API_KEY)" },
      { status: 503 },
    );
  }
  let messageId: string | undefined;
  try {
    const delay = Math.min(2500, Math.max(900, text.length * 22));
    const evResponse = await fetch(`${config.baseUrl}/message/sendText/${config.instanceName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: config.apiKey,
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

    // Leitura best-effort do corpo — a Evolution API pode devolver um JSON
    // sem o formato esperado (ou nenhum), e isso nunca deve impedir o envio
    // já confirmado de seguir para o registro no histórico.
    try {
      const respostaJson: unknown = typeof evResponse.json === "function" ? await evResponse.json() : undefined;
      messageId = extrairMessageIdEnvio(respostaJson);
    } catch {
      messageId = undefined;
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

  // Marca o messageId como eco do painel — se a Evolution devolver este
  // mesmo envio no webhook com fromMe=true, o webhook não registra de novo.
  // Sem messageId confiável, não há deduplicação: a mensagem do painel já
  // foi registrada aqui, e o eco (se vier) será tratado no webhook como uma
  // mensagem "atendente" adicional — melhor um possível duplicado raro do
  // que descartar mensagens reais por dedup baseada só em texto.
  if (messageId) {
    await marcarEcoPainel(messageId);
  }

  // Renova TTL de manual e session enquanto o atendimento está ativo.
  // Previne que o flag manual expire durante conversas longas e o bot reassuma.
  await redis.set(`manual:${phone}`, true, { ex: 7200 });
  const sessaoEnvio = await redis.get(`session:${phone}`);
  if (sessaoEnvio) {
    await redis.set(`session:${phone}`, sessaoEnvio, { ex: 7200 });
  }

  return NextResponse.json({ ok: true, senderName, phone });
}

// Tipo helper local para o narrowing após validação
interface ValidacaoEnvioOk {
  ok: true;
  phone: string;
  text: string;
  senderName: string;
}
