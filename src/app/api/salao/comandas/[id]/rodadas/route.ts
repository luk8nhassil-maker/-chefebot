import { NextRequest, NextResponse } from "next/server";
import { lerSessaoSalao } from "@/lib/salaoAuth";
import { criarRodadaEmRascunho, totalParcialComanda } from "@/lib/comandas";
import { podeAdicionarItensNaComanda } from "@/lib/salaoConta.server";
import { ERRO_ESCRITA_SALAO_PREVIEW, escritaSalaoBloqueadaNoPreview } from "@/lib/salaoAmbiente";

export const dynamic = "force-dynamic";

// Cria a próxima rodada em rascunho da comanda — idempotente (clientRequestId
// e por estado: nunca duas rodadas em rascunho ao mesmo tempo, ver
// src/lib/comandas.ts). Nesta etapa isto só cria a estrutura em memória:
// nenhum pedido oficial é criado, nenhuma impressão é disparada.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessaoSalao = await lerSessaoSalao(req);
  if (!sessaoSalao) {
    return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }
  if (escritaSalaoBloqueadaNoPreview()) {
    return NextResponse.json({ ok: false, error: ERRO_ESCRITA_SALAO_PREVIEW }, { status: 403 });
  }

  const { id } = await params;
  if (!(await podeAdicionarItensNaComanda(id))) {
    return NextResponse.json({ ok: false, error: "A conta já foi solicitada. Continue o atendimento antes de adicionar novos itens." }, { status: 409 });
  }

  let body: { clientRequestId?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  let resultado;
  try {
    resultado = await criarRodadaEmRascunho(id, body.clientRequestId);
  } catch {
    return NextResponse.json({ ok: false, error: "Não foi possível criar a rodada agora. Tente de novo." }, { status: 503 });
  }

  if (!resultado.ok) {
    if (resultado.motivo === "nao_encontrada") {
      return NextResponse.json({ ok: false, error: "Comanda não encontrada" }, { status: 404 });
    }
    return NextResponse.json({ ok: false, error: "Esta comanda já está fechada" }, { status: 409 });
  }

  return NextResponse.json({
    ok: true,
    rodada: resultado.rodada,
    criada: resultado.criada,
    comanda: resultado.comanda,
    totalParcial: totalParcialComanda(resultado.comanda),
  });
}
