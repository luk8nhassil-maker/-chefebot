import { NextRequest, NextResponse } from "next/server";
import { processMessage, createInitialSession, BotSession } from "@/lib/bot";
import { resolverFallbackInteligente } from "@/lib/fallbackInteligente";
import { redis } from "@/lib/redis";
import { gerarIdPedidoUnico, proximoNumeroPedido } from "@/lib/numeracao";
import { criarPixMetadata, type PixMetadata } from "@/lib/pix";

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
  data?: string;
  pagamento?: string;
  troco?: string;
  pix?: PixMetadata;
  tipoEntrega?: string;
  taxaEntrega?: number;
  bairro?: string;
  observacao?: string;
};

async function salvarPedido(session: BotSession, phone: string) {
  const pedidos = (await redis.get<Pedido[]>("pedidos")) || [];
  const itens = session.cart.map((item) => {
    const border = item.border && item.border !== "Sem borda" ? ` + ${item.border}` : "";
    const size = item.size ? ` ${item.size}` : "";
    const flavor = item.flavor ? ` ${item.flavor}` : "";
    return `${item.name}${size}${flavor}${border}`;
  });
  const total = session.cart.reduce((sum, item) => sum + item.price, 0) + session.deliveryFee;

  const endereco = session.deliveryType === "delivery"
    ? `${session.address} - ${session.neighborhood}`
    : session.deliveryType === "dine_in"
    ? "Consumo no local"
    : "Retirada na loja";

  const numeroPedido = await proximoNumeroPedido();
  const agora = new Date();
  const pedidoId = await gerarIdPedidoUnico();
  const pix = criarPixMetadata(pedidoId, session.paymentMethod, total);
  const novoPedido: Pedido = {
    id: pedidoId,
    numero: numeroPedido,
    cliente: session.customerName || phone,
    telefone: phone,
    itens,
    total,
    status: "novo",
    horario: agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }),
    data: agora.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    endereco,
    ...(session.paymentMethod ? { pagamento: session.paymentMethod } : {}),
    ...(pix ? { pix } : {}),
    ...(session.troco ? { troco: session.troco } : {}),
    ...(session.deliveryType ? { tipoEntrega: session.deliveryType } : {}),
    ...(session.deliveryFee ? { taxaEntrega: session.deliveryFee } : {}),
    ...(session.neighborhood ? { bairro: session.neighborhood } : {}),
    ...(session.observacao ? { observacao: session.observacao } : {}),
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
