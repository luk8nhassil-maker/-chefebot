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

  // Fecha o card urgente no painel
  const pedidos = (await redis.get<Pedido[]>("pedidos")) || [];
  const atualizados = pedidos.map(p =>
    p.telefone === phone && p.escalonado === true && p.status === "novo"
      ? { ...p, escalonado: false, status: "entregue" as const }
      : p
  );
  await redis.set("pedidos", atualizados);

  // Limpa tudo relacionado ao cliente — sessão, manual, resolvendo
  await redis.del(`session:${phone}`);
  await redis.del(`manual:${phone}`);
  await redis.del(`resolvendo:${phone}`);

  // Envia mensagem de encerramento humanizada
  await enviarMensagem(
    phone,
    `Fico feliz em ter ajudado! 😊\n\nSe precisar de mais alguma coisa é só chamar. Estamos sempre aqui pra te atender! 🍕`
  );

  return NextResponse.json({ ok: true });
}