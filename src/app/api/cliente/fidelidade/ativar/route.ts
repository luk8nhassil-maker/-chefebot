import { NextRequest, NextResponse } from "next/server";
import { resolverSessaoCliente, definirCookieSessaoCliente } from "@/lib/clienteAuth";
import { ativarParticipacaoPontos } from "@/lib/clientes";

// POST /api/cliente/fidelidade/ativar — ativa a participação individual do
// cliente autenticado no programa de pontos (Nível 6.6). Não recebe nenhum
// identificador no corpo: o cliente é sempre resolvido pela sessão (cookie),
// nunca por telefone/clienteId enviado pelo frontend. Idempotente —
// `ativarParticipacaoPontos` não sobrescreve nem duplica nada se o cliente já
// estava ativo.
export async function POST(req: NextRequest) {
  const sessao = await resolverSessaoCliente(req);
  if (!sessao) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const cliente = await ativarParticipacaoPontos(sessao.cliente.clienteId);
  if (!cliente) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const res = NextResponse.json({
    ok: true,
    pontosAtivos: true,
    pontosAtivadoEm: cliente.pontosAtivadoEm ?? null,
  });
  if (sessao.deveRenovar && sessao.novoToken) definirCookieSessaoCliente(res, sessao.novoToken);
  return res;
}
