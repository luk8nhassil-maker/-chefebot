import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { reconciliarPixMercadoPago } from "@/lib/mercadoPagoReconciliacao";

// Rota admin sob-demanda (Nivel 6.2A): dispara a conciliação manual de Pix
// Mercado Pago pendentes, enquanto não há webhook configurado no painel MP.
// Mesmo padrão de autenticação de /api/admin/integracoes/mercadopago.

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

  const resumo = await reconciliarPixMercadoPago();
  return NextResponse.json({ ok: true, ...resumo });
}
