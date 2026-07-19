import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { obterPendencias, resolverPendencia } from "@/lib/jornadaChef";

// GET/POST /api/admin/jornada-chef/pendencias — fila de revisão manual da
// Kellyne (reversões que não puderam ser resolvidas automaticamente, rule 9).

async function checkAuth(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || !["admin", "atendente", "dev"].includes(payload.role as string)) return null;
  return payload;
}

export async function GET(req: NextRequest) {
  const auth = await checkAuth(req);
  if (!auth) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  const incluirResolvidas = new URL(req.url).searchParams.get("todas") === "1";
  const pendencias = await obterPendencias(undefined, incluirResolvidas);
  return NextResponse.json({ pendencias });
}

export async function POST(req: NextRequest) {
  const auth = await checkAuth(req);
  if (!auth) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const pendenciaId = String(body?.pendenciaId ?? "").trim();
  const nota = String(body?.nota ?? "").trim();
  if (!pendenciaId) return NextResponse.json({ ok: false, error: "pendenciaId obrigatorio" }, { status: 400 });

  await resolverPendencia(pendenciaId, auth.username as string, nota);
  return NextResponse.json({ ok: true });
}
