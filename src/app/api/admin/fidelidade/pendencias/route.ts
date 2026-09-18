import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import {
  obterPendenciasEfeitosFidelidade,
  reprocessarPendenciaEfeitosFidelidade,
} from "@/lib/fidelidadeEfeitos";

async function requireAdminOrDev(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return { ok: false as const, status: 401 };
  const user = await verifyToken(token);
  if (!user) return { ok: false as const, status: 401 };
  if (user.role !== "admin" && user.role !== "dev") return { ok: false as const, status: 403 };
  return { ok: true as const };
}

export async function GET(req: NextRequest) {
  const auth = await requireAdminOrDev(req);
  if (!auth.ok) return NextResponse.json({ error: "Nao autorizado" }, { status: auth.status });
  const pendencias = await obterPendenciasEfeitosFidelidade();
  return NextResponse.json({ pendencias });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminOrDev(req);
  if (!auth.ok) return NextResponse.json({ error: "Nao autorizado" }, { status: auth.status });

  const body = await req.json().catch(() => ({}));
  const pedidoId = String(body?.pedidoId ?? "").trim();
  const acao = body?.acao === "cancelado" ? "cancelado" : body?.acao === "entregue" ? "entregue" : null;
  if (!pedidoId || !acao) {
    return NextResponse.json({ ok: false, error: "pedidoId e acao obrigatorios" }, { status: 400 });
  }

  await reprocessarPendenciaEfeitosFidelidade(pedidoId, acao);
  return NextResponse.json({ ok: true });
}
