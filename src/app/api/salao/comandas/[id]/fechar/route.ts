import { NextRequest, NextResponse } from "next/server";
import { lerSessaoSalao } from "@/lib/salaoAuth";
import { fecharComanda } from "@/lib/comandas";

export const dynamic = "force-dynamic";

// Fechar a comanda é só o bookkeeping do Salão em si (a mesa está livre de
// novo) — o pedido criado ao enviar continua seguindo o ciclo de vida
// normal em /pedidos (status, pagamento, impressão), sem nenhuma ligação
// nova aqui. Só pode fechar depois de ter enviado ao menos um pedido.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessaoSalao = await lerSessaoSalao(req);
  if (!sessaoSalao) {
    return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }

  const { id } = await params;
  const resultado = await fecharComanda(id);

  if (resultado === "nao_encontrada") {
    return NextResponse.json({ ok: false, error: "Comanda não encontrada" }, { status: 404 });
  }
  if (resultado === "ainda_aberta") {
    return NextResponse.json({ ok: false, error: "Envie o pedido antes de fechar a comanda" }, { status: 409 });
  }
  if (resultado === "ja_fechada") {
    return NextResponse.json({ ok: false, error: "Esta comanda já está fechada" }, { status: 409 });
  }

  return NextResponse.json({ ok: true, comanda: resultado });
}
