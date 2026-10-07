import { NextRequest, NextResponse } from "next/server";
import { lerSessaoCliente } from "@/lib/clienteAuth";
import {
  ErroConsentimentoRanking,
  obterHistoricoConsentimentoRanking,
  obterParticipacaoRanking,
  obterPreferenciasConsentimentoRanking,
  obterRegraJogoSecretoRanking,
  registrarParticipacaoRanking,
  registrarConsentimentoRanking,
  revogarTodosConsentimentosRanking,
} from "@/lib/consentimentoRanking";
import { dataReferenciaUtc } from "@/lib/rankingHistorico";
import { registrarFatoRankingGamificacao } from "@/lib/rankingGamificacaoFatos";

export const dynamic = "force-dynamic";

function respostaJson(body: unknown, init?: ResponseInit): NextResponse {
  const resposta = NextResponse.json(body, init);
  resposta.headers.set("Cache-Control", "private, no-store, max-age=0");
  return resposta;
}
async function clienteAutenticado(req: NextRequest): Promise<{ clienteId: string } | null> {
  const sessao = await lerSessaoCliente(req);
  return sessao?.clienteId ? { clienteId: sessao.clienteId } : null;
}

function statusErroConsentimento(erro: ErroConsentimentoRanking): number {
  if (erro.codigo === "finalidade_invalida") return 400;
  if (erro.codigo === "versao_texto_desatualizada") return 409;
  if (erro.codigo === "participacao_inativa") return 409;
  if (erro.codigo === "fonte_oficial_indisponivel") return 409;
  return 503;
}

async function obterEstadoRankingCliente(clienteId: string) {
  const [finalidades, participaCampanha, regraJogo] = await Promise.all([
    obterPreferenciasConsentimentoRanking(clienteId),
    obterParticipacaoRanking(clienteId),
    obterRegraJogoSecretoRanking(clienteId),
  ]);
  return {
    finalidades,
    participaCampanha,
    regraJogo: {
      versao: "ranking-jogo-secreto-v1",
      aceitaRevelacao30d: regraJogo.aceitaRevelacao30d,
      diasRevelacao: 30,
    },
  };
}

/** Ativação voluntária. Não concede nome, telefone, bônus ou recompensa. */
export async function POST(req: NextRequest) {
  const cliente = await clienteAutenticado(req);
  if (!cliente) return respostaJson({ error: "Nao autorizado" }, { status: 401 });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {}

  if (body.aceitaRegraRevelacao30d !== true) {
    return respostaJson({ error: "regra_jogo_nao_aceita" }, { status: 400 });
  }

  try {
    await registrarParticipacaoRanking(cliente.clienteId, true, { aceitaRevelacao30d: true });
    return respostaJson({ ok: true, ...await obterEstadoRankingCliente(cliente.clienteId) });
  } catch (erro) {
    if (erro instanceof ErroConsentimentoRanking) {
      return respostaJson({ error: erro.codigo }, { status: statusErroConsentimento(erro) });
    }
    return respostaJson({ error: "Erro interno" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const cliente = await clienteAutenticado(req);
  if (!cliente) return respostaJson({ error: "Nao autorizado" }, { status: 401 });

  try {
    const estadoRanking = await obterEstadoRankingCliente(cliente.clienteId);
    const incluirHistorico = req.nextUrl.searchParams.get("historico") === "1";
    if (!incluirHistorico) return respostaJson(estadoRanking);

    const offsetBruto = Number(req.nextUrl.searchParams.get("offset") ?? 0);
    const offset = Number.isFinite(offsetBruto) ? offsetBruto : 0;
    const historico = await obterHistoricoConsentimentoRanking(cliente.clienteId, offset, 50);
    return respostaJson({ ...estadoRanking, historico });
  } catch (erro) {
    if (erro instanceof ErroConsentimentoRanking) {
      return respostaJson({ error: erro.codigo }, { status: statusErroConsentimento(erro) });
    }
    return respostaJson({ error: "Erro interno" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const cliente = await clienteAutenticado(req);
  if (!cliente) return respostaJson({ error: "Nao autorizado" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return respostaJson({ error: "Corpo invalido" }, { status: 400 });
  }

  if (body.estado !== "concedido" && body.estado !== "revogado") {
    return respostaJson({ error: "estado_invalido" }, { status: 400 });
  }

  try {
    if (body.estado === "concedido" && !await obterParticipacaoRanking(cliente.clienteId)) {
      return respostaJson({ error: "ranking_inativo" }, { status: 409 });
    }
    await registrarConsentimentoRanking({
      clienteId: cliente.clienteId,
      finalidade: body.finalidade,
      estado: body.estado,
      textoVersaoInformada: body.textoVersao,
    });
    const estadoRanking = await obterEstadoRankingCliente(cliente.clienteId);
    return respostaJson({ ok: true, ...estadoRanking });
  } catch (erro) {
    if (erro instanceof ErroConsentimentoRanking) {
      return respostaJson({ ok: false, error: erro.codigo }, { status: statusErroConsentimento(erro) });
    }
    return respostaJson({ ok: false, error: "Erro interno" }, { status: 500 });
  }
}

/** DELETE remove todas as autorizacoes ativas, mas preserva a trilha de
 * auditoria. Nao representa pedido amplo de eliminacao LGPD. */
export async function DELETE(req: NextRequest) {
  const cliente = await clienteAutenticado(req);
  if (!cliente) return respostaJson({ error: "Nao autorizado" }, { status: 401 });

  try {
    await revogarTodosConsentimentosRanking(cliente.clienteId);
    // Fato de negócio registrado no servidor (nunca a partir do clique no
    // navegador) — deduplicado por cliente+dia, coerente com o mesmo idioma
    // de "referência diária" já usado no snapshot do histórico do ranking.
    try {
      await registrarFatoRankingGamificacao(
        "participacao_revogada",
        `${cliente.clienteId}:${dataReferenciaUtc(new Date())}`,
      );
    } catch {
      // A saída já foi confirmada no Redis; uma falha da telemetria não
      // reverte a decisão nem deve instruir o cliente a repetir a ação.
    }
    const estadoRanking = await obterEstadoRankingCliente(cliente.clienteId);
    return respostaJson({ ok: true, ...estadoRanking });
  } catch (erro) {
    if (erro instanceof ErroConsentimentoRanking) {
      return respostaJson({ ok: false, error: erro.codigo }, { status: statusErroConsentimento(erro) });
    }
    return respostaJson({ ok: false, error: "Erro interno" }, { status: 500 });
  }
}
