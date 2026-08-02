import { NextRequest, NextResponse } from "next/server";
import { lerSessaoAdministrativa } from "@/lib/sessaoAdministrativa";
import { revogarSessoesSalao } from "@/lib/salaoAuth";

// Revoga imediatamente todas as sessões do terminal do Salão, sem trocar o
// código de acesso — mesmo nível de autorização de /api/admin/salao/config
// (só admin/dev).
function autorizado(role: string | undefined): boolean {
  return role === "admin" || role === "dev";
}

export async function POST(req: NextRequest) {
  const sessao = await lerSessaoAdministrativa(req);
  if (!sessao || !autorizado(sessao.role)) {
    return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }
  await revogarSessoesSalao();
  return NextResponse.json({ ok: true });
}
