import { NextRequest, NextResponse } from "next/server";
import { lerSessaoSalao } from "@/lib/salaoAuth";
import { reabrirAtendimentoSalao, solicitarContaSalao } from "@/lib/salaoConta.server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessao = await lerSessaoSalao(req);
  if (!sessao) return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const acao = typeof body?.acao === "string" ? body.acao : "";
  const responsavel = "Salão";

  try {
    const resultado = acao === "solicitar"
      ? await solicitarContaSalao(id, responsavel)
      : acao === "reabrir"
        ? await reabrirAtendimentoSalao(id, responsavel)
        : { ok: false as const, status: 400, error: "Ação inválida." };

    if (!resultado.ok) {
      const code = "code" in resultado && typeof resultado.code === "string" ? resultado.code : undefined;
      return NextResponse.json({ ok: false, error: resultado.error, ...(code ? { code } : {}) }, { status: resultado.status });
    }
    return NextResponse.json({ ok: true, ...resultado });
  } catch (error) {
    console.error("[Salão] Falha ao atualizar conta:", error instanceof Error ? error.message : "erro desconhecido");
    return NextResponse.json({ ok: false, error: "Não foi possível atualizar a conta agora." }, { status: 503 });
  }
}
