import { NextRequest, NextResponse } from "next/server";
import { resolverSessaoCliente, definirCookieSessaoCliente } from "@/lib/clienteAuth";
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
  const sessao = await resolverSessaoCliente(req);
  if (!sessao) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  const { cliente } = sessao;

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

  const res = NextResponse.json({
    cliente: { nome: cliente.nome ?? null, telefone: cliente.telefone, pontosAtivos: cliente.pontosAtivos === true },
    fidelidade,
    ultimosPedidos,
  });
  if (sessao.deveRenovar && sessao.novoToken) definirCookieSessaoCliente(res, sessao.novoToken);
  return res;
}
