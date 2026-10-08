import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { redis } from "@/lib/redis";

const ROLES_PODEM_CONTROLAR_BOT = new Set(["admin", "atendente", "dev"]);
const BOT_STATUS_AUDIT_TTL_SECONDS = 30 * 24 * 60 * 60;

type BotStatusBody = {
  ativo?: unknown;
  phone?: unknown;
  source?: unknown;
};

function origemSegura(source: unknown): "painel_toggle" | "api" {
  return source === "painel_toggle" ? "painel_toggle" : "api";
}

async function usuarioAutorizado(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value;
  const usuario = token ? await verifyToken(token) : null;
  if (!usuario || !ROLES_PODEM_CONTROLAR_BOT.has(usuario.role)) return null;
  return usuario;
}

export async function GET() {
  const ativo = await redis.get<boolean>("bot_ativo");
  return NextResponse.json({ ativo: ativo !== false });
}

export async function POST(req: NextRequest) {
  const usuario = await usuarioAutorizado(req);
  if (!usuario) {
    return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }

  const body = (await req.json()) as BotStatusBody;

  // Pausa global — só equipe autenticada pode alterar. Também registra a última
  // mudança para que um futuro "desativou sozinho" tenha autor/origem/timestamp
  // verificáveis em vez de depender de hipótese.
  if (typeof body.ativo === "boolean" && !body.phone) {
    const anterior = await redis.get<boolean>("bot_ativo");
    await redis.set("bot_ativo", body.ativo);
    await redis.set(
      "bot_status:last_change",
      {
        ativo: body.ativo,
        anterior: anterior !== false,
        at: new Date().toISOString(),
        username: usuario.username,
        role: usuario.role,
        source: origemSegura(body.source),
      },
      { ex: BOT_STATUS_AUDIT_TTL_SECONDS }
    );
    return NextResponse.json({ ok: true, ativo: body.ativo });
  }

  // Pausa por cliente
  if (typeof body.phone === "string" && body.phone.trim()) {
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
