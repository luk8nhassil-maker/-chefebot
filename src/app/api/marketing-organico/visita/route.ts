import { NextRequest, NextResponse } from "next/server";
import { lerSessaoCliente } from "@/lib/clienteAuth";
import { buscarClientePorId } from "@/lib/clientes";
import { derivarClienteIdPorTelefone } from "@/lib/fidelidade";
import { confirmarAberturaConviteDivulgacao, resolverConviteDivulgacao } from "@/lib/rankingMissaoDivulgacao";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    return NextResponse.json({ ok: false, destino: "/pedido" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token) return NextResponse.json({ ok: false, destino: "/pedido" }, { status: 400 });

  let visitanteClienteId: string | null = null;
  try {
    const cookieDono = req.cookies.get("cf_marketing_owner")?.value ?? null;
    if (cookieDono === token) {
      const payload = await resolverConviteDivulgacao(token);
      visitanteClienteId = payload?.clienteId ?? null;
    } else {
      const sessao = await lerSessaoCliente(req);
      if (sessao) {
        const cliente = await buscarClientePorId(sessao.clienteId);
        if (cliente) visitanteClienteId = derivarClienteIdPorTelefone(cliente.telefone) ?? cliente.clienteId;
      }
    }
  } catch {}

  const resultado = await confirmarAberturaConviteDivulgacao({ token, visitanteClienteId });
  const destino = resultado.valido && resultado.refToken
    ? `/pedido?ref=${encodeURIComponent(resultado.refToken)}`
    : "/pedido";

  return NextResponse.json({
    ok: resultado.valido,
    destino,
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
