import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { cookies } from "next/headers";

function isAdmin(): boolean {
  try {
    const cookieStore = cookies();
    const cookie = cookieStore.get("auth-user");
    if (!cookie) return false;
    const user = JSON.parse(decodeURIComponent(cookie.value));
    return user.role === "admin";
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { phone } = body;

    if (!phone) {
      return NextResponse.json({ error: "phone obrigatorio" }, { status: 400 });
    }

    const sessionKey = `session:${phone}`;
    const manualKey = `manual:${phone}`;
    const fechadoKey = `fechado:${phone}`;

    await redis.del(sessionKey);
    await redis.del(manualKey);
    await redis.del(fechadoKey);

    return NextResponse.json({ ok: true, phone, message: "Sessao resetada com sucesso" });
  } catch (error) {
    console.error("Reset session error:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
