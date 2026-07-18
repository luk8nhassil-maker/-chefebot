import { NextRequest, NextResponse } from "next/server";
import { CLIENTE_COOKIE, extrairBearer, revogarSessaoOpaca } from "@/lib/clienteAuth";

export async function POST(req: NextRequest) {
  // Revoga também a sessão opaca (fallback Bearer) quando presente — sair
  // precisa invalidar a sessão no servidor, não só apagar o cookie.
  try { await revogarSessaoOpaca(extrairBearer(req.headers.get("authorization"))); } catch {}
  const res = NextResponse.json({ ok: true });
  res.cookies.set(CLIENTE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
