import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { verifyToken } from "@/lib/auth";

async function equipeAutorizada(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get("auth-token")?.value;
  if (!token) return false;
  const usuario = await verifyToken(token);
  return !!usuario && ["admin", "atendente", "dev"].includes(usuario.role);
}

export async function GET(req: NextRequest) {
  if (!(await equipeAutorizada(req))) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const ativo = await redis.get<boolean>("bot_ativo");
  return NextResponse.json({ ativo: ativo !== false });
}

export async function POST(req: NextRequest) {
  if (!(await equipeAutorizada(req))) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
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
