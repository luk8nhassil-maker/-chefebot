import { NextRequest, NextResponse } from "next/server";
import { autenticarEntregador } from "@/lib/entregadorAuth";

export async function GET(req: NextRequest) {
  try {
    const auth = await autenticarEntregador(req);
    if (!auth) {
      return NextResponse.json({ ok: false, error: "Não autenticado" }, { status: 401 });
    }
    return NextResponse.json({
      ok: true,
      entregador: { id: auth.entregador.id, nome: auth.entregador.nome },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Não foi possível validar a sessão" }, { status: 503 });
  }
}
