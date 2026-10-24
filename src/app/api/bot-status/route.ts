import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { verifyToken } from "@/lib/auth";

const BOT_STATUS_AUDIT_TTL_SECONDS = 30 * 24 * 60 * 60;

async function equipeAutorizada(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value;
  const usuario = token ? await verifyToken(token) : null;
  if (!usuario || !["admin", "atendente", "dev"].includes(usuario.role)) return null;
  return usuario;
}

export async function GET(req: NextRequest) {
  if (!(await equipeAutorizada(req))) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const ativo = await redis.get<boolean>("bot_ativo");
  return NextResponse.json({ ativo: ativo !== false });
}

export async function POST(req: NextRequest) {
  const usuario = await equipeAutorizada(req);
  if (!usuario) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const { ativo, phone, source } = body as { ativo?: unknown; phone?: unknown; source?: unknown };

  // Uma URL compartilhada não pode pausar o bot. Só a equipe autenticada
  // envia o POST explícito; mudança global e última auditoria são atômicas.
  if (typeof ativo === "boolean" && (phone === undefined || phone === null || phone === "")) {
    const anteriorObservado = await redis.get<boolean>("bot_ativo");
    const transacao = redis.multi();
    transacao.set("bot_ativo", ativo);
    transacao.set("bot_status:last_change", {
      ativo,
      anteriorObservado: anteriorObservado !== false,
      at: new Date().toISOString(),
      username: usuario.username,
      role: usuario.role,
      source: source === "painel_toggle" ? "painel_toggle" : "api",
    }, { ex: BOT_STATUS_AUDIT_TTL_SECONDS });
    await transacao.exec();
    return NextResponse.json({ ok: true, ativo });
  }

  // Pausa manual por cliente: exige boolean explícito e telefone string.
  // Preserva as chaves/TTL já usadas pelo atendimento.
  if (typeof ativo === "boolean" && typeof phone === "string" && phone.trim() && phone.length <= 64) {
    const chave = `manual:${phone}`;
    if (ativo === false) {
      await redis.set(chave, true, { ex: 3600 }); // expira em 1h
    } else {
      await redis.del(chave);
    }
    return NextResponse.json({ ok: true, phone, manual: ativo === false });
  }

  return NextResponse.json({ ok: false }, { status: 400 });
}
