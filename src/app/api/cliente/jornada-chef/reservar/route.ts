import { NextRequest, NextResponse } from "next/server";
import { lerSessaoCliente } from "@/lib/clienteAuth";
import { buscarClientePorId } from "@/lib/clientes";
import { derivarClienteIdPorTelefone } from "@/lib/fidelidade";
import { reservarRecompensaParaProximoPedido, obterConfigJornadaChef, jornadaAtivaParaCliente } from "@/lib/jornadaChef";

// POST /api/cliente/jornada-chef/reservar — cliente escolhe "Usar no próximo
// pedido": reserva o presente para o carrinho (ainda sem pedido vinculado).

export async function POST(req: NextRequest) {
  const payload = await lerSessaoCliente(req);
  if (!payload) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const cliente = await buscarClientePorId(payload.clienteId);
  if (!cliente) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const recompensaId = typeof body?.recompensaId === "string" ? body.recompensaId : "";
  if (!recompensaId) return NextResponse.json({ error: "recompensaId obrigatorio" }, { status: 400 });

  const clienteIdJornada = derivarClienteIdPorTelefone(cliente.telefone) ?? cliente.clienteId;
  const config = await obterConfigJornadaChef();
  if (!jornadaAtivaParaCliente(config, clienteIdJornada)) {
    return NextResponse.json({ ok: false, error: "Jornada do Chef nao disponivel" }, { status: 403 });
  }

  try {
    const recompensa = await reservarRecompensaParaProximoPedido(clienteIdJornada, recompensaId);
    return NextResponse.json({ ok: true, recompensaId: recompensa.recompensaId, status: recompensa.status });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Nao foi possivel reservar o presente" }, { status: 400 });
  }
}
