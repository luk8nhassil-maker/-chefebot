import { NextRequest, NextResponse } from "next/server";
import { verificarTokenCliente, CLIENTE_COOKIE } from "@/lib/clienteAuth";
import { buscarClientePorId } from "@/lib/clientes";
import { cancelarReservaResgate } from "@/lib/fidelidade";

// DELETE /api/cliente/fidelidade/resgates/[resgateId] — cancela uma reserva
// ainda nao aplicada do proprio cliente autenticado. Uma reserva ja aplicada
// a um pedido nao pode ser cancelada manualmente.

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ resgateId: string }> }
) {
  const token = req.cookies.get(CLIENTE_COOKIE)?.value ?? null;
  if (!token) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const payload = await verificarTokenCliente(token);
  if (!payload) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const cliente = await buscarClientePorId(payload.clienteId);
  if (!cliente) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const { resgateId } = await params;
  const resultado = await cancelarReservaResgate(cliente.clienteId, resgateId);
  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
