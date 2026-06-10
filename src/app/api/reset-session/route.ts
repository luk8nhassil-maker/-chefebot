import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
export async function POST(req: NextRequest) {
  const { phone } = await req.json();
  if (!phone) return NextResponse.json({ ok: false }, { status: 400 });
  const digits = phone.replace(/\D/g, "");
  const variantes = [
    digits,
    "55" + digits,
    digits.replace(/^55/, ""),
    digits.replace(/^5555/, "55"),
  ];
  const chaves: string[] = [];
  for (const v of variantes) {
    chaves.push(`session:${v}`);
    chaves.push(`manual:${v}`);
    chaves.push(`resolvendo:${v}`);
    chaves.push(`avaliacao:${v}`);
    chaves.push(`aguardando_avaliacao:${v}`);
  }
  for (const chave of chaves) {
    await redis.del(chave);
  }
  return NextResponse.json({ ok: true, limpas: chaves });
}