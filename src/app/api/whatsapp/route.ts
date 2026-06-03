import { NextRequest, NextResponse } from "next/server";
import { processMessage, createInitialSession, BotSession } from "@/lib/bot";
import { redis } from "@/lib/redis";

type Pedido = {
  id: string;
  cliente: string;
  telefone: string;
  itens: string[];
  total: number;
  status: "novo" | "em_preparo" | "saiu_entrega" | "entregue" | "cancelado";
  horario: string;
  endereco: string;
};

async function salvarPedido(session: BotSession, phone: string) {
  const pedidos = (await redis.get<Pedido[]>("pedidos")) || [];
  const itens = session.cart.map((item) => {
    const border = item.border !== "Sem borda" ? ` + ${item.border}` : "";
    return `Pizza ${item.flavor} ${item.size}${border}`;
  });
  const total =
    session.cart.reduce((sum, item) => sum + item.price, 0) +
    session.deliveryFee;
  const endereco =
    session.deliveryType === "delivery"
      ? `${session.address} — ${session.neighborhood}`
      : "Retirada na loja";
  const novoPedido: Pedido = {
    id: Date.now().toString(),
    cliente: session.customerName || phone,
    telefone: phone,
    itens,
    total,
    status: "novo",
    horario: new Date().toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    endereco,
  };
  await redis.set("pedidos", [...pedidos, novoPedido]);
}

async function enviarMensagem(phone: string, message: string) {
  const url = `https://${process.env.EVOLUTION_API_URL}/message/sendText/chefebot`;
  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: process.env.EVOLUTION_API_KEY!,
    },
    body: JSON.stringify({
      number: phone,
      text: message,
    }),
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (body.event !== "messages.upsert") {
      return NextResponse.json({ ok: true });
    }

    const data = body.data;

    if (data?.key?.fromMe) {
      return NextResponse.json({ ok: true });
    }

    const phone = data?.key?.remoteJid?.replace("@s.whatsapp.net", "");
    const messageText =
      data?.message?.conversation ||
      data?.message?.extendedTextMessage?.text ||
      "";

    if (!phone || !messageText) {
      return NextResponse.json({ ok: true });
    }

    const botAtivo = await redis.get<boolean>("bot_ativo");
    if (botAtivo === false) {
      return NextResponse.json({ ok: true });
    }

    const sessionKey = `session:${phone}`;
    const savedSession = await redis.get<BotSession>(sessionKey);
    const currentSession = savedSession ?? createInitialSession();

    const result = processMessage(messageText, currentSession);

    if (
      currentSession.step === "confirm" &&
      (messageText.trim() === "1" ||
        messageText.trim().toLowerCase() === "sim")
    ) {
      await salvarPedido(currentSession, phone);
    }

    await redis.set(sessionKey, result.session, { ex: 1800 });

    for (const msg of result.messages) {
      await enviarMensagem(phone, msg);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json({ ok: true });
  }
}
