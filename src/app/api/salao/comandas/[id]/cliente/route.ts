import { NextRequest, NextResponse } from "next/server";
import { lerSessaoSalao } from "@/lib/salaoAuth";
import { atualizarClienteSalao } from "@/lib/salaoCliente.server";
import { ERRO_ESCRITA_SALAO_PREVIEW, escritaSalaoBloqueadaNoPreview } from "@/lib/salaoAmbiente";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessaoSalao = await lerSessaoSalao(req);
  if (!sessaoSalao) {
    return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }
  if (escritaSalaoBloqueadaNoPreview()) {
    return NextResponse.json({ ok: false, error: ERRO_ESCRITA_SALAO_PREVIEW }, { status: 403 });
  }

  let body: { cliente?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Payload inválido" }, { status: 400 });
  }

  const cliente = typeof body.cliente === "string" ? body.cliente.trim() : "";
  if (!cliente) {
    return NextResponse.json({ ok: false, error: "Informe o nome do cliente" }, { status: 400 });
  }

  const { id } = await params;
  const resultado = await atualizarClienteSalao(id, cliente);
  if (!resultado.ok) {
    if (resultado.motivo === "nao_encontrada") {
      return NextResponse.json({ ok: false, error: "Comanda não encontrada" }, { status: 404 });
    }
    if (resultado.motivo === "comanda_fechada") {
      return NextResponse.json({ ok: false, error: "Esta comanda já está fechada" }, { status: 409 });
    }
    if (resultado.motivo === "mutex_indisponivel") {
      return NextResponse.json({ ok: false, error: "Atendimento ocupado. Tente novamente." }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: "Informe o nome do cliente" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, comanda: resultado.comanda });
}
