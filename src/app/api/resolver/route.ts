import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { redis } from "@/lib/redis";

async function checkAuth(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || !["atendente", "admin"].includes(payload.role as string)) return null;
  return payload;
}

const _evResolverUrl = process.env.EVOLUTION_API_URL ?? 'evolution-api-production-8f99.up.railway.app'
const EVOLUTION_API_URL = _evResolverUrl.startsWith('http') ? _evResolverUrl : `https://${_evResolverUrl}`
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY!
const EVOLUTION_INSTANCE = "chefebot";

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
  await fetch(`${EVOLUTION_API_URL}/message/sendText/${EVOLUTION_INSTANCE}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: EVOLUTION_API_KEY,
    },
    body: JSON.stringify({ number: phone, text: message }),
  });
}

export async function POST(req: NextRequest) {
  const auth = await checkAuth(req);
  if (!auth) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const { phone } = await req.json();
  if (!phone) return NextResponse.json({ ok: false }, { status: 400 });

  // Fecha o card urgente no painel e devolve o pedido para o fluxo normal (cozinha)
  const pedidos = (await redis.get<Pedido[]>("pedidos")) || [];
  const atualizados = pedidos.map(p =>
    p.telefone === phone && p.escalonado === true && p.status === "novo"
      ? { ...p, escalonado: false, status: "em_preparo" as const }
      : p
  );
  await redis.set("pedidos", atualizados);

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