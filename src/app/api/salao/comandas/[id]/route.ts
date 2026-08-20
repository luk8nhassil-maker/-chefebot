import { NextRequest, NextResponse } from "next/server";
import { lerSessaoSalao } from "@/lib/salaoAuth";
import { atualizarItensComanda, validarItensComanda } from "@/lib/comandas";
import { executarMutacaoComContaAbertaSalao } from "@/lib/salaoConta.server";
import { ERRO_ESCRITA_SALAO_PREVIEW, escritaSalaoBloqueadaNoPreview } from "@/lib/salaoAmbiente";

export const dynamic = "force-dynamic";

// Adicionar/editar quantidade/remover item, e editar observação/complemento
// — tudo é a MESMA operação aqui: o Salão sempre envia a lista completa e
// atual dos itens da comanda (como um carrinho), nunca um diff. Preço
// sempre recalculado no servidor contra o cardápio oficial.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessaoSalao = await lerSessaoSalao(req);
  if (!sessaoSalao) {
    return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }
  if (escritaSalaoBloqueadaNoPreview()) {
    return NextResponse.json({ ok: false, error: ERRO_ESCRITA_SALAO_PREVIEW }, { status: 403 });
  }

  const { id } = await params;
  let body: { itens?: unknown; observacao?: string; complemento?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Payload inválido" }, { status: 400 });
  }

  const validacao = await validarItensComanda(body.itens);
  if (!validacao.ok) {
    return NextResponse.json({ ok: false, error: validacao.error }, { status: 400 });
  }

  const mutacao = await executarMutacaoComContaAbertaSalao(id, () =>
    atualizarItensComanda(id, validacao.itens, {
      observacao: body.observacao,
      complemento: body.complemento,
    })
  );
  if (!mutacao.ok) {
    return NextResponse.json({ ok: false, error: mutacao.error }, { status: mutacao.status });
  }
  const resultado = mutacao.valor;

  if (resultado === "nao_encontrada") {
    return NextResponse.json({ ok: false, error: "Comanda não encontrada" }, { status: 404 });
  }
  if (resultado === "nao_esta_aberta") {
    return NextResponse.json({ ok: false, error: "Esta comanda não está mais aberta" }, { status: 409 });
  }

  return NextResponse.json({ ok: true, comanda: resultado, total: validacao.total });
}
