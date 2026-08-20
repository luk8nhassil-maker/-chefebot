import { NextRequest, NextResponse } from "next/server";
import { lerSessaoSalao } from "@/lib/salaoAuth";
import { fecharContaSalao } from "@/lib/salaoConta.server";
import { sanitizeClientRequestId } from "@/survival/clientRequestId";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessao = await lerSessaoSalao(req);
  if (!sessao) return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ ok: false, error: "Payload inválido" }, { status: 400 });

  const requestId = sanitizeClientRequestId((body as { requestId?: unknown }).requestId);
  if (!requestId) return NextResponse.json({ ok: false, error: "Identificador de fechamento é obrigatório." }, { status: 400 });

  try {
    const resultado = await fecharContaSalao({
      comandaId: id,
      responsavel: "Terminal do salão",
      requestId,
      totalEsperadoCentavos: (body as { totalEsperadoCentavos?: unknown }).totalEsperadoCentavos,
      pagamento: (body as { pagamento?: unknown }).pagamento,
      troco: (body as { troco?: unknown }).troco,
      valorPix: (body as { valorPix?: unknown }).valorPix,
      valorDinheiro: (body as { valorDinheiro?: unknown }).valorDinheiro,
    });
    if (!resultado.ok) {
      const code = "code" in resultado && typeof resultado.code === "string" ? resultado.code : undefined;
      return NextResponse.json({ ok: false, error: resultado.error, ...(code ? { code } : {}) }, { status: resultado.status });
    }
    return NextResponse.json({ ok: true, estado: resultado.estado, deduplicado: resultado.deduplicado });
  } catch (error) {
    console.error("[Salão] Falha ao receber conta no terminal:", error instanceof Error ? error.message : "erro desconhecido");
    return NextResponse.json({ ok: false, error: "Não foi possível fechar a conta agora." }, { status: 503 });
  }
}
