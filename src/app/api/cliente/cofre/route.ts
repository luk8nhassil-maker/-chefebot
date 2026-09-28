import { NextRequest, NextResponse } from "next/server";
import { lerSessaoCliente } from "@/lib/clienteAuth";
import { buscarClientePorId } from "@/lib/clientes";
import { derivarClienteIdPorTelefone } from "@/lib/fidelidade";
import { obterCofreClienteSomenteLeitura } from "@/lib/cofreChefReadModel";

// GET /api/cliente/cofre
//
// Fase 1 do Cofre do Chefe: read-model autenticado e estritamente somente
// leitura. Não aceita clienteId por query/body; o titular vem exclusivamente
// da sessão do cliente e é canonizado pelo mesmo telefone usado no ledger.
//
// Esta rota NÃO:
// - cria cupom;
// - reserva/debita Estrelas;
// - altera Ranking;
// - escreve analytics;
// - envia WhatsApp;
// - cria pedido/Pix;
// - imprime ou altera estoque.
export async function GET(req: NextRequest) {
  const payload = await lerSessaoCliente(req);
  if (!payload) {
    return NextResponse.json(
      { error: "Nao autorizado" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const cliente = await buscarClientePorId(payload.clienteId);
  if (!cliente) {
    return NextResponse.json(
      { error: "Nao autorizado" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const clienteId = derivarClienteIdPorTelefone(cliente.telefone) ?? cliente.clienteId;
  const estado = await obterCofreClienteSomenteLeitura({ clienteId });

  return NextResponse.json(estado, {
    headers: {
      "Cache-Control": "no-store",
      "X-ChefeBot-Cofre-Mode": "read-only",
    },
  });
}
