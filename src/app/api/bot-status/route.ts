import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export async function GET() {
  const ativo = await redis.get<boolean>("bot_ativo");
  return NextResponse.json({ ativo: ativo !== false });
}

export async function POST(req: NextRequest) {
  const { ativo } = await req.json();
  await redis.set("bot_ativo", ativo);
  return NextResponse.json({ ok: true, ativo });
}
