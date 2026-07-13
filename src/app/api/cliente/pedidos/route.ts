import { NextRequest, NextResponse } from "next/server";
import { resolverSessaoCliente, definirCookieSessaoCliente } from "@/lib/clienteAuth";
import { redis } from "@/lib/redis";
import {
  filtrarPedidosDoCliente,
  ordenarPedidosMaisNovoPrimeiro,
  paraResumoPublico,
  type PedidoClienteFonte,
} from "@/lib/clientePedidos";

// GET /api/cliente/pedidos — histórico completo do cliente autenticado.
//
// Identidade vem só do cookie CLIENTE_COOKIE (JWT verificado no servidor).
// Nunca aceita telefone/clienteId por query — não há nenhum searchParam lido
// aqui, de propósito. Sem sessão válida -> sempre 401 (cookie ausente, token
// inválido ou cliente inexistente tratam-se igual, mesma resposta genérica).
export async function GET(req: NextRequest) {
  const sessao = await resolverSessaoCliente(req);
  if (!sessao) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  const { cliente } = sessao;

  let pedidos: PedidoClienteFonte[] = [];
  try {
    pedidos = (await redis.get<PedidoClienteFonte[]>("pedidos")) || [];
  } catch (err) {
    console.error("[ChefeBot] Erro ao buscar pedidos do cliente:", err);
    return NextResponse.json({ error: "Falha ao carregar pedidos" }, { status: 502 });
  }

  // clienteId direto (pedidos criados depois da Área do Cliente) + telefone
  // verificado (pedidos antigos, sem clienteId, anteriores à Área do
  // Cliente) — deduplicado por id. Inclui ativos, concluídos, cancelados e
  // arquivados: sem corte arbitrário (.slice), o histórico é completo.
  const doCliente = filtrarPedidosDoCliente(pedidos, cliente.clienteId, cliente.telefone);
  const ordenados = ordenarPedidosMaisNovoPrimeiro(doCliente);
  const resumos = ordenados.map(paraResumoPublico);

  const res = new NextResponse(JSON.stringify({ pedidos: resumos }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
  if (sessao.deveRenovar && sessao.novoToken) definirCookieSessaoCliente(res, sessao.novoToken);
  return res;
}
