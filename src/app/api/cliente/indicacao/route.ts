import { NextRequest, NextResponse } from "next/server";
import { lerSessaoCliente } from "@/lib/clienteAuth";
import { buscarClientePorId } from "@/lib/clientes";
import { derivarClienteIdPorTelefone } from "@/lib/fidelidade";
import {
  salvarTokenIndicacao,
  resolverTokenIndicacao,
  salvarCandidaturaIndicacao,
} from "@/lib/indicacaoToken";

// GET /api/cliente/indicacao — retorna o token opaco de indicação do cliente
// autenticado, criando-o se ainda não existir. O token é enviado ao amigo
// como query-param `?ref=TOKEN` no link de acesso.
export async function GET(req: NextRequest) {
  const payload = await lerSessaoCliente(req);
  if (!payload) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const cliente = await buscarClientePorId(payload.clienteId);
  if (!cliente) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const clienteId = derivarClienteIdPorTelefone(cliente.telefone) ?? cliente.clienteId;
  const token = await salvarTokenIndicacao(clienteId);
  return NextResponse.json({ token });
}

// POST /api/cliente/indicacao { ref: TOKEN } — salva candidatura de indicação para
// o cliente autenticado. A relação permanente só é confirmada na primeira compra.
export async function POST(req: NextRequest) {
  const payload = await lerSessaoCliente(req);
  if (!payload) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const cliente = await buscarClientePorId(payload.clienteId);
  if (!cliente) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "Body invalido" }, { status: 400 });
  }

  const ref = typeof body.ref === "string" ? body.ref.trim() : null;
  if (!ref) return NextResponse.json({ error: "ref obrigatorio" }, { status: 400 });

  const indicadorId = await resolverTokenIndicacao(ref);
  if (!indicadorId) return NextResponse.json({ error: "Token invalido ou expirado" }, { status: 400 });

  const indicadoId = derivarClienteIdPorTelefone(cliente.telefone) ?? cliente.clienteId;

  const resultado = await salvarCandidaturaIndicacao(indicadoId, indicadorId);
  if (resultado === "self_referral") {
    return NextResponse.json({ error: "Indicacao propria nao permitida" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, status: resultado });
}
