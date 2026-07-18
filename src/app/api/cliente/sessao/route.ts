import { NextRequest, NextResponse } from "next/server";
import { consumirTicketSessao, criarTokenCliente, CLIENTE_COOKIE } from "@/lib/clienteAuth";
import { buscarClientePorId, clienteProximaEtapa } from "@/lib/clientes";

// GET /api/cliente/sessao?tk=... — ativa a sessão do cliente numa RESPOSTA DE
// NAVEGAÇÃO (não de fetch), para navegadores que não persistem Set-Cookie de
// XHR/fetch (navegador interno do WhatsApp no iOS). O ticket é opaco, de uso
// único e TTL 60s, criado somente após um OTP validado — este endpoint nunca
// autentica por conta própria, só materializa uma verificação que já
// aconteceu. Ticket inválido/expirado/reusado apenas redireciona para
// /cliente sem cookie (o fluxo normal recomeça); nunca revela o motivo.
export async function GET(req: NextRequest) {
  const destinoNeutro = new URL("/cliente", req.nextUrl.origin);
  try {
    const payload = await consumirTicketSessao(req.nextUrl.searchParams.get("tk"));
    if (!payload) return NextResponse.redirect(destinoNeutro, 303);

    const cliente = await buscarClientePorId(payload.clienteId);
    if (!cliente) return NextResponse.redirect(destinoNeutro, 303);

    // Mesma fonte de decisão do fluxo: primeira ativação pendente volta
    // direto para a etapa do nome.
    const destino = new URL(clienteProximaEtapa(cliente) === "points" ? "/cliente" : "/cliente?cadastro=nome", req.nextUrl.origin);
    const token = await criarTokenCliente({ clienteId: cliente.clienteId, telefone: cliente.telefone });
    const res = NextResponse.redirect(destino, 303);
    res.cookies.set(CLIENTE_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return res;
  } catch (error) {
    console.error("[ChefeBot] Erro ao ativar sessão do cliente:", error);
    return NextResponse.redirect(destinoNeutro, 303);
  }
}
