import { NextRequest, NextResponse } from "next/server";
import { verificarOtp, criarTokenCliente, criarTicketSessao, criarSessaoOpaca, CLIENTE_COOKIE } from "@/lib/clienteAuth";
import { obterOuCriarCliente, sanitizeTelefoneCliente, normalizarNomeCliente } from "@/lib/clientes";
import { validarTokenCardapio } from "@/lib/cardapioToken";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const codigo = String(body?.codigo || "").trim();

    // Fluxo de número reconhecido (link do WhatsApp): o telefone verificado é
    // SEMPRE o phone resolvido do token no servidor — o `telefone` do body é
    // ignorado nesse modo (mesma regra do envio do OTP em /api/cliente/login).
    const waToken = typeof body?.waToken === "string" && body.waToken ? body.waToken : null;
    let telefone: string;
    if (waToken) {
      const resolvido = await validarTokenCardapio(waToken);
      if (!resolvido) {
        return NextResponse.json(
          { ok: false, error: "Não conseguimos confirmar seu WhatsApp. Digite seu número.", vinculoInvalido: true },
          { status: 401 }
        );
      }
      telefone = sanitizeTelefoneCliente(resolvido.phone);
    } else {
      telefone = sanitizeTelefoneCliente(body?.telefone || "");
    }

    if (telefone.length < 10 || !codigo) {
      return NextResponse.json({ ok: false, error: "Dados inválidos" }, { status: 400 });
    }

    const valido = await verificarOtp(telefone, codigo);
    if (!valido) {
      return NextResponse.json({ ok: false, error: "Código inválido ou expirado" }, { status: 401 });
    }

    const nome = normalizarNomeCliente(body?.nome);
    const cliente = await obterOuCriarCliente(telefone, nome || undefined);
    const token = await criarTokenCliente({ clienteId: cliente.clienteId, telefone: cliente.telefone });

    // Ticket de ativação por navegação (uso único, 60s): fallback para
    // navegadores que não persistem o Set-Cookie desta resposta de fetch —
    // ver /api/cliente/sessao. Nunca devolve o telefone completo ao
    // navegador — a tela de Pontos só precisa saber se o cliente já tem nome
    // (para pular a etapa de cadastro).
    const ticket = await criarTicketSessao({ clienteId: cliente.clienteId, telefone: cliente.telefone });
    // Sessão opaca (token aleatório, sem nenhum dado do cliente): o front só a
    // usa — e só a guarda — quando comprovar que o cookie desta resposta não
    // foi aplicado (navegador interno do WhatsApp no iPhone).
    const sessao = await criarSessaoOpaca({ clienteId: cliente.clienteId, telefone: cliente.telefone });
    const res = NextResponse.json({ ok: true, cliente: { nome: cliente.nome ?? null }, ticket, sessao });
    res.cookies.set(CLIENTE_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return res;
  } catch (error) {
    console.error("[ChefeBot] Erro ao verificar OTP do cliente:", error);
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500 });
  }
}
