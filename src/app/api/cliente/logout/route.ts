import { NextRequest, NextResponse } from "next/server";
import { CLIENTE_COOKIE, invalidarSessaoCliente } from "@/lib/clienteAuth";

export async function POST(req: NextRequest) {
  const sessionId = req.cookies.get(CLIENTE_COOKIE)?.value ?? null;
  try {
    await invalidarSessaoCliente(sessionId);
  } catch (err) {
    console.error("[ChefeBot] Erro ao invalidar sessao do cliente no logout:", err);
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(CLIENTE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
