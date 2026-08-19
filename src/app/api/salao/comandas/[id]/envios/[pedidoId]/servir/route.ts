import { NextRequest, NextResponse } from "next/server";
import { lerSessaoSalao } from "@/lib/salaoAuth";
import { marcarEnvioServidoSalao } from "@/lib/salaoConta.server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; pedidoId: string }> }) {
  const sessao = await lerSessaoSalao(req);
  if (!sessao) return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  const { id, pedidoId } = await params;

  try {
    const resultado = await marcarEnvioServidoSalao(id, pedidoId, "Salão");
    if (!resultado.ok) return NextResponse.json({ ok: false, error: resultado.error }, { status: resultado.status });
    return NextResponse.json({ ok: true, deduplicado: resultado.deduplicado });
  } catch (error) {
    console.error("[Salão] Falha ao marcar servido:", error instanceof Error ? error.message : "erro desconhecido");
    return NextResponse.json({ ok: false, error: "Não foi possível marcar este pedido como servido agora." }, { status: 503 });
  }
}
