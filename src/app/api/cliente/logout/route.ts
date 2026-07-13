import { NextRequest, NextResponse } from "next/server";
import { CLIENTE_COOKIE, verificarTokenCliente, invalidarSessaoCliente } from "@/lib/clienteAuth";

// Invalida a sessão IMEDIATAMENTE no servidor (apaga o registro no Redis, não
// só o cookie) — um JWT antigo, mesmo copiado antes do logout, deixa de
// passar em resolverSessaoCliente assim que este registro some. Cookie
// ausente/inválido não é erro: apenas não há nada para invalidar no Redis,
// mas a limpeza do cookie sempre acontece.
//
// Nível 6.6.1: a limpeza do cookie NUNCA pode depender do Redis ter
// funcionado — se `invalidarSessaoCliente` lançar, isso é capturado aqui
// (sem nunca logar token/telefone/clienteId) e o cookie ainda assim é
// expirado antes de responder. Se a invalidação server-side falhar de
// verdade, a resposta é explícita sobre isso (503, `ok:false`) — nunca
// afirma "sessão invalidada no servidor" quando o Redis pode não ter feito
// isso; o cookie expirado já garante que o navegador não reenvia mais essa
// sessão, e o registro em Redis (se sobreviveu) vai expirar sozinho pelo TTL.
export async function POST(req: NextRequest) {
  const token = req.cookies.get(CLIENTE_COOKIE)?.value ?? null;
  let invalidacaoFalhou = false;

  if (token) {
    const payload = await verificarTokenCliente(token);
    if (payload) {
      try {
        await invalidarSessaoCliente(payload.clienteId);
      } catch (err) {
        invalidacaoFalhou = true;
        console.error("[ChefeBot] Erro ao invalidar sessao do cliente no logout:", err instanceof Error ? err.message : "erro desconhecido");
      }
    }
  }

  const res = invalidacaoFalhou
    ? NextResponse.json(
        { ok: false, error: "Nao foi possivel invalidar a sessao no servidor agora. O cookie foi removido mesmo assim." },
        { status: 503 }
      )
    : NextResponse.json({ ok: true });
  res.cookies.set(CLIENTE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
