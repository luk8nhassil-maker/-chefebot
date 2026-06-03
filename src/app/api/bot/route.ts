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
  const total = session.cart.reduce((sum, item) => sum + item.price, 0) + session.deliveryFee;
  const novoPedido: Pedido = {
    id: Date.now().toString(),
    cliente: session.customerName || phone,
    telefone: phone,
    itens,
    total,
    status: "novo",
    horario: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    endereco: session.neighborhood || "Retirada na loja",
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

  if (
    currentSession.step === "confirm" &&
    (message.trim() === "1" || message.trim().toLowerCase() === "sim")
  ) {
    await salvarPedido(currentSession, phone);
  }

  return NextResponse.json(result);
}