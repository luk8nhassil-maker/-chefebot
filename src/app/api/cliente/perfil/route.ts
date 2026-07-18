import { NextRequest, NextResponse } from "next/server";
import { verificarTokenCliente, CLIENTE_COOKIE } from "@/lib/clienteAuth";
import { buscarClientePorId, normalizarNomeCliente, obterOuCriarCliente } from "@/lib/clientes";
import { obterProgressoFidelidade } from "@/lib/fidelidade";
import { redis } from "@/lib/redis";

type PedidoResumo = {
  id: string;
  clienteId?: string;
  numero?: number;
  data?: string;
  horario?: string;
  total?: number;
  status?: string;
};

export async function GET(req: NextRequest) {
  const token = req.cookies.get(CLIENTE_COOKIE)?.value ?? null;
  if (!token) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const payload = await verificarTokenCliente(token);
  if (!payload) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const cliente = await buscarClientePorId(payload.clienteId);
  if (!cliente) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const fidelidade = await obterProgressoFidelidade(cliente.clienteId);

  let ultimosPedidos: PedidoResumo[] = [];
  try {
    const pedidos = (await redis.get<PedidoResumo[]>("pedidos")) || [];
    ultimosPedidos = pedidos
      .filter((p) => p.clienteId === cliente.clienteId)
      .slice(-5)
      .reverse()
      .map((p) => ({ id: p.id, numero: p.numero, data: p.data, total: p.total, status: p.status }));
  } catch (err) {
    console.error("[ChefeBot] Erro ao buscar pedidos do cliente:", err);
  }

  return NextResponse.json({
    cliente: { nome: cliente.nome ?? null, telefone: cliente.telefone },
    fidelidade,
    ultimosPedidos,
  });
}

// PATCH /api/cliente/perfil — completa o cadastro do próprio dono da sessão
// (só o nome; o telefone é sempre o da sessão autenticada, nunca do body).
// Usado pela tela de Pontos logo após o OTP, quando o cliente ainda não tem
// nome salvo.
export async function PATCH(req: NextRequest) {
  const token = req.cookies.get(CLIENTE_COOKIE)?.value ?? null;
  if (!token) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const payload = await verificarTokenCliente(token);
  if (!payload) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const cliente = await buscarClientePorId(payload.clienteId);
  if (!cliente) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  try {
    const body = await req.json();
    const nome = normalizarNomeCliente(body?.nome);
    if (nome.length < 2) {
      return NextResponse.json({ ok: false, error: "Digite seu nome" }, { status: 400 });
    }
    const atualizado = await obterOuCriarCliente(cliente.telefone, nome);
    return NextResponse.json({ ok: true, cliente: { nome: atualizado.nome ?? null } });
  } catch (error) {
    console.error("[ChefeBot] Erro ao atualizar nome do cliente:", error);
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500 });
  }
}
