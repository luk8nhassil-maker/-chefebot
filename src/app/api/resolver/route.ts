import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { redis } from "@/lib/redis";
import { mutarPedidos } from "@/lib/pedidosConcorrencia";
import { obterConfigEvolution } from "@/lib/evolutionApi";

async function checkAuth(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || !["atendente", "admin"].includes(payload.role as string)) return null;
  return payload;
}

type Pedido = {
  id: string;
  cliente: string;
  telefone: string;
  itens: string[];
  total: number;
  status: "novo" | "em_preparo" | "saiu_entrega" | "entregue" | "cancelado";
  horario: string;
  endereco: string;
  escalonado?: boolean;
  cancelamentoSolicitado?: boolean;
  observacao?: string;
};

async function enviarMensagem(phone: string, message: string) {
  const config = obterConfigEvolution();
  if (!config) { console.error("[ChefeBot] Provider de WhatsApp não configurado — mensagem de encerramento não enviada."); return; }
  try {
    await fetch(`${config.baseUrl}/message/sendText/${config.instanceName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: config.apiKey,
      },
      body: JSON.stringify({ number: phone, text: message }),
    });
  } catch (err) {
    console.error("[ChefeBot] Erro ao enviar mensagem de encerramento:", err);
  }
}

export async function POST(req: NextRequest) {
  const auth = await checkAuth(req);
  if (!auth) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const { phone } = await req.json();
  if (!phone) return NextResponse.json({ ok: false }, { status: 400 });

  // Fecha o card urgente no painel e devolve o pedido para o fluxo normal
  // (cozinha), protegido pelo lock GLOBAL de "pedidos" (ver
  // src/lib/pedidosConcorrencia.ts).
  await mutarPedidos<Pedido, void>((pedidosFrescos) => ({
    persistir: true,
    pedidos: pedidosFrescos.map(p =>
      p.telefone === phone && p.escalonado === true && p.status === "novo"
        ? { ...p, escalonado: false, status: "em_preparo" as const }
        : p
    ),
    resultado: undefined,
  }));

  // Limpa tudo relacionado ao cliente — sessão, manual, resolvendo
  await redis.del(`session:${phone}`);
  await redis.del(`manual:${phone}`);
  await redis.del(`resolvendo:${phone}`);

  // Envia mensagem de encerramento humanizada (o pedido continua, só o atendimento foi resolvido)
  await enviarMensagem(
    phone,
    `Fico feliz em ter ajudado! 😊\n\nSeu pedido já está sendo preparado com carinho. Qualquer coisa é só chamar! 🍕`
  );

  return NextResponse.json({ ok: true });
}