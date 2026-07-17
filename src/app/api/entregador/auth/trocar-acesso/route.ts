import { NextRequest, NextResponse } from "next/server";
import {
  ENTREGADOR_COOKIE,
  consumirTicketAcesso,
  cookieEntregadorOptions,
  criarTokenEntregador,
  obterEntregadorPorId,
  ticketAcessoValido,
} from "@/lib/entregadorAuth";

const ERRO_ACESSO = { ok: false, error: "Acesso inválido ou expirado" };

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const acesso = body?.acesso;
    if (!ticketAcessoValido(acesso)) {
      return NextResponse.json({ ok: false, error: "Dados inválidos" }, { status: 400 });
    }

    const registro = await consumirTicketAcesso(acesso);
    if (!registro) return NextResponse.json(ERRO_ACESSO, { status: 401 });

    const entregador = await obterEntregadorPorId(registro.entregadorId);
    if (!entregador) return NextResponse.json(ERRO_ACESSO, { status: 401 });
    if (!entregador.ativo) {
      return NextResponse.json({ ok: false, error: "Acesso indisponível" }, { status: 403 });
    }

    const token = await criarTokenEntregador(entregador);
    const response = NextResponse.json({
      ok: true,
      entregador: { id: entregador.id, nome: entregador.nome },
    });
    response.cookies.set(ENTREGADOR_COOKIE, token, cookieEntregadorOptions());
    return response;
  } catch {
    return NextResponse.json({ ok: false, error: "Não foi possível validar o acesso" }, { status: 500 });
  }
}
