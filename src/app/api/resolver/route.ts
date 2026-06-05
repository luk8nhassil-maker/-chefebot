import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
const EVOLUTION_API_URL = "https://evolution-api-production-8f99.up.railway.app";
const EVOLUTION_API_KEY = "6208711c1b6fdffcc30cb492a44d74601415c33ff717ef6032162f9c0056319e";
const EVOLUTION_INSTANCE = "chefe";
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
  const { phone } = await req.json();
  if (!phone) return NextResponse.json({ ok: false }, { status: 400 });
  // Marca como resolvendo no Redis
  await redis.set(`resolvendo:${phone}`, true, { ex: 1800 });
  // Fecha o card urgente no painel - marca escalonado como false
  const pedidos = (await redis.get<Pedido[]>("pedidos")) || [];
  const atualizados = pedidos.map(p =>
    p.telefone === phone && p.escalonado === true && p.status === "novo"
      ? { ...p, escalonado: false, status: "entregue" as const }
      : p
  );
  await redis.set("pedidos", atualizados);
  // Envia mensagem de encerramento para o cliente
  await enviarMensagem(
    phone,
    "Consegui te ajudar? Tem mais alguma coisa que posso fazer por voce? 😊"
  );
  return NextResponse.json({ ok: true });
}