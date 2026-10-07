import { NextRequest, NextResponse } from "next/server";
import { lerSessaoCliente } from "@/lib/clienteAuth";
import { buscarClientePorId } from "@/lib/clientes";
import { derivarClienteIdPorTelefone } from "@/lib/fidelidade";
import { obterOuCriarConviteDivulgacao } from "@/lib/rankingMissaoDivulgacao";

const TENANT_ID = "default";

function mensagemCompartilhamento(premioDescricao: string | null): string {
  if (premioDescricao) {
    return `🍕 Estou no Ranking do Chefe! Hoje você também pode entrar no jogo. Tem ${premioDescricao} como prêmio da temporada, conforme as regras. Faça seu pedido pelo meu link:`;
  }
  return "🍕 Estou no Ranking do Chefe! Você também pode fazer seu pedido, juntar Estrelas, subir no ranking e desbloquear presentes. Entra pelo meu link:";
}

export async function GET(req: NextRequest) {
  const sessao = await lerSessaoCliente(req);
  if (!sessao) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const cliente = await buscarClientePorId(sessao.clienteId);
  if (!cliente) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const clienteId = derivarClienteIdPorTelefone(cliente.telefone) ?? cliente.clienteId;
  try {
    const convite = await obterOuCriarConviteDivulgacao({ tenantId: TENANT_ID, clienteId });
    const url = convite.token ? `${req.nextUrl.origin}/m/${encodeURIComponent(convite.token)}` : null;
    const resposta = NextResponse.json({
      ...convite.estado,
      url,
      mensagem: url ? mensagemCompartilhamento(convite.premioDescricao) : null,
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
    if (convite.token) {
      resposta.cookies.set("cf_marketing_owner", convite.token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 72 * 60 * 60,
      });
    }
    return resposta;
  } catch {
    return NextResponse.json({ error: "missao_indisponivel" }, { status: 503 });
  }
}
