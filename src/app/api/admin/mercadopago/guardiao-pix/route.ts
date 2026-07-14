import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { executarGuardiaoPix } from "@/lib/pixGuardiao";

// Rota admin sob-demanda — Guardião Pix. Mesmo padrão de autenticação de
// /api/admin/mercadopago/reconciliar-pix (o Guardião reaproveita o mesmo
// mecanismo central de confirmação, nunca cria um caminho novo). Só avalia
// saúde operacional e, quando seguro, reencaminha pagamentos travados para a
// fila de verificação — nunca confirma nada por si mesmo.

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
  if (!auth.ok) return NextResponse.json({ error: "Nao autorizado" }, { status: auth.status });

  const resultado = await executarGuardiaoPix();
  return NextResponse.json({ ok: true, ...resultado });
}
