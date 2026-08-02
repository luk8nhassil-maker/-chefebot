import { NextRequest, NextResponse } from "next/server";
import { lerSessaoSalao } from "@/lib/salaoAuth";
import { descartarComandaVazia } from "@/lib/comandas";

export const dynamic = "force-dynamic";

// Descarta um atendimento que ainda não enviou nada para a cozinha — usado
// por "Fechar sem item" (silencioso) e por "Descartar pedido" (com
// confirmação) no catálogo/revisão. Nunca mexe em uma comanda que já tem
// pedido oficial: aí é `fecharComanda`, o caminho oposto.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessaoSalao = await lerSessaoSalao(req);
  if (!sessaoSalao) {
    return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }

  const { id } = await params;
  const resultado = await descartarComandaVazia(id);

  if (resultado === "nao_encontrada") {
    return NextResponse.json({ ok: false, error: "Comanda não encontrada" }, { status: 404 });
  }
  if (resultado === "ja_enviada") {
    return NextResponse.json({ ok: false, error: "Este pedido já foi enviado para a cozinha e não pode mais ser descartado" }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}
