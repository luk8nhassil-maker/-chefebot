import { NextRequest, NextResponse } from "next/server";
import { lerSessaoSalao } from "@/lib/salaoAuth";
import { solicitarContaSalao } from "@/lib/salaoConta.server";

export const dynamic = "force-dynamic";

// Compatibilidade com a tela anterior do Salão: este endpoint não fecha mais
// a comanda diretamente. Ele só faz a transição segura "Pedir conta". O
// pagamento e o fechamento definitivo acontecem exclusivamente no caixa,
// com total recalculado e forma de pagamento validada no servidor.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessao = await lerSessaoSalao(req);
  if (!sessao) return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  try {
    const resultado = await solicitarContaSalao(id, "Salão");
    if (!resultado.ok) {
      const code = "code" in resultado && typeof resultado.code === "string" ? resultado.code : undefined;
      return NextResponse.json({ ok: false, error: resultado.error, ...(code ? { code } : {}) }, { status: resultado.status });
    }
    return NextResponse.json({ ok: true, contaSolicitada: true, estado: resultado.estado, deduplicado: resultado.deduplicado });
  } catch (error) {
    console.error("[Salão] Falha ao solicitar conta pelo endpoint legado:", error instanceof Error ? error.message : "erro desconhecido");
    return NextResponse.json({ ok: false, error: "Não foi possível solicitar a conta agora." }, { status: 503 });
  }
}
