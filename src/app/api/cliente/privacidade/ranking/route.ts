import { NextRequest, NextResponse } from "next/server";
import { lerSessaoCliente } from "@/lib/clienteAuth";
import {
  ErroConsentimentoRanking,
  obterHistoricoConsentimentoRanking,
  obterPreferenciasConsentimentoRanking,
  registrarConsentimentoRanking,
  revogarTodosConsentimentosRanking,
} from "@/lib/consentimentoRanking";

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
  if (erro.codigo === "fonte_oficial_indisponivel") return 409;
  return 503;
}

export async function GET(req: NextRequest) {
  const cliente = await clienteAutenticado(req);
  if (!cliente) return respostaJson({ error: "Nao autorizado" }, { status: 401 });

  try {
    const finalidades = await obterPreferenciasConsentimentoRanking(cliente.clienteId);
    const incluirHistorico = req.nextUrl.searchParams.get("historico") === "1";
    if (!incluirHistorico) return respostaJson({ finalidades });

    const offsetBruto = Number(req.nextUrl.searchParams.get("offset") ?? 0);
    const offset = Number.isFinite(offsetBruto) ? offsetBruto : 0;
    const historico = await obterHistoricoConsentimentoRanking(cliente.clienteId, offset, 50);
    return respostaJson({ finalidades, historico });
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
    await registrarConsentimentoRanking({
      clienteId: cliente.clienteId,
      finalidade: body.finalidade,
      estado: body.estado,
      textoVersaoInformada: body.textoVersao,
    });
    const finalidades = await obterPreferenciasConsentimentoRanking(cliente.clienteId);
    return respostaJson({ ok: true, finalidades });
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
    const finalidades = await obterPreferenciasConsentimentoRanking(cliente.clienteId);
    return respostaJson({ ok: true, finalidades });
  } catch (erro) {
    if (erro instanceof ErroConsentimentoRanking) {
      return respostaJson({ ok: false, error: erro.codigo }, { status: statusErroConsentimento(erro) });
    }
    return respostaJson({ ok: false, error: "Erro interno" }, { status: 500 });
  }
}
