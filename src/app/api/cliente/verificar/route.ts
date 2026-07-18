import { NextRequest, NextResponse } from "next/server";
import { verificarOtp, criarTokenCliente, criarTicketSessao, criarSessaoPortatil, criarTicketAtivacaoPerfil, CLIENTE_COOKIE } from "@/lib/clienteAuth";
import { obterOuCriarCliente, sanitizeTelefoneCliente, normalizarNomeCliente, clienteProximaEtapa } from "@/lib/clientes";
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
    // Sessão portátil (JWE cifrado, sem dado legível e sem leitura de Redis
    // para validar): usável via Authorization: Bearer em qualquer navegador,
    // inclusive os que descartam cookies (navegador interno do WhatsApp no
    // iPhone) — e imune a atraso de réplica do Redis logo após esta escrita.
    const sessao = await criarSessaoPortatil({ clienteId: cliente.clienteId, telefone: cliente.telefone });

    // Resposta ATÔMICA: a próxima tela é decidida AQUI, na mesma execução que
    // validou o OTP e criou cliente+sessão — nenhuma leitura posterior (que
    // pode falhar por réplica atrasada/erro secundário) participa da decisão.
    // "name" = primeira ativação pendente (fidelidadeAtivadaEm ausente);
    // "points" = fidelidade já ativada. traceId do body (formato estrito) é
    // só ecoado para correlação de suporte — nunca influencia nada.
    const next = clienteProximaEtapa(cliente);
    const traceId = typeof body?.traceId === "string" && /^P3-[A-Z0-9]{6}$/.test(body.traceId) ? body.traceId : null;

    // Ticket de ativação do PERFIL (distinto do "ticket" de navegação acima):
    // só emitido quando falta a primeira ativação (next === "name") — é o
    // fallback de última linha do PATCH /api/cliente/perfil se cookie e
    // sessão portátil, emitidos nesta mesma resposta, falharem por qualquer
    // motivo (ver src/lib/clienteAuth.ts). Nunca emitido para quem já tem
    // fidelidade ativa — não há PATCH de nome a proteger nesse caso.
    const ativacaoToken = next === "name"
      ? await criarTicketAtivacaoPerfil({ clienteId: cliente.clienteId, telefone: cliente.telefone })
      : null;

    const res = NextResponse.json({ ok: true, next, sessao, ticket, ativacaoToken, cliente: { nome: cliente.nome ?? null }, traceId });
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
