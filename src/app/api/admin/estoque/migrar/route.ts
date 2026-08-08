// Fase 11 — Migração de dados: popula "estoque:itens" (disponibilidade por ID
// estável) a partir da lista legada "esgotados" (por nome), sem apagá-la.
//
// Só admin/dev pode executar (mais restrito que o PATCH /api/cardapio, que
// também aceita atendente — esta é uma operação de dado, não de operação
// diária da loja). Dry-run primeiro é o uso esperado antes de migrar de
// verdade; a migração real sempre cria backup e é idempotente (ver
// @/lib/estoque). Reversão usa a chave de backup devolvida pela migração.
import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { getMENUDinamico } from "@/lib/menu.server";
import { migrarEsgotadosParaEstoque, reverterMigracaoEstoque } from "@/lib/estoque";

async function requireAdminOrDev(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return { ok: false as const, status: 401 };
  const user = await verifyToken(token);
  if (!user) return { ok: false as const, status: 401 };
  if (user.role !== "admin" && user.role !== "dev") return { ok: false as const, status: 403 };
  return { ok: true as const, user };
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminOrDev(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: "Nao autorizado" }, { status: auth.status });

  let body: { acao?: string; chaveBackup?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Corpo invalido" }, { status: 400 });
  }

  if (body.acao === "reverter") {
    if (typeof body.chaveBackup !== "string" || !body.chaveBackup) {
      return NextResponse.json({ ok: false, error: "chaveBackup obrigatoria" }, { status: 400 });
    }
    const resultado = await reverterMigracaoEstoque(body.chaveBackup);
    return NextResponse.json(resultado, { status: resultado.ok ? 200 : 404 });
  }

  if (body.acao !== "dry-run" && body.acao !== "migrar") {
    return NextResponse.json({ ok: false, error: 'acao deve ser "dry-run", "migrar" ou "reverter"' }, { status: 400 });
  }

  const menu = await getMENUDinamico();
  const relatorio = await migrarEsgotadosParaEstoque({ menu, dryRun: body.acao === "dry-run" });
  return NextResponse.json({ ok: true, relatorio });
}
