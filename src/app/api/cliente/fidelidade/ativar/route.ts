import { NextRequest, NextResponse } from "next/server";
import { resolverSessaoCliente, definirCookieSessaoCliente } from "@/lib/clienteAuth";
import { ativarParticipacaoPontos } from "@/lib/clientes";
import { obterConfigFidelidadePontos } from "@/lib/fidelidade";

// POST /api/cliente/fidelidade/ativar — ativa a participação individual do
// cliente autenticado no programa de pontos (Nível 6.6). Não recebe nenhum
// identificador no corpo: o cliente é sempre resolvido pela sessão (cookie),
// nunca por telefone/clienteId enviado pelo frontend. Idempotente —
// `ativarParticipacaoPontos` não sobrescreve nem duplica nada se o cliente já
// estava ativo.
//
// Nível 6.6.1: nunca ativa participação individual se o programa GLOBAL
// estiver desligado — sem essa checagem, um cliente conseguia "ativar" uma
// participação que nunca teria efeito nenhum (e que ficaria ativa por engano
// quando o admin ligasse o programa depois, sem o cliente ter revisitado a
// decisão).
export async function POST(req: NextRequest) {
  const sessao = await resolverSessaoCliente(req);
  if (!sessao) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const config = await obterConfigFidelidadePontos();
  if (!config.ativo) {
    return NextResponse.json({ error: "Programa de pontos inativo", codigo: "PROGRAMA_PONTOS_INATIVO" }, { status: 409 });
  }

  const cliente = await ativarParticipacaoPontos(sessao.cliente.clienteId);
  if (!cliente) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  if (cliente.pontosAtivos !== true || !cliente.pontosAtivadoEm) {
    return NextResponse.json({ error: "Nao foi possivel confirmar a ativacao dos pontos", codigo: "ATIVACAO_NAO_CONFIRMADA" }, { status: 502 });
  }

  const res = NextResponse.json({
    ok: true,
    pontosAtivos: true,
    pontosAtivadoEm: cliente.pontosAtivadoEm ?? null,
  });
  if (sessao.deveRenovar && sessao.novoToken) definirCookieSessaoCliente(res, sessao.novoToken);
  return res;
}
