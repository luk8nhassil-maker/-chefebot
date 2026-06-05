import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
const EVOLUTION_API_URL = "https://evolution-api-production-8f99.up.railway.app";
const EVOLUTION_API_KEY = "6208711c1b6fdffcc30cb492a44d74601415c33ff717ef6032162f9c0056319e";
const EVOLUTION_INSTANCE = "chefe";
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
  await redis.set(`resolvendo:${phone}`, true, { ex: 1800 });
  await enviarMensagem(
    phone,
    "Consegui te ajudar? Tem mais alguma coisa que posso fazer por voce? 😊"
  );
  return NextResponse.json({ ok: true });
}