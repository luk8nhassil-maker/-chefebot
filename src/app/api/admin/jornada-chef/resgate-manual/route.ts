import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { aplicarResgateManual, revogarCodigoResgate, substituirRecompensa } from "@/lib/jornadaChef";

// POST /api/admin/jornada-chef/resgate-manual — fallback obrigatório da
// Kellyne (rule 15): aplica manualmente um presente pelo código público de
// resgate, sem depender do fluxo automático de carrinho/pedido do site.

async function checkAuth(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || !["admin", "atendente", "dev"].includes(payload.role as string)) return null;
  return payload;
}

export async function POST(req: NextRequest) {
  const auth = await checkAuth(req);
  if (!auth) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const acao = body?.acao;

  try {
    if (acao === "aplicar") {
      const codigo = String(body?.codigoPublico ?? "").trim();
      if (!codigo) return NextResponse.json({ ok: false, error: "codigoPublico obrigatorio" }, { status: 400 });
      const recompensa = await aplicarResgateManual(codigo, auth.username as string);
      return NextResponse.json({ ok: true, recompensaId: recompensa.recompensaId, status: recompensa.status });
    }
    if (acao === "revogar_codigo") {
      const recompensaId = String(body?.recompensaId ?? "").trim();
      if (!recompensaId) return NextResponse.json({ ok: false, error: "recompensaId obrigatorio" }, { status: 400 });
      const recompensa = await revogarCodigoResgate(recompensaId);
      return NextResponse.json({ ok: true, codigoPublico: recompensa.codigoPublico });
    }
    if (acao === "substituir") {
      if (auth.role !== "admin" && auth.role !== "dev") {
        return NextResponse.json({ error: "Nao autorizado" }, { status: 403 });
      }
      const recompensaId = String(body?.recompensaId ?? "").trim();
      const novoProdutoId = String(body?.novoProdutoId ?? "").trim();
      const novoProdutoNome = String(body?.novoProdutoNome ?? "").trim();
      const motivo = String(body?.motivo ?? "").trim();
      if (!recompensaId || !novoProdutoId || !novoProdutoNome || !motivo) {
        return NextResponse.json({ ok: false, error: "Campos obrigatorios ausentes" }, { status: 400 });
      }
      const recompensa = await substituirRecompensa(recompensaId, novoProdutoId, novoProdutoNome, motivo, auth.username as string);
      return NextResponse.json({ ok: true, recompensaId: recompensa.recompensaId, produtoNome: recompensa.produtoNome });
    }
    return NextResponse.json({ ok: false, error: "Acao invalida" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Nao foi possivel processar" }, { status: 400 });
  }
}
