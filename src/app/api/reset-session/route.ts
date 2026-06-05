import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
export async function POST(req: NextRequest) {
  const { phone } = await req.json();
  if (!phone) return NextResponse.json({ ok: false }, { status: 400 });
  await redis.del(`session:${phone}`);
  await redis.del(`manual:${phone}`);
  await redis.del(`resolvendo:${phone}`);
  return NextResponse.json({ ok: true });
}