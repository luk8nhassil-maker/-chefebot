import { NextRequest, NextResponse } from "next/server";
import { lerSessaoSalao } from "@/lib/salaoAuth";
import { atualizarItensRodada, totalParcialComanda, validarItensComanda } from "@/lib/comandas";
import { executarMutacaoComContaAbertaSalao } from "@/lib/salaoConta.server";
import { ERRO_ESCRITA_SALAO_PREVIEW, escritaSalaoBloqueadaNoPreview } from "@/lib/salaoAmbiente";

export const dynamic = "force-dynamic";

// Adicionar/editar quantidade/remover item e editar observação de UMA
// rodada específica — mesmo padrão de "carrinho completo" já usado por
// PATCH /api/salao/comandas/[id] (Rodada 1): o Salão sempre envia a lista
// atual e completa de itens da rodada, nunca um diff. Preço sempre
// recalculado no servidor contra o cardápio oficial. Uma rodada em
// rascunho pode ficar momentaneamente vazia (removeu o último item antes
// de adicionar outro) — só o envio para a cozinha exige itens.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; rodadaId: string }> }
) {
  const sessaoSalao = await lerSessaoSalao(req);
  if (!sessaoSalao) {
    return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }
  if (escritaSalaoBloqueadaNoPreview()) {
    return NextResponse.json({ ok: false, error: ERRO_ESCRITA_SALAO_PREVIEW }, { status: 403 });
  }

  const { id, rodadaId } = await params;
  let body: { itens?: unknown; observacao?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Payload inválido" }, { status: 400 });
  }

  const validacao = await validarItensComanda(body.itens, { permitirVazio: true });
  if (!validacao.ok) {
    return NextResponse.json({ ok: false, error: validacao.error }, { status: 400 });
  }

  let mutacao;
  try {
    mutacao = await executarMutacaoComContaAbertaSalao(id, () =>
      atualizarItensRodada(id, rodadaId, validacao.itens, { observacao: body.observacao })
    );
  } catch {
    return NextResponse.json({ ok: false, error: "Não foi possível salvar agora. Tente de novo." }, { status: 503 });
  }
  if (!mutacao.ok) {
    return NextResponse.json({ ok: false, error: mutacao.error }, { status: mutacao.status });
  }
  const resultado = mutacao.valor;

  if (!resultado.ok) {
    if (resultado.motivo === "nao_encontrada") {
      return NextResponse.json({ ok: false, error: "Comanda não encontrada" }, { status: 404 });
    }
    if (resultado.motivo === "comanda_fechada") {
      return NextResponse.json({ ok: false, error: "Esta comanda já está fechada" }, { status: 409 });
    }
    if (resultado.motivo === "rodada_nao_encontrada") {
      return NextResponse.json({ ok: false, error: "Rodada não encontrada" }, { status: 404 });
    }
    return NextResponse.json({ ok: false, error: "Esta rodada já foi enviada e não pode mais ser editada" }, { status: 409 });
  }

  return NextResponse.json({
    ok: true,
    rodada: resultado.rodada,
    comanda: resultado.comanda,
    total: validacao.total,
    totalParcial: totalParcialComanda(resultado.comanda),
  });
}
