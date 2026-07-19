import { NextRequest, NextResponse } from "next/server";
import { lerSessaoCliente } from "@/lib/clienteAuth";
import { buscarClientePorId } from "@/lib/clientes";
import { derivarClienteIdPorTelefone } from "@/lib/fidelidade";
import { abrirRecompensa } from "@/lib/jornadaChef";

// POST /api/cliente/jornada-chef/abrir — abre a caixa (revela o presente já
// determinado no servidor). Idempotente: refresh/clique duplo nunca muda o
// resultado. Nunca confia em recompensaId sem checar a sessão + propriedade.

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
    const recompensa = await abrirRecompensa(clienteIdJornada, recompensaId);
    return NextResponse.json({
      ok: true,
      recompensaId: recompensa.recompensaId,
      tipo: recompensa.tipo,
      produtoNome: recompensa.produtoNome,
      abertaEm: recompensa.abertaEm,
      validaAte: recompensa.validaAte,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Nao foi possivel abrir o presente" }, { status: 400 });
  }
}
