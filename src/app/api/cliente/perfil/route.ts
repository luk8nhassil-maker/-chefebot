import { NextRequest, NextResponse } from "next/server";
import { verificarTokenCliente, CLIENTE_COOKIE } from "@/lib/clienteAuth";
import { buscarClientePorId } from "@/lib/clientes";
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
