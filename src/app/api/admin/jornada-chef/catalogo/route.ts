import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { obterCatalogoJornada } from "@/lib/jornadaChef";

// GET /api/admin/jornada-chef/catalogo — catálogo real do cardápio dinâmico
// oficial (tamanhos de pizza, sabores, itens individuais com status de
// esgotado), para o construtor de "Sequência de presentes" no painel da
// Kellyne. Nunca duplicado/hardcodado no frontend — sempre lido daqui.

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
  const catalogo = await obterCatalogoJornada();
  return NextResponse.json(catalogo);
}
