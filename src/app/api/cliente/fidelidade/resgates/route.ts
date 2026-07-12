import { NextRequest, NextResponse } from "next/server";
import { verificarTokenCliente, CLIENTE_COOKIE } from "@/lib/clienteAuth";
import { buscarClientePorId } from "@/lib/clientes";
import { criarReservaResgate, obterResgatesCliente } from "@/lib/fidelidade";

// POST /api/cliente/fidelidade/resgates — cria uma reserva de resgate para o
// cliente autenticado (Etapa 5). O cliente nunca informa clienteId, valor do
// desconto ou tipo de recompensa: tudo vem da configuracao no servidor.
// GET /api/cliente/fidelidade/resgates — lista somente os resgates do dono
// da sessao.

async function autenticar(req: NextRequest) {
  const token = req.cookies.get(CLIENTE_COOKIE)?.value ?? null;
  if (!token) return null;
  const payload = await verificarTokenCliente(token);
  if (!payload) return null;
  const cliente = await buscarClientePorId(payload.clienteId);
  if (!cliente) return null;
  return cliente;
}

export async function POST(req: NextRequest) {
  const cliente = await autenticar(req);
  if (!cliente) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const resultado = await criarReservaResgate(cliente.clienteId);
  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: 400 });
  }

  return NextResponse.json({ resgate: resultado.resgate }, { status: 201 });
}

export async function GET(req: NextRequest) {
  const cliente = await autenticar(req);
  if (!cliente) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const resgates = await obterResgatesCliente(cliente.clienteId);
  return NextResponse.json({ resgates });
}
