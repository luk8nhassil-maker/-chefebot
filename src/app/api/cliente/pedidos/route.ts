import { NextRequest, NextResponse } from "next/server";
import { verificarTokenCliente, CLIENTE_COOKIE } from "@/lib/clienteAuth";
import { buscarClientePorId } from "@/lib/clientes";
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
  const token = req.cookies.get(CLIENTE_COOKIE)?.value ?? null;
  if (!token) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const payload = await verificarTokenCliente(token);
  if (!payload) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const cliente = await buscarClientePorId(payload.clienteId);
  if (!cliente) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

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

  return new NextResponse(JSON.stringify({ pedidos: resumos }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
