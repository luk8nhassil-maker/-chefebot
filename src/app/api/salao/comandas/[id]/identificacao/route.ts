import { NextRequest, NextResponse } from "next/server";
import { lerSessaoSalao } from "@/lib/salaoAuth";
import { atualizarIdentificacaoComanda } from "@/lib/comandas";

export const dynamic = "force-dynamic";

// Grava cliente/mesa/WhatsApp da comanda — chamado só pela tela de revisão,
// no fim do fluxo do garçom (nunca na abertura do atendimento, que agora
// abre a comanda ainda anônima direto no catálogo).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessaoSalao = await lerSessaoSalao(req);
  if (!sessaoSalao) {
    return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }

  const { id } = await params;
  let body: { cliente?: string; mesa?: string; semMesa?: boolean; whatsapp?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Payload inválido" }, { status: 400 });
  }

  const resultado = await atualizarIdentificacaoComanda(id, {
    cliente: body.cliente,
    mesa: body.mesa,
    semMesa: body.semMesa,
    whatsapp: body.whatsapp,
  });

  if (resultado === "nao_encontrada") {
    return NextResponse.json({ ok: false, error: "Comanda não encontrada" }, { status: 404 });
  }
  if (resultado === "nao_esta_aberta") {
    return NextResponse.json({ ok: false, error: "Esta comanda não está mais aberta" }, { status: 409 });
  }
  if (resultado === "mesa_ocupada") {
    return NextResponse.json({ ok: false, error: "Esta mesa já possui uma comanda aberta" }, { status: 409 });
  }

  return NextResponse.json({ ok: true, comanda: resultado });
}
