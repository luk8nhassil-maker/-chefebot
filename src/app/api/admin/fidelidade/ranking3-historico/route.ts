import { NextRequest, NextResponse } from "next/server";
import { autenticarRequisicao, exigirRole } from "@/lib/apiAuth";
import {
  PRIMEIRA_TEMPORADA_HISTORICA,
  auditarPrimeiroParticipanteLegitimo,
  concederPremioExcepcionalPrimeiraTemporada,
} from "@/lib/ranking3/historico";

function respostaSegura(resultado: Awaited<ReturnType<typeof auditarPrimeiroParticipanteLegitimo>>) {
  if (resultado.estado !== "pronto_para_conceder" && resultado.estado !== "concedido") return resultado;
  return {
    estado: resultado.estado,
    temporadaId: resultado.temporadaId,
    vencedor: { posicao: resultado.vencedor.posicao, score: resultado.vencedor.score },
    corteEm: resultado.corteEm,
    ...(resultado.estado === "concedido" ? { premio: { id: resultado.premio.id, estado: resultado.premio.estado, origem: resultado.premio.origem } } : {}),
  };
}

export async function GET(req: NextRequest) {
  const erro = exigirRole(await autenticarRequisicao(req), ["admin", "dev"]);
  if (erro) return erro;
  const resultado = await auditarPrimeiroParticipanteLegitimo();
  return NextResponse.json(respostaSegura(resultado));
}

export async function POST(req: NextRequest) {
  const erro = exigirRole(await autenticarRequisicao(req), ["admin", "dev"]);
  if (erro) return erro;
  const body = await req.json().catch(() => null);
  if (body?.temporadaId !== PRIMEIRA_TEMPORADA_HISTORICA || body?.confirmar !== "CONCEDER_PREMIO_HISTORICO") {
    return NextResponse.json({ ok: false, error: "confirmacao_explicita_obrigatoria" }, { status: 400 });
  }
  const resultado = await concederPremioExcepcionalPrimeiraTemporada();
  return NextResponse.json({ ok: resultado.estado === "concedido", ...respostaSegura(resultado) });
}
