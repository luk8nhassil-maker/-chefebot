import { NextRequest, NextResponse } from "next/server";
import { sugerirRuas } from "@/lib/ruasConhecidas";

// Autocomplete de rua do checkout do cliente — leitura pública, só devolve
// nomes de rua já usados por qualquer cliente (memória universal, sem
// número/referência/dado pessoal — ver src/lib/ruasConhecidas.ts). A
// gravação NUNCA acontece aqui: só depois de um pedido confirmado
// (src/app/api/pedido-app/route.ts).
export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams.get("q") || "";
    if (q.trim().length < 2) return NextResponse.json({ ok: true, ruas: [] });
    const ruas = await sugerirRuas(q);
    return NextResponse.json({ ok: true, ruas });
  } catch {
    // Autocomplete é 100% opcional — falha aqui nunca deve travar o campo,
    // o cliente continua digitando manualmente.
    return NextResponse.json({ ok: true, ruas: [] });
  }
}
