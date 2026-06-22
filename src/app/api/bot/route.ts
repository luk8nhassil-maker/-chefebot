import { NextRequest, NextResponse } from "next/server";
import { processMessage, createInitialSession, BotSession } from "@/lib/bot";
import { resolverFallbackInteligente } from "@/lib/fallbackInteligente";
import { redis } from "@/lib/redis";
import { proximoNumeroPedido } from "@/lib/numeracao";

type Pedido = {
  id: string;
  numero?: number;
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
  const total = session.cart.reduce((sum, item) => sum + item.price, 0) + session.deliveryFee;

  const endereco = session.deliveryType === "delivery"
    ? `${session.address} — ${session.neighborhood}`
    : "Retirada na loja";

  const numeroPedido = await proximoNumeroPedido();
  const novoPedido: Pedido = {
    id: Date.now().toString(),
    numero: numeroPedido,
    cliente: session.customerName || phone,
    telefone: phone,
    itens,
    total,
    status: "novo",
    horario: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    endereco,
  };
  await redis.set("pedidos", [...pedidos, novoPedido]);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { message, session, phone } = body as {
    message: string;
    session: BotSession | null;
    phone: string;
  };

  const currentSession = session ?? createInitialSession();
  const result = processMessage(message, currentSession);

  // Fallback Inteligente Universal: nunca devolve resposta "seca" ao simulador.
  // Só troca o TEXTO de saída — não altera a sessão/carrinho retornados.
  const fb = await resolverFallbackInteligente({
    mensagemAtual: message,
    session: result.session,
    mensagensFallback: result.messages,
    jaEscalou: result.escalar,
  });
  result.messages = fb.messages;

  if (
    currentSession.step === "confirm" &&
    (message.trim() === "1" || message.trim().toLowerCase() === "sim")
  ) {
    await salvarPedido(currentSession, phone);
  }

  return NextResponse.json(result);
}

export async function DELETE(req: NextRequest) {
  await redis.del("pedidos");
  return NextResponse.json({ ok: true });
}