import { NextRequest, NextResponse } from "next/server";
import { verificarTokenCliente, CLIENTE_COOKIE, cookieOptionsSessaoCliente } from "@/lib/clienteAuth";
import { buscarClientePorId } from "@/lib/clientes";
import {
  derivarClienteIdPorTelefone,
  obterRecompensasPontos,
  reservarResgatePontos,
} from "@/lib/fidelidade";

// POST /api/cliente/fidelidade/resgate — reserva o resgate de uma recompensa
// disponível do cliente autenticado (Etapa 5). Só opera sobre o dono da
// sessão (cliente-token): nenhum clienteId/recompensaId de outro cliente
// pode ser usado, mesmo que informado no corpo da requisição — o corpo só
// aceita o `recompensaId`, o `clienteId` é sempre resolvido do cookie.
//
// A reserva em si não debita pontos (ver src/lib/fidelidade.ts) — só marca
// a intenção, com validade curta, para o checkout confirmar de verdade
// junto com a criação do pedido. Nunca pode ser ativada respondendo o
// WhatsApp nem liberada manualmente por atendente — só por este endpoint,
// autenticado, dentro do app.

export async function POST(req: NextRequest) {
  const token = req.cookies.get(CLIENTE_COOKIE)?.value ?? null;
  if (!token) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const payload = await verificarTokenCliente(token);
  if (!payload) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const cliente = await buscarClientePorId(payload.clienteId);
  if (!cliente) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const clienteIdPontos = derivarClienteIdPorTelefone(cliente.telefone) ?? cliente.clienteId;

  let body: { recompensaId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo invalido" }, { status: 400 });
  }

  const recompensaId = typeof body.recompensaId === "string" ? body.recompensaId.trim() : "";
  if (!recompensaId) {
    return NextResponse.json({ error: "recompensaId obrigatorio" }, { status: 400 });
  }

  // Confere que a recompensa pertence mesmo a este cliente antes de tentar
  // reservar — nunca permite reservar o recompensaId de outra pessoa.
  const recompensas = await obterRecompensasPontos(clienteIdPontos);
  const pertenceAoCliente = recompensas.some((r) => r.recompensaId === recompensaId);
  if (!pertenceAoCliente) {
    return NextResponse.json({ error: "Recompensa nao encontrada" }, { status: 404 });
  }

  try {
    const reserva = await reservarResgatePontos(clienteIdPontos, recompensaId);
    const res = NextResponse.json({
      ok: true,
      resgateId: reserva.resgateId,
      valorDescontoMaximo: reserva.valorDescontoMaximo,
      pontosReservados: reserva.pontosReservados,
      expiraEm: reserva.expiraEm,
    });
    res.cookies.set(CLIENTE_COOKIE, token, cookieOptionsSessaoCliente());
    return res;
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : "Erro ao reservar resgate";
    return NextResponse.json({ error: mensagem }, { status: 409 });
  }
}
