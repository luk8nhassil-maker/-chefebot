import { NextRequest, NextResponse } from "next/server";
import { lerSessaoCliente } from "@/lib/clienteAuth";
import { buscarClientePorId } from "@/lib/clientes";
import { derivarClienteIdPorTelefone } from "@/lib/fidelidade";
import { cancelarReservaRecompensa } from "@/lib/jornadaChef";

// POST /api/cliente/jornada-chef/cancelar-reserva — remove a reserva do
// carrinho SEM perder o prêmio (volta a ficar "disponivel" para uso futuro).
// Só funciona antes de o presente estar vinculado a um pedido de verdade.

export async function POST(req: NextRequest) {
  const payload = await lerSessaoCliente(req);
  if (!payload) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const cliente = await buscarClientePorId(payload.clienteId);
  if (!cliente) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const recompensaId = typeof body?.recompensaId === "string" ? body.recompensaId : "";
  if (!recompensaId) return NextResponse.json({ error: "recompensaId obrigatorio" }, { status: 400 });

  const clienteIdJornada = derivarClienteIdPorTelefone(cliente.telefone) ?? cliente.clienteId;

  try {
    const recompensa = await cancelarReservaRecompensa(clienteIdJornada, recompensaId);
    return NextResponse.json({ ok: true, recompensaId: recompensa.recompensaId, status: recompensa.status });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Nao foi possivel remover a reserva" }, { status: 400 });
  }
}
