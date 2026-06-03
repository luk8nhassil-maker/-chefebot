import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export async function GET() {
  const ativo = await redis.get<boolean>("bot_ativo");
  return NextResponse.json({ ativo: ativo !== false });
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  // Pausa global
  if (typeof body.ativo === "boolean" && !body.phone) {
    await redis.set("bot_ativo", body.ativo);
    return NextResponse.json({ ok: true, ativo: body.ativo });
  }

  // Pausa por cliente
  if (body.phone) {
    const chave = `manual:${body.phone}`;
    if (body.ativo === false) {
      await redis.set(chave, true, { ex: 3600 }); // expira em 1h
    } else {
      await redis.del(chave);
    }
    return NextResponse.json({ ok: true, phone: body.phone, manual: body.ativo === false });
  }

  return NextResponse.json({ ok: false }, { status: 400 });
}
