import { NextRequest, NextResponse } from "next/server";
import { lerSessaoCliente } from "@/lib/clienteAuth";
import { buscarClientePorId, clienteProximaEtapa } from "@/lib/clientes";

// GET /api/cliente/estado-sessao — ÚNICA fonte de "estou autenticado?" para o
// frontend. Faz somente: validar cookie/Bearer e ler o registro mínimo do
// cliente. Nunca consulta extrato, recompensas, pedidos, configuração ou
// progresso — nenhuma falha de dado secundário pode ser confundida com
// sessão inválida. Só um 401 DESTE endpoint autoriza o frontend a voltar
// para a confirmação do número.
export async function GET(req: NextRequest) {
  const payload = await lerSessaoCliente(req);
  if (!payload) return NextResponse.json({ authenticated: false }, { status: 401 });

  // Leitura best-effort: se o registro do cliente estiver momentaneamente
  // ilegível (réplica atrasada, erro transitório), a sessão CONTINUA válida —
  // caímos em "name" (a ativação regrava o registro), nunca em 401.
  let next: "name" | "points" = "name";
  try {
    const cliente = await buscarClientePorId(payload.clienteId);
    next = clienteProximaEtapa(cliente);
  } catch {}

  return NextResponse.json({ authenticated: true, next });
}
