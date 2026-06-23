import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { verifyToken } from "@/lib/auth";
import { escolherStepDeRetomada } from "@/lib/reviverConversa";
import type { BotSession, BotStep } from "@/lib/bot";

async function checkAuth(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || !["atendente", "admin", "dev"].includes(payload.role as string)) return null;
  return payload;
}

// Reviver manual de conversa: a atendente decide reativar o bot para um número.
// NÃO envia mensagem ao cliente. NÃO cria pedido. NÃO imprime.
// Apenas recalcula o step seguro de retomada e salva a sessão.
// A próxima mensagem do cliente ativa o bot normalmente.
export async function POST(req: NextRequest) {
  const auth = await checkAuth(req);
  if (!auth) return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });

  const body = await req.json();
  const { phone } = body;
  if (!phone) return NextResponse.json({ ok: false, error: "phone obrigatório" }, { status: 400 });

  const phoneFormatado = String(phone).replace(/\D/g, "");
  if (!phoneFormatado) return NextResponse.json({ ok: false, error: "phone inválido" }, { status: 400 });

  const sessionKey = `session:${phoneFormatado}`;
  const session = await redis.get<BotSession>(sessionKey);

  const novoStep = session ? (escolherStepDeRetomada(session) as BotStep) : "category";

  const sessionFinal: BotSession = session
    ? { ...session, step: novoStep, escalado: false, stepAnteriorEscalado: undefined }
    : { step: "category", cart: [], deliveryFee: 0, tentativasInvalidas: 0 };

  // Preserva histórico da conversa (conversa:${phone}) — nunca deleta.
  await redis.set(sessionKey, sessionFinal, { ex: 1800 });

  // Remove lock manual para devolver ao bot.
  await redis.del(`manual:${phoneFormatado}`);
  await redis.del(`revive_cooldown:${phoneFormatado}`);

  return NextResponse.json({ ok: true, novoStep });
}
