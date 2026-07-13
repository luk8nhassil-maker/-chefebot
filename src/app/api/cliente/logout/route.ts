import { NextRequest, NextResponse } from "next/server";
import { CLIENTE_COOKIE, verificarTokenCliente, invalidarSessaoCliente } from "@/lib/clienteAuth";

// Invalida a sessão IMEDIATAMENTE no servidor (apaga o registro no Redis, não
// só o cookie) — um JWT antigo, mesmo copiado antes do logout, deixa de
// passar em resolverSessaoCliente assim que este registro some. Cookie
// ausente/inválido não é erro: apenas não há nada para invalidar no Redis,
// mas a limpeza do cookie sempre acontece.
export async function POST(req: NextRequest) {
  const token = req.cookies.get(CLIENTE_COOKIE)?.value ?? null;
  if (token) {
    const payload = await verificarTokenCliente(token);
    if (payload) await invalidarSessaoCliente(payload.clienteId);
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(CLIENTE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
